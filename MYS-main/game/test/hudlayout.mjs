// MYS Generals — per-player HUD layout persistence tests (spec §24 → T23).
// Proves a customized layout is saved per side and survives a "restart" (reload from storage),
// that the two split halves keep SEPARATE layouts, and that reset-to-default clears it.
// Run: node test/hudlayout.mjs

// minimal localStorage double
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { loadHudLayout, saveHudLayout, clearHudLayout } = await import("../dist/ui/hudLayout.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Fresh load is empty:");
assert(JSON.stringify(loadHudLayout("left")) === "{}", "no stored layout → {}");

console.log("Save + reload (survives a restart):");
saveHudLayout("left", { commands: { x: 40, y: 300, w: 280 }, minimap: { hidden: true } });
const reloaded = loadHudLayout("left");
assert(reloaded.commands.x === 40 && reloaded.commands.y === 300, "left command-panel position persisted");
assert(reloaded.commands.w === 280, "left command-panel size persisted");
assert(reloaded.minimap.hidden === true, "left minimap hidden state persisted");

console.log("The two halves keep SEPARATE layouts:");
saveHudLayout("right", { commands: { x: 999, y: 10 } });
assert(loadHudLayout("left").commands.x === 40, "left layout is untouched by the right layout");
assert(loadHudLayout("right").commands.x === 999, "right layout stored independently");
assert(JSON.stringify(loadHudLayout("single")) === "{}", "single-player layout is its own slot");

console.log("Reset-to-default clears that side only:");
clearHudLayout("left");
assert(JSON.stringify(loadHudLayout("left")) === "{}", "left reset to default");
assert(loadHudLayout("right").commands.x === 999, "right layout untouched by left reset");

console.log("Corrupt storage degrades to default:");
store.set("mys.hud.layout.left", "{not json");
assert(JSON.stringify(loadHudLayout("left")) === "{}", "invalid JSON → default {}");

console.log("");
if (failures === 0) { console.log("ALL HUD-LAYOUT TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " HUD-LAYOUT TEST(S) FAILED ✗"); process.exit(1); }
