// MYS Generals — T26 visuals test (spec §24 → T26 Part D): the pure unitShape(type) helper must
// return a DISTINCT silhouette descriptor for each of the 11 unit types, so every unit reads
// differently on the map and the shape cue does not rely on colour alone. Pure (no browser).
// Run: NODE_OPTIONS="" node test/visuals.mjs
import { unitShape } from "../dist/render/renderer.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

const TYPES = [
  "miner", "engineer", "infantry", "rocket_soldier", "robot",
  "light_tank", "heavy_tank", "artillery", "rocket_launcher", "anti_air", "hero",
];

console.log("unitShape(type) returns a distinct visual descriptor for every unit type:");
const seen = new Map();
let dup = false;
for (const t of TYPES) {
  const sh = unitShape(t);
  assert(sh && sh.type === t, `${t}: descriptor returned with matching type`);
  // compare the VISUAL fields only (exclude the `type` label) so we prove the silhouettes differ.
  const { type: _omit, ...visual } = sh;
  const key = JSON.stringify(visual);
  if (seen.has(key)) { dup = true; console.error(`  ✗ ${t} shares a silhouette with ${seen.get(key)}`); failures++; }
  seen.set(key, t);
}
assert(!dup, "no two unit types share the same silhouette");
assert(seen.size === 11, `all 11 unit silhouettes are unique (got ${seen.size})`);

console.log("Chassis classification is sensible (workers/infantry vs vehicles vs hero):");
assert(unitShape("hero").chassis === "hero", "hero uses the star chassis");
assert(unitShape("light_tank").chassis === "vehicle" && unitShape("artillery").chassis === "vehicle", "tanks/artillery are vehicles");
assert(unitShape("infantry").chassis === "infantry" && unitShape("miner").chassis === "infantry", "infantry/miner are foot chassis");
assert(unitShape("miner").combat === false && unitShape("engineer").combat === false, "workers are flagged non-combat (muted tint)");

console.log("");
if (failures === 0) { console.log("ALL T26 VISUALS TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T26 VISUALS TEST(S) FAILED ✗"); process.exit(1); }
