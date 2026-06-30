// MYS Generals — T27 Part A keyboard build-category navigation test. Proves the Space→E flow:
// with a builder selected, the switch key (Space) moves a category-FOCUS highlight across the build
// categories WITHOUT changing the active tab; the select key (E) OPENS the focused category (and is
// consumed, so it does not also start a cursor-select); Esc cancels focus; and in single-player the
// same Space does nothing to the panel. Pure logic (no browser), mirroring test/keyboard.mjs.
// Run: NODE_OPTIONS="" node test/catnav.mjs

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
  return { me, entities, byId: new Map(entities.map((e) => [e.id, e])), players: [{ heroId: 0 }, { heroId: 0 }], isAlly(o) { return o === this.me; }, economyOwner() { return this.me; }, sends: [], send(c) { this.sends.push(c); } };
}
const audio = { resume() {}, play() {} };

// A tiny stand-in for the HUD's category-focus model (mirrors hud.ts: CATS + catFocus + the three
// callbacks). The real HUD wires the exact same callbacks onto the InputController.
const CATS = ["economy", "military", "defense", "tech"];
const ECON = ["silver_mine", "iron_mine", "gold_mine", "power_plant"];
const MIL = ["barracks", "war_factory", "research_center"];
function makeHudStub(input) {
  const hud = {
    tab: "economy", catFocus: -1,
    focusNext() { const base = hud.catFocus < 0 ? CATS.indexOf(hud.tab) : hud.catFocus; hud.catFocus = (base + 1) % CATS.length; },
    confirm() { if (hud.catFocus < 0) return false; hud.tab = CATS[hud.catFocus]; hud.catFocus = -1; return true; },
    cancel() { hud.catFocus = -1; },
    // digit build: pick the Nth building of the ACTIVE category and enter placing mode
    build(idx) { const list = hud.tab === "economy" ? ECON : hud.tab === "military" ? MIL : []; if (list[idx]) input.setPlacing(list[idx]); },
  };
  input.onCategoryFocus = () => hud.focusNext();
  input.onCategoryConfirm = () => hud.confirm();
  input.onCategoryCancel = () => hud.cancel();
  input.onPanelDigit = (idx) => hud.build(idx);
  return hud;
}

console.log("p1-keyboard: Space moves the category focus WITHOUT changing the active tab:");
const r = makeRenderer(0, 500);
const cw = r.screenToWorld(250, 300);
const w = makeWorld(0, [miner(10, 0, cw.x, cw.y)]);
const p1 = new InputController(r, w, audio, { pointerType: null, keyboard: true, control: "p1-keyboard" });
p1.attach(canvas);
p1.updateCamera(0.016);
const hud = makeHudStub(p1);
r.selection.add(10); // builder selected

key("keydown", " "); key("keyup", " "); // Space → focus advances economy(0) → military(1)
assert(hud.catFocus === 1, "first Space focuses the next category (military)");
assert(hud.tab === "economy", "active tab is unchanged by Space (preview only)");
key("keydown", " "); key("keyup", " "); // → defense(2)
key("keydown", " "); key("keyup", " "); // → tech(3)
key("keydown", " "); key("keyup", " "); // wraps → economy(0)
assert(hud.catFocus === 0, "Space wraps around the categories");
key("keydown", " "); key("keyup", " "); // → military(1)
assert(hud.catFocus === 1, "focus back on military");

console.log("E opens the focused category (and is consumed — no cursor-select started):");
const selBefore = new Set(r.selection);
key("keydown", "e"); key("keyup", "e");
assert(hud.tab === "military", "E opened the focused category (active tab = military)");
assert(hud.catFocus === -1, "focus cleared after opening");
assert(r.selection.size === selBefore.size && r.selection.has(10), "E did not clear/replace the selection (cursor-select was not triggered)");

console.log("Number key then builds from the now-active (military) category:");
w.sends.length = 0;
key("keydown", "1"); key("keyup", "1"); // panel button #1 of military = barracks → placing
assert(r.placing && r.placing.building === "barracks", "digit 1 entered placing mode for the 1st military building (barracks)");
key("keydown", "q"); key("keyup", "q"); // command key places it
const build = w.sends.find((c) => c.t === "build");
assert(!!build && build.building === "barracks", "command key issued the build for the military building — dead-end fixed");

console.log("Esc cancels an active focus without changing the active tab:");
key("keydown", " "); key("keyup", " "); // focus advances
assert(hud.catFocus >= 0, "focus is active");
const tabAtEsc = hud.tab;
key("keydown", "escape"); key("keyup", "escape");
assert(hud.catFocus === -1, "Esc cleared the focus");
assert(hud.tab === tabAtEsc, "Esc did not change the active tab");

console.log("E with no active focus behaves normally (selects under the cursor, not a tab open):");
const r2 = makeRenderer(0, 500);
const cw2 = r2.screenToWorld(250, 300);
const w2 = makeWorld(0, [miner(20, 0, cw2.x, cw2.y)]);
const p1b = new InputController(r2, w2, audio, { pointerType: null, keyboard: true, control: "p1-keyboard" });
p1b.attach(canvas); p1b.updateCamera(0.016);
const hud2 = makeHudStub(p1b);
r2.selection.clear();
key("keydown", "e"); key("keyup", "e"); // no focus → normal cursor select picks the miner under cursor
assert(hud2.tab === "economy" && hud2.catFocus === -1, "E with no focus did not open any category");
assert(r2.selection.has(20), "E with no focus performed the normal cursor-select");

console.log("Single-player: Space is not a category switch (no panel effect):");
const rs = makeRenderer(0, 1000);
const ws = makeWorld(0, [miner(30, 0, 6, 6)]);
const sp = new InputController(rs, ws, audio, { pointerType: "mouse", keyboard: true, control: "single" });
sp.attach(canvas);
let focusCalls = 0;
sp.onCategoryFocus = () => focusCalls++;
key("keydown", " "); key("keyup", " ");
assert(focusCalls === 0, "single-player Space did not trigger category focus");

console.log("");
if (failures === 0) { console.log("ALL T27 CATEGORY-NAV TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T27 CATEGORY-NAV TEST(S) FAILED ✗"); process.exit(1); }
