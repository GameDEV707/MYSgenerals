// MYS Generals — T32 map structure & reachability test (spec §24 → T32 Parts A/C). The maps are
// enlarged, FORTIFIED multi-base arenas: every main base is walled with a gate (so the interior +
// deposits stay reachable), there are capturable outpost sub-bases, and a new big map exists.
// Run: NODE_OPTIONS="" node test/maps.mjs
import { World } from "../dist/sim/world.js";
import { getMap, MAP_IDS } from "../dist/sim/map.js";
import { findPath } from "../dist/sim/grid.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 15, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

const EXPECT = {
  twin_rivers: { w: 80, h: 80, spawns: 2 },
  crossfire: { w: 88, h: 88, spawns: 4 },
  iron_crossroads: { w: 96, h: 96, spawns: 4 },
};

console.log("Three selectable maps (incl. the new big multi-base map):");
assert(MAP_IDS.length === 3, "MAP_IDS lists three maps");
assert(MAP_IDS.includes("iron_crossroads"), "the new 'iron_crossroads' map is selectable");

for (const id of MAP_IDS) {
  console.log(`Map '${id}':`);
  const map = getMap(id);
  const e = EXPECT[id];
  assert(map.w === e.w && map.h === e.h, `enlarged to ${e.w}×${e.h}`);
  assert(map.spawns.length === e.spawns, `${e.spawns} fortified main bases`);

  let walls = 0, cliffs = 0;
  for (const t of map.terrain) { if (t === 4) walls++; if (t === 1) cliffs++; }
  assert(walls > 0, `has wall terrain — fortifications (${walls} tiles)`);
  assert(cliffs > 0, `has cliff/rock obstacle clusters (${cliffs} tiles)`);

  const outposts = map.neutrals.filter((n) => n.kind === "outpost");
  const derricks = map.neutrals.filter((n) => n.kind === "oil_derrick");
  assert(outposts.length >= 2, `has capturable outpost sub-bases (${outposts.length})`);
  assert(derricks.length >= 1, `has oil derricks (${derricks.length})`);

  // terrain-only grid (no buildings yet) — proves the fortification gates keep things reachable.
  const grid = new World(map).grid;
  const cx = Math.floor(map.w / 2), cy = Math.floor(map.h / 2);
  let gateOk = true;
  for (const s of map.spawns) if (!findPath(grid, s.x, s.y, cx, cy)) gateOk = false;
  assert(gateOk, "every spawn can path out through its gate to the centre");

  let depOk = true, depGrass = true;
  for (const d of map.deposits) {
    if (map.terrain[d.y * map.w + d.x] !== 0) depGrass = false;
    if (!map.spawns.some((s) => findPath(grid, s.x, s.y, d.x, d.y))) depOk = false;
  }
  assert(depGrass, "every deposit sits on buildable grass");
  assert(depOk, "every deposit is reachable from a spawn");

  let neuOk = true, neuGrass = true;
  for (const n of map.neutrals) {
    if (map.terrain[n.y * map.w + n.x] !== 0) neuGrass = false;
    if (!map.spawns.some((s) => findPath(grid, s.x, s.y, n.x, n.y))) neuOk = false;
  }
  assert(neuGrass, "every outpost/derrick sits on clear grass");
  assert(neuOk, "every outpost/derrick is reachable from a spawn");

  // a full base spawns cleanly inside the walls on this map
  const w = new World(map);
  for (let i = 0; i < map.spawns.length; i++) w.addPlayer(mkPlayer(i));
  for (let i = 0; i < map.spawns.length; i++) w.spawnBase(i, map.spawns[i]);
  w.setupNeutrals();
  const cc0 = w.entities.find((x) => x.type === "command_center" && x.owner === 0);
  assert(!!cc0, "Command Center spawns inside the fortified base");
  const op = w.entities.find((x) => x.type === "outpost");
  assert(!!op && op.owner === -1 && !!op.weaponDef, "outposts spawn as NEUTRAL garrisoned (weaponed) towers");
}

console.log("");
if (failures === 0) { console.log("ALL T32 MAP TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T32 MAP TEST(S) FAILED ✗"); process.exit(1); }
