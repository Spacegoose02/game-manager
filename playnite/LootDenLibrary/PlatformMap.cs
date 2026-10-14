using Playnite.SDK;
using Playnite.SDK.Models;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace LootDenLibrary
{
    /// <summary>
    /// Maps LootDen's platform ids (the Emulation/&lt;system&gt; folder names, see
    /// packages/shared/src/platforms.ts) to Playnite's platform specification ids, so each
    /// system shows under its own platform instead of everything under PC.
    /// </summary>
    public static class PlatformMap
    {
        private static readonly Dictionary<string, string> SpecIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["pc"] = "pc_windows",
            ["windows"] = "pc_windows",
            ["linux"] = "pc_linux",
            ["dos"] = "pc_dos",
            ["ps1"] = "sony_playstation",
            ["psx"] = "sony_playstation",
            ["playstation"] = "sony_playstation",
            ["ps2"] = "sony_playstation2",
            ["ps3"] = "sony_playstation3",
            ["ps4"] = "sony_playstation4",
            ["ps5"] = "sony_playstation5",
            ["psp"] = "sony_psp",
            ["vita"] = "sony_vita",
            ["psvita"] = "sony_vita",
            ["xbox"] = "xbox",
            ["xbox360"] = "xbox360",
            ["xboxone"] = "xbox_one",
            ["xboxseries"] = "xbox_series",
            ["switch"] = "nintendo_switch",
            ["nes"] = "nintendo_nes",
            ["famicom"] = "nintendo_nes",
            ["snes"] = "nintendo_super_nes",
            ["sfc"] = "nintendo_super_nes",
            ["n64"] = "nintendo_64",
            ["gb"] = "nintendo_gameboy",
            ["gbc"] = "nintendo_gameboycolor",
            ["gba"] = "nintendo_gameboyadvance",
            ["nds"] = "nintendo_ds",
            ["ds"] = "nintendo_ds",
            ["3ds"] = "nintendo_3ds",
            ["n3ds"] = "nintendo_3ds",
            ["gamecube"] = "nintendo_gamecube",
            ["gc"] = "nintendo_gamecube",
            ["wii"] = "nintendo_wii",
            ["wiiu"] = "nintendo_wiiu",
            ["genesis"] = "sega_genesis",
            ["megadrive"] = "sega_genesis",
            ["mastersystem"] = "sega_mastersystem",
            ["gamegear"] = "sega_gamegear",
            ["segacd"] = "sega_cd",
            ["32x"] = "sega_32x",
            ["saturn"] = "sega_saturn",
            ["dreamcast"] = "sega_dreamcast",
            ["atari2600"] = "atari_2600",
            ["turbografx16"] = "nec_turbografx_16",
            ["pcengine"] = "nec_turbografx_16",
        };

        /// <summary>Names for systems Playnite has no specification for, from the folder name.</summary>
        private static readonly Dictionary<string, string> Names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["arcade"] = "Arcade",
            ["mame"] = "Arcade",
        };

        /// <summary>The platform to give a LootDen game: a Playnite specification when one fits, else a named platform.</summary>
        public static MetadataProperty For(string platform)
        {
            var key = (platform ?? "pc").Replace(" ", "").Replace("_", "").Replace("-", "");
            if (SpecIds.TryGetValue(key, out var spec)) return new MetadataSpecProperty(spec);
            if (Names.TryGetValue(key, out var name)) return new MetadataNameProperty(name);
            return new MetadataNameProperty(CultureInfo.InvariantCulture.TextInfo.ToTitleCase(platform ?? "PC"));
        }

        /// <summary>
        /// Games imported before platforms were separated all say PC. Playnite only applies
        /// metadata to new games, so this moves existing LootDen games to their platform.
        /// </summary>
        public static int FixExisting(IPlayniteAPI playnite, Guid pluginId, IEnumerable<ServerGame> games)
        {
            var byId = games.ToDictionary(g => g.id, g => g.platform ?? "pc");
            var fixedCount = 0;
            using (playnite.Database.BufferedUpdate())
            {
                foreach (var game in playnite.Database.Games.Where(g => g.PluginId == pluginId).ToList())
                {
                    if (!byId.TryGetValue(game.GameId, out var platform)) continue;
                    var wanted = Resolve(playnite, For(platform));
                    if (wanted == null) continue;
                    if (game.PlatformIds != null && game.PlatformIds.Count == 1 && game.PlatformIds[0] == wanted.Id) continue;
                    game.PlatformIds = new List<Guid> { wanted.Id };
                    playnite.Database.Games.Update(game);
                    fixedCount++;
                }
            }
            return fixedCount;
        }

        /// <summary>Finds the Playnite platform for a property, adding it to the database if needed.</summary>
        private static Platform Resolve(IPlayniteAPI playnite, MetadataProperty property)
        {
            var platforms = playnite.Database.Platforms;
            if (property is MetadataSpecProperty spec)
            {
                var existing = platforms.FirstOrDefault(p => string.Equals(p.SpecificationId, spec.Id, StringComparison.OrdinalIgnoreCase));
                if (existing != null) return existing;
                var known = playnite.Emulation.Platforms.FirstOrDefault(p => p.Id == spec.Id);
                if (known == null) return null;
                var added = new Platform(known.Name) { SpecificationId = known.Id };
                platforms.Add(added);
                return added;
            }
            if (property is MetadataNameProperty named)
            {
                var existing = platforms.FirstOrDefault(p => string.Equals(p.Name, named.Name, StringComparison.OrdinalIgnoreCase));
                if (existing != null) return existing;
                var added = new Platform(named.Name);
                platforms.Add(added);
                return added;
            }
            return null;
        }
    }
}
