using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PreviouslyOn.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Gets or sets a value indicating whether the recap is shown in the web client.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the break (in days since anything of the series was last played) after which the recap appears.</summary>
    public int MinGapDays { get; set; } = 21;

    /// <summary>Gets or sets how many previous episodes are summarised.</summary>
    public int EpisodeCount { get; set; } = 3;

    /// <summary>Gets or sets a value indicating whether the description of the previous season is added when a new season starts.</summary>
    public bool IncludeSeasonOverview { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether episode images are shown next to the descriptions.</summary>
    public bool ShowImages { get; set; } = true;

    /// <summary>Gets or sets a value that changes on every save (part of the client cache key).</summary>
    public long Revision { get; set; }
}
