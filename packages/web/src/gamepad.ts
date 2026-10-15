/**
 * Couch and handheld navigation: arrow keys and a gamepad (ROG Ally, Steam Deck,
 * any XInput pad) move focus between on-screen items by position, A activates,
 * B goes back. Mouse and touch keep working as normal.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

type Dir = "up" | "down" | "left" | "right";

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

export function moveFocus(dir: Dir): void {
  const items = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  const current = document.activeElement as HTMLElement | null;
  if (!current || current === document.body || !items.includes(current)) {
    (document.querySelector<HTMLElement>("main " + FOCUSABLE) ?? items[0])?.focus();
    return;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const ahead = dir === "right" ? dx > 4 : dir === "left" ? dx < -4 : dir === "down" ? dy > 4 : dy < -4;
    if (!ahead) continue;
    const main = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const cross = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

/** Left/right edit text and up/down change a select, so those keys stay with the control. Up/down leave a text box. */
const keepsKey = (el: Element | null, dir: Dir) =>
  el instanceof HTMLSelectElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(el.type) && (dir === "left" || dir === "right"));

/** A game has the controller: the in-browser player's frame is focused, or LootDen is in the background behind an emulator. */
function padBelongsElsewhere(): boolean {
  if (document.visibilityState === "hidden" || !document.hasFocus()) return true;
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement || document.fullscreenElement instanceof HTMLIFrameElement;
}

/** Controllers the browser can see right now. */
export const connectedPads = (): Gamepad[] => [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);

/**
 * Installs keyboard and gamepad navigation once for the whole app. onBack is read on every
 * press, so the caller can pass a fresh function without reinstalling (reinstalling used to
 * stop gamepad polling after the first page change, because "gamepadconnected" only fires once).
 */
export function installSpatialNavigation(onBack: () => void): () => void {
  const keys: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  const onKey = (e: KeyboardEvent) => {
    const dir = keys[e.key];
    if (!dir || keepsKey(document.activeElement, dir) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.activeElement instanceof HTMLIFrameElement) return;
    e.preventDefault();
    moveFocus(dir);
  };
  window.addEventListener("keydown", onKey);

  // Gamepad polling: d-pad / left stick move, A (0) clicks, B (1) goes back, the right
  // stick scrolls, and the shoulder buttons page up and down.
  let frame = 0;
  const held = new Map<string, number>();
  const repeat = (id: string, pressed: boolean, action: () => void) => {
    const now = performance.now();
    const since = held.get(id);
    if (!pressed) return void held.delete(id);
    if (since === undefined) {
      held.set(id, now + 250);
      action();
    } else if (now > since) {
      held.set(id, now + 90);
      action();
    }
  };
  const activate = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return moveFocus("down");
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.click();
    // Text boxes take focus for typing (the on-screen keyboard on handhelds); everything else is clicked.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.focus();
    el.click();
  };
  const scrollBy = (dy: number) => (document.scrollingElement ?? document.documentElement).scrollBy({ top: dy });
  const poll = () => {
    frame = 0;
    const pads = connectedPads();
    if (!pads.length) return; // polling resumes on the next "gamepadconnected"
    if (padBelongsElsewhere()) held.clear();
    else
      for (const pad of pads) {
        document.documentElement.dataset.gamepad = "on";
        const [ax = 0, ay = 0, , ry = 0] = pad.axes;
        const b = (i: number) => !!pad.buttons[i]?.pressed;
        repeat(`${pad.index}up`, b(12) || ay < -0.6, () => moveFocus("up"));
        repeat(`${pad.index}down`, b(13) || ay > 0.6, () => moveFocus("down"));
        repeat(`${pad.index}left`, b(14) || ax < -0.6, () => moveFocus("left"));
        repeat(`${pad.index}right`, b(15) || ax > 0.6, () => moveFocus("right"));
        repeat(`${pad.index}a`, b(0), activate);
        repeat(`${pad.index}b`, b(1), () => {
          // B first leaves a text box, then goes back a page.
          const el = document.activeElement;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) (el as HTMLElement).blur();
          else onBack();
        });
        repeat(`${pad.index}lb`, b(4), () => scrollBy(-window.innerHeight * 0.8));
        repeat(`${pad.index}rb`, b(5), () => scrollBy(window.innerHeight * 0.8));
        if (Math.abs(ry) > 0.25) scrollBy(ry * 18);
      }
    frame = requestAnimationFrame(poll);
  };
  const start = () => {
    if (!frame) frame = requestAnimationFrame(poll);
  };
  window.addEventListener("gamepadconnected", start);
  // Pads that were connected before this page loaded don't always announce themselves, and
  // polling stops when the window is in the background, so check again on focus.
  window.addEventListener("focus", start);
  start();

  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("gamepadconnected", start);
    window.removeEventListener("focus", start);
    cancelAnimationFrame(frame);
  };
}
