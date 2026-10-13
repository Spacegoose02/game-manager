using Playnite.SDK;
using Playnite.SDK.Data;
using System;
using System.Collections.Generic;

namespace GameManagerLibrary
{
    public class GameManagerSettings : ObservableObject
    {
        private string serverUrl = "";
        private string apiToken = "";

        /// <summary>Address of the Game Manager server, e.g. http://tower:8080</summary>
        public string ServerUrl { get => serverUrl; set => SetValue(ref serverUrl, value); }

        /// <summary>A personal token from Profile, Devices and tokens.</summary>
        public string ApiToken { get => apiToken; set => SetValue(ref apiToken, value); }
    }

    public class GameManagerSettingsViewModel : ObservableObject, ISettings
    {
        private readonly GameManagerLibrary plugin;
        private GameManagerSettings editingClone;
        private GameManagerSettings settings;

        public GameManagerSettings Settings { get => settings; set => SetValue(ref settings, value); }

        public GameManagerSettingsViewModel(GameManagerLibrary plugin)
        {
            this.plugin = plugin;
            Settings = plugin.LoadPluginSettings<GameManagerSettings>() ?? new GameManagerSettings();
        }

        public void BeginEdit() => editingClone = Serialization.GetClone(Settings);

        public void CancelEdit() => Settings = editingClone;

        public void EndEdit() => plugin.SavePluginSettings(Settings);

        public bool VerifySettings(out List<string> errors)
        {
            errors = new List<string>();
            if (!Uri.TryCreate(Settings.ServerUrl, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https"))
                errors.Add("Server address must start with http:// or https://");
            if (string.IsNullOrWhiteSpace(Settings.ApiToken))
                errors.Add("Paste a personal token from your Game Manager profile page.");
            return errors.Count == 0;
        }
    }
}
