// MYS Generals — split-screen pointer-routing tests (spec §24 → T23, §21.2).
// Instantiates TWO InputControllers (touch→left, mouse→right) on ONE shared canvas (exactly like
// MatchSession) and fires synthetic PointerEvents to prove: each stream only acts on its own half
// and its own pointer type, there is NO cross-half input bleed, the two streams act concurrently,
// and the touch stream raises its own on-canvas pointer indicator. Pure logic harness (no browser).
// Run: node test/input.mjs

// --- minimal DOM doubles --------------------------------------------------------------------
const canvasListeners = {};
const windowListeners = {};
const canvas = {
  style: {},
  addEventListener(type, fn) { (canvasListeners[type] ||= []).push(fn); },
};
globalThis.window = { addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); } };
function fireCanvas(type, e) { (canvasListeners[type] || []).forEach((fn) => fn(e)); }
function fireWindow(type, e) { (windowListeners[type] || []).forEach((fn) => fn(e)); }
function ev(o) { return { button: 0, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...o }; }

const { InputController } = await import("../dist/input.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

// --- stub renderer & world ------------------------------------------------------------------
function makeRenderer(vx, w) {
  return {
    vx, vy: 0, W: w, H: 600, cam: { x: 0, y: 0, zoom: 24 },
    selection: new Set(), placing: null, mouseWorld: { x: 0, y: 0 }, pointerHint: null,
    fx: { addCmdMarker() {} },
    contains(sx, sy) { return sx >= this.vx && sx < this.vx + this.W && sy >= this.vy && sy < this.vy + this.H; },
    screenToWorld(sx, sy) { return { x: this.cam.x + (sx - this.vx) / this.cam.zoom, y: this.cam.y + (sy - this.vy) / this.cam.zoom }; },
    clampCam() {},
  };
}
function unit(id, owner) { return { id, owner, kind: "unit", type: "infantry", stub: false, radius: 0.4, pos: { x: 5, y: 5 } }; }
function makeWorld(me, entities) {
  return { me, entities, byId: new Map(entities.map((e) => [e.id, e])), players: [{ heroId: 0 }, { heroId: 0 }], send() {} };
}
const audio = { resume() {}, play() {} };

// left viewport [0,500), right viewport [500,1000)
const rL = makeRenderer(0, 500);
const rR = makeRenderer(500, 500);
const wL = makeWorld(0, [unit(10, 0)]);   // player 0 owns unit 10 (left)
const wR = makeWorld(1, [unit(20, 1)]);   // player 1 owns unit 20 (right)

// Two controllers attach to the SAME canvas (as MatchSession does).
const touchCtl = new InputController(rL, wL, audio, { pointerType: "touch", keyboard: false });
const mouseCtl = new InputController(rR, wR, audio, { pointerType: "mouse", keyboard: true });
touchCtl.attach(canvas);
mouseCtl.attach(canvas);

// a click = pointerdown on canvas, then pointerup on window (no movement → select)
function click(pointerType, pointerId, x, y) {
  fireCanvas("pointerdown", ev({ pointerType, pointerId, clientX: x, clientY: y }));
  fireWindow("pointerup", ev({ pointerType, pointerId, clientX: x, clientY: y }));
}
function reset() { rL.selection.clear(); rR.selection.clear(); rL.pointerHint = null; rR.pointerHint = null; }

// screen→world: left unit at world (5,5) → screen (120,120) in left half; right unit → (620,120).
console.log("Touch acts on the LEFT half only:");
reset();
click("touch", 1, 120, 120);
assert(rL.selection.has(10), "touch in left half selected Player 1's unit");
assert(rR.selection.size === 0, "touch did not touch Player 2's selection (no bleed)");

console.log("Mouse acts on the RIGHT half only:");
reset();
click("mouse", 2, 620, 120);
assert(rR.selection.has(20), "mouse in right half selected Player 2's unit");
assert(rL.selection.size === 0, "mouse did not touch Player 1's selection (no bleed)");

console.log("No cross-half bleed for the WRONG device:");
reset();
click("mouse", 3, 120, 120);   // mouse inside the LEFT (touch) half
assert(rL.selection.size === 0 && rR.selection.size === 0, "a mouse click in the touch half commands nobody");
reset();
click("touch", 4, 620, 120);   // touch inside the RIGHT (mouse) half
assert(rL.selection.size === 0 && rR.selection.size === 0, "a touch in the mouse half commands nobody");

console.log("Two concurrent, independent streams (multi-touch + mouse at once):");
reset();
// interleave: touch down (left) and mouse down (right) BEFORE either lifts
fireCanvas("pointerdown", ev({ pointerType: "touch", pointerId: 5, clientX: 120, clientY: 120 }));
fireCanvas("pointerdown", ev({ pointerType: "mouse", pointerId: 6, clientX: 620, clientY: 120 }));
assert(rL.pointerHint && Math.round(rL.pointerHint.x) === 120, "touch stream shows its own pointer indicator on the left");
assert(rR.pointerHint === null, "mouse stream draws no synthetic indicator (uses the native cursor)");
fireWindow("pointerup", ev({ pointerType: "touch", pointerId: 5, clientX: 120, clientY: 120 }));
fireWindow("pointerup", ev({ pointerType: "mouse", pointerId: 6, clientX: 620, clientY: 120 }));
assert(rL.selection.has(10) && rR.selection.has(20), "both players selected their own units in the same interaction");

console.log("");
if (failures === 0) { console.log("ALL INPUT-ROUTING TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " INPUT-ROUTING TEST(S) FAILED ✗"); process.exit(1); }
