using Playnite.SDK;
using Playnite.SDK.Models;
using Playnite.SDK.Plugins;
using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace GameManagerLibrary
{
    /// <summary>
    /// Hands the install to the desktop app (gamemanager://install/id), then waits for the server
    /// to say this PC has it. The desktop app does the download, unpack and archive cleanup.
    /// </summary>
    public class GameManagerInstallController : InstallController
    {
        private readonly ServerApi api;
        private CancellationTokenSource watch;

        public GameManagerInstallController(Game game, ServerApi api) : base(game)
        {
            Name = "Install with Game Manager";
            this.api = api;
        }

        public override void Install(InstallActionArgs args)
        {
            try
            {
                Process.Start("gamemanager://install/" + Game.GameId);
            }
            catch (Exception)
            {
                // Desktop app not installed: open the game's page so it can be downloaded from the browser.
                Process.Start(api.BaseUrl + "/games/" + Game.GameId);
            }
            watch = new CancellationTokenSource();
            var token = watch.Token;
            Task.Run(async () =>
            {
                var until = DateTime.UtcNow.AddHours(12);
                while (!token.IsCancellationRequested && DateTime.UtcNow < until)
                {
                    try
                    {
                        if (Installs.OnThisPc(await api.MyGames()).TryGetValue(Game.GameId, out var dir))
                        {
                            InvokeOnInstalled(new GameInstalledEventArgs(new GameInstallationData { InstallDirectory = dir }));
                            return;
                        }
                    }
                    catch (Exception e)
                    {
                        LogManager.GetLogger().Warn(e, "Game Manager: checking install state failed");
                    }
                    await Task.Delay(TimeSpan.FromSeconds(5), token).ContinueWith(_ => { });
                }
            });
        }

        public override void Dispose()
        {
            watch?.Cancel();
            base.Dispose();
        }
    }

    public class GameManagerUninstallController : UninstallController
    {
        private readonly ServerApi api;

        public GameManagerUninstallController(Game game, ServerApi api) : base(game)
        {
            Name = "Uninstall";
            this.api = api;
        }

        public override void Uninstall(UninstallActionArgs args)
        {
            Installs.Delete(Game.InstallDirectory);
            try
            {
                api.Report(Game.GameId, "uninstalled").Wait();
            }
            catch (Exception e)
            {
                LogManager.GetLogger().Warn(e, "Game Manager: reporting uninstall failed");
            }
            InvokeOnUninstalled(new GameUninstalledEventArgs());
        }
    }
}
