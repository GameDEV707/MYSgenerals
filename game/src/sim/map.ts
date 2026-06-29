// MYS Generals — map definitions (spec §19; T32 enrichment). Maps are generated procedurally but
// follow the designed layouts: bigger, FORTIFIED multi-base arenas (Dota/Generals-style) with a few
// big main bases (walled + a gate + obstacle clusters) AND several small capturable sub-bases
// (garrisoned outposts), plus resource deposits and oil derricks.
import { ResKind } from "../types.js";

export interface Deposit { x: number; y: number; kind: ResKind; }
// T32: a neutral point is either an oil derrick (income) or a capturable garrisoned outpost (sub-base).
export interface NeutralPoint { x: number; y: number; kind: "oil_derrick" | "outpost"; }
export interface Spawn { x: number; y: number; }

export interface GameMap {
  id: string;
  nameKey: string;
  w: number;
  h: number;
  terrain: Uint8Array; // 0 grass, 1 cliff, 2 water, 3 road, 4 wall (T32; blocks movement, unbuildable)
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

// T32 Part A2: fortify a main base — a WALL along its two center-facing sides at distance R, each
// with a wide (≈5-tile) gate facing the map centre, plus a few cliff cover clusters just outside the
// gates. The base interior (CC, the starting silver mine + miner, engineer, hero, base deposits) sits
// inside the walls; the gate keeps everything reachable (verified by test/maps.mjs).
function fortifyBase(terrain: Uint8Array, w: number, h: number, sx: number, sy: number): void {
  const set = setter(terrain, w, h);
  const R = 7, GATE = 2; // gate half-width 2 → 5-tile opening
  const cx = w / 2, cy = h / 2;
  const innerX = sx < cx ? sx + R : sx - R; // vertical wall column (center-facing)
  const innerY = sy < cy ? sy + R : sy - R; // horizontal wall row (center-facing)
  for (let y = sy - R; y <= sy + R; y++) { if (Math.abs(y - sy) <= GATE) continue; set(innerX, y, WALL); }
  for (let x = sx - R; x <= sx + R; x++) { if (Math.abs(x - sx) <= GATE) continue; set(x, innerY, WALL); }
  // cliff cover flanking the gates (never inside the gate opening itself)
  const ox = innerX + (sx < cx ? 2 : -2);
  const oy = innerY + (sy < cy ? 2 : -2);
  set(ox, sy + 4, CLIFF); set(ox, sy - 4, CLIFF);
  set(sx + 4, oy, CLIFF); set(sx - 4, oy, CLIFF);
}

// Per-base interior iron + gold deposits (sit inside the walls, near the CC, buildable from the start).
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

// Map A — "Twin Rivers" (2 players). Enlarged to 80×80: a central river with four bridges, two
// fortified main bases, four capturable outposts flanking the crossings, contested central gold,
// and two oil derricks.
export function buildTwinRivers(): GameMap {
  const w = 80, h = 80;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = w / 2, cy = h / 2;
  // vertical river at x≈38..41
  for (let y = 0; y < h; y++) for (let x = 38; x <= 41; x++) set(x, y, WATER);
  // four bridges (roads crossing the river)
  for (const by of [20, 40, 60]) for (let dy = 0; dy <= 1; dy++) for (let x = 35; x <= 44; x++) set(x, by + dy, ROAD);
  const spawns: Spawn[] = [{ x: 10, y: 10 }, { x: 69, y: 69 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // midfield cover
  rocks(set, [[24, 30], [54, 48], [28, 54], [50, 26]]);
  const deposits: Deposit[] = [
    ...baseDeposits(10, 10, cx, cy), ...baseDeposits(69, 69, cx, cy),
    // contested expansions near the outposts / centre
    { x: 26, y: 26, kind: "silver" }, { x: 53, y: 53, kind: "silver" },
    { x: 30, y: 18, kind: "iron" }, { x: 49, y: 61, kind: "iron" },
    { x: 33, y: 40, kind: "gold" }, { x: 46, y: 40, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    // four capturable sub-bases flanking the crossings (off the river)
    { x: 30, y: 20, kind: "outpost" }, { x: 49, y: 20, kind: "outpost" },
    { x: 30, y: 60, kind: "outpost" }, { x: 49, y: 60, kind: "outpost" },
    // oil derricks
    { x: 33, y: 33, kind: "oil_derrick" }, { x: 46, y: 47, kind: "oil_derrick" },
  ];
  return { id: "twin_rivers", nameKey: "menu.mapA", w, h, terrain, spawns, deposits, neutrals };
}

// Map B — "Crossfire" (up to 4 players). Enlarged to 88×88: four fortified corner bases around a
// central cliff plateau (four ramps), four edge outposts (sub-bases) and contested central resources.
export function buildCrossfire(): GameMap {
  const w = 88, h = 88;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 44, cy = 44;
  // central plateau ring of cliffs
  for (let a = 0; a < 360; a += 3) {
    const r = 13;
    set(Math.round(cx + Math.cos(a * Math.PI / 180) * r), Math.round(cy + Math.sin(a * Math.PI / 180) * r), CLIFF);
  }
  // four ramps (clear openings through the ring, on the axes)
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (let k = 10; k <= 16; k++) {
      set(cx + dx * k, cy + dy * k, GRASS);
      set(cx + dx * k + (dy !== 0 ? 1 : 0), cy + dy * k + (dx !== 0 ? 1 : 0), GRASS);
      set(cx + dx * k - (dy !== 0 ? 1 : 0), cy + dy * k - (dx !== 0 ? 1 : 0), GRASS);
    }
  }
  const spawns: Spawn[] = [{ x: 10, y: 10 }, { x: 77, y: 77 }, { x: 77, y: 10 }, { x: 10, y: 77 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  rocks(set, [[26, 26], [60, 60], [60, 26], [26, 60]]);
  const deposits: Deposit[] = [
    ...baseDeposits(10, 10, cx, cy), ...baseDeposits(77, 77, cx, cy),
    ...baseDeposits(77, 10, cx, cy), ...baseDeposits(10, 77, cx, cy),
    // contested edge silver near each outpost
    { x: 44, y: 22, kind: "silver" }, { x: 44, y: 66, kind: "silver" },
    { x: 22, y: 44, kind: "silver" }, { x: 66, y: 44, kind: "silver" },
    // central prize
    { x: 44, y: 44, kind: "gold" }, { x: 38, y: 44, kind: "iron" }, { x: 50, y: 44, kind: "iron" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 44, y: 24, kind: "outpost" }, { x: 44, y: 64, kind: "outpost" },
    { x: 24, y: 44, kind: "outpost" }, { x: 64, y: 44, kind: "outpost" },
    { x: 30, y: 44, kind: "oil_derrick" }, { x: 58, y: 44, kind: "oil_derrick" },
  ];
  return { id: "crossfire", nameKey: "menu.mapB", w, h, terrain, spawns, deposits, neutrals };
}

// Map C — "Iron Crossroads" (up to 4 players, T32). A big 96×96 multi-base arena: four fortified
// corner main bases, a walled cross of obstacles through the middle, SIX capturable sub-base outposts
// (four edge midpoints + two central flanks), contested central resources and oil derricks — so a
// match fields four big bases and many small sub-bases at once.
export function buildIronCrossroads(): GameMap {
  const w = 96, h = 96;
  const terrain = blank(w, h);
  const set = setter(terrain, w, h);
  const cx = 48, cy = 48;
  // a central cross of WALL segments (with gaps) framing the contested middle
  for (let x = 30; x <= 66; x++) { if (Math.abs(x - cx) <= 3) continue; set(x, 40, WALL); set(x, 56, WALL); }
  for (let y = 30; y <= 66; y++) { if (Math.abs(y - cy) <= 3) continue; set(48 - 9, y, WALL); set(48 + 9, y, WALL); }
  // cliff cover inside the cross
  rocks(set, [[44, 44], [50, 50]]);
  const spawns: Spawn[] = [{ x: 12, y: 12 }, { x: 83, y: 83 }, { x: 83, y: 12 }, { x: 12, y: 83 }];
  for (const s of spawns) fortifyBase(terrain, w, h, s.x, s.y);
  // midfield rock obstacles between the bases and the centre
  rocks(set, [[30, 30], [64, 64], [64, 30], [30, 64], [48, 24], [48, 70], [24, 48], [70, 48]]);
  const deposits: Deposit[] = [
    ...baseDeposits(12, 12, cx, cy), ...baseDeposits(83, 83, cx, cy),
    ...baseDeposits(83, 12, cx, cy), ...baseDeposits(12, 83, cx, cy),
    // expansions near the edge outposts
    { x: 48, y: 20, kind: "silver" }, { x: 48, y: 76, kind: "silver" },
    { x: 20, y: 48, kind: "iron" }, { x: 76, y: 48, kind: "iron" },
    // central contested prize
    { x: 48, y: 48, kind: "gold" }, { x: 40, y: 48, kind: "gold" }, { x: 56, y: 48, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    // four edge-midpoint sub-bases
    { x: 48, y: 22, kind: "outpost" }, { x: 48, y: 74, kind: "outpost" },
    { x: 22, y: 48, kind: "outpost" }, { x: 74, y: 48, kind: "outpost" },
    // two central-flank sub-bases (high-value, contested)
    { x: 34, y: 48, kind: "outpost" }, { x: 62, y: 48, kind: "outpost" },
    // oil derricks
    { x: 30, y: 48, kind: "oil_derrick" }, { x: 66, y: 48, kind: "oil_derrick" },
  ];
  return { id: "iron_crossroads", nameKey: "menu.mapC", w, h, terrain, spawns, deposits, neutrals };
}

export function getMap(id: string): GameMap {
  switch (id) {
    case "crossfire": return buildCrossfire();
    case "iron_crossroads": return buildIronCrossroads();
    default: return buildTwinRivers();
  }
}

// The selectable map ids (shared by the menu/lobby).
export const MAP_IDS = ["twin_rivers", "crossfire", "iron_crossroads"];
