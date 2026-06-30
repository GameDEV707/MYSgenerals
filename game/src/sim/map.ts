// MYS Generals — map definitions (spec §19; T34 rewrite). The three previously-shipped maps are
// retired and replaced by SEVEN brand-new, bigger, FASTER arenas tuned for
// specific player counts (2 / 3 / 4 / 6 / 8) plus a dedicated 2-team elongated lane map. The large
// maps add the new capturable Neutral FORTRESS faction (white, hostile, captured by shooting it down).
// Every map is procedurally generated but follows its designed layout: fortified main bases (walls +
// a gate), wide road lanes for fast contact, contested resource deposits, capturable outposts, oil
// derricks, and (on the big maps) three neutral fortress-lords.
import { ResKind } from "../types.js";

export interface Deposit { x: number; y: number; kind: ResKind; }
// T34: a neutral point is an oil derrick (income), a capturable garrisoned outpost (sub-base), or a
// capturable Neutral FORTRESS (a white, hostile keep with a fixed garrison, taken by ranged defeat).
export interface NeutralPoint { x: number; y: number; kind: "oil_derrick" | "outpost" | "fortress"; }
export interface Spawn { x: number; y: number; }

export interface GameMap {
  id: string;
  nameKey: string;
  w: number;
  h: number;
  terrain: Uint8Array; // 0 grass, 1 cliff, 2 water, 3 road, 4 wall (blocks movement; grass/road buildable)
  spawns: Spawn[];
  deposits: Deposit[];
  neutrals: NeutralPoint[];
}

// Terrain tile values (shared with the NavGrid + renderer).
const GRASS = 0, CLIFF = 1, WATER = 2, ROAD = 3, WALL = 4;

function blank(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h); // all grass
}
function setter(terrain: Uint8Array, w: number, h: number) {
  return (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < w && y < h) terrain[y * w + x] = v; };
}

// Fortify a main base — a WALL along its two centre-facing sides at distance R, each with a wide
// (≈5-tile) gate facing the map centre, plus a few cliff cover clusters just outside the gates. The
// base interior (CC, starting silver mine + miner, engineer, hero, base deposits) sits inside the
// walls; the gate keeps everything reachable (verified by test/maps.mjs). Needs the spawn ≥9 tiles
// from every edge and ≥2 tiles off both centre axes (else the gate degenerates).
function fortifyBase(terrain: Uint8Array, w: number, h: number, sx: number, sy: number): void {
  const set = setter(terrain, w, h);
  const R = 7, GATE = 2; // gate half-width 2 → 5-tile opening
  const cx = w / 2, cy = h / 2;
  const innerX = sx < cx ? sx + R : sx - R; // vertical wall column (centre-facing)
  const innerY = sy < cy ? sy + R : sy - R; // horizontal wall row (centre-facing)
  for (let y = sy - R; y <= sy + R; y++) { if (Math.abs(y - sy) <= GATE) continue; set(innerX, y, WALL); }
  for (let x = sx - R; x <= sx + R; x++) { if (Math.abs(x - sx) <= GATE) continue; set(x, innerY, WALL); }
  // cliff cover flanking the gates (never inside the gate opening itself)
  const ox = innerX + (sx < cx ? 2 : -2);
  const oy = innerY + (sy < cy ? 2 : -2);
  set(ox, sy + 4, CLIFF); set(ox, sy - 4, CLIFF);
  set(sx + 4, oy, CLIFF); set(sx - 4, oy, CLIFF);
}

// Per-base interior iron + gold deposits (sit inside the walls, near the CC, buildable from the
// start). Iron at (sx±1, sy±4) and gold at (sx±4, sy±1) toward the map edge, inside the walls.
function baseDeposits(sx: number, sy: number, cx: number, cy: number): Deposit[] {
  const ex = sx < cx ? -1 : 1; // toward the map edge (the base interior side)
  const ey = sy < cy ? -1 : 1;
  return [
    { x: sx + ex, y: sy + ey * 4, kind: "iron" },
    { x: sx + ex * 4, y: sy + ey, kind: "gold" },
  ];
}

