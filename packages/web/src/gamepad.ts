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

/**
 * The selection box. Chromium only draws :focus-visible after keyboard input, so focus moved by
 * a gamepad after any tap or click (the usual case on a touchscreen handheld) showed nothing at
 * all. A box drawn over the page also can't be clipped by scrolling rows the way an outline is.
 */
let ring: HTMLElement | null = null;
let ringFrame = 0;

function trackRing(): void {
  ringFrame = 0;
  if (document.documentElement.dataset.nav !== "pad") return void ring?.classList.remove("on");
  const el = document.activeElement as HTMLElement | null;
  if (!ring) {
    ring = document.createElement("div");
    ring.className = "pad-ring";
    ring.setAttribute("aria-hidden", "true");
    document.body.append(ring);
  }
  let target = el && el !== document.body && !(el instanceof HTMLIFrameElement) ? el : null;
  // Toggle switches hide the real checkbox, so box its label instead.
  if (target && !visible(target)) target = target.closest("label");
  const r = target?.getBoundingClientRect();
  if (target && r && r.width > 0 && r.height > 0) {
    const radius = getComputedStyle(target).borderRadius;
    Object.assign(ring.style, { transform: `translate(${r.left - 5}px, ${r.top - 5}px)`, width: `${r.width + 10}px`, height: `${r.height + 10}px`, borderRadius: radius === "0px" ? "10px" : `calc(${radius} + 5px)` });
    ring.classList.add("on");
  } else ring.classList.remove("on");
  // Followed every frame while shown: tiles grow on focus and rows scroll smoothly.
  ringFrame = requestAnimationFrame(trackRing);
}

/** Controller or arrow keys: show the selection box until the mouse or a finger takes over. */
export function setNavMode(mode: "pad" | "pointer"): void {
  if (document.documentElement.dataset.nav === mode) return;
  document.documentElement.dataset.nav = mode;
  if (mode === "pad" && !ringFrame) ringFrame = requestAnimationFrame(trackRing);
}

export function moveFocus(dir: Dir): void {
  setNavMode("pad");
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

const isTextField = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

/** An open menu, the alerts panel or a video: B and Esc close it before going back a page. */
const openPopup = () => document.querySelector('[role="dialog"], [role="menu"]');

/** A game has the controller: the in-browser player's frame is focused, or LootDen is in the background behind an emulator. */
function padBelongsElsewhere(): boolean {
  if (document.visibilityState === "hidden" || !document.hasFocus()) return true;
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement || document.fullscreenElement instanceof HTMLIFrameElement;
}

/**
 * The d-pad on a controller Chromium doesn't recognise as standard (DirectInput, some handheld
 * drivers): it arrives as one hat axis, usually the 10th, going -1 (up) clockwise to 1 (up-left).
 */
function padHat(pad: Gamepad): Dir | null {
  if (pad.mapping === "standard") return null;
  const v = pad.axes[9];
  if (v === undefined || v > 1.05) return null; // about 1.29 at rest
  const step = Math.round(((v + 1) / 2) * 7); // 0 up, 1 up-right, 2 right … 7 up-left
  return (["up", "up", "right", "down", "down", "down", "left", "up"] as const)[step] ?? null;
}

/** Controllers the browser can see right now. */
export const connectedPads = (): Gamepad[] => [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);

/**
 * Installs keyboard and gamepad navigation once for the whole app. onBack is read on every
 * press, so the caller can pass a fresh function without reinstalling (reinstalling used to
 * stop gamepad polling after the first page change, because "gamepadconnected" only fires once).
 */
export function installSpatialNavigation(onBack: () => void): () => void {
  const back = () => {
    const popup = openPopup();
    // The popups close on Esc themselves (Layout listens on document, the video player on window).
    if (popup) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else onBack();
  };
  const keys: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  const onKey = (e: KeyboardEvent) => {
    // Esc goes back a page, like B. The ROG Ally sends Esc for B when Armoury Crate has LootDen in Desktop mode.
    if (e.key === "Escape" && !e.defaultPrevented && !openPopup() && !isTextField(document.activeElement) && !(document.activeElement instanceof HTMLIFrameElement)) {
      back();
      return;
    }
    const dir = keys[e.key];
    if (!dir || keepsKey(document.activeElement, dir) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.activeElement instanceof HTMLIFrameElement) return;
    e.preventDefault();
    moveFocus(dir);
  };
  window.addEventListener("keydown", onKey);
  // Only a real mouse move hides the box; Chromium also fires mousemove when the page scrolls under a still cursor.
  const onPointer = (e: PointerEvent | MouseEvent) => {
    if (e.type === "mousemove" && Math.abs((e as MouseEvent).movementX) + Math.abs((e as MouseEvent).movementY) < 3) return;
    setNavMode("pointer");
  };
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("mousemove", onPointer, true);

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
  let idle = 0;
  const poll = () => {
    frame = 0;
    const pads = connectedPads();
    if (!pads.length) {
      // Keep looking slowly rather than wait for "gamepadconnected": Chromium doesn't always send it
      // for a pad that was already plugged in, or when Armoury Crate switches the Ally into Gamepad mode.
      idle = window.setTimeout(start, 1000);
      return;
    }
    if (padBelongsElsewhere()) held.clear();
    else
      for (const pad of pads) {
        document.documentElement.dataset.gamepad = "on";
        const [ax = 0, ay = 0, , ry = 0] = pad.axes;
        const b = (i: number) => !!pad.buttons[i]?.pressed;
        const hat = padHat(pad);
        const any = pad.buttons.some((x) => x.pressed) || Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6;
        if (any) setNavMode("pad");
        repeat(`${pad.index}up`, b(12) || hat === "up" || ay < -0.6, () => moveFocus("up"));
        repeat(`${pad.index}down`, b(13) || hat === "down" || ay > 0.6, () => moveFocus("down"));
        repeat(`${pad.index}left`, b(14) || hat === "left" || ax < -0.6, () => moveFocus("left"));
        repeat(`${pad.index}right`, b(15) || hat === "right" || ax > 0.6, () => moveFocus("right"));
        repeat(`${pad.index}a`, b(0), activate);
        repeat(`${pad.index}b`, b(1), () => {
          // B first leaves a text box, then closes a menu or video, then goes back a page.
          const el = document.activeElement;
          if (isTextField(el)) (el as HTMLElement).blur();
          else back();
        });
        repeat(`${pad.index}lb`, b(4), () => scrollBy(-window.innerHeight * 0.8));
        repeat(`${pad.index}rb`, b(5), () => scrollBy(window.innerHeight * 0.8));
        if (pad.mapping === "standard" && Math.abs(ry) > 0.25) scrollBy(ry * 18);
      }
    frame = requestAnimationFrame(poll);
  };
  const start = () => {
    window.clearTimeout(idle);
    if (!frame) frame = requestAnimationFrame(poll);
  };
  window.addEventListener("gamepadconnected", start);
  // Polling pauses while the window is in the background, so check again on focus.
  window.addEventListener("focus", start);
  start();

  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("gamepadconnected", start);
    window.removeEventListener("focus", start);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("mousemove", onPointer, true);
    window.clearTimeout(idle);
    cancelAnimationFrame(frame);
  };
}
