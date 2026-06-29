// MYS Generals — central remappable key-binding store (spec §24 → T24).
// Single source of truth for every bindable key. The in-game InputController and the HUD hotkey
// labels read their keys from here (no hardcoded keys), and the Settings → Keyboard screen rebinds
// them. Bindings are grouped per control context and persisted to localStorage so they survive a
// restart, with conflict detection (per context) and reset-to-defaults. Isolated here so it is
// unit-testable without a browser.

// A binding context groups the actions of one controller so duplicate-key conflicts are only
// checked within the same player (the same physical key may serve different players — e.g. P1's
// keyboard and P2's mouse can never collide).
export type BindContext = "p1" | "p2" | "shared";

export type Bindings = Record<string, string>;
export interface KeyBindings {
  p1: Bindings;      // Player 1 (left) keyboard-driven virtual cursor scheme
  p2: Bindings;      // Player 2 (right) mouse player — hero ability keys
  shared: Bindings;  // single-player / shared keyboard scheme
}

const STORAGE_KEY = "mys.keybindings";

// Default control scheme (spec §24). Keys are stored as normalized KeyboardEvent.key values
// (lowercased; arrows as "arrowup" etc.; space as "space").
export function defaultKeyBindings(): KeyBindings {
  return {
    p1: {
      cursorUp: "w", cursorLeft: "a", cursorDown: "s", cursorRight: "d",
      select: "e", command: "q",
      ability1: "z", ability2: "x", ability3: "c", ability4: "v",
      nextTab: "]", prevTab: "[",
    },
    p2: {
      ability1: "arrowup", ability2: "arrowright", ability3: "arrowleft", ability4: "arrowdown",
    },
    shared: {
      ability1: "q", ability2: "w", ability3: "e", ability4: "r",
      stop: "s", hold: "h", attackMove: "a",
      cameraUp: "arrowup", cameraDown: "arrowdown", cameraLeft: "arrowleft", cameraRight: "arrowright",
    },
  };
}

// Action metadata that drives the Settings → Keyboard UI (grouped & labelled per context).
export interface ActionDef { context: BindContext; action: string; labelKey: string; }
export const ACTION_DEFS: ActionDef[] = [
  // Player 1 — keyboard virtual cursor
  { context: "p1", action: "cursorUp", labelKey: "key.cursorUp" },
  { context: "p1", action: "cursorDown", labelKey: "key.cursorDown" },
  { context: "p1", action: "cursorLeft", labelKey: "key.cursorLeft" },
  { context: "p1", action: "cursorRight", labelKey: "key.cursorRight" },
  { context: "p1", action: "select", labelKey: "key.select" },
  { context: "p1", action: "command", labelKey: "key.command" },
  { context: "p1", action: "ability1", labelKey: "key.ability1" },
  { context: "p1", action: "ability2", labelKey: "key.ability2" },
  { context: "p1", action: "ability3", labelKey: "key.ability3" },
  { context: "p1", action: "ability4", labelKey: "key.ability4" },
  { context: "p1", action: "nextTab", labelKey: "key.nextTab" },
  { context: "p1", action: "prevTab", labelKey: "key.prevTab" },
  // Player 2 — mouse player hero abilities
  { context: "p2", action: "ability1", labelKey: "key.ability1" },
  { context: "p2", action: "ability2", labelKey: "key.ability2" },
  { context: "p2", action: "ability3", labelKey: "key.ability3" },
  { context: "p2", action: "ability4", labelKey: "key.ability4" },
  // Single-player / shared
  { context: "shared", action: "ability1", labelKey: "key.ability1" },
  { context: "shared", action: "ability2", labelKey: "key.ability2" },
  { context: "shared", action: "ability3", labelKey: "key.ability3" },
  { context: "shared", action: "ability4", labelKey: "key.ability4" },
  { context: "shared", action: "stop", labelKey: "key.stop" },
  { context: "shared", action: "hold", labelKey: "key.hold" },
  { context: "shared", action: "attackMove", labelKey: "key.attackMove" },
  { context: "shared", action: "cameraUp", labelKey: "key.cameraUp" },
  { context: "shared", action: "cameraDown", labelKey: "key.cameraDown" },
  { context: "shared", action: "cameraLeft", labelKey: "key.cameraLeft" },
  { context: "shared", action: "cameraRight", labelKey: "key.cameraRight" },
];

const CONTEXTS: BindContext[] = ["p1", "p2", "shared"];

// Merge stored values onto the defaults so old/partial saves keep working and new actions get a
// sensible default key (forward/backward compatible).
export function loadKeyBindings(): KeyBindings {
  const d = defaultKeyBindings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<KeyBindings>;
      for (const ctx of CONTEXTS) {
        const src = o?.[ctx];
        if (src && typeof src === "object") {
          for (const a of Object.keys(d[ctx])) {
            if (typeof src[a] === "string" && src[a]) d[ctx][a] = (src[a] as string).toLowerCase();
          }
        }
      }
    }
  } catch { /* ignore */ }
  return d;
}

export function saveKeyBindings(b: KeyBindings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); } catch { /* ignore */ }
}
export function clearKeyBindings(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Returns the action (within the SAME context) that already uses `key`, or null if free.
export function findConflict(b: KeyBindings, context: BindContext, action: string, key: string): string | null {
  const ctx = b[context];
  for (const a of Object.keys(ctx)) {
    if (a !== action && ctx[a] === key) return a;
  }
  return null;
}

// Convert a KeyboardEvent to the canonical, comparable key string used throughout the store.
export function normalizeKey(e: { key: string }): string {
  const k = e.key;
  if (k === " " || k === "Spacebar") return "space";
  return k.toLowerCase();
}

const KEY_LABELS: Record<string, string> = {
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
  space: "Space", escape: "Esc", enter: "Enter", tab: "Tab",
  control: "Ctrl", shift: "Shift", alt: "Alt", " ": "Space",
};

// Human-friendly label for a key (for HUD hotkey hints and the rebind UI).
export function keyLabel(k: string): string {
  if (!k) return "—";
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// ---- Live singleton (the running game reads from here so rebinds take effect immediately) ----
let current: KeyBindings = loadKeyBindings();
const listeners = new Set<() => void>();
function notify(): void { listeners.forEach((fn) => fn()); }

export function getKeyBindings(): KeyBindings { return current; }
export function onBindingsChange(fn: () => void): void { listeners.add(fn); }
export function reloadKeyBindings(): void { current = loadKeyBindings(); notify(); }

// Assign a key. Returns the conflicting action name if blocked (same-context duplicate), else null.
export function setBinding(context: BindContext, action: string, key: string): string | null {
  const conflict = findConflict(current, context, action, key);
  if (conflict) return conflict;
  current[context][action] = key;
  saveKeyBindings(current);
  notify();
  return null;
}

// Reset one context (per player) or, with no argument, everything (global).
export function resetKeyBindings(context?: BindContext): void {
  const def = defaultKeyBindings();
  if (context) current[context] = def[context];
  else current = def;
  saveKeyBindings(current);
  notify();
}
