using Playnite.SDK;
using Playnite.SDK.Events;
using Playnite.SDK.Models;
using Playnite.SDK.Plugins;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Controls;

namespace GameManagerLibrary
{
    public class GameManagerLibrary : LibraryPlugin
    {
        private static readonly ILogger logger = LogManager.GetLogger();
        private GameManagerSettingsViewModel settings;

        public override Guid Id { get; } = Guid.Parse("cb17f98c-8f44-4e3a-8804-b3d7df8ca427");
        public override string Name => "LootDen";
        public override LibraryClient Client => null;

        private ServerApi Api => new ServerApi(settings.Settings);

        public GameManagerLibrary(IPlayniteAPI api) : base(api)
        {
            settings = new GameManagerSettingsViewModel(this);
            Properties = new LibraryPluginProperties { HasSettings = true, CanShutdownClient = false };
        }

        public override IEnumerable<GameMetadata> GetGames(LibraryGetGamesArgs args)
        {
            var api = Api;
            if (!api.Configured)
            {
                PlayniteApi.Notifications.Add(new NotificationMessage("gm-setup", "LootDen: add your server address and token in the add-on settings.", NotificationType.Info));
                return Enumerable.Empty<GameMetadata>();
            }
            var games = api.Games().GetAwaiter().GetResult();
            var installed = Installs.OnThisPc(api.MyGames().GetAwaiter().GetResult());
            return games.Select(g =>
            {
                installed.TryGetValue(g.id, out var dir);
                return new GameMetadata
                {
                    GameId = g.id,
                    Name = g.title,
                    Source = new MetadataNameProperty("LootDen"),
                    Platforms = new HashSet<MetadataProperty> { new MetadataSpecProperty("pc_windows") },
                    Genres = g.genres == null ? null : new HashSet<MetadataProperty>(g.genres.Select(x => new MetadataNameProperty(x))),
                    ReleaseDate = g.releaseYear.HasValue ? new ReleaseDate(g.releaseYear.Value) : (ReleaseDate?)null,
                    CommunityScore = g.rating,
                    CoverImage = g.coverUrl != null ? new MetadataFile(api.WithToken(g.coverUrl)) : null,
                    InstallSize = (ulong)g.sizeBytes,
                    IsInstalled = dir != null,
                    InstallDirectory = dir,
                    Links = new List<Link> { new Link("LootDen", api.BaseUrl + "/games/" + g.id) },
                };
            }).ToList();
        }

        public override IEnumerable<InstallController> GetInstallActions(GetInstallActionsArgs args)
        {
            if (args.Game.PluginId == Id) yield return new GameManagerInstallController(args.Game, Api);
        }

        public override IEnumerable<UninstallController> GetUninstallActions(GetUninstallActionsArgs args)
        {
            if (args.Game.PluginId == Id) yield return new GameManagerUninstallController(args.Game, Api);
        }

        public override IEnumerable<PlayController> GetPlayActions(GetPlayActionsArgs args)
        {
            if (args.Game.PluginId != Id || string.IsNullOrEmpty(args.Game.InstallDirectory)) yield break;
            var exe = Installs.GuessExecutable(args.Game.InstallDirectory);
            if (exe == null)
            {
                PlayniteApi.Dialogs.ShowErrorMessage("No game executable found. Add a play action in Playnite (Edit, Actions) pointing at the game's .exe.", "LootDen");
                yield break;
            }
            yield return new AutomaticPlayController(args.Game)
            {
                Name = Path.GetFileNameWithoutExtension(exe),
                Type = AutomaticPlayActionType.File,
                TrackingMode = TrackingMode.Default,
                Path = exe,
                WorkingDir = Path.GetDirectoryName(exe),
            };
        }

        /// <summary>Sends Playnite's play time to the profile on the server.</summary>
        public override void OnGameStopped(OnGameStoppedEventArgs args)
        {
            if (args.Game.PluginId != Id || !Api.Configured) return;
            try
            {
                Api.Report(args.Game.GameId, "played", seconds: args.ElapsedSeconds).Wait();
            }
            catch (Exception e)
            {
                logger.Warn(e, "LootDen: reporting play time failed");
            }
        }

        public override ISettings GetSettings(bool firstRunSettings) => settings;

        public override UserControl GetSettingsView(bool firstRunSettings) => new GameManagerSettingsView { DataContext = settings };
    }
}
