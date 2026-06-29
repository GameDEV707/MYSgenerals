// MYS Generals — T28 Part A hero-panel visibility test. The hero "super" ability cluster is shown
// ONLY when the hero is selected (or while editing the HUD layout, so it can be repositioned);
// otherwise it is hidden. Tests the pure heroPanelShouldShow() predicate. Headless.
// Run: NODE_OPTIONS="" node test/heropanel.mjs

// hud.js transitively loads the key-binding store, which reads localStorage at import → mock first.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const { heroPanelShouldShow } = await import("../dist/ui/hud.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

const heroId = 42;

console.log("Hidden by default (no hero selected):");
assert(heroPanelShouldShow(heroId, new Set(), false) === false, "empty selection → hidden");
assert(heroPanelShouldShow(heroId, new Set([7, 8]), false) === false, "other units selected → hidden");

console.log("Shown when the hero is in the selection:");
assert(heroPanelShouldShow(heroId, new Set([heroId]), false) === true, "hero selected → shown");
assert(heroPanelShouldShow(heroId, new Set([7, heroId, 9]), false) === true, "hero among a group → shown");

console.log("No hero (heroId 0, e.g. dead/respawning) → hidden:");
assert(heroPanelShouldShow(0, new Set([0]), false) === false, "heroId 0 is never 'selected'");

console.log("Always shown while editing the HUD layout (so it can be repositioned):");
assert(heroPanelShouldShow(heroId, new Set(), true) === true, "editing → shown even with no selection");
assert(heroPanelShouldShow(0, new Set(), true) === true, "editing → shown even with no hero");

console.log("");
if (failures === 0) { console.log("ALL T28 HERO-PANEL TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T28 HERO-PANEL TEST(S) FAILED ✗"); process.exit(1); }
