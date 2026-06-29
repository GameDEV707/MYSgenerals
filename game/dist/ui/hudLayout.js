// MYS Generals — per-player HUD layout persistence (spec §24 → T23).
// Each player's HUD layout (per-widget position / size / hidden state) is saved to local settings
// keyed by which side of the split it occupies, so a customized layout survives a restart and the
// two players never share one layout. Used by the HUD; isolated here so it is unit-testable.
function storageKey(side) { return "mys.hud.layout." + side; }
export function loadHudLayout(side) {
    try {
        const raw = localStorage.getItem(storageKey(side));
        if (!raw)
            return {};
        const o = JSON.parse(raw);
        return (o && typeof o === "object") ? o : {};
    }
    catch {
        return {};
    }
}
export function saveHudLayout(side, layout) {
    try {
        localStorage.setItem(storageKey(side), JSON.stringify(layout));
    }
    catch { /* ignore */ }
}
export function clearHudLayout(side) {
    try {
        localStorage.removeItem(storageKey(side));
    }
    catch { /* ignore */ }
}