function rocks(set: (x: number, y: number, v: number) => void, clusters: [number, number][]): void {
  for (const [cx, cy] of clusters) { set(cx, cy, CLIFF); set(cx + 1, cy, CLIFF); set(cx, cy + 1, CLIFF); }
}

// Paint a ROAD band `width` tiles thick along the straight segment (x0,y0)→(x1,y1). Roads are
// passable AND buildable, so lanes are fast attack/expansion routes.
function laneRoad(set: (x: number, y: number, v: number) => void, x0: number, y0: number, x1: number, y1: number, width = 2): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  const half = Math.floor(width / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -half; dy <= width - 1 - half; dy++) for (let dx = -half; dx <= width - 1 - half; dx++) set(cx + dx, cy + dy, ROAD);
  }
}

// A WALL (or other tile `tile`) ring of `radius` around (cx,cy), MINUS gate openings at the given
// angles (degrees). Used for the hex/octagon central enclosures; the gates keep the interior
// reachable (so the central prize + fortresses can always be reached through a gate).
function wallArc(set: (x: number, y: number, v: number) => void, cx: number, cy: number, radius: number, gateAnglesDeg: number[], gateHalfWidthDeg = 12, tile = WALL): void {
  for (let a = 0; a < 360; a += 2) {
    let inGate = false;
    for (const g of gateAnglesDeg) { const d = Math.abs(((a - g + 540) % 360) - 180); if (d <= gateHalfWidthDeg) inGate = true; }
    if (inGate) continue;
    set(Math.round(cx + Math.cos(a * Math.PI / 180) * radius), Math.round(cy + Math.sin(a * Math.PI / 180) * radius), tile);
  }
}

