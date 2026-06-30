// MYS Generals — T34 map structure & reachability gate (spec §24 → T34). The three retired maps are
// replaced by SEVEN new large/fast arenas (2 / 3 / 4 / 6 / 8 players + a 2-team lane map). Every main
// base is fortified with a gate, every base can build BOTH a gold and an iron mine, the contested
// heart and every objective sit on reachable grass, and the big maps carry three neutral Fortresses.
// Run: NODE_OPTIONS="" node test/maps.mjs
import { World } from "../dist/sim/world.js";
import { getMap, MAP_IDS } from "../dist/sim/map.js";
import { findPath } from "../dist/sim/grid.js";
import { BUILD_RADIUS } from "../dist/constants.js";

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

function mkPlayer(id) {
  return { id, silver: 15, iron: 0, gold: 0, color: "#4ea3ff", isAI: false, aiDiff: "normal", defeated: false,
    powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
    research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
}

const EXPECT = {
  twin_spear:       { w: 104, h: 64,  spawns: 2, fortresses: 1 },
  quad_foundry:     { w: 112, h: 112, spawns: 4, fortresses: 1 },
  serpent_delta:    { w: 116, h: 100, spawns: 4, fortresses: 1 },
  hex_bazaar:       { w: 132, h: 116, spawns: 6, fortresses: 3 },
  iron_octagon:     { w: 148, h: 148, spawns: 8, fortresses: 3 },
  necrokeep_line:   { w: 168, h: 88,  spawns: 6, fortresses: 3 },
  ashfall_crucible: { w: 116, h: 116, spawns: 3, fortresses: 3 },
};

console.log("Seven selectable maps replace the retired three:");
assert(MAP_IDS.length === 7, "MAP_IDS lists seven maps");
for (const id of Object.keys(EXPECT)) assert(MAP_IDS.includes(id), `'${id}' is selectable`);
assert(!MAP_IDS.includes("twin_rivers") && !MAP_IDS.includes("crossfire") && !MAP_IDS.includes("iron_crossroads"), "the retired map ids are gone");

for (const id of MAP_IDS) {
  console.log(`Map '${id}':`);
  const map = getMap(id);
  const e = EXPECT[id];
  assert(map.w === e.w && map.h === e.h, `sized ${e.w}×${e.h}`);
  assert(map.spawns.length === e.spawns, `${e.spawns} fortified main bases`);

  let walls = 0, cliffs = 0;
  for (const t of map.terrain) { if (t === 4) walls++; if (t === 1) cliffs++; }
  assert(walls > 0, `has wall terrain — fortifications (${walls} tiles)`);
  assert(cliffs > 0, `has cliff/rock obstacle clusters (${cliffs} tiles)`);

  const outposts = map.neutrals.filter((n) => n.kind === "outpost");
  const derricks = map.neutrals.filter((n) => n.kind === "oil_derrick");
  const fortresses = map.neutrals.filter((n) => n.kind === "fortress");
  assert(outposts.length >= 2, `has capturable outpost sub-bases (${outposts.length})`);
  assert(derricks.length >= 1, `has oil derricks (${derricks.length})`);
  assert(fortresses.length === e.fortresses, `has ${e.fortresses} neutral Fortress(es) (${fortresses.length})`);

  // terrain-only grid (no buildings yet) — proves the fortification gates keep things reachable.
  const grid = new World(map).grid;
  const cx = Math.floor(map.w / 2), cy = Math.floor(map.h / 2);

  // the contested heart: the centre tile + the 3×3 around it must be passable grass.
  let centerGrass = true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.terrain[(cy + dy) * map.w + (cx + dx)] !== 0) centerGrass = false;
  assert(centerGrass, "the centre 3×3 is grass");

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
  assert(neuGrass, "every outpost/derrick/fortress sits on clear grass");
  assert(neuOk, "every outpost/derrick/fortress is reachable from a spawn");

  // T34 core invariant: EVERY base can build BOTH a gold mine and an iron mine — there is a gold AND
  // an iron deposit within BUILD_RADIUS of the spawn, each on grass. No cramped, un-buildable base.
  let goldBuildable = true, ironBuildable = true;
  for (const s of map.spawns) {
    const hasGold = map.deposits.some((d) => d.kind === "gold" && map.terrain[d.y * map.w + d.x] === 0 && Math.hypot(d.x - s.x, d.y - s.y) <= BUILD_RADIUS);
    const hasIron = map.deposits.some((d) => d.kind === "iron" && map.terrain[d.y * map.w + d.x] === 0 && Math.hypot(d.x - s.x, d.y - s.y) <= BUILD_RADIUS);
    if (!hasGold) goldBuildable = false;
    if (!hasIron) ironBuildable = false;
  }
  assert(goldBuildable, "every base has a gold deposit on grass within build range");
  assert(ironBuildable, "every base has an iron deposit on grass within build range");

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
if (failures === 0) { console.log("ALL T34 MAP TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " T34 MAP TEST(S) FAILED ✗"); process.exit(1); }
