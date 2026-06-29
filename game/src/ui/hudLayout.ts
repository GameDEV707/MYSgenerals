// MYS Generals — per-player HUD layout persistence (spec §24 → T23).
// Each player's HUD layout (per-widget position / size / hidden state) is saved to local settings
// keyed by which side of the split it occupies, so a customized layout survives a restart and the
// two players never share one layout. Used by the HUD; isolated here so it is unit-testable.

export interface WidgetState { x?: number; y?: number; w?: number; h?: number; hidden?: boolean; }
export type HudLayout = Record<string, WidgetState>;
export type HudSide = "left" | "right" | "single";

function storageKey(side: HudSide): string { return "mys.hud.layout." + side; }

export function loadHudLayout(side: HudSide): HudLayout {
  try {
    const raw = localStorage.getItem(storageKey(side));
    if (!raw) return {};
    const o = JSON.parse(raw);
    return (o && typeof o === "object") ? o as HudLayout : {};
  } catch { return {}; }
}

export function saveHudLayout(side: HudSide, layout: HudLayout): void {
  try { localStorage.setItem(storageKey(side), JSON.stringify(layout)); } catch { /* ignore */ }
}

export function clearHudLayout(side: HudSide): void {
  try { localStorage.removeItem(storageKey(side)); } catch { /* ignore */ }
}