// Final safety pass shared by every builder: GUARANTEE the contested heart and every objective sit on
// reachable buildable grass. Forces the centre 3×3 to grass, every deposit tile to grass, and every
// neutral's footprint apron to grass (so its structure + garrison spawn cleanly and the test's
// on-grass / reachability invariants always hold regardless of the lanes/walls painted above).
function clearObjects(terrain: Uint8Array, w: number, h: number, deposits: Deposit[], neutrals: NeutralPoint[]): void {
  const set = setter(terrain, w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(cx + dx, cy + dy, GRASS);
  for (const d of deposits) set(d.x, d.y, GRASS);
  for (const n of neutrals) {
    const ap = n.kind === "fortress" ? 5 : 2;
    for (let dy = -ap; dy <= ap; dy++) for (let dx = -ap; dx <= ap; dx++) set(n.x + dx, n.y + dy, GRASS);
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A1 — "Twin Spear" — 2 players — 104×64 (fast triple-lane duel; 1 central fortress).
export function buildTwinSpear(): GameMap {
  const w = 104, h = 64;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 52, cy = 32;
  // three horizontal road lanes across the midfield
  laneRoad(set, 26, 16, 78, 16, 2);
  laneRoad(set, 26, 48, 78, 48, 2);
  // middle lane split to leave the central fortress cluster clear
  laneRoad(set, 26, 32, 36, 32, 2);
  laneRoad(set, 68, 32, 78, 32, 2);
  rocks(set, [[44, 22], [58, 42], [44, 42], [58, 22]]);
  const spawns: Spawn[] = [{ x: 14, y: 18 }, { x: 89, y: 45 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // vertical connectors linking each base gate to all three lanes
  laneRoad(set, 21, 18, 21, 48, 2);
  laneRoad(set, 82, 16, 82, 45, 2);
  const deposits: Deposit[] = [
    ...baseDeposits(14, 18, cx, cy), ...baseDeposits(89, 45, cx, cy),
    { x: 52, y: 18, kind: "silver" }, { x: 52, y: 46, kind: "silver" },
    { x: 40, y: 32, kind: "iron" }, { x: 64, y: 32, kind: "iron" },
    { x: 46, y: 32, kind: "gold" }, { x: 58, y: 32, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 52, y: 32, kind: "fortress" },
    { x: 40, y: 16, kind: "outpost" }, { x: 64, y: 48, kind: "outpost" },
    { x: 33, y: 40, kind: "oil_derrick" }, { x: 70, y: 24, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "twin_spear", nameKey: "menu.map.twin_spear", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A2 — "Quad Foundry" — 4 players — 112×112 (four corners, road cross, central cliff plateau; 1 fortress).
export function buildQuadFoundry(): GameMap {
  const w = 112, h = 112;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 56, cy = 56;
  // central cliff-ring plateau with 4 axis ramps (clear grass openings)
  for (let a = 0; a < 360; a += 3) {
    const r = 14;
    set(Math.round(cx + Math.cos(a * Math.PI / 180) * r), Math.round(cy + Math.sin(a * Math.PI / 180) * r), CLIFF);
  }
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (let k = 10; k <= 17; k++) {
      set(cx + dx * k, cy + dy * k, GRASS);
      set(cx + dx * k + (dy !== 0 ? 1 : 0), cy + dy * k + (dx !== 0 ? 1 : 0), GRASS);
      set(cx + dx * k - (dy !== 0 ? 1 : 0), cy + dy * k - (dx !== 0 ? 1 : 0), GRASS);
    }
  }
  const spawns: Spawn[] = [{ x: 16, y: 16 }, { x: 95, y: 95 }, { x: 95, y: 16 }, { x: 16, y: 95 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // a cross of roads from each gate through the edge-mid outposts toward the ramps
  laneRoad(set, 56, 18, 56, 40, 2); laneRoad(set, 56, 72, 56, 94, 2);
  laneRoad(set, 18, 56, 40, 56, 2); laneRoad(set, 72, 56, 94, 56, 2);
  laneRoad(set, 24, 24, 42, 42, 2); laneRoad(set, 88, 88, 70, 70, 2);
  laneRoad(set, 88, 24, 70, 42, 2); laneRoad(set, 24, 88, 42, 70, 2);
  rocks(set, [[34, 34], [74, 74], [74, 34], [34, 74]]);
  const deposits: Deposit[] = [
    ...baseDeposits(16, 16, cx, cy), ...baseDeposits(95, 95, cx, cy),
    ...baseDeposits(95, 16, cx, cy), ...baseDeposits(16, 95, cx, cy),
    { x: 56, y: 22, kind: "silver" }, { x: 56, y: 90, kind: "silver" },
    { x: 22, y: 56, kind: "silver" }, { x: 90, y: 56, kind: "silver" },
    { x: 42, y: 56, kind: "iron" }, { x: 70, y: 56, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 56, y: 56, kind: "fortress" },
    { x: 56, y: 18, kind: "outpost" }, { x: 56, y: 94, kind: "outpost" },
    { x: 18, y: 56, kind: "outpost" }, { x: 94, y: 56, kind: "outpost" },
    { x: 40, y: 56, kind: "oil_derrick" }, { x: 72, y: 56, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "quad_foundry", nameKey: "menu.map.quad_foundry", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A3 — "Serpent Delta" — 4 players — 116×100 (river delta, bridges, island fortress; 1 fortress).
export function buildSerpentDelta(): GameMap {
  const w = 116, h = 100;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 58, cy = 50;
  // vertical river splitting the map (x≈55..60)
  for (let y = 0; y < h; y++) for (let x = 55; x <= 60; x++) set(x, y, WATER);
  // a branching tributary toward the bottom-left
  for (let y = 60; y < h; y++) for (let x = 40; x <= 43; x++) set(x, y, WATER);
  // three road bridges (width 3) crossing the river
  for (const by of [20, 50, 80]) laneRoad(set, 50, by, 66, by, 3);
  // bridge over the tributary
  laneRoad(set, 36, 70, 47, 70, 3);
  const spawns: Spawn[] = [{ x: 16, y: 24 }, { x: 16, y: 76 }, { x: 99, y: 24 }, { x: 99, y: 76 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  rocks(set, [[30, 50], [86, 50], [50, 34], [66, 66]]);
  const deposits: Deposit[] = [
    ...baseDeposits(16, 24, cx, cy), ...baseDeposits(16, 76, cx, cy),
    ...baseDeposits(99, 24, cx, cy), ...baseDeposits(99, 76, cx, cy),
    { x: 48, y: 20, kind: "silver" }, { x: 68, y: 20, kind: "silver" },
    { x: 48, y: 80, kind: "silver" }, { x: 68, y: 80, kind: "silver" },
    { x: 50, y: 50, kind: "iron" }, { x: 66, y: 50, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 58, y: 50, kind: "fortress" },
    { x: 48, y: 20, kind: "outpost" }, { x: 68, y: 20, kind: "outpost" },
    { x: 48, y: 80, kind: "outpost" }, { x: 68, y: 80, kind: "outpost" },
    { x: 30, y: 50, kind: "oil_derrick" }, { x: 86, y: 50, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "serpent_delta", nameKey: "menu.map.serpent_delta", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A4 — "Hex Bazaar" — 6 players — 132×116 (six bases around a guarded central market; 3 fortresses).
export function buildHexBazaar(): GameMap {
  const w = 132, h = 116;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 66, cy = 58;
  const spawns: Spawn[] = [
    { x: 22, y: 26 }, { x: 110, y: 26 }, { x: 18, y: 55 },
    { x: 114, y: 61 }, { x: 22, y: 90 }, { x: 110, y: 90 },
  ];
  // road spokes from each base toward the centre (fast contact)
  for (const s of spawns) laneRoad(set, s.x, s.y, cx, cy, 2);
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // hexagonal market wall enclosure with 6 gates (one facing each base)
  wallArc(set, cx, cy, 20, [0, 60, 120, 180, 240, 300], 14);
  rocks(set, [[44, 40], [88, 40], [44, 76], [88, 76]]);
  const deposits: Deposit[] = [
    ...baseDeposits(22, 26, cx, cy), ...baseDeposits(110, 26, cx, cy), ...baseDeposits(18, 55, cx, cy),
    ...baseDeposits(114, 61, cx, cy), ...baseDeposits(22, 90, cx, cy), ...baseDeposits(110, 90, cx, cy),
    { x: 40, y: 30, kind: "silver" }, { x: 92, y: 30, kind: "silver" },
    { x: 40, y: 86, kind: "silver" }, { x: 92, y: 86, kind: "silver" },
    { x: 58, y: 42, kind: "iron" }, { x: 74, y: 42, kind: "gold" },
    { x: 46, y: 70, kind: "iron" }, { x: 86, y: 70, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 66, y: 42, kind: "fortress" }, { x: 50, y: 68, kind: "fortress" }, { x: 82, y: 68, kind: "fortress" },
    { x: 66, y: 30, kind: "outpost" }, { x: 40, y: 46, kind: "outpost" }, { x: 92, y: 46, kind: "outpost" },
    { x: 40, y: 70, kind: "outpost" }, { x: 92, y: 70, kind: "outpost" }, { x: 66, y: 86, kind: "outpost" },
    { x: 58, y: 58, kind: "oil_derrick" }, { x: 74, y: 58, kind: "oil_derrick" }, { x: 66, y: 70, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "hex_bazaar", nameKey: "menu.map.hex_bazaar", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A5 — "Iron Octagon" — 8 players — 148×148 (rim ring road + spokes, central vault; 3 fortresses).
export function buildIronOctagon(): GameMap {
  const w = 148, h = 148;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 74, cy = 74;
  const spawns: Spawn[] = [
    { x: 18, y: 18 }, { x: 130, y: 18 }, { x: 130, y: 130 }, { x: 18, y: 130 },
    { x: 72, y: 16 }, { x: 132, y: 72 }, { x: 76, y: 132 }, { x: 16, y: 76 },
  ];
  // ring road linking all 8 bases (octagon at radius ≈44)
  const ringPts: [number, number][] = [];
  for (let a = 0; a < 360; a += 45) ringPts.push([Math.round(cx + Math.cos(a * Math.PI / 180) * 44), Math.round(cy + Math.sin(a * Math.PI / 180) * 44)]);
  for (let i = 0; i < ringPts.length; i++) {
    const a = ringPts[i], b = ringPts[(i + 1) % ringPts.length];
    laneRoad(set, a[0], a[1], b[0], b[1], 2);
  }
  // 8 spokes from each base gate inward toward the centre
  for (const s of spawns) laneRoad(set, s.x, s.y, cx, cy, 2);
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // central vault wall ring with 4 gates around the big central prize
  wallArc(set, cx, cy, 11, [0, 90, 180, 270], 16);
  rocks(set, [[50, 50], [98, 50], [50, 98], [98, 98]]);
  const deposits: Deposit[] = [
    ...baseDeposits(18, 18, cx, cy), ...baseDeposits(130, 18, cx, cy), ...baseDeposits(130, 130, cx, cy), ...baseDeposits(18, 130, cx, cy),
    ...baseDeposits(72, 16, cx, cy), ...baseDeposits(132, 72, cx, cy), ...baseDeposits(76, 132, cx, cy), ...baseDeposits(16, 76, cx, cy),
    { x: 74, y: 74, kind: "gold" }, { x: 70, y: 74, kind: "gold" },
    { x: 50, y: 30, kind: "silver" }, { x: 98, y: 30, kind: "silver" },
    { x: 50, y: 118, kind: "silver" }, { x: 98, y: 118, kind: "silver" },
    { x: 58, y: 74, kind: "iron" }, { x: 90, y: 74, kind: "gold" },
    { x: 74, y: 58, kind: "iron" }, { x: 74, y: 90, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 74, y: 56, kind: "fortress" }, { x: 58, y: 84, kind: "fortress" }, { x: 90, y: 84, kind: "fortress" },
    { x: 46, y: 46, kind: "outpost" }, { x: 102, y: 46, kind: "outpost" }, { x: 102, y: 102, kind: "outpost" }, { x: 46, y: 102, kind: "outpost" },
    { x: 74, y: 32, kind: "outpost" }, { x: 116, y: 74, kind: "outpost" }, { x: 74, y: 116, kind: "outpost" }, { x: 32, y: 74, kind: "outpost" },
    { x: 40, y: 74, kind: "oil_derrick" }, { x: 108, y: 74, kind: "oil_derrick" }, { x: 74, y: 40, kind: "oil_derrick" }, { x: 74, y: 108, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "iron_octagon", nameKey: "menu.map.iron_octagon", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A6 — "Necrokeep Line" — 2 teams (up to 3v3) — 168×88 (elongated two-lane team map; 3 fortresses).
// spawns[0] = BLUE shared base (far left), spawns[1] = RED shared base (far right) — order is
// load-bearing for team mode; spawns[2..5] are the FFA-fill corner bases at the two ends.
export function buildNecrokeepLine(): GameMap {
  const w = 168, h = 88;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 84, cy = 44;
  // top + bottom road lanes linking the two ends
  laneRoad(set, 24, 17, 144, 17, 3);
  laneRoad(set, 24, 69, 144, 69, 3);
  const spawns: Spawn[] = [
    { x: 16, y: 42 }, { x: 151, y: 46 },
    { x: 16, y: 18 }, { x: 16, y: 68 }, { x: 151, y: 18 }, { x: 151, y: 68 },
  ];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // central divider stubs (wall) between the lanes and the jungle spine — with wide gaps for
  // lane↔jungle crossings (kept clear of the fortress line at x=84).
  for (let x = 40; x <= 70; x += 1) { set(x, 27, WALL); set(x, 61, WALL); }
  for (let x = 98; x <= 128; x += 1) { set(x, 27, WALL); set(x, 61, WALL); }
  rocks(set, [[64, 38], [104, 50], [64, 50], [104, 38]]);
  const deposits: Deposit[] = [
    ...baseDeposits(16, 42, cx, cy), ...baseDeposits(151, 46, cx, cy),
    ...baseDeposits(16, 18, cx, cy), ...baseDeposits(16, 68, cx, cy),
    ...baseDeposits(151, 18, cx, cy), ...baseDeposits(151, 68, cx, cy),
    { x: 56, y: 14, kind: "silver" }, { x: 112, y: 14, kind: "silver" },
    { x: 56, y: 72, kind: "silver" }, { x: 112, y: 72, kind: "silver" },
    { x: 74, y: 30, kind: "iron" }, { x: 94, y: 30, kind: "gold" },
    { x: 74, y: 58, kind: "iron" }, { x: 94, y: 58, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 84, y: 30, kind: "fortress" }, { x: 84, y: 44, kind: "fortress" }, { x: 84, y: 58, kind: "fortress" },
    { x: 56, y: 17, kind: "outpost" }, { x: 112, y: 17, kind: "outpost" },
    { x: 56, y: 69, kind: "outpost" }, { x: 112, y: 69, kind: "outpost" },
    { x: 72, y: 44, kind: "outpost" }, { x: 96, y: 44, kind: "outpost" },
    { x: 64, y: 44, kind: "oil_derrick" }, { x: 104, y: 44, kind: "oil_derrick" }, { x: 84, y: 70, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "necrokeep_line", nameKey: "menu.map.necrokeep_line", w, h, terrain, spawns, deposits, neutrals };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// A7 — "Ashfall Crucible" — 3 players — 116×116 (volcanic caldera, lava moat, 3 land bridges; 3 fortresses).
export function buildAshfallCrucible(): GameMap {
  const w = 116, h = 116;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 58, cy = 58;
  // annular LAVA moat (water tiles — impassable; the renderer tints them on this map) around a
  // central grass courtyard, with a cliff caldera rim just outside it.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d >= 14 && d <= 18) set(x, y, WATER);   // lava moat
    else if (d > 18 && d <= 20) set(x, y, CLIFF); // caldera rim
  }
  const spawns: Spawn[] = [{ x: 54, y: 16 }, { x: 20, y: 96 }, { x: 96, y: 96 }];
  // three land bridges (road) radiating from the central courtyard to each base
  for (const s of spawns) laneRoad(set, cx, cy, s.x, s.y, 3);
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // scattered ruined-building rubble on the outer plain (decor / cover)
  rocks(set, [[30, 30], [86, 30], [30, 86], [86, 86], [58, 96], [40, 50]]);
  const deposits: Deposit[] = [
    ...baseDeposits(54, 16, cx, cy), ...baseDeposits(20, 96, cx, cy), ...baseDeposits(96, 96, cx, cy),
    { x: 58, y: 30, kind: "silver" }, { x: 34, y: 78, kind: "silver" }, { x: 82, y: 78, kind: "silver" },
    { x: 50, y: 48, kind: "iron" }, { x: 66, y: 48, kind: "gold" },
    { x: 50, y: 68, kind: "iron" }, { x: 66, y: 68, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 58, y: 40, kind: "fortress" }, { x: 40, y: 72, kind: "fortress" }, { x: 76, y: 72, kind: "fortress" },
    { x: 58, y: 34, kind: "outpost" }, { x: 38, y: 64, kind: "outpost" }, { x: 78, y: 64, kind: "outpost" },
    { x: 58, y: 48, kind: "oil_derrick" }, { x: 46, y: 66, kind: "oil_derrick" }, { x: 70, y: 66, kind: "oil_derrick" },
  ];
  clearObjects(terrain, w, h, deposits, neutrals);
  return { id: "ashfall_crucible", nameKey: "menu.map.ashfall_crucible", w, h, terrain, spawns, deposits, neutrals };
}

export function getMap(id: string): GameMap {
  switch (id) {
    case "quad_foundry": return buildQuadFoundry();
    case "serpent_delta": return buildSerpentDelta();
    case "hex_bazaar": return buildHexBazaar();
    case "iron_octagon": return buildIronOctagon();
    case "necrokeep_line": return buildNecrokeepLine();
    case "ashfall_crucible": return buildAshfallCrucible();
    default: return buildTwinSpear();
  }
}

// The selectable map ids (shared by the menu/lobby).
export const MAP_IDS = ["twin_spear", "quad_foundry", "serpent_delta", "hex_bazaar", "iron_octagon", "necrokeep_line", "ashfall_crucible"];
