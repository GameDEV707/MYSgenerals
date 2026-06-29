// MYS Generals — map definitions (spec §19). Maps are generated procedurally but
// follow the designed layouts (symmetric, with deposits & neutral points).
import { ResKind } from "../types.js";

export interface Deposit { x: number; y: number; kind: ResKind; }
export interface NeutralPoint { x: number; y: number; kind: "oil_derrick"; }
export interface Spawn { x: number; y: number; }

export interface GameMap {
  id: string;
  nameKey: string;
  w: number;
  h: number;
  terrain: Uint8Array; // 0 grass, 1 cliff, 2 water, 3 road
  spawns: Spawn[];
  deposits: Deposit[];
  neutrals: NeutralPoint[];
}

function blank(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h); // all grass
}

// Map A — "Twin Rivers" (2 players, symmetric). A central river with two bridges.
export function buildTwinRivers(): GameMap {
  const w = 64, h = 64;
  const terrain = blank(w, h);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < w && y < h) terrain[y * w + x] = v; };
  // vertical river at center x ~ 32, with two bridges (road) at y=18 and y=46
  for (let y = 0; y < h; y++) {
    for (let x = 30; x <= 33; x++) set(x, y, 2); // water
  }
  for (const by of [18, 46]) {
    for (let x = 29; x <= 34; x++) { set(x, by, 3); set(x, by - 1, 3); }
  }
  // a few rock clusters for cover
  for (const [cx, cy] of [[14, 30], [50, 34], [20, 50], [44, 14]]) {
    set(cx, cy, 1); set(cx + 1, cy, 1); set(cx, cy + 1, 1);
  }
  const spawns: Spawn[] = [{ x: 8, y: 8 }, { x: 56, y: 56 }];
  const deposits: Deposit[] = [
    // base-adjacent silver handled at spawn; extra deposits:
    { x: 14, y: 6, kind: "silver" }, { x: 6, y: 16, kind: "iron" }, { x: 18, y: 16, kind: "gold" },
    { x: 50, y: 58, kind: "silver" }, { x: 58, y: 48, kind: "iron" }, { x: 46, y: 48, kind: "gold" },
    { x: 32, y: 32, kind: "gold" }, // contested center
  ];
  const neutrals: NeutralPoint[] = [
    { x: 26, y: 20, kind: "oil_derrick" }, { x: 38, y: 44, kind: "oil_derrick" },
  ];
  return { id: "twin_rivers", nameKey: "menu.mapA", w, h, terrain, spawns, deposits, neutrals };
}

// Map B — "Crossfire" (here used as a 1v1 on a larger open arena with a central prize).
export function buildCrossfire(): GameMap {
  const w = 72, h = 72;
  const terrain = blank(w, h);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < w && y < h) terrain[y * w + x] = v; };
  // central plateau ring of cliffs with ramps
  const cx = 36, cy = 36;
  for (let a = 0; a < 360; a += 4) {
    const r = 10;
    const x = Math.round(cx + Math.cos(a * Math.PI / 180) * r);
    const y = Math.round(cy + Math.sin(a * Math.PI / 180) * r);
    set(x, y, 1);
  }
  // ramps (gaps) — clear four openings
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (let k = 8; k <= 12; k++) { set(cx + dx * k, cy + dy * k, 0); set(cx + dx * k + (dy !== 0 ? 1 : 0), cy + dy * k + (dx !== 0 ? 1 : 0), 0); }
  }
  const spawns: Spawn[] = [{ x: 8, y: 8 }, { x: 63, y: 63 }, { x: 63, y: 8 }, { x: 8, y: 63 }];
  const deposits: Deposit[] = [
    { x: 14, y: 6, kind: "silver" }, { x: 6, y: 16, kind: "iron" }, { x: 16, y: 16, kind: "gold" },
    { x: 57, y: 65, kind: "silver" }, { x: 65, y: 55, kind: "iron" }, { x: 55, y: 55, kind: "gold" },
    { x: 65, y: 14, kind: "silver" }, { x: 55, y: 6, kind: "iron" }, { x: 55, y: 16, kind: "gold" },
    { x: 6, y: 57, kind: "silver" }, { x: 16, y: 65, kind: "iron" }, { x: 16, y: 55, kind: "gold" },
    { x: 36, y: 36, kind: "gold" },
  ];
  const neutrals: NeutralPoint[] = [
    { x: 36, y: 18, kind: "oil_derrick" }, { x: 36, y: 54, kind: "oil_derrick" },
    { x: 18, y: 36, kind: "oil_derrick" }, { x: 54, y: 36, kind: "oil_derrick" },
  ];
  return { id: "crossfire", nameKey: "menu.mapB", w, h, terrain, spawns, deposits, neutrals };
}

export function getMap(id: string): GameMap {
  return id === "crossfire" ? buildCrossfire() : buildTwinRivers();
}
