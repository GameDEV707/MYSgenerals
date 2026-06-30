// MYS Generals — canvas world renderer (spec §1, §15 fog, §16 visuals).
// Reads ONLY from the client WorldView (snapshot-reconstructed, fog-filtered). It never
// touches the authoritative sim, so it cannot render entities the host didn't send.
import { WorldView, ViewEntity, NEUTRAL, NEUTRAL_FORTRESS_COLOR } from "../client/worldView.js";
import { BUILDING_DEFS, MINE_EMBLEM_COLORS } from "../data.js";
import { BuildingId, Vec2, UnitId } from "../types.js";
import { DEFENSE_RANGE_PER_LEVEL } from "../constants.js";
import { FxRenderer } from "./fx.js";

export interface Cam { x: number; y: number; zoom: number; }
const TERRAIN_COLORS = ["#3c5a3a", "#5a5048", "#26506b", "#6b6258", "#71727a"]; // grass, cliff, water, road, wall (T32)

// ---- T26 Part D: per-unit-type silhouette descriptors. `unitShape(type)` is a PURE function
// (no DOM/canvas) returning a small, DISTINCT descriptor for each of the 11 unit types, so it is
// unit-testable (no two types share a descriptor) and the shape cue does not rely on colour alone.
// Descriptors are interned in a constant map so calling unitShape() never allocates per frame.
export type Chassis = "infantry" | "vehicle" | "hero";
export interface UnitShape {
  type: UnitId;
  chassis: Chassis;
  body: "round" | "roundsquare" | "heavy" | "box" | "boxLarge" | "boxLong" | "star";
  // infantry weapon cue / vehicle barrel cue (distinct per type)
  arm: "none" | "rifle" | "launcher" | "core" | "single" | "double" | "long" | "pod" | "twin";
  glyph: string;        // colour-blind-safe shape hint also drawn as a tiny emblem
  combat: boolean;      // false → muted tint (non-combat worker)
  accent: boolean;      // engineer accent ring
  skirt: boolean;       // heavy tank hull skirt
  recoil: boolean;      // artillery recoil notch
  dish: boolean;        // anti-air radar dish
  bodyScale: number;    // relative body size (heavier units are visibly larger)
}

