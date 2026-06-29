// MYS Generals — split-screen device→player assignment tests (spec §24 → T24, refines T23).
// Verifies the active default (P1=keyboard virtual cursor, P2=mouse), the control-mode resolution,
// the swap, and the no-touchscreen fallback. Pure logic — no DOM. Run: node test/split.mjs
import { defaultSplitInput, resolveSplitInput, hasTouch, loadSplitInput } from "../dist/client/splitInput.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Default device assignment (T24 — keyboard + mouse):");
const d = defaultSplitInput();
assert(d.left === "keyboard", "Player 1 (left) defaults to the keyboard (virtual cursor)");
assert(d.right === "mouse", "Player 2 (right) defaults to the mouse");

console.log("Resolve the default to concrete control schemes:");
const r = resolveSplitInput(d, false);
assert(r.length === 2, "resolves exactly two local inputs");
assert(r[0].control === "p1-keyboard" && r[0].pointerType === null && r[0].keyboard === true, "P1 = keyboard virtual cursor (no mouse, keyboard on)");
assert(r[1].control === "p2-mouse" && r[1].pointerType === "mouse" && r[1].keyboard === true, "P2 = mouse + ability keys");
assert(r[0].pointerType !== "mouse", "the keyboard player never grabs the mouse (no cross-control)");

console.log("Swapped assignment (keyboard ↔ mouse):");
const swapped = { left: "mouse", right: "keyboard" };
const rs = resolveSplitInput(swapped, false);
assert(rs[0].control === "p2-mouse" && rs[0].pointerType === "mouse", "after swap P1 (left) = mouse");
assert(rs[1].control === "p1-keyboard" && rs[1].pointerType === null, "after swap P2 (right) = keyboard cursor");
assert(rs[0].pointerType !== rs[1].pointerType, "the two schemes stay independent (no bleed)");

console.log("Touch device still supported when a touchscreen is present (T23 compatibility):");
const t23 = { left: "touch", right: "mouse" };
const rt = resolveSplitInput(t23, true);
assert(rt[0].pointerType === "touch" && rt[0].keyboard === false, "P1 = touch (HUD abilities, no keyboard)");
assert(rt[1].pointerType === "mouse" && rt[1].control === "p2-mouse", "P2 = mouse + ability keys");

console.log("No-touchscreen fallback keeps two independent controls:");
const rf = resolveSplitInput(t23, false);
assert(rf[0].control === "p1-keyboard", "a touch P1 with no touchscreen falls back to the keyboard cursor");
assert(rf[1].control === "p2-mouse" && rf[1].pointerType === "mouse", "P2 stays on the mouse");

console.log("Environment helpers degrade safely off-DOM:");
assert(hasTouch() === false, "hasTouch() is false in a headless (no navigator/window) env");
const loaded = loadSplitInput();
assert(loaded.left === "keyboard" && loaded.right === "mouse", "loadSplitInput() returns the T24 default without localStorage");

console.log("");
if (failures === 0) { console.log("ALL SPLIT-INPUT TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " SPLIT-INPUT TEST(S) FAILED ✗"); process.exit(1); }
