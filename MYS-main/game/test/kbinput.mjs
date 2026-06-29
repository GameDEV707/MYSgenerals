// MYS Generals — T24 keyboard(P1) + mouse(P2) split-screen control tests (spec §24 → T24).
// Instantiates a P1 keyboard-cursor controller (left) and a P2 mouse controller (right) on ONE
// shared canvas (exactly like MatchSession) and drives them with synthetic Keyboard events to
// prove: P1 gets a visible virtual cursor; E selects / Q commands for P1; abilities are per-player
// and DISJOINT (P1=Z/X/C/V, P2=arrows) with no cross-control; and the cursor moves with WASD,
// clamps to the left viewport and pans the camera at the edge. Pure logic (no browser).
// Run: node test/kbinput.mjs

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const windowListeners = {};
const canvas = { style: {}, addEventListener() {} };
globalThis.window = { addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); } };
function fireWindow(type, e) { (windowListeners[type] || []).forEach((fn) => fn(e)); }
function key(type, k, extra = {}) { fireWindow(type, { key: k, ctrlKey: false, repeat: false, preventDefault() {}, stopPropagation() {}, ...extra }); }

const { InputController } = await import("../dist/input.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function makeRenderer(vx, w) {
  return {
    vx, vy: 0, W: w, H: 600, cam: { x: 5, y: 5, zoom: 24 },
    selection: new Set(), placing: null, mouseWorld: { x: 0, y: 0 }, pointerHint: null, virtualCursor: null,
    fx: { addCmdMarker() {} },
    contains(sx, sy) { return sx >= this.vx && sx < this.vx + this.W && sy >= this.vy && sy < this.vy + this.H; },
    screenToWorld(sx, sy) { return { x: this.cam.x + (sx - this.vx) / this.cam.zoom, y: this.cam.y + (sy - this.vy) / this.cam.zoom }; },
    clampCam() { /* no-op: let the camera move freely so edge-pan is observable */ },
  };
}
function unit(id, owner, x, y) { return { id, owner, kind: "unit", type: "infantry", stub: false, radius: 0.4, pos: { x, y } }; }
function hero(id, owner) { return { id, owner, kind: "unit", type: "hero", stub: false, radius: 0.5, pos: { x: 0, y: 0 }, hero: { abilities: [{ rank: 1 }, { rank: 1 }, { rank: 1 }, { rank: 1 }] } }; }
function makeWorld(me, entities, heroId) {
  const players = [{ heroId: 0 }, { heroId: 0 }];
  players[me] = { heroId };
  return { me, entities, byId: new Map(entities.map((e) => [e.id, e])), players, sends: [], send(c) { this.sends.push(c); } };
}
const audio = { resume() {}, play() {} };

const rL = makeRenderer(0, 500);
const rR = makeRenderer(500, 500);
// P1's unit sits at the world point under the left-viewport CENTRE (250,300), where the cursor inits.
const cw = rL.screenToWorld(250, 300);
const wL = makeWorld(0, [unit(10, 0, cw.x, cw.y), hero(11, 0)], 11);
const wR = makeWorld(1, [unit(20, 1, 5, 5), hero(21, 1)], 21);

const p1 = new InputController(rL, wL, audio, { pointerType: null, keyboard: true, control: "p1-keyboard" });
const p2 = new InputController(rR, wR, audio, { pointerType: "mouse", keyboard: true, control: "p2-mouse" });
p1.attach(canvas); p2.attach(canvas);

// Initialise both cursors (P1's virtual cursor seeds at the left-viewport centre).
p1.updateCamera(0.016); p2.updateCamera(0.016);

console.log("Two visible cursors — P1 draws a virtual cursor, P2 uses the native OS cursor:");
assert(rL.virtualCursor && Math.abs(rL.virtualCursor.x - 250) < 1 && Math.abs(rL.virtualCursor.y - 300) < 1, "P1 virtual cursor starts at the left-viewport centre");
assert(rR.virtualCursor === null, "P2 (mouse) draws no synthetic cursor");

console.log("P1 SELECT (E) click-selects P1's unit; never touches P2's selection (no bleed):");
key("keydown", "e"); key("keyup", "e"); // tap (no movement) → click-select at the cursor
assert(rL.selection.has(10), "E selected the P1 unit under the cursor");
assert(rR.selection.size === 0, "P1's select did not affect Player 2 (no cross-control)");

console.log("P1 COMMAND (Q) issues an order for P1's selected units:");
wL.sends.length = 0;
key("keydown", "q"); key("keyup", "q");
assert(wL.sends.some((c) => c.t === "move" || c.t === "attack" || c.t === "attackmove"), "Q issued a command for P1");
assert(wR.sends.length === 0, "P1's command never reached Player 2");

console.log("Per-player abilities are DISJOINT (P1=Z/X/C/V, P2=arrows), no cross-control:");
wL.sends.length = 0; wR.sends.length = 0;
key("keydown", "z"); key("keyup", "z"); // P1 ability slot 0 (self-cast → sent immediately)
assert(wL.sends.some((c) => c.t === "ability" && c.slot === 0), "P1 'Z' cast P1's ability 1");
assert(!wR.sends.some((c) => c.t === "ability"), "P1 'Z' did NOT trigger Player 2's hero");
wL.sends.length = 0; wR.sends.length = 0;
key("keydown", "ArrowUp"); key("keyup", "ArrowUp"); // P2 ability slot 0
assert(wR.sends.some((c) => c.t === "ability" && c.slot === 0), "P2 ArrowUp cast P2's ability 1");
assert(!wL.sends.some((c) => c.t === "ability"), "P2 ArrowUp did NOT trigger Player 1's hero");

console.log("P1 WASD moves the virtual cursor, clamps to the LEFT half, and pans at the edge:");
key("keydown", "w");
p1.updateCamera(0.1);
assert(rL.virtualCursor.y < 300, "pressing W moved the cursor up");
key("keyup", "w");
const camXBefore = rL.cam.x;
key("keydown", "d");
p1.updateCamera(1.0); // large step → push hard against the right edge of the LEFT half
assert(rL.virtualCursor.x <= rL.vx + rL.W && rL.virtualCursor.x >= rL.vx + rL.W - 4, "cursor clamps to the right edge of the LEFT half (never crosses the divider)");
assert(rL.cam.x > camXBefore, "camera pans right when the cursor reaches the viewport edge");
key("keyup", "d");

console.log("P2 keys never move P1's cursor (no cross-control):");
const beforeCx = rL.virtualCursor.x;
key("keydown", "arrowleft"); p1.updateCamera(0.1); key("keyup", "arrowleft");
assert(Math.abs(rL.virtualCursor.x - beforeCx) < 0.001, "a Player-2 arrow key does not move Player 1's cursor");

console.log("");
if (failures === 0) { console.log("ALL T24 KEYBOARD-INPUT TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T24 KEYBOARD-INPUT TEST(S) FAILED ✗"); process.exit(1); }