const SHAPES: Record<UnitId, UnitShape> = {
  miner:          { type: "miner",          chassis: "infantry", body: "roundsquare", arm: "none",     glyph: "▲", combat: false, accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  engineer:       { type: "engineer",       chassis: "infantry", body: "round",       arm: "none",     glyph: "✚", combat: false, accent: true,  skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  repair_engineer:{ type: "repair_engineer",chassis: "infantry", body: "roundsquare", arm: "none",     glyph: "⛭", combat: false, accent: true,  skirt: false, recoil: false, dish: false, bodyScale: 1.05 },
  medic:          { type: "medic",          chassis: "infantry", body: "round",       arm: "none",     glyph: "✛", combat: false, accent: true,  skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  infantry:       { type: "infantry",       chassis: "infantry", body: "round",       arm: "rifle",    glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  rocket_soldier: { type: "rocket_soldier", chassis: "infantry", body: "round",       arm: "launcher", glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  robot:          { type: "robot",          chassis: "infantry", body: "heavy",       arm: "core",     glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.25 },
  light_tank:     { type: "light_tank",     chassis: "vehicle",  body: "box",         arm: "single",   glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
  heavy_tank:     { type: "heavy_tank",     chassis: "vehicle",  body: "boxLarge",    arm: "double",   glyph: "",  combat: true,  accent: false, skirt: true,  recoil: false, dish: false, bodyScale: 1.2 },
  artillery:      { type: "artillery",      chassis: "vehicle",  body: "boxLong",     arm: "long",     glyph: "",  combat: true,  accent: false, skirt: false, recoil: true,  dish: false, bodyScale: 1.1 },
  rocket_launcher:{ type: "rocket_launcher",chassis: "vehicle",  body: "box",         arm: "pod",      glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.05 },
  anti_air:       { type: "anti_air",       chassis: "vehicle",  body: "box",         arm: "twin",     glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: true,  bodyScale: 1.0 },
  hero:           { type: "hero",           chassis: "hero",     body: "star",        arm: "none",     glyph: "",  combat: true,  accent: false, skirt: false, recoil: false, dish: false, bodyScale: 1.0 },
};

// Pure shape lookup (interned → no per-frame allocation). Unknown types fall back to plain infantry.
export function unitShape(type: string): UnitShape {
  return SHAPES[type as UnitId] ?? SHAPES.infantry;
}

// ---- T27 Part B: ordered, non-overlapping world-space overlay layout. `entityOverlayLayout(topY)`
// is a PURE function returning the y of each overlay slot stacked ABOVE the entity (topY = the top
// edge of the entity in screen px), so the rank/level pip, HP bar, the single secondary bar
// (construction OR production OR research — never doubled) and the hero mana bar never collide.
// An optional `out` lets the renderer reuse one object (no per-frame allocation).
export interface OverlaySlots {
  hpY: number;   // HP bar row (closest above the entity)
  secY: number;  // secondary bar row (construction/production/research) — one shared slot
  manaY: number; // hero mana bar (shares the secondary slot; a hero shows no build bar)
  pipY: number;  // rank/level pip row (its own slot, above the bars)
  barH: number;  // bar height used for the slots
}
export function entityOverlayLayout(topY: number, out?: OverlaySlots): OverlaySlots {
  const barH = 4;
  const gap = 2;
  const hpY = topY - (barH + 3);          // HP bar just above the entity
  const secY = hpY - (barH + gap);        // secondary/mana bar stacked above HP (own row)
  const pipY = secY - (barH + 5);         // pip row above everything (own row)
  const o = out ?? { hpY: 0, secY: 0, manaY: 0, pipY: 0, barH: 0 };
  o.hpY = hpY; o.secY = secY; o.manaY = secY; o.pipY = pipY; o.barH = barH;
  return o;
}

// A renderer draws one player's viewport. `viewport` (in CSS pixels) lets several renderers
// share one canvas for split-screen (spec §21.1); it defaults to the full window.
export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  world: WorldView;
  fx: FxRenderer;
  cam: Cam = { x: 0, y: 0, zoom: 24 };
  W = 0; H = 0;                 // viewport size (CSS px)
  vx = 0; vy = 0;               // viewport top-left offset on the canvas (CSS px)
  visible: Uint8Array;
  explored: Uint8Array;
  visTimer = 0;
  smokeTimer = 0;
  selection = new Set<number>();
  placing: { building: BuildingId } | null = null;
  mouseWorld: Vec2 = { x: 0, y: 0 };
  // optional per-player on-canvas pointer indicator (touch stream only — spec §24/T23)
  pointerHint: { x: number; y: number } | null = null;
  // Player 1's keyboard-driven on-screen cursor (spec §24/T24) — drawn so the screen shows TWO
  // cursors (this one for the keyboard player + Player 2's native OS mouse cursor).
  virtualCursor: { x: number; y: number } | null = null;
  // Split-screen MOUSE player's cursor — a custom crosshair CLAMPED to this viewport half (the
  // native OS cursor is hidden in split mode). Drawing our own confined cursor is what keeps the
  // mouse player's pointer from straying into the other player's half. null in single-player (the
  // native crosshair is used) and cleared on game over (the real OS cursor returns).
  mouseCursor: { x: number; y: number } | null = null;
  showFog = true;
  fullWindow = true;
  // T27 Part B: reused overlay-slot scratch (avoids a per-frame allocation per entity).
  private _ov: OverlaySlots = { hpY: 0, secY: 0, manaY: 0, pipY: 0, barH: 0 };

  constructor(canvas: HTMLCanvasElement, world: WorldView, fx: FxRenderer) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d")!; this.world = world; this.fx = fx;
    this.visible = new Uint8Array(world.map.w * world.map.h);
    this.explored = new Uint8Array(world.map.w * world.map.h);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // Set an explicit viewport rectangle (used by split-screen); pass null for full window.
  setViewport(rect: { x: number; y: number; w: number; h: number } | null): void {
    if (rect) { this.fullWindow = false; this.vx = rect.x; this.vy = rect.y; this.W = rect.w; this.H = rect.h; }
    else { this.fullWindow = true; this.vx = 0; this.vy = 0; this.W = window.innerWidth; this.H = window.innerHeight; }
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.fullWindow) { this.W = window.innerWidth; this.H = window.innerHeight; this.vx = 0; this.vy = 0; }
    // canvas backing store always covers the whole window; viewports clip into it.
    this.canvas.width = window.innerWidth * dpr; this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + "px"; this.canvas.style.height = window.innerHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  centerOn(x: number, y: number): void { this.cam.x = x - this.W / this.cam.zoom / 2; this.cam.y = y - this.H / this.cam.zoom / 2; this.clampCam(); }
  clampCam(): void {
    const m = this.world.map; const vw = this.W / this.cam.zoom, vh = this.H / this.cam.zoom;
    this.cam.x = Math.max(-2, Math.min(m.w - vw + 2, this.cam.x));
    this.cam.y = Math.max(-2, Math.min(m.h - vh + 2, this.cam.y));
  }
  toX = (wx: number): number => this.vx + (wx - this.cam.x) * this.cam.zoom;
  toY = (wy: number): number => this.vy + (wy - this.cam.y) * this.cam.zoom;
  screenToWorld(sx: number, sy: number): Vec2 { return { x: this.cam.x + (sx - this.vx) / this.cam.zoom, y: this.cam.y + (sy - this.vy) / this.cam.zoom }; }
  // is a screen point inside this renderer's viewport?
  contains(sx: number, sy: number): boolean { return sx >= this.vx && sx < this.vx + this.W && sy >= this.vy && sy < this.vy + this.H; }

  teamColor(owner: number): string {
    if (owner === NEUTRAL) return "#9aa4ad";
    return this.world.players[owner]?.color ?? "#888";
  }

  // T34: entity-aware colour — the hostile Neutral Fortress + its garrison render near-white; other
  // neutrals (derrick/outpost) stay grey; a captured fortress takes the capturer's colour (its owner
  // flipped, so this falls through to teamColor).
  entityColor(e: ViewEntity): string {
    if (e.owner === NEUTRAL && e.hostileNeutral) return NEUTRAL_FORTRESS_COLOR;
    return this.teamColor(e.owner);
  }

  updateVisibility(): void {
    this.visible.fill(0);
    const m = this.world.map;
    for (const e of this.world.entities) {
      // Custom-team co-op: a side shares fog — reveal bright tiles around ALLY units too, not just
      // our own, so a teammate actually sees the shared base/units (classic: only our own reveal).
      if (!this.world.isAlly(e.owner) || e.stub) continue;
      const r = e.vision; const cx = Math.floor(e.pos.x), cy = Math.floor(e.pos.y);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        this.visible[y * m.w + x] = 2; this.explored[y * m.w + x] = 1;
      }
    }
  }
  isVisible(wx: number, wy: number): boolean {
    const m = this.world.map; const x = Math.floor(wx), y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
    return !this.showFog || this.visible[y * m.w + x] === 2;
  }

  update(dt: number): void {
    this.visTimer -= dt; if (this.visTimer <= 0) { this.updateVisibility(); this.visTimer = 0.15; }
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.25;
      for (const e of this.world.entities) {
        if (e.kind === "building" && !e.stub && !e.constructing && e.hp < e.maxHp * 0.66 && this.isVisible(e.pos.x, e.pos.y)) {
          const heavy = e.hp < e.maxHp * 0.33;
          this.fx.particles.push({ x: e.pos.x + (Math.random() - 0.5), y: e.pos.y - e.radius, vx: (Math.random() - 0.5) * 0.2, vy: -0.5, age: 0, life: 1.2, size: 2 + Math.random() * 2, color: heavy ? "#3a3a3a" : "#888", grav: -0.2 });
          if (heavy && Math.random() < 0.5) this.fx.particles.push({ x: e.pos.x + (Math.random() - 0.5), y: e.pos.y, vx: 0, vy: -0.3, age: 0, life: 0.5, size: 3, color: "#ff8a3c", grav: -0.3 });
        }
      }
    }
  }

  draw(): void {
    const ctx = this.ctx; ctx.save();
    // clip to viewport (split-screen safe)
    ctx.beginPath(); ctx.rect(this.vx, this.vy, this.W, this.H); ctx.clip();
    const off = this.fx.shakeOffset();
    ctx.translate(off.x, off.y);
    ctx.fillStyle = "#0a0d10"; ctx.fillRect(this.vx - 20, this.vy - 20, this.W + 40, this.H + 40);
    this.drawTerrain();
    this.fx.drawGround(ctx, this.toX, this.toY, this.cam.zoom);
    this.drawEntities();
    this.drawStrikesAndBanners();
    this.fx.draw(ctx, this.toX, this.toY, this.cam.zoom);
    if (this.placing) this.drawPlacement();
    if (this.showFog) this.drawFog();
    if (this.pointerHint) this.drawPointerHint();
    if (this.virtualCursor) this.drawVirtualCursor();
    if (this.mouseCursor) this.drawMouseCursor();
    ctx.restore();
    this.fx.drawFlash(ctx, window.innerWidth, window.innerHeight);
  }

  // Touch-player pointer indicator: a cyan ring + cross at the active touch contact, so the touch
  // player has a visible cursor alongside the mouse player's native cursor (two distinct pointers).
  private drawPointerHint(): void {
    if (!this.pointerHint) return;
    const ctx = this.ctx; const x = this.pointerHint.x, y = this.pointerHint.y;
    ctx.save();
    ctx.strokeStyle = "rgba(56,189,248,0.95)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(56,189,248,0.55)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x - 7, y); ctx.moveTo(x + 7, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 7); ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 22);
    ctx.stroke();
    ctx.restore();
  }

  // Player 1's keyboard virtual cursor: a green arrow pointer + ring, visually distinct from the
  // cyan touch indicator and from Player 2's native OS arrow — so two cursors are clearly visible.
  private drawVirtualCursor(): void {
    if (!this.virtualCursor) return;
    const ctx = this.ctx; const x = this.virtualCursor.x, y = this.virtualCursor.y;
    ctx.save();
    ctx.strokeStyle = "rgba(52,211,153,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
    // arrow pointer (classic cursor silhouette), filled green with a dark outline
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 18);
    ctx.lineTo(x + 4.5, y + 13.5);
    ctx.lineTo(x + 8, y + 20);
    ctx.lineTo(x + 11, y + 18.5);
    ctx.lineTo(x + 7.5, y + 12);
    ctx.lineTo(x + 13, y + 12);
    ctx.closePath();
    ctx.fillStyle = "rgba(52,211,153,0.95)"; ctx.fill();
    ctx.strokeStyle = "#04140d"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
  }

  // Split-screen mouse player's confined cursor: a crosshair (replacing the hidden native crosshair)
  // drawn at the clamped position. It is rendered inside this viewport's clip, so together with the
  // clamp in the input controller it can never appear in the other player's half.
  private drawMouseCursor(): void {
    if (!this.mouseCursor) return;
    const ctx = this.ctx; const x = this.mouseCursor.x, y = this.mouseCursor.y;
    const g = 4, len = 11;
    const stroke = (w: number, color: string) => {
      ctx.lineWidth = w; ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x - g, y);
      ctx.moveTo(x + g, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len); ctx.lineTo(x, y - g);
      ctx.moveTo(x, y + g); ctx.lineTo(x, y + len);
      ctx.stroke();
    };
    ctx.save();
    stroke(3.5, "rgba(0,0,0,0.55)");          // dark outline for contrast on light terrain
    stroke(1.5, "rgba(255,255,255,0.96)");    // bright crosshair
    ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private drawTerrain(): void {
    const ctx = this.ctx, m = this.world.map, z = this.cam.zoom;
    const x0 = Math.max(0, Math.floor(this.cam.x)), y0 = Math.max(0, Math.floor(this.cam.y));
    const x1 = Math.min(m.w, Math.ceil(this.cam.x + this.W / z)), y1 = Math.min(m.h, Math.ceil(this.cam.y + this.H / z));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const t = m.terrain[y * m.w + x];
      ctx.fillStyle = TERRAIN_COLORS[t];
      ctx.fillRect(this.toX(x), this.toY(y), z + 1, z + 1);
      if (t === 2) { ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(this.toX(x), this.toY(y) + Math.sin((this.world.time + x + y) * 2) * 1, z + 1, 2); }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x++) { ctx.beginPath(); ctx.moveTo(this.toX(x), this.toY(y0)); ctx.lineTo(this.toX(x), this.toY(y1)); ctx.stroke(); }
    for (let y = y0; y <= y1; y++) { ctx.beginPath(); ctx.moveTo(this.toX(x0), this.toY(y)); ctx.lineTo(this.toX(x1), this.toY(y)); ctx.stroke(); }
    for (const d of m.deposits) {
      if (!this.isVisible(d.x, d.y) && !this.explored[d.y * m.w + d.x]) continue;
      ctx.fillStyle = d.kind === "silver" ? "#c9d1d9" : d.kind === "iron" ? "#8c98a4" : "#ffd23f";
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) { const a = i * 1.3; ctx.beginPath(); ctx.arc(this.toX(d.x + 0.5 + Math.cos(a) * 0.8), this.toY(d.y + 0.5 + Math.sin(a) * 0.8), z * 0.12, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }

  private drawEntities(): void {
    const list = this.world.entities.slice().sort((a, b) => a.pos.y - b.pos.y);
    for (const e of list) {
      // last-known enemy building stubs are drawn dimmed; everything else full (already fog-filtered by host)
      this.ctx.globalAlpha = e.stub ? 0.45 : 1;
      if (e.kind === "building") this.drawBuilding(e);
      else if (e.kind === "neutral") this.drawNeutral(e);
      else this.drawUnit(e);
      this.ctx.globalAlpha = 1;
    }
  }

  private drawBuilding(e: ViewEntity): void {
    const ctx = this.ctx, z = this.cam.zoom;
    const def = BUILDING_DEFS[e.type as BuildingId];
    const s = def.footprint * z; const x = this.toX(e.pos.x) - s / 2, y = this.toY(e.pos.y) - s / 2;
    const col = this.entityColor(e);
    ctx.fillStyle = e.constructing ? "rgba(60,70,80,0.5)" : "#1a2530";
    this.roundRect(x, y, s, s, 4); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; this.roundRect(x, y, s, s, 4); ctx.stroke();
    // T29 Part C: each resource mine draws a distinct resource-coloured emblem (a faceted gem) so the
    // Silver / Iron / Gold mines are unmistakable at a glance, keeping the team-colour outline above.
    const mineColor = MINE_EMBLEM_COLORS[e.type as BuildingId];
    if (mineColor && !e.constructing) {
      this.drawMineEmblem(this.toX(e.pos.x), this.toY(e.pos.y), s * 0.4, mineColor);
    } else {
      ctx.fillStyle = "#dfe7ee"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `${Math.floor(s * 0.5)}px serif`;
      ctx.fillText(def.icon, this.toX(e.pos.x), this.toY(e.pos.y));
    }
    if (e.constructing) {
      ctx.strokeStyle = "rgba(255,200,120,0.6)"; ctx.setLineDash([4, 3]);
      this.roundRect(x, y, s, s, 4); ctx.stroke(); ctx.setLineDash([]);
    } else if (this.world.players[e.owner]?.brownout) {
      ctx.fillStyle = "rgba(255,80,40,0.12)"; this.roundRect(x, y, s, s, 4); ctx.fill();
    }
    if (def.weapon && !e.constructing) {
      ctx.strokeStyle = "#cfd8e0"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(this.toX(e.pos.x), this.toY(e.pos.y));
      ctx.lineTo(this.toX(e.pos.x) + Math.cos(e.turret) * s * 0.45, this.toY(e.pos.y) + Math.sin(e.turret) * s * 0.45); ctx.stroke();
    }
    // Radar: an auto-rotating dish (purely cosmetic, driven by wall-clock sim time) sweeping for
    // enemies. Its level pip + reveal ring are handled by the generic overlay/selection code below.
    if (e.type === "radar" && !e.constructing) {
      this.drawRadarDish(this.toX(e.pos.x), this.toY(e.pos.y), s * 0.42);
    }
    // T27 Part B: a single ordered overlay stack — the HP bar and ONE secondary bar (construction,
    // production head-item, or research; mutually exclusive) share fixed, non-overlapping slots.
    const slots = entityOverlayLayout(y, this._ov);
    if (e.constructing) {
      this.bar(x, slots.secY, s, slots.barH, e.buildProgress, "#ffb020");
    } else if (this.world.isAlly(e.owner) && e.upgrading) {
      // T30: timed level-upgrade progress (Command Center / defensive tower), gold like a rank-up.
      this.bar(x, slots.secY, s, slots.barH, Math.min(1, e.upgrading.progress), "#ffd23f");
    } else if (this.world.isAlly(e.owner) && e.queue.length > 0) {
      // on-map head-item production bar over the side's producing buildings (shared in team co-op)
      this.bar(x, slots.secY, s, slots.barH, Math.min(1, e.queue[0].progress), "#38bdf8");
    } else if (this.world.isAlly(e.owner) && e.researching) {
      this.bar(x, slots.secY, s, slots.barH, Math.min(1, e.researching.progress), "#a78bfa");
    }
    // T29 Part B: a thin resource-coloured progress ring over the SELECTED own mine showing fill
    // toward the next +1 (consistent with the overlay stack — drawn around the tile, above the bars).
    if (this.world.isAlly(e.owner) && this.selection.has(e.id) && e.mineEta && !e.mineEta.idle) {
      const mc = MINE_EMBLEM_COLORS[e.type as BuildingId] || "#c9d1d9";
      this.drawMineRing(this.toX(e.pos.x), this.toY(e.pos.y), s * 0.62, e.mineEta.progress, mc);
    }
    // T30 Part B: when a defensive tower is selected, show how far it sees and fires — a bright
    // attack-range ring (grown by its level) plus a faint vision ring, centred on the tile.
    if (this.selection.has(e.id) && def.weapon && !def.produces && !def.isWall && !e.constructing) {
      const atk = (def.weapon.range + (e.level - 1) * DEFENSE_RANGE_PER_LEVEL) * z;
      this.drawRangeRing(this.toX(e.pos.x), this.toY(e.pos.y), def.vision * z, "rgba(120,180,255,0.18)");
      this.drawRangeRing(this.toX(e.pos.x), this.toY(e.pos.y), atk, "rgba(255,90,70,0.5)");
    }
    // Radar reveal ring: when selected, show the area it scouts (its leveled vision radius).
    if (this.selection.has(e.id) && e.type === "radar" && !e.constructing) {
      this.drawRangeRing(this.toX(e.pos.x), this.toY(e.pos.y), e.vision * z, "rgba(120,200,255,0.45)");
    }
    // Rally "flag(s)": for a selected OWN building, draw a flag at each rally point and a dashed
    // guide line from the building. The Command Center has two — a Miner flag (green) and an
    // Engineer flag (cyan); other producers have one general flag (green).
    if (this.world.isAlly(e.owner) && this.selection.has(e.id)) {
      if (e.rally) this.drawRallyFlag(e.rally.x, e.rally.y, e.pos.x, e.pos.y, "#34d399");
      if (e.rally2) this.drawRallyFlag(e.rally2.x, e.rally2.y, e.pos.x, e.pos.y, "#38bdf8");
    }
    // T30: building level pip (L2 / L3) for upgraded Command Centers and towers (own info).
    if (e.level > 1) {
      ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 2;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 11px system-ui, sans-serif";
      const px = this.toX(e.pos.x), py = slots.pipY;
      ctx.strokeText("L" + e.level, px, py); ctx.fillText("L" + e.level, px, py);
    }
    this.drawHpBar(e, s);
    if (this.selection.has(e.id)) this.drawSelection(e, s * 0.6);
  }

  private drawNeutral(e: ViewEntity): void {
    const ctx = this.ctx, z = this.cam.zoom; const s = 2.2 * z;
    const x = this.toX(e.pos.x), y = this.toY(e.pos.y);
    if (e.type === "outpost") { this.drawOutpost(e, x, y, z); return; }
    if (e.type === "fortress") { this.drawFortress(e, x, y, z); return; }
    ctx.fillStyle = "#2a2018"; this.roundRect(x - s / 2, y - s / 2, s, s, 4); ctx.fill();
    ctx.strokeStyle = this.entityColor(e); ctx.lineWidth = 2; this.roundRect(x - s / 2, y - s / 2, s, s, 4); ctx.stroke();
    ctx.fillStyle = "#dfe7ee"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${Math.floor(s * 0.5)}px serif`;
    ctx.fillText("🛢", x, y);
    ctx.strokeStyle = "#888"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + s * 0.3, y - s * 0.5); ctx.lineTo(x + s * 0.3, y - s * 0.8); ctx.stroke();
    ctx.fillStyle = this.entityColor(e); ctx.fillRect(x + s * 0.3, y - s * 0.8, s * 0.25, s * 0.15);
    if (e.captureProgress > 0) {
      ctx.strokeStyle = this.teamColor(e.captureOwner); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, s * 0.7, -Math.PI / 2, -Math.PI / 2 + e.captureProgress * Math.PI * 2); ctx.stroke();
    }
    if (this.selection.has(e.id)) this.drawSelection(e, s * 0.6);
  }

  // T34: a Neutral FORTRESS keep — a big (4-footprint) white stronghold with battlements, a rotating
  // turret and an HP bar (it is damageable; the bar shows the siege progress). A faint white "siege"
  // ring pulses while it is being shot. Once captured, entityColor returns the capturer's colour so
  // the whole keep + garrison re-tint to the new owner automatically.
  private drawFortress(e: ViewEntity, x: number, y: number, z: number): void {
    const ctx = this.ctx; const s = 3.6 * z; const col = this.entityColor(e);
    // keep body
    ctx.fillStyle = "#20262e"; this.roundRect(x - s / 2, y - s / 2, s, s, 6); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3; this.roundRect(x - s / 2, y - s / 2, s, s, 6); ctx.stroke();
    // battlements (crenellations) on all four sides
    ctx.fillStyle = col;
    for (let i = 0; i < 5; i++) {
      const fx = x - s / 2 + i * s / 5 + s * 0.03;
      ctx.fillRect(fx, y - s / 2 - s * 0.08, s * 0.13, s * 0.12);
      ctx.fillRect(fx, y + s / 2 - s * 0.04, s * 0.13, s * 0.12);
    }
    // corner towers
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.fillStyle = "#2b333c"; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + dx * s * 0.4, y + dy * s * 0.4, s * 0.12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // crown emblem (white-faction crest)
    ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${Math.floor(s * 0.34)}px serif`;
    ctx.fillText("♛", x, y - s * 0.04);
    // rotating garrison turret
    ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(e.turret) * s * 0.5, y + Math.sin(e.turret) * s * 0.5); ctx.stroke();
    ctx.fillStyle = "#cfd8e0"; ctx.beginPath(); ctx.arc(x, y, s * 0.14, 0, Math.PI * 2); ctx.fill();
    // siege ring while being damaged (HP below full)
    if (e.hp < e.maxHp) {
      ctx.strokeStyle = "rgba(238,242,246,0.35)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, s * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
    this.drawHpBar(e, s);
    if (this.selection.has(e.id)) this.drawSelection(e, s * 0.6);
  }

  // T32: a capturable garrisoned outpost (sub-base) — a stone fortress with crenellations, a team-
  // coloured banner (neutral = grey), a rotating garrison turret, and a capture ring while contested.
  private drawOutpost(e: ViewEntity, x: number, y: number, z: number): void {
    const ctx = this.ctx; const s = 2.6 * z; const col = this.teamColor(e.owner);
    ctx.fillStyle = "#2b3038"; this.roundRect(x - s / 2, y - s / 2, s, s, 5); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; this.roundRect(x - s / 2, y - s / 2, s, s, 5); ctx.stroke();
    // crenellations along the top
    ctx.fillStyle = "#3a414b";
    for (let i = 0; i < 4; i++) { ctx.fillRect(x - s / 2 + i * s / 4 + s * 0.04, y - s / 2 - s * 0.1, s * 0.16, s * 0.16); }
    // garrison turret
    ctx.strokeStyle = "#cfd8e0"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(e.turret) * s * 0.45, y + Math.sin(e.turret) * s * 0.45); ctx.stroke();
    ctx.fillStyle = "#cfd8e0"; ctx.beginPath(); ctx.arc(x, y, s * 0.18, 0, Math.PI * 2); ctx.fill();
    // banner pole + flag
    ctx.strokeStyle = "#888"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x, y - s * 0.95); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(x, y - s * 0.95, s * 0.3, s * 0.18);
    if (e.captureProgress > 0) {
      ctx.strokeStyle = this.teamColor(e.captureOwner); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, s * 0.66, -Math.PI / 2, -Math.PI / 2 + e.captureProgress * Math.PI * 2); ctx.stroke();
    }
    if (this.selection.has(e.id)) this.drawSelection(e, s * 0.6);
  }

  private drawUnit(e: ViewEntity): void {
    const ctx = this.ctx, z = this.cam.zoom;
    const x = this.toX(e.pos.x), y = this.toY(e.pos.y);
    const col = this.entityColor(e);
    const r = e.radius * z;
    const sh = unitShape(e.type);
    if (this.selection.has(e.id)) this.drawSelection(e, r + 4);

    if (sh.chassis === "hero") {
      ctx.globalAlpha *= 0.4; const a0 = ctx.globalAlpha; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = a0 / 0.4;
      this.star(x, y, r * 1.5, r * 0.7, 5, col, "#fff");
    } else if (sh.chassis === "vehicle") {
      this.drawVehicleShape(e, sh, x, y, r, col);
    } else {
      this.drawInfantryShape(e, sh, x, y, r, col);
    }

    if (e.hitFlash > 0) { const a0 = ctx.globalAlpha; ctx.globalAlpha = Math.min(1, e.hitFlash * 5); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = a0; }
    // T27 Part B: rank/level pip in its own overlay slot (above the bars, never overlapping them).
    if (e.rank > 0 || e.hero) {
      const slots = entityOverlayLayout(y - r, this._ov);
      if (e.hero) {
        const lvl = this.world.players[e.owner]?.heroLevel ?? 1;
        ctx.fillStyle = "#ffd23f"; ctx.font = `bold ${Math.floor(z * 0.34)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillText("★" + lvl, x, slots.pipY + slots.barH);
      } else {
        ctx.fillStyle = e.rank >= 3 ? "#ffd23f" : "#cfd8e0"; ctx.font = `${Math.floor(z * 0.4)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillText("›".repeat(e.rank), x, slots.pipY + slots.barH);
      }
    }
    this.drawHpBar(e, r * 2);
  }

  // Foot-soldier / worker silhouettes (infantry, rocket-soldier, robot, miner, engineer).
  private drawInfantryShape(e: ViewEntity, sh: UnitShape, x: number, y: number, r: number, col: string): void {
    const ctx = this.ctx, z = this.cam.zoom;
    const br = r * sh.bodyScale;
    ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1.5;
    const a0 = ctx.globalAlpha; if (!sh.combat) ctx.globalAlpha = a0 * 0.82; // muted tint for workers
    ctx.fillStyle = col;
    if (sh.body === "roundsquare") {
      this.roundRect(x - br, y - br, br * 2, br * 2, br * 0.6); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = a0;
    if (sh.accent) { ctx.strokeStyle = "#dfe7ee"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, br * 0.55, 0, Math.PI * 2); ctx.stroke(); }
    if (sh.arm === "core") {
      ctx.fillStyle = "#0b0f14"; ctx.fillRect(x - br * 0.4, y - br * 0.4, br * 0.8, br * 0.8);
      ctx.fillStyle = "#e6edf3"; ctx.fillRect(x - br * 0.28, y - br * 0.18, br * 0.18, br * 0.18); ctx.fillRect(x + br * 0.1, y - br * 0.18, br * 0.18, br * 0.18);
      ctx.strokeStyle = "#cfd8e0"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - br * 0.3, y - br); ctx.lineTo(x - br * 0.5, y - br * 1.5); ctx.moveTo(x + br * 0.3, y - br); ctx.lineTo(x + br * 0.5, y - br * 1.5); ctx.stroke();
    }
    if (sh.arm === "rifle") {
      ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = Math.max(1.5, r * 0.28);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(e.turret) * br * 1.25, y + Math.sin(e.turret) * br * 1.25); ctx.stroke();
    } else if (sh.arm === "launcher") {
      const ox = Math.cos(e.turret + Math.PI / 2) * br * 0.35, oy = Math.sin(e.turret + Math.PI / 2) * br * 0.35;
      ctx.strokeStyle = "#cdd6df"; ctx.lineWidth = Math.max(2.5, r * 0.5);
      ctx.beginPath(); ctx.moveTo(x + ox - Math.cos(e.turret) * br * 0.4, y + oy - Math.sin(e.turret) * br * 0.4);
      ctx.lineTo(x + ox + Math.cos(e.turret) * br * 1.5, y + oy + Math.sin(e.turret) * br * 1.5); ctx.stroke();
    }
    if (sh.glyph) { ctx.fillStyle = "#0b0f14"; ctx.font = `bold ${Math.floor(z * 0.34)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(sh.glyph, x, y); }
  }

  // Vehicle silhouettes: chassis rotates by facing, barrel/turret by turret. Distinct per type.
  private drawVehicleShape(e: ViewEntity, sh: UnitShape, x: number, y: number, r: number, col: string): void {
    const ctx = this.ctx;
    const br = r * sh.bodyScale;
    ctx.save(); ctx.translate(x, y); ctx.rotate(e.facing);
    ctx.fillStyle = col; ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1.5;
    let hw = br, hh = br * 0.7;
    if (sh.body === "boxLarge") { hw = br * 1.05; hh = br * 0.82; }
    else if (sh.body === "boxLong") { hw = br * 1.35; hh = br * 0.6; }
    if (sh.skirt) { ctx.fillStyle = "#0b0f14"; ctx.fillRect(-hw - 2, -hh - 2, hw * 2 + 4, hh * 2 + 4); ctx.fillStyle = col; }
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.rotate(e.turret);
    ctx.strokeStyle = "#e6edf3"; ctx.fillStyle = "#cdd6df";
    const L = br * 1.6;
    if (sh.arm === "single") {
      ctx.lineWidth = Math.max(2, r * 0.3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke();
    } else if (sh.arm === "double") {
      ctx.lineWidth = Math.max(2.5, r * 0.45);
      ctx.beginPath(); ctx.moveTo(0, -br * 0.22); ctx.lineTo(L, -br * 0.22); ctx.moveTo(0, br * 0.22); ctx.lineTo(L, br * 0.22); ctx.stroke();
    } else if (sh.arm === "long") {
      ctx.lineWidth = Math.max(1.5, r * 0.22); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 1.5, 0); ctx.stroke();
      if (sh.recoil) { ctx.lineWidth = Math.max(2.5, r * 0.5); ctx.beginPath(); ctx.moveTo(-br * 0.2, 0); ctx.lineTo(br * 0.5, 0); ctx.stroke(); }
    } else if (sh.arm === "pod") {
      ctx.fillStyle = "#aeb8c2"; ctx.fillRect(br * 0.2, -br * 0.55, br * 0.9, br * 1.1);
      ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1; ctx.strokeRect(br * 0.2, -br * 0.55, br * 0.9, br * 1.1);
      ctx.fillStyle = "#2b333c";
      for (let i = 0; i < 3; i++) { const ty = -br * 0.34 + i * br * 0.34; ctx.fillRect(br * 0.5, ty - br * 0.06, br * 0.7, br * 0.12); }
    } else if (sh.arm === "twin") {
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath(); ctx.moveTo(0, -br * 0.18); ctx.lineTo(L * 0.7, -br * 0.5); ctx.moveTo(0, br * 0.18); ctx.lineTo(L * 0.7, -br * 0.16); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#cfd8e0"; ctx.beginPath(); ctx.arc(x, y, br * 0.5, 0, Math.PI * 2); ctx.fill();
    if (sh.dish) { ctx.strokeStyle = "#9fb0bf"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, br * 0.32, Math.PI * 0.1, Math.PI * 1.1); ctx.stroke(); }
  }

  private drawStrikesAndBanners(): void {
    const ctx = this.ctx, z = this.cam.zoom;
    for (const s of this.world.strikes) {
      const x = this.toX(s.pos.x), y = this.toY(s.pos.y);
      const k = Math.max(0, (s.at - this.world.time) / 1.5);
      ctx.strokeStyle = "rgba(255,60,40,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, s.radius * z * (0.5 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - z, y); ctx.lineTo(x + z, y); ctx.moveTo(x, y - z); ctx.lineTo(x, y + z); ctx.stroke();
    }
    for (const b of this.world.banners) {
      const x = this.toX(b.pos.x), y = this.toY(b.pos.y);
      ctx.globalAlpha = 0.3; ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(x, y, 5 * z, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - z); ctx.stroke();
      ctx.fillStyle = this.teamColor(b.owner); ctx.fillRect(x, y - z, z * 0.5, z * 0.3);
    }
  }

  private drawPlacement(): void {
    if (!this.placing) return;
    const ctx = this.ctx, z = this.cam.zoom;
    const def = BUILDING_DEFS[this.placing.building];
    const tx = Math.floor(this.mouseWorld.x), ty = Math.floor(this.mouseWorld.y);
    const ok = this.world.placementValid(this.world.me, this.placing.building, tx, ty);
    const fp = def.footprint, half = Math.floor(fp / 2);
    ctx.globalAlpha = 0.5; ctx.fillStyle = ok ? "#34d399" : "#ef4444";
    ctx.fillRect(this.toX(tx - half), this.toY(ty - half), fp * z, fp * z);
    ctx.globalAlpha = 1; ctx.strokeStyle = ok ? "#34d399" : "#ef4444"; ctx.lineWidth = 2;
    ctx.strokeRect(this.toX(tx - half), this.toY(ty - half), fp * z, fp * z);
  }

  private drawFog(): void {
    const ctx = this.ctx, m = this.world.map, z = this.cam.zoom;
    const x0 = Math.max(0, Math.floor(this.cam.x)), y0 = Math.max(0, Math.floor(this.cam.y));
    const x1 = Math.min(m.w, Math.ceil(this.cam.x + this.W / z)), y1 = Math.min(m.h, Math.ceil(this.cam.y + this.H / z));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = this.visible[y * m.w + x];
      if (v === 2) continue;
      ctx.fillStyle = v === 1 ? "rgba(5,8,12,0.5)" : "rgba(3,5,8,0.96)";
      ctx.fillRect(this.toX(x), this.toY(y), z + 1, z + 1);
    }
  }

  // T27 Part B: show-when-relevant rule (Generals/Dota declutter). A full-HP idle unit shows no
  // bar; bars appear for selected, hovered, recently-hit or damaged entities, and always for the
  // local player's hero.
  private shouldShowHp(e: ViewEntity): boolean {
    if (this.selection.has(e.id)) return true;
    if (e.hero && this.world.isAlly(e.owner)) return true;
    if (e.hp < e.maxHp) return true;
    if (e.hitFlash > 0) return true;
    const d = Math.hypot(e.pos.x - this.mouseWorld.x, e.pos.y - this.mouseWorld.y);
    return d < e.radius + 0.5;
  }

  private drawHpBar(e: ViewEntity, w: number): void {
    if (!this.shouldShowHp(e)) return;
    const halfH = e.kind === "building" ? w / 2 : e.radius * this.cam.zoom;
    const topY = this.toY(e.pos.y) - halfH;
    const slots = entityOverlayLayout(topY, this._ov);
    const x = this.toX(e.pos.x) - w / 2;
    this.bar(x, slots.hpY, w, slots.barH, e.hp / e.maxHp, e.hp / e.maxHp > 0.5 ? "#34d399" : e.hp / e.maxHp > 0.25 ? "#ffb020" : "#ef4444");
    // The hero mana bar takes the secondary slot (a hero never shows a build/research bar).
    if (e.hero) { this.bar(x, slots.manaY, w, 3, e.hero.mana / e.hero.maxMana, "#38bdf8"); }
  }
  private bar(x: number, y: number, w: number, h: number, frac: number, color: string): void {
    const ctx = this.ctx; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, w * frac), h);
  }
  private drawSelection(e: ViewEntity, r: number): void {
    const ctx = this.ctx; ctx.strokeStyle = this.world.isAlly(e.owner) ? "#34d399" : "#ef4444"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.toX(e.pos.x), this.toY(e.pos.y), r, 0, Math.PI * 2); ctx.stroke();
  }

  // T29 Part C: a faceted resource-coloured gem/ingot emblem centred on a mine tile. `half` is half
  // the gem's width (px). A lighter top facet + dark outline read clearly at a distance.
  private drawMineEmblem(cx: number, cy: number, half: number, color: string): void {
    const ctx = this.ctx;
    // diamond / gem silhouette
    ctx.beginPath();
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 1.6; ctx.stroke();
    // top highlight facet (lighter) for a gem-like sheen
    ctx.beginPath();
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half * 0.55, cy - half * 0.15);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - half * 0.55, cy - half * 0.15);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fill();
  }

  // T29 Part B (optional cue): a thin progress ring around a selected own mine showing fill toward
  // the next extraction. Sweeps clockwise from the top in the mine's resource colour.
  // T30 Part B: a defensive tower's reach ring (attack range / vision), drawn while it is selected.
  private drawRangeRing(cx: number, cy: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Auto-rotating radar dish: a sweeping arc + a base post, spun by the sim clock so every radar
  // continuously scans. `half` is the dish radius in px.
  private drawRadarDish(cx: number, cy: number, half: number): void {
    const ctx = this.ctx;
    const a = (this.world.time * 1.6) % (Math.PI * 2); // sweep angle (rad/s)
    // sweeping sensor wedge
    ctx.fillStyle = "rgba(120,200,255,0.18)";
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, half * 1.7, a, a + Math.PI / 3); ctx.closePath(); ctx.fill();
    // dish: a parabola-ish arc facing the sweep direction
    ctx.strokeStyle = "#9fd6ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, half, a + Math.PI * 0.6, a + Math.PI * 1.4); ctx.stroke();
    // dish mast + hub
    ctx.strokeStyle = "#cfd8e0"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * half, cy + Math.sin(a) * half); ctx.stroke();
    ctx.fillStyle = "#cfd8e0"; ctx.beginPath(); ctx.arc(cx, cy, half * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  // Rally "flag" marker drawn in world space: a dashed guide line from the building to the rally
  // point, then a small pole + coloured pennant at the point.
  private drawRallyFlag(rx: number, ry: number, bx: number, by: number, color: string): void {
    const ctx = this.ctx, z = this.cam.zoom;
    const fx = this.toX(rx), fy = this.toY(ry);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(this.toX(bx), this.toY(by)); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // pole
    ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - z * 0.9); ctx.stroke();
    // pennant
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(fx, fy - z * 0.9); ctx.lineTo(fx + z * 0.5, fy - z * 0.74); ctx.lineTo(fx, fy - z * 0.58); ctx.closePath(); ctx.fill();
    // base dot
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(fx, fy, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  private drawMineRing(cx: number, cy: number, r: number, progress: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    const a = -Math.PI / 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, a, a + Math.max(0, Math.min(1, progress)) * Math.PI * 2); ctx.stroke();
  }
  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx; ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  private star(cx: number, cy: number, R: number, r: number, n: number, fill: string, stroke: string): void {
    const ctx = this.ctx; ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const rad = i % 2 ? r : R; const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
  }

  drawMinimap(ctx: CanvasRenderingContext2D, size: number): void {
    const m = this.world.map; const sx = size / m.w, sy = size / m.h;
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const ex = this.explored[y * m.w + x];
      if (!ex) { ctx.fillStyle = "#05080b"; }
      else { ctx.fillStyle = TERRAIN_COLORS[m.terrain[y * m.w + x]]; }
      ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
    }
    for (const e of this.world.entities) {
      ctx.globalAlpha = e.stub ? 0.5 : 1;
      ctx.fillStyle = this.entityColor(e);
      const sz = e.kind === "building" ? 4 : 2;
      ctx.fillRect(e.pos.x * sx - sz / 2, e.pos.y * sy - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = 1;
    ctx.strokeRect(this.cam.x * sx, this.cam.y * sy, (this.W / this.cam.zoom) * sx, (this.H / this.cam.zoom) * sy);
  }
}
