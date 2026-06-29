// MYS Generals — T28 Part C keyboard zoom test. Player 1 (keyboard) zooms the map with the bound
// zoomIn / zoomOut keys (defaults Shift / Ctrl): holding them changes renderer.cam.zoom within the
// clamped bounds (10..48). Pure logic (no browser), mirroring test/kbinput.mjs.
// Run: NODE_OPTIONS="" node test/zoom.mjs

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

function makeRenderer() {
  return {
    vx: 0, vy: 0, W: 500, H: 600, cam: { x: 5, y: 5, zoom: 24 },
    selection: new Set(), placing: null, mouseWorld: { x: 0, y: 0 }, pointerHint: null, virtualCursor: null,
    fx: { addCmdMarker() {} },
    contains(sx, sy) { return sx >= this.vx && sx < this.vx + this.W && sy >= this.vy && sy < this.vy + this.H; },
    screenToWorld(sx, sy) { return { x: this.cam.x + (sx - this.vx) / this.cam.zoom, y: this.cam.y + (sy - this.vy) / this.cam.zoom }; },
    clampCam() {},
  };
}
function makeWorld(me) { return { me, entities: [], byId: new Map(), players: [{ heroId: 0 }, { heroId: 0 }], map: { w: 60, h: 60 }, sends: [], send() {} }; }
const audio = { resume() {}, play() {} };

function mkP1() {
  const r = makeRenderer();
  const p1 = new InputController(r, makeWorld(0), audio, { pointerType: null, keyboard: true, control: "p1-keyboard" });
  p1.attach(canvas);
  p1.updateCamera(0.016); // seed the virtual cursor
  return { r, p1 };
}

console.log("Holding zoomIn (Shift) increases cam.zoom; zoomOut (Ctrl) decreases it:");
{
  const { r, p1 } = mkP1();
  const z0 = r.cam.zoom;
  key("keydown", "Shift"); // normalizes to "shift" = default zoomIn
  for (let i = 0; i < 10; i++) p1.updateCamera(0.05);
  key("keyup", "Shift");
  assert(r.cam.zoom > z0, `zoom in raised cam.zoom (${z0} → ${r.cam.zoom.toFixed(1)})`);

  const z1 = r.cam.zoom;
  key("keydown", "Control"); // "control" = default zoomOut
  for (let i = 0; i < 10; i++) p1.updateCamera(0.05);
  key("keyup", "Control");
  assert(r.cam.zoom < z1, `zoom out lowered cam.zoom (${z1.toFixed(1)} → ${r.cam.zoom.toFixed(1)})`);
}

console.log("Zoom is clamped to the 10..48 bounds:");
{
  const { r, p1 } = mkP1();
  key("keydown", "Shift");
  for (let i = 0; i < 300; i++) p1.updateCamera(0.05); // hold a long time
  key("keyup", "Shift");
  assert(r.cam.zoom <= 48 + 1e-6, `zoom in clamps at 48 (got ${r.cam.zoom.toFixed(1)})`);

  key("keydown", "Control");
  for (let i = 0; i < 300; i++) p1.updateCamera(0.05);
  key("keyup", "Control");
  assert(r.cam.zoom >= 10 - 1e-6, `zoom out clamps at 10 (got ${r.cam.zoom.toFixed(1)})`);
}

console.log("Without a zoom key held, cam.zoom is unchanged by camera updates:");
{
  const { r, p1 } = mkP1();
  const z0 = r.cam.zoom;
  for (let i = 0; i < 10; i++) p1.updateCamera(0.05);
  assert(Math.abs(r.cam.zoom - z0) < 1e-6, "no zoom key → zoom steady");
}

console.log("");
if (failures === 0) { console.log("ALL T28 ZOOM TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T28 ZOOM TEST(S) FAILED ✗"); process.exit(1); }
