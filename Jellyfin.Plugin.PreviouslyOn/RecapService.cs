using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.PreviouslyOn;

/// <summary>A previous episode in the recap.</summary>
public sealed record RecapEpisode(Guid Id, string Name, int? Season, int? Episode, string? Overview, bool HasImage, bool Played);

/// <summary>The recap for one episode, or the reason there is none.</summary>
public sealed record Recap(
    bool Show,
    string Reason,
    Guid? SeriesId = null,
    string? SeriesName = null,
    DateTime? LastPlayed = null,
    int? GapDays = null,
    string? SeasonName = null,
    string? SeasonOverview = null,
    IReadOnlyList<RecapEpisode>? Episodes = null);

/// <summary>
/// Builds the recap purely from what the library already knows: the episode and season
/// descriptions from the metadata, and the user's own playback history. No external requests.
/// </summary>
public sealed class RecapService
{
    private readonly ILibraryManager _library;
    private readonly IUserDataManager _userData;

    public RecapService(ILibraryManager library, IUserDataManager userData)
    {
        _library = library;
        _userData = userData;
    }

    public Recap Build(Episode current, User user)
    {
        var cfg = Plugin.Instance?.Configuration;
        if (cfg is null || !cfg.Enabled)
        {
            return new Recap(false, "disabled");
        }

        var series = current.Series;
        if (series is null)
        {
            return new Recap(false, "noSeries");
        }

        // Specials have no place in the running story.
        if (current.ParentIndexNumber is null or 0 || current.IndexNumber is null)
        {
            return new Recap(false, "special");
        }

        var episodes = _library.GetItemList(new InternalItemsQuery(user)
            {
                AncestorIds = new[] { series.Id },
                IncludeItemTypes = new[] { BaseItemKind.Episode },
                Recursive = true,
                IsVirtualItem = false
            })
            .OfType<Episode>()
            .Where(e => e.ParentIndexNumber is > 0 && e.IndexNumber is not null)
            .GroupBy(e => (e.ParentIndexNumber!.Value, e.IndexNumber!.Value)) // one per episode, even with several versions
            .Select(g => g.First())
            .OrderBy(e => e.ParentIndexNumber)
            .ThenBy(e => e.IndexNumber)
            .ToList();

        var data = episodes.ToDictionary(e => e.Id, e => _userData.GetUserData(user, e));

        // The break: since anything of the series (the current episode included, when it is resumed) was last played.
        var lastPlayed = data.Values
            .Where(d => d is not null && d.LastPlayedDate is not null && (d.Played || d.PlaybackPositionTicks > 0))
            .Select(d => d!.LastPlayedDate!.Value)
            .DefaultIfEmpty()
            .Max();
        if (lastPlayed == default)
        {
            return new Recap(false, "neverWatched");
        }

        var gap = DateTime.UtcNow - DateTime.SpecifyKind(lastPlayed, DateTimeKind.Utc);
        if (gap.TotalDays < Math.Max(0, cfg.MinGapDays))
        {
            return new Recap(false, "noBreak", series.Id, series.Name, lastPlayed, (int)gap.TotalDays);
        }

        var index = episodes.FindIndex(e => e.ParentIndexNumber == current.ParentIndexNumber && e.IndexNumber == current.IndexNumber);
        if (index <= 0)
        {
            return new Recap(false, "firstEpisode", series.Id, series.Name, lastPlayed, (int)gap.TotalDays);
        }

        var count = Math.Clamp(cfg.EpisodeCount, 1, 10);
        var previous = episodes.Skip(Math.Max(0, index - count)).Take(index - Math.Max(0, index - count))
            .Select(e => new RecapEpisode(
                e.Id,
                e.Name,
                e.ParentIndexNumber,
                e.IndexNumber,
                string.IsNullOrWhiteSpace(e.Overview) ? null : e.Overview.Trim(),
                cfg.ShowImages && e.HasImage(ImageType.Primary),
                data.TryGetValue(e.Id, out var d) && d is not null && d.Played))
            .ToList();

        // A new season starts: the previous season's description sums up what came before.
        string? seasonName = null;
        string? seasonOverview = null;
        var prev = episodes[index - 1];
        if (cfg.IncludeSeasonOverview && prev.ParentIndexNumber != current.ParentIndexNumber && prev.Season is { } prevSeason
            && !string.IsNullOrWhiteSpace(prevSeason.Overview))
        {
            seasonName = prevSeason.Name;
            seasonOverview = prevSeason.Overview.Trim();
        }

        if (seasonOverview is null && previous.All(e => e.Overview is null))
        {
            return new Recap(false, "noDescriptions", series.Id, series.Name, lastPlayed, (int)gap.TotalDays);
        }

        return new Recap(true, "ok", series.Id, series.Name, lastPlayed, (int)gap.TotalDays, seasonName, seasonOverview, previous);
    }
}
