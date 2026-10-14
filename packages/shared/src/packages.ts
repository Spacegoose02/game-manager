// Telling full games apart from update and DLC packages by their file or folder names.

/** "game": installs on its own. "update": a patch applied over an installed game. "dlc": extra content for one. */
export type PackageKind = "game" | "update" | "dlc";

export interface PackageInfo {
  kind: PackageKind;
  /** The game's name with the update or DLC wording and version removed, for matching to the base game. */
  baseTitle: string;
  /** The version the package brings the game to ("1.3.0.5"), or a full game's own version. */
  version: string | null;
  /** The version an update expects to be installed first, when the name says ("v1.2 to v1.3"). */
  fromVersion: string | null;
}

const VERSION = String.raw`v(?:ersion)?[ ._]?(\d+(?:[._]\d+){0,3}[a-z]?)`;
/** "Update", "Patch", "Hotfix", "Title Update 3", "TU5". */
const UPDATE_WORD = /(?<![a-z])(title[ ._-]?update|update|patch|hot[ ._-]?fix|tu\d+)(?![a-z])/i;
const DLC_WORD = /(?<![a-z])(dlc|expansion[ ._-]?pack|season[ ._-]?pass|add[ ._-]?on)(?![a-z])/i;
/** "incl. Update 3", "+ 5 DLCs", "with Patch": a full game that already contains them. */
const BUNDLED = /(?<![a-z])(incl(?:uding|\.)?|with|plus|and|\+|complete|goty|edition|bundle|collection)[ ._-]*(?:all[ ._-]+)?(?:\d+[ ._-]*)?(?:the[ ._-]+)?(title[ ._-]?update|update|patch|hot[ ._-]?fix|dlcs?|expansions?)/i;
/** "v1.2 to v1.3", "v1.2-v1.3", "from v1.2". */
const FROM_TO = new RegExp(String.raw`${VERSION}[ ._]*(?:to|-|_|→|->)[ ._]*${VERSION}`, "i");
const FROM = new RegExp(String.raw`(?<![a-z])from[ ._]+${VERSION}`, "i");
const ANY_VERSION = new RegExp(String.raw`(?<![a-z0-9])${VERSION}(?![a-z0-9])`, "gi");

const clean = (v: string) => v.replace(/_/g, ".");

/** Reads what a library entry is from its name ("Game.Update.v1.3-GROUP", "Game v1.2 to v1.3 Patch.zip"). */
export function packageInfo(name: string, folderHint?: "update" | "dlc"): PackageInfo {
  const base = name.replace(/(\.part\d+)?\.(zip|7z|rar|exe|msi)(\.\d{3})?$/i, "");
  const fromTo = base.match(FROM_TO);
  const versions = [...base.matchAll(ANY_VERSION)].map((m) => clean(m[1]!));
  const fromVersion = fromTo ? clean(fromTo[1]!) : (base.match(FROM)?.[1] ? clean(base.match(FROM)![1]!) : null);
  const version = fromTo ? clean(fromTo[2]!) : (versions.filter((v) => v !== fromVersion).pop() ?? null);

  let kind: PackageKind = "game";
  if (!BUNDLED.test(base)) {
    // A name that starts with the word ("Patch Quest") is a game's title, not a patch.
    if ((UPDATE_WORD.test(base) && base.search(UPDATE_WORD) > 0) || fromTo || fromVersion) kind = "update";
    else if (DLC_WORD.test(base)) kind = "dlc";
  }
  if (kind === "game" && folderHint) kind = folderHint;

  // The base game's name is everything before the first update/DLC word or version.
  const cut = kind === "game" ? -1 : Math.min(...[UPDATE_WORD, DLC_WORD, new RegExp(String.raw`(?<![a-z0-9])${VERSION}`, "i"), /(?<![a-z])from[ ._]/i].map((re) => base.search(re)).filter((i) => i > 0));
  const head = cut > 0 && Number.isFinite(cut) ? base.slice(0, cut) : base;
  const baseTitle = head
    .replace(/[([{].*$/, "")
    .replace(/-[a-z0-9]+$/i, (m) => (/[a-z]/i.test(m) && m === m.toUpperCase() ? "" : m)) // trailing -GROUP
    .replace(/[._]+/g, " ")
    .replace(/[\s-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { kind, baseTitle: baseTitle || base, version, fromVersion };
}

/** -1, 0 or 1, comparing dotted version numbers ("1.10.2" > "1.9"). */
export function compareVersion(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^build\s*/i, "").split(/[._-]/).map((x) => parseInt(x, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
