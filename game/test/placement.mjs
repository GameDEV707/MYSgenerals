// MYS Generals — T29 Part A placement-visibility test. The pure predicate
// panelsHiddenDuringPlacement(placing) is true while a building is being positioned (r.placing set)
// and false otherwise — driving the hide of the command/selection/hero panels — and the Cancel-build
// action (input.setPlacing(null)) clears r.placing so the panels reappear. Headless.
// Run: NODE_OPTIONS="" node test/placement.mjs

// hud.js + input.js transitively load the key-binding store, which reads localStorage at import.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { addEventListener() {} };

const { panelsHiddenDuringPlacement } = await import("../dist/ui/hud.js");
const { InputController } = await import("../dist/input.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("panelsHiddenDuringPlacement() is true while placing, false otherwise:");
assert(panelsHiddenDuringPlacement(null) === false, "no placing → panels visible (false)");
assert(panelsHiddenDuringPlacement(undefined) === false, "undefined → panels visible (false)");
assert(panelsHiddenDuringPlacement({ building: "barracks" }) === true, "placing a barracks → panels hidden (true)");
assert(panelsHiddenDuringPlacement({ building: "silver_mine" }) === true, "placing a silver mine → panels hidden (true)");

// --- the Cancel action clears r.placing via input.setPlacing(null) ---
const r = { placing: null, selection: new Set() };
const world = { me: 0, players: [{ heroId: 0 }], byId: new Map(), send() {} };
const audio = { resume() {}, play() {} };
const input = new InputController(r, world, audio, { pointerType: "mouse", keyboard: false });

console.log("Entering placement sets r.placing (panels hide), the Cancel action clears it (panels return):");
input.setPlacing("barracks");
assert(r.placing != null && r.placing.building === "barracks", "setPlacing('barracks') sets r.placing");
assert(panelsHiddenDuringPlacement(r.placing) === true, "predicate now reports panels hidden");

// the Cancel-build control calls input.setPlacing(null) — exactly what the HUD button wires.
input.setPlacing(null);
assert(r.placing === null, "Cancel action (setPlacing(null)) clears r.placing");
assert(panelsHiddenDuringPlacement(r.placing) === false, "predicate now reports panels visible again");

console.log("setPlacing also clears any pending ability (no stale placement/ability state):");
input.pendingAbility = 2;
input.setPlacing("power_plant");
assert(input.pendingAbility === -1, "a pending ability is cancelled when placement starts");

console.log("");
if (failures === 0) { console.log("ALL T29 PLACEMENT-VISIBILITY TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T29 PLACEMENT-VISIBILITY TEST(S) FAILED ✗"); process.exit(1); }
