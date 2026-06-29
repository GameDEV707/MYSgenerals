// MYS Generals — T26 keyboard build-control test (spec §24 → T26 Part E). Proves the "builder
// selected → nothing happens" dead-end is fixed: in p1-keyboard, selecting a miner and pressing a
// digit activates the matching command-panel button (build → placing mode), and the command key
// then issues the build; while in single-player the same digit still recalls a control group (no
// panel activation). Pure logic (no browser), mirroring test/kbinput.mjs.
// Run: NODE_OPTIONS="" node test/keyboard.mjs

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
    clampCam() {},
  };
}
function miner(id, owner, x, y) { return { id, owner, kind: "unit", type: "miner", stub: false, radius: 0.4, pos: { x, y } }; }
function makeWorld(me, entities) {
  return { me, entities, byId: new Map(entities.map((e) => [e.id, e])), players: [{ heroId: 0 }, { heroId: 0 }], sends: [], send(c) { this.sends.push(c); } };
}
const audio = { resume() {}, play() {} };

// The economy build tab in visible order (mirrors data.ts BUILD_MENU.economy / the HUD grid).
const ECON = ["silver_mine", "iron_mine", "gold_mine", "power_plant"];

console.log("p1-keyboard: select a miner, press '2' → placing mode for the 2nd build button:");
const r = makeRenderer(0, 500);
const cw = r.screenToWorld(250, 300); // world point under the cursor centre
const w = makeWorld(0, [miner(10, 0, cw.x, cw.y)]);
const p1 = new InputController(r, w, audio, { pointerType: null, keyboard: true, control: "p1-keyboard" });
p1.attach(canvas);
p1.updateCamera(0.016); // seed the virtual cursor at the left-viewport centre

// The HUD wires these callbacks; here we mimic HUD.activatePanelDigit → activateCmd(build button).
const digits = [];
p1.onPanelDigit = (idx) => { digits.push(idx); if (idx < ECON.length) p1.setPlacing(ECON[idx]); };
p1.onCycleTab = () => {};

key("keydown", "e"); key("keyup", "e"); // select the miner under the cursor
assert(r.selection.has(10), "E selected the miner under the keyboard cursor (selection works)");

key("keydown", "2"); key("keyup", "2"); // digit 2 → 2nd grid button
assert(digits.length === 1 && digits[0] === 1, "pressing '2' activated panel button index 1");
assert(r.placing && r.placing.building === "iron_mine", "the 2nd build button entered placing mode (iron_mine)");

console.log("Command key at the cursor then issues the build (dead-end resolved):");
w.sends.length = 0;
key("keydown", "q"); key("keyup", "q"); // command key confirms placement at the cursor
const build = w.sends.find((c) => c.t === "build");
assert(!!build && build.building === "iron_mine" && build.owner === 0, "command key sent a build command for the placed building");
assert(r.placing === null, "placing mode cleared after the build was issued");

console.log("Category cycling is wired to nextTab/prevTab (']' / '['):");
const cyc = [];
p1.onCycleTab = (d) => cyc.push(d);
key("keydown", "]"); key("keyup", "]");
key("keydown", "["); key("keyup", "[");
assert(cyc.length === 2 && cyc[0] === 1 && cyc[1] === -1, "']' cycles forward and '[' cycles back through build tabs");

console.log("Single-player: the same digit recalls a control group (NOT panel activation):");
const rs = makeRenderer(0, 1000);
const ws = makeWorld(0, [miner(20, 0, 6, 6), miner(21, 0, 7, 6)]);
const sp = new InputController(rs, ws, audio, { pointerType: "mouse", keyboard: true, control: "single" });
sp.attach(canvas);
const spDigits = [];
sp.onPanelDigit = (i) => spDigits.push(i); // must NOT be called in single-player
rs.selection.add(20); rs.selection.add(21);
key("keydown", "1", { ctrlKey: true }); key("keyup", "1", { ctrlKey: true }); // store control group 1
rs.selection.clear();
key("keydown", "1"); key("keyup", "1"); // recall control group 1
assert(spDigits.length === 0, "single-player digit did NOT activate the command panel");
assert(rs.selection.has(20) && rs.selection.has(21), "single-player digit recalled the control group (unchanged behaviour)");

console.log("");
if (failures === 0) { console.log("ALL T26 KEYBOARD-BUILD TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T26 KEYBOARD-BUILD TEST(S) FAILED ✗"); process.exit(1); }
