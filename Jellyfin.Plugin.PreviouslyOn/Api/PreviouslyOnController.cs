using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PreviouslyOn.Api;

[ApiController]
[Route("PreviouslyOn")]
public class PreviouslyOnController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly RecapService _recaps;
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;

    public PreviouslyOnController(RecapService recaps, ILibraryManager library, IUserManager users)
    {
        _recaps = recaps;
        _library = library;
        _users = users;
    }

    // ------------------------------------------------------------------ client assets (anonymous: loaded before login)

    [HttpGet("ClientScript")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public ActionResult GetClientScript()
    {
        var plugin = Plugin.Instance;
        if (plugin is null)
        {
            return NotFound();
        }

        var cfg = plugin.Configuration;
        var clientConfig = new { cfg.Enabled, Version = plugin.CacheKey };
        var script = "window.PreviouslyOnConfig = " + JsonSerializer.Serialize(clientConfig, JsonOptions) + ";\n"
            + ReadResource("Web.previouslyon.js");
        Response.Headers.CacheControl = "public, max-age=86400";
        return Content(script, "application/javascript; charset=utf-8");
    }

    [HttpGet("ClientStyle")]
    [AllowAnonymous]
    [Produces("text/css")]
    public ActionResult GetClientStyle()
    {
        Response.Headers.CacheControl = "public, max-age=86400";
        return Content(ReadResource("Web.previouslyon.css"), "text/css; charset=utf-8");
    }

    // ------------------------------------------------------------------ recap

    /// <summary>The recap to show before this episode starts, for the calling user.</summary>
    [HttpGet("Recap/{itemId}")]
    [Authorize]
    public ActionResult GetRecap([FromRoute] Guid itemId)
    {
        var claim = User.FindFirst("Jellyfin-UserId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var user = Guid.TryParse(claim, out var userId) ? _users.GetUserById(userId) : null;
        if (user is null)
        {
            return Json(new Recap(false, "noUser"));
        }

        var item = _library.GetItemById(itemId);
        if (item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        if (item is not Episode episode)
        {
            return Json(new Recap(false, "notAnEpisode"));
        }

        return Json(_recaps.Build(episode, user));
    }

    // Jellyfin's own formatter writes PascalCase; the client script expects camelCase.
    private ContentResult Json(Recap recap)
    {
        Response.Headers.CacheControl = "no-store";
        return Content(JsonSerializer.Serialize(recap, JsonOptions), "application/json; charset=utf-8");
    }

    private static string ReadResource(string relativeName)
    {
        var asm = Assembly.GetExecutingAssembly();
        var name = $"{typeof(Plugin).Namespace}.{relativeName}";
        using var stream = asm.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Missing embedded resource {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
