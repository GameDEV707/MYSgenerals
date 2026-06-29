// MYS Generals — grid pathfinding (A* on the tile grid, spec §8.5 / §3.1).
import { Vec2 } from "../types.js";

export class NavGrid {
  w: number;
  h: number;
  blocked: Uint8Array; // 1 = impassable (cliff / building / wall)
  terrain: Uint8Array;  // 0 grass, 1 cliff, 2 water, 3 road

  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.blocked = new Uint8Array(w * h);
    this.terrain = new Uint8Array(w * h);
  }
  idx(x: number, y: number): number { return y * this.w + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.blocked[this.idx(x, y)] === 1;
  }
  setBlocked(x: number, y: number, v: boolean): void {
    if (this.inBounds(x, y)) this.blocked[this.idx(x, y)] = v ? 1 : 0;
  }
}

interface Node { x: number; y: number; g: number; f: number; parent: Node | null; }

// A* returning a list of tile-center waypoints (in tile coordinates).
export function findPath(grid: NavGrid, sx: number, sy: number, tx: number, ty: number, maxNodes = 4000): Vec2[] | null {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (!grid.inBounds(tx, ty)) return null;
  // If target blocked, find nearest free neighbour.
  if (grid.isBlocked(tx, ty)) {
    const alt = nearestFree(grid, tx, ty);
    if (!alt) return null;
    tx = alt.x; ty = alt.y;
  }
  if (sx === tx && sy === ty) return [{ x: tx + 0.5, y: ty + 0.5 }];

  const open: Node[] = [];
  const came = new Map<number, Node>();
  const gScore = new Map<number, number>();
  const start: Node = { x: sx, y: sy, g: 0, f: heur(sx, sy, tx, ty), parent: null };
  open.push(start);
  gScore.set(grid.idx(sx, sy), 0);
  let nodes = 0;

  while (open.length) {
    // pop lowest f (linear scan; grids here are small)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === tx && cur.y === ty) return reconstruct(cur);
    if (++nodes > maxNodes) break;

    for (const [dx, dy] of NEIGH) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (grid.isBlocked(nx, ny)) continue;
      // prevent cutting diagonal corners
      if (dx !== 0 && dy !== 0) {
        if (grid.isBlocked(cur.x + dx, cur.y) && grid.isBlocked(cur.x, cur.y + dy)) continue;
      }
      const step = (dx !== 0 && dy !== 0) ? 1.4142 : 1;
      const ng = cur.g + step;
      const id = grid.idx(nx, ny);
      if (gScore.has(id) && ng >= (gScore.get(id) as number)) continue;
      gScore.set(id, ng);
      const node: Node = { x: nx, y: ny, g: ng, f: ng + heur(nx, ny, tx, ty), parent: cur };
      came.set(id, cur);
      open.push(node);
    }
  }
  return null;
}

const NEIGH = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function heur(x: number, y: number, tx: number, ty: number): number {
  const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
  return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
}
function reconstruct(n: Node): Vec2[] {
  const path: Vec2[] = [];
  let cur: Node | null = n;
  while (cur) { path.push({ x: cur.x + 0.5, y: cur.y + 0.5 }); cur = cur.parent; }
  path.reverse();
  // drop the first (current) waypoint to avoid backtracking
  if (path.length > 1) path.shift();
  return path;
}
export function nearestFree(grid: NavGrid, x: number, y: number): Vec2 | null {
  for (let r = 1; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (!grid.isBlocked(nx, ny)) return { x: nx, y: ny };
    }
  }
  return null;
}
