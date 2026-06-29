// MYS Generals — remappable key-binding store tests (spec §24 → T24).
// Proves the defaults, per-context conflict detection (same player only), persistence across a
// "restart", reset-to-defaults (per player + global), and key normalize/label helpers.
// Run: node test/keybindings.mjs

// minimal localStorage double (must exist BEFORE importing the store — it loads at module init)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const kb = await import("../dist/ui/keyBindings.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Default scheme (spec §24):");
const d = kb.defaultKeyBindings();
assert(d.p1.cursorUp === "w" && d.p1.cursorLeft === "a" && d.p1.cursorDown === "s" && d.p1.cursorRight === "d", "P1 cursor = W/A/S/D");
assert(d.p1.select === "e" && d.p1.command === "q", "P1 select = E, command = Q");
assert(d.p1.ability1 === "z" && d.p1.ability2 === "x" && d.p1.ability3 === "c" && d.p1.ability4 === "v", "P1 abilities = Z/X/C/V");
assert(d.p1.nextTab === "]" && d.p1.prevTab === "[", "P1 build-tab cycle = ] / [ (T26)");
assert(d.p1.cycleCategory === "space", "P1 category switch = Space (T27)");
assert(d.p2.ability1 === "arrowup" && d.p2.ability2 === "arrowright" && d.p2.ability3 === "arrowleft" && d.p2.ability4 === "arrowdown", "P2 abilities = arrow keys");
assert(d.shared.ability1 === "q" && d.shared.ability2 === "w" && d.shared.ability3 === "e" && d.shared.ability4 === "r", "Single-player abilities = Q/W/E/R");

console.log("Key normalization & labels:");
assert(kb.normalizeKey({ key: "ArrowUp" }) === "arrowup", "ArrowUp → arrowup");
assert(kb.normalizeKey({ key: " " }) === "space", "Space → space");
assert(kb.normalizeKey({ key: "W" }) === "w", "W → w (case-insensitive)");
assert(kb.keyLabel("arrowup") === "↑" && kb.keyLabel("arrowdown") === "↓", "arrow labels are glyphs");
assert(kb.keyLabel("z") === "Z", "letter label uppercased");
assert(kb.keyLabel("") === "—", "empty key shows a dash");

console.log("Conflict detection is per-context (per player) only:");
assert(kb.findConflict(d, "p1", "command", "w") === "cursorUp", "assigning P1 command=W conflicts with P1 cursorUp");
assert(kb.findConflict(d, "p1", "command", "k") === null, "a free key has no conflict");
// T26: the new build-tab keys are conflict-checked within the P1 context like every other binding.
assert(kb.findConflict(d, "p1", "nextTab", "[") === "prevTab", "P1 nextTab=[ conflicts with prevTab");
assert(kb.findConflict(d, "p1", "select", "]") === "nextTab", "P1 select=] conflicts with nextTab");
// T27: the category switch key (Space) is conflict-checked within the P1 context like any binding.
assert(kb.findConflict(d, "p1", "command", "space") === "cycleCategory", "P1 command=Space conflicts with cycleCategory");
assert(kb.findConflict(d, "p1", "cycleCategory", "k") === null, "rebinding cycleCategory to a free key has no conflict");
// the same physical key in DIFFERENT contexts is allowed (P1 'q' and shared 'q' can't cross-control)
assert(kb.findConflict(d, "shared", "ability1", "q") === null, "shared can use Q even though P1 command is Q (different player)");

console.log("Live singleton: blocked conflict, applied free key, persistence:");
const conflict = kb.setBinding("p1", "command", "w");
assert(conflict === "cursorUp", "setBinding returns the conflicting action and does not apply");
assert(kb.getKeyBindings().p1.command === "q", "P1 command unchanged after a blocked rebind");
const ok = kb.setBinding("p1", "command", "b");
assert(ok === null && kb.getKeyBindings().p1.command === "b", "a free rebind applies");
assert(kb.loadKeyBindings().p1.command === "b", "the rebind persisted to storage (survives a restart)");

console.log("Reset to defaults (per player, then global):");
kb.setBinding("p2", "ability1", "k");
kb.resetKeyBindings("p1");
assert(kb.getKeyBindings().p1.command === "q", "per-player reset restored P1 command to Q");
assert(kb.getKeyBindings().p2.ability1 === "k", "per-player reset left P2 untouched");
kb.resetKeyBindings();
assert(kb.getKeyBindings().p2.ability1 === "arrowup", "global reset restored everything");

console.log("Partial/old saves merge onto defaults:");
store.set("mys.keybindings", JSON.stringify({ p1: { command: "g" } }));
const merged = kb.loadKeyBindings();
assert(merged.p1.command === "g" && merged.p1.cursorUp === "w", "stored value kept, missing actions default");

console.log("");
if (failures === 0) { console.log("ALL KEY-BINDING TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " KEY-BINDING TEST(S) FAILED ✗"); process.exit(1); }
