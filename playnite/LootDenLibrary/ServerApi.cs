using Playnite.SDK.Data;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;

namespace LootDenLibrary
{
    // Mirrors the JSON shapes in packages/shared/src/index.ts.
    public class ServerGame
    {
        public string id { get; set; }
        public string title { get; set; }
        public long sizeBytes { get; set; }
        public string coverUrl { get; set; }
        public List<string> genres { get; set; }
        public int? releaseYear { get; set; }
        public int? rating { get; set; }
        public string addedAt { get; set; }
    }

    public class ServerGameDetail : ServerGame
    {
        public ServerMetadata metadata { get; set; }
    }

    public class ServerMetadata
    {
        public string summary { get; set; }
    }

    public class ServerGameState
    {
        public string gameId { get; set; }
        public string device { get; set; }
        public string installedAt { get; set; }
        public string uninstalledAt { get; set; }
        public string installPath { get; set; }
    }

    public class ServerApi
    {
        private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        private readonly LootDenSettings settings;

        public ServerApi(LootDenSettings settings)
        {
            this.settings = settings;
        }

        public string BaseUrl => (settings.ServerUrl ?? "").TrimEnd('/');

        public bool Configured => !string.IsNullOrWhiteSpace(settings.ServerUrl) && !string.IsNullOrWhiteSpace(settings.ApiToken);

        /// <summary>Absolute URL that works without headers, e.g. for cover images Playnite downloads itself.</summary>
        public string WithToken(string serverPath)
        {
            var sep = serverPath.Contains("?") ? "&" : "?";
            return BaseUrl + serverPath + sep + "token=" + Uri.EscapeDataString(settings.ApiToken);
        }

        private async Task<string> Send(HttpMethod method, string path, object body = null)
        {
            var req = new HttpRequestMessage(method, BaseUrl + path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiToken);
            if (body != null)
            {
                req.Content = new StringContent(Serialization.ToJson(body), Encoding.UTF8, "application/json");
            }
            var res = await http.SendAsync(req).ConfigureAwait(false);
            var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                throw new Exception($"LootDen server returned {(int)res.StatusCode} for {path}: {text}");
            }
            return text;
        }

        public async Task<List<ServerGame>> Games() =>
            Serialization.FromJson<List<ServerGame>>(await Send(HttpMethod.Get, "/api/games").ConfigureAwait(false));

        public async Task<ServerGameDetail> Game(string id) =>
            Serialization.FromJson<ServerGameDetail>(await Send(HttpMethod.Get, "/api/games/" + Uri.EscapeDataString(id)).ConfigureAwait(false));

        public async Task<List<ServerGameState>> MyGames() =>
            Serialization.FromJson<List<ServerGameState>>(await Send(HttpMethod.Get, "/api/me/games").ConfigureAwait(false));

        public Task Report(string gameId, string evt, string installPath = null, ulong seconds = 0) =>
            Send(HttpMethod.Post, "/api/me/activity", new Dictionary<string, object>
            {
                ["gameId"] = gameId,
                ["device"] = Environment.MachineName,
                ["event"] = evt,
                ["installPath"] = installPath,
                ["seconds"] = seconds,
            });
    }
}
