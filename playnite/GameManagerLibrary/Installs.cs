using Playnite.SDK.Data;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace GameManagerLibrary
{
    /// <summary>The .game-manager.json file the desktop app writes into every install folder.</summary>
    public class InstallManifest
    {
        public string gameId { get; set; }
        public string title { get; set; }
        public string installedAt { get; set; }
        public string executable { get; set; }
    }

    public static class Installs
    {
        public const string ManifestName = ".game-manager.json";

        public static InstallManifest Read(string dir)
        {
            try
            {
                var file = Path.Combine(dir, ManifestName);
                return File.Exists(file) ? Serialization.FromJson<InstallManifest>(File.ReadAllText(file)) : null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Installs on this PC, keyed by game id. The server remembers where each profile installed
        /// what; a path only counts when it exists here and holds the matching manifest.
        /// </summary>
        public static Dictionary<string, string> OnThisPc(IEnumerable<ServerGameState> states)
        {
            var found = new Dictionary<string, string>();
            foreach (var s in states.Where(s => s.installedAt != null && s.uninstalledAt == null && !string.IsNullOrEmpty(s.installPath)))
            {
                var m = Read(s.installPath);
                if (m != null && m.gameId == s.gameId) found[s.gameId] = s.installPath;
            }
            return found;
        }

        private static readonly string[] NotTheGame = { "unins", "setup", "install", "redist", "vcredist", "directx", "dxsetup", "crash", "report", "helper", "launcher_", "ue4prereq", "dotnet" };

        /// <summary>Same idea as the desktop app's guess: the biggest .exe that isn't an installer or helper.</summary>
        public static string GuessExecutable(string dir)
        {
            var m = Read(dir);
            if (m?.executable != null && File.Exists(Path.Combine(dir, m.executable))) return Path.Combine(dir, m.executable);
            try
            {
                return Directory.EnumerateFiles(dir, "*.exe", SearchOption.AllDirectories)
                    .Where(f => !NotTheGame.Any(n => Path.GetFileName(f).ToLowerInvariant().Contains(n)))
                    .OrderBy(f => f.Count(c => c == Path.DirectorySeparatorChar))
                    .ThenByDescending(f => new FileInfo(f).Length)
                    .FirstOrDefault();
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Deletes an install folder, but only one the desktop app created.</summary>
        public static void Delete(string dir)
        {
            if (Read(dir) == null) throw new InvalidOperationException($"{dir} has no {ManifestName}, so it was not installed by LootDen; not deleting it.");
            Directory.Delete(dir, true);
        }
    }
}
