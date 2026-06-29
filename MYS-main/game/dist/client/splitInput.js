// MYS Generals — split-screen device→player assignment (spec §24 → T24, refines §21.2 / T23).
// Decides which physical device drives each LOCAL viewport. The active default scheme for a
// standard laptop (one keyboard + one mouse, no touchscreen) is **Player 1 (left) = keyboard**
// (an on-screen virtual cursor) and **Player 2 (right) = mouse**. The mapping is swappable and
// persisted, and falls back sensibly when a chosen touch device is unavailable.
const STORAGE_KEY = "mys.split.input";
// Spec T24 default: P1(left)=keyboard virtual cursor, P2(right)=mouse.
export function defaultSplitInput() {
    return { left: "keyboard", right: "mouse", keyboardOwner: 1 };
}
// Does this machine have any touch capability? Used for the no-touchscreen fallback.
export function hasTouch() {
    try {
        if (typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0)
            return true;
        if (typeof window !== "undefined" && "ontouchstart" in window)
            return true;
        if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches)
            return true;
    }
    catch { /* ignore */ }
    return false;
}
function isDevice(v) { return v === "touch" || v === "mouse" || v === "keyboard"; }
export function loadSplitInput() {
    const cfg = defaultSplitInput();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const o = JSON.parse(raw);
            if (isDevice(o.left))
                cfg.left = o.left;
            if (isDevice(o.right))
                cfg.right = o.right;
            if (o.keyboardOwner === 0 || o.keyboardOwner === 1)
                cfg.keyboardOwner = o.keyboardOwner;
        }
    }
    catch { /* ignore */ }
    return cfg;
}
export function saveSplitInput(cfg) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }
    catch { /* ignore */ }
}
// Map a single side's device to its concrete control scheme, applying the no-touchscreen fallback:
// a side asking for "touch" with no touchscreen present falls back to keyboard (left) / mouse (right)
// so the two players still get two independent controls (the T24 default scheme).
function resolveDevice(dev, side, touchAvailable) {
    if (dev === "touch" && !touchAvailable)
        dev = side === "left" ? "keyboard" : "mouse";
    switch (dev) {
        case "keyboard": return { pointerType: null, keyboard: true, control: "p1-keyboard" };
        case "mouse": return { pointerType: "mouse", keyboard: true, control: "p2-mouse" };
        case "touch": return { pointerType: "touch", keyboard: false, control: "single" };
    }
}
export function resolveSplitInput(cfg, touchAvailable = hasTouch()) {
    return [
        resolveDevice(cfg.left, "left", touchAvailable),
        resolveDevice(cfg.right, "right", touchAvailable),
    ];
}
