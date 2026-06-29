// MYS Generals — authoritative simulation (engine-agnostic, no DOM/canvas imports).
// Implements spec §3.2 (fixed tick), §6 (economy), §8 (units), §7 (buildings),
// §13 (combat), §9 (hero), §10.5 (veterancy), §12 (capture), §23 (win/lose).
import {
  Vec2, UnitId, BuildingId, Cost, ResKind, DamageType, ArmorType, ProjectileKind,
} from "../types.js";
import { UNIT_DEFS, BUILDING_DEFS, damageMultiplier, RESEARCH_BY_ID, ResearchDef } from "../data.js";
import {
  TICK_DT, START_SILVER, MINER_OUTPUT_INTERVAL, SILVER_MINE_SLOTS, IRON_INTERVAL, GOLD_INTERVAL,
  OIL_INTERVAL, CC_POWER, BROWNOUT_PRODUCTION_MULT, BROWNOUT_TOWER_FIRE_MULT, BROWNOUT_TOWER_RANGE_MULT,
  SELL_REFUND, CANCEL_QUEUED_REFUND, CANCEL_INPROGRESS_REFUND, BUILD_RADIUS, MAX_QUEUE,
  HERO_RESPAWN_BASE, HERO_RESPAWN_PER_LEVEL, HERO_XP_PER_LEVEL, HERO_PASSIVE_XP, HERO_MAX_LEVEL,
  VET_THRESHOLDS, MAX_BAYS, MAX_SPEED_LEVEL, ASSEMBLY_SPEED_PER_LEVEL, BAY_UPGRADE_COSTS,
  SPEED_UPGRADE_COSTS, RESEARCH_DAMAGE_PER_LEVEL, RESEARCH_ARMOR_PER_LEVEL, LOGISTICS_BUILD_MULT,
  MAX_BASE_LEVEL, CC_UPGRADE_COSTS, CC_UPGRADE_TIMES, REQUIRED_BASE_LEVEL, MAX_DEFENSE_LEVEL,
  DEFENSE_RANGE_PER_LEVEL, DEFENSE_DAMAGE_PER_LEVEL, defenseUpgradeCost, upgradeTime,
  mineSlotCap, isMineType,
} from "../constants.js";
import { NavGrid, findPath, nearestFree } from "./grid.js";
import { GameMap } from "./map.js";

export const NEUTRAL = -1;

export type Stance = "aggressive" | "hold" | "attackmove";

export interface QueueItem { unit: UnitId; progress: number; time: number; }

export interface HeroData {
  mana: number; maxMana: number;
  abilities: { rank: number; cdUntil: number }[]; // Q,W,E,R
  burstShots: number; burstBonus: number; // Q effect
  invulnUntil: number;
}

export class Entity {
  id: number;
  kind: "unit" | "building" | "neutral" | "projectile";
  type: string; // UnitId | BuildingId | NeutralId
  owner: number;
  pos: Vec2;
  facing = 0;
  turret = 0;
  hp: number;
  maxHp: number;
  vision: number;
  radius: number;
  dead = false;
  // movement
  path: Vec2[] = [];
  moveTarget: Vec2 | null = null;
  repathTimer = 0;
  // combat
  target: number | null = null;
  attackCd = 0;
  stance: Stance = "aggressive";
  attackMoveTarget: Vec2 | null = null;
  pendingShots: { at: number; n: number } | null = null;
  // veterancy
  xp = 0; rank = 0;
  // worker / economy
  isWorker = false; isVehicle = false;
  mineId: number | null = null; mining = false;
  buildTask: { bid: BuildingId; pos: Vec2; entId: number } | null = null;
  captureTask: { target: number } | null = null;
  // building
  isBuilding = false;
  constructing = false;
  buildProgress = 0; // 0..1
  buildTotal = 0;
  queue: QueueItem[] = [];
  rally: Vec2 | null = null;
  // T26: factory upgrades — parallel build bays (1..MAX_BAYS) and assembly-speed level (0..MAX_SPEED_LEVEL).
  bays = 1;
  speedLevel = 0;
  // T30: building level (Command Center 1..3 gates the build tree; defensive towers 1..3 boost
  // range + damage). A timed level upgrade in progress is tracked in `upgrading` (null = idle).
  level = 1;
  upgrading: { to: number; progress: number; time: number } | null = null;
  // T26: Research Center active timed research slot (null = idle).
  researching: { id: string; progress: number; time: number } | null = null;
  resAccum = 0; // for mines
  minerSlots = 0; // miners working inside this mine (occupancy; T30: all mine types)
  // T30: a miner that has entered a mine to work — hidden from the map (not drawn / selectable /
  // collidable / targetable). It still exists in the sim so it can be released if the mine dies.
  inMine = false;
  power = 0;
  weaponDef?: typeof UNIT_DEFS[UnitId]["weapon"];
  // neutral
  captureProgress = 0; captureOwner = NEUTRAL; bountyCd = 0;
  // hero
  hero: HeroData | null = null;
  // visual flags
  hitFlash = 0;

  constructor(id: number, kind: Entity["kind"], type: string, owner: number, pos: Vec2) {
    this.id = id; this.kind = kind; this.type = type; this.owner = owner; this.pos = { ...pos };
    this.hp = 1; this.maxHp = 1; this.vision = 4; this.radius = 0.4;
  }
}

export interface PlayerResearch {
  weapons: number;      // 0..2  (+15% damage per level)
  armor: number;        // 0..2  (+15% effective HP per level)
  factoryTech: number;  // 0..2  (gates the Part B factory upgrades)
  logistics: boolean;   // -20% unit build time
}

export interface PlayerState {
  id: number;
  silver: number; iron: number; gold: number;
  color: string;
  isAI: boolean;
  aiDiff: "easy" | "normal" | "hard";
  defeated: boolean;
  powerGen: number; powerUse: number; brownout: boolean;
  heroId: number; heroLevel: number; heroXp: number; heroRespawnAt: number;
  // T26: global tech researched at the Research Center.
  research: PlayerResearch;
  // stats
  unitsBuilt: number; unitsLost: number; buildingsDestroyed: number;
}

export function emptyResearch(): PlayerResearch {
  return { weapons: 0, armor: 0, factoryTech: 0, logistics: false };
}

export type Command =
  | { t: "move"; ids: number[]; x: number; y: number }
  | { t: "attackmove"; ids: number[]; x: number; y: number }
  | { t: "attack"; ids: number[]; target: number }
  | { t: "stop"; ids: number[] }
  | { t: "hold"; ids: number[] }
  | { t: "build"; owner: number; building: BuildingId; x: number; y: number; builder?: number }
  | { t: "train"; building: number; unit: UnitId }
  | { t: "cancel"; building: number; index: number }
  | { t: "upgradeBuilding"; building: number; kind: "bay" | "speed" | "level" }
  | { t: "research"; building: number; id: string }
  | { t: "cancelResearch"; building: number }
  | { t: "rally"; building: number; x: number; y: number }
  | { t: "capture"; ids: number[]; target: number }
  | { t: "ability"; hero: number; slot: number; x: number; y: number; target?: number }
  | { t: "sell"; building: number }
  | { t: "mine"; ids: number[]; target: number }
  | { t: "surrender"; owner: number };

export interface Projectile {
  kind: ProjectileKind;
  pos: Vec2; aim: Vec2; targetId: number | null; attackerId: number;
  speed: number; damage: number; damageType: DamageType; splash: number;
  owner: number; arc: boolean; delay: number; t: number; total: number;
  dead: boolean; rot: number; trail: Vec2[];
}

export type GameEvent =
  | { e: "fire"; from: Vec2; to: Vec2; kind: ProjectileKind; owner: number; speed: number; arc: boolean; shots: number; shotDelay: number }
  | { e: "impact"; pos: Vec2; kind: ProjectileKind; size: number }
  | { e: "death"; pos: Vec2; kind: string; owner: number }
  | { e: "float"; pos: Vec2; text: string; color: string }
  | { e: "construct"; pos: Vec2 }
  | { e: "capture"; pos: Vec2; owner: number }
  | { e: "rankup"; pos: Vec2 }
  | { e: "shake"; intensity: number }
  | { e: "flash"; color: string }
  | { e: "ability"; slot: number; pos: Vec2; owner: number }
  // `to` (when present) restricts a notification to a single player (spec §20.3 per-player events).
  | { e: "toast"; key: string; kind?: string; params?: Record<string, string | number>; to?: number };

const RANK_DMG = [1, 1.1, 1.2, 1.3];
const RANK_HP = [1, 1.1, 1.2, 1.3];
const RANK_RANGE = [0, 0, 1, 1];

// Hero ability tuning (spec §9.3). Index 0=Q,1=W,2=E,3=R.
const ABIL = {
  q: { mana: 40, cd: 8, bonus: [30, 50, 70, 90] },
  w: { mana: 60, cd: 16, range: 5, dur: 8, asMult: [0.8, 0.73, 0.66, 0.6], armor: 1 },
  e: { mana: 35, cd: 10, dmg: [40, 70, 100, 130], range: 6 },
  r: { mana: 120, cd: 70, dmg: [250, 350, 450, 500], radius: 3, delay: 1.5 },
};

interface Banner { owner: number; pos: Vec2; until: number; rank: number; }
interface Strike { owner: number; pos: Vec2; at: number; damage: number; radius: number; }

export class World {
  map: GameMap;
  grid: NavGrid;
  entities: Entity[] = [];
  byId = new Map<number, Entity>();
  projectiles: Projectile[] = [];
  banners: Banner[] = [];
  strikes: Strike[] = [];
  players: PlayerState[] = [];
  events: GameEvent[] = [];
  time = 0;
  nextId = 1;
  winner = -2; // -2 ongoing, -1 draw, >=0 player id
  commandQueue: Command[] = [];

  constructor(map: GameMap) {
    this.map = map;
    this.grid = new NavGrid(map.w, map.h);
    this.grid.terrain = map.terrain;
    for (let i = 0; i < map.terrain.length; i++) {
      const t = map.terrain[i];
      if (t === 1 || t === 2) this.grid.blocked[i] = 1; // cliff & water block ground
    }
  }

  // ---------- setup ----------
  addPlayer(p: PlayerState): void { if (!p.research) p.research = emptyResearch(); this.players.push(p); }

  spawn(kind: Entity["kind"], type: string, owner: number, x: number, y: number): Entity {
    const e = new Entity(this.nextId++, kind, type, owner, { x: x + 0.5, y: y + 0.5 });
    if (kind === "unit") {
      const d = UNIT_DEFS[type as UnitId];
      e.maxHp = d.hp; e.hp = d.hp; e.vision = d.vision; e.radius = d.radius;
      e.isWorker = !!d.isWorker; e.isVehicle = !!d.isVehicle; e.weaponDef = d.weapon;
    } else if (kind === "building") {
      const d = BUILDING_DEFS[type as BuildingId];
      e.isBuilding = true; e.maxHp = d.hp; e.hp = d.hp; e.vision = d.vision;
      e.radius = d.footprint / 2; e.power = d.power; e.weaponDef = d.weapon;
      this.occupy(e, true);
    } else if (kind === "neutral") {
      e.maxHp = 800; e.hp = 800; e.vision = 5; e.radius = 1.2; e.owner = NEUTRAL; e.captureOwner = NEUTRAL;
      this.occupy(e, true);
    }
    this.entities.push(e); this.byId.set(e.id, e);
    return e;
  }

  occupy(e: Entity, val: boolean): void {
    const d = e.kind === "building" ? BUILDING_DEFS[e.type as BuildingId].footprint : 3;
    const half = Math.floor(d / 2);
    const cx = Math.floor(e.pos.x), cy = Math.floor(e.pos.y);
    for (let dy = -half; dy < d - half; dy++) for (let dx = -half; dx < d - half; dx++) {
      this.grid.setBlocked(cx + dx, cy + dy, val);
    }
  }

  spawnBase(owner: number, spawn: { x: number; y: number }): void {
    const cc = this.spawn("building", "command_center", owner, spawn.x, spawn.y);
    cc.constructing = false;
    // adjacent silver mine with 1 miner already working INSIDE it (spec §6.2; T30: miners work inside)
    const mine = this.spawn("building", "silver_mine", owner, spawn.x + 4, spawn.y);
    const miner = this.spawn("unit", "miner", owner, spawn.x + 4, spawn.y + 3);
    miner.mineId = mine.id; miner.mining = true; miner.inMine = true;
    miner.pos = { x: mine.pos.x, y: mine.pos.y };
    mine.minerSlots = 1;
    // hero
    const hero = this.spawn("unit", "hero", owner, spawn.x + 2, spawn.y + 2);
    hero.hero = { mana: 100, maxMana: 100, abilities: [{ rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }], burstShots: 0, burstBonus: 0, invulnUntil: 0 };
    const p = this.players[owner];
    p.heroId = hero.id;
  }

  setupNeutrals(): void {
    for (const n of this.map.neutrals) this.spawn("neutral", "oil_derrick", NEUTRAL, n.x, n.y);
  }

  // ---------- helpers ----------
  dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
  isEnemy(a: Entity, b: Entity): boolean {
    if (a.owner === b.owner) return false;
    if (b.owner === NEUTRAL) return false;
    return true;
  }
  armorOf(e: Entity): ArmorType {
    if (e.kind === "building" || e.kind === "neutral") return "StructureArmored";
    return UNIT_DEFS[e.type as UnitId].armor;
  }
  cost(b: BuildingId | UnitId, isUnit: boolean): Cost {
    return isUnit ? UNIT_DEFS[b as UnitId].cost : BUILDING_DEFS[b as BuildingId].cost;
  }
  canAfford(p: PlayerState, c: Cost): boolean {
    return (p.silver >= (c.silver ?? 0)) && (p.iron >= (c.iron ?? 0)) && (p.gold >= (c.gold ?? 0));
  }
  pay(p: PlayerState, c: Cost): void { p.silver -= c.silver ?? 0; p.iron -= c.iron ?? 0; p.gold -= c.gold ?? 0; }
  refund(p: PlayerState, c: Cost, frac: number): void {
    p.silver += Math.floor((c.silver ?? 0) * frac); p.iron += Math.floor((c.iron ?? 0) * frac); p.gold += Math.floor((c.gold ?? 0) * frac);
  }

  // ---------- command application ----------
  issue(cmd: Command): void { this.commandQueue.push(cmd); }

  private applyCommands(): void {
    for (const cmd of this.commandQueue) this.apply(cmd);
    this.commandQueue.length = 0;
  }

  private apply(cmd: Command): void {
    switch (cmd.t) {
      case "move": case "attackmove": {
        for (const id of cmd.ids) {
          const e = this.byId.get(id); if (!e || e.kind !== "unit" || e.dead) continue;
          e.target = null; e.captureTask = null; e.mining = false; e.mineId = null;
          if (cmd.t === "attackmove") { e.stance = "attackmove"; e.attackMoveTarget = { x: cmd.x, y: cmd.y }; }
          else { e.stance = "aggressive"; e.attackMoveTarget = null; }
          this.setMove(e, cmd.x, cmd.y);
        }
        break;
      }
      case "attack": {
        for (const id of cmd.ids) {
          const e = this.byId.get(id); if (!e || e.kind !== "unit" || e.dead) continue;
          e.target = cmd.target; e.stance = "aggressive"; e.captureTask = null;
        }
        break;
      }
      case "stop": for (const id of cmd.ids) { const e = this.byId.get(id); if (e) { e.path = []; e.moveTarget = null; e.target = null; } } break;
      case "hold": for (const id of cmd.ids) { const e = this.byId.get(id); if (e) { e.stance = "hold"; e.path = []; e.moveTarget = null; } } break;
      case "mine": {
        const mine = this.byId.get(cmd.target);
        if (!mine || !isMineType(mine.type)) break; // T30: any mine type (silver/iron/gold/captured oil)
        for (const id of cmd.ids) {
          const e = this.byId.get(id); if (!e || !e.isWorker || e.type !== "miner") continue;
          e.mineId = mine.id; e.mining = false; e.inMine = false; e.buildTask = null;
          this.setMove(e, mine.pos.x, mine.pos.y);
        }
        break;
      }
      case "build": this.tryBuild(cmd); break;
      case "train": this.tryTrain(cmd); break;
      case "cancel": this.cancelQueue(cmd.building, cmd.index); break;
      case "upgradeBuilding": this.tryUpgradeBuilding(cmd.building, cmd.kind); break;
      case "research": this.tryResearch(cmd.building, cmd.id); break;
      case "cancelResearch": this.cancelResearch(cmd.building); break;
      case "rally": { const b = this.byId.get(cmd.building); if (b) b.rally = { x: cmd.x, y: cmd.y }; break; }
      case "capture": {
        const tgt = this.byId.get(cmd.target); if (!tgt) break;
        for (const id of cmd.ids) {
          const e = this.byId.get(id); if (!e || e.type !== "engineer") continue;
          e.captureTask = { target: cmd.target }; this.setMove(e, tgt.pos.x, tgt.pos.y);
        }
        break;
      }
      case "ability": this.castAbility(cmd); break;
      case "sell": this.sell(cmd.building); break;
      case "surrender": { const p = this.players[cmd.owner]; if (p) this.eliminate(cmd.owner); break; }
    }
  }

  setMove(e: Entity, x: number, y: number): void {
    const path = findPath(this.grid, e.pos.x, e.pos.y, x, y);
    if (path) { e.path = path; e.moveTarget = { x, y }; }
    else { e.moveTarget = { x, y }; e.path = [{ x: x + 0, y: y + 0 }]; }
  }

  // T30: the owner's highest Command-Center level (gates the build tree). Defaults to 1.
  maxBaseLevel(owner: number): number {
    let lvl = 1;
    for (const e of this.entities) {
      if (e.dead || e.owner !== owner || e.type !== "command_center" || e.constructing) continue;
      if (e.level > lvl) lvl = e.level;
    }
    return lvl;
  }

  tryBuild(cmd: Extract<Command, { t: "build" }>): void {
    const p = this.players[cmd.owner]; if (!p) return;
    const def = BUILDING_DEFS[cmd.building];
    if (!this.canAfford(p, def.cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, def.cost), kind: "danger", to: cmd.owner }); return; }
    if (def.requires && !this.entities.some((e) => e.owner === cmd.owner && e.type === def.requires && !e.constructing)) {
      this.events.push({ e: "toast", key: "errors.needBuilding", kind: "danger", params: { b: BUILDING_DEFS[def.requires].nameKey }, to: cmd.owner }); return;
    }
    // T30 Part A: the Command Center level gates the build tree (Barracks/Cannon need L2, War
    // Factory/Rocket need L3). Reject authoritatively with a clear toast naming the required level.
    const reqLvl = REQUIRED_BASE_LEVEL[cmd.building] ?? 1;
    if (reqLvl > 1 && this.maxBaseLevel(cmd.owner) < reqLvl) {
      this.events.push({ e: "toast", key: "errors.needBaseLevel", kind: "danger", params: { lvl: reqLvl }, to: cmd.owner }); return;
    }
    if (!this.placementValid(cmd.owner, cmd.building, cmd.x, cmd.y)) {
      this.events.push({ e: "toast", key: "errors.invalidPlacement", kind: "danger", to: cmd.owner }); return;
    }
    // T28 Part B: power gate — a power-CONSUMING building cannot be started without spare
    // generation. Count current usage + the demand of this owner's already-in-progress consumers,
    // so you cannot queue several builds that would collectively exceed supply. Power PRODUCERS
    // (power_plant, command_center) have def.power >= 0 and are never blocked.
    const demand = def.power < 0 ? -def.power : 0;
    if (demand > 0) {
      let committed = p.powerUse;
      for (const e of this.entities) {
        if (!e.dead && e.kind === "building" && e.owner === cmd.owner && e.constructing && e.power < 0) committed += -e.power;
      }
      if (committed + demand > p.powerGen) {
        this.events.push({ e: "toast", key: "errors.needPower", kind: "danger", to: cmd.owner }); return;
      }
    }
    this.pay(p, def.cost);
    const b = this.spawn("building", cmd.building, cmd.owner, cmd.x, cmd.y);
    b.constructing = true; b.buildTotal = def.buildTime; b.buildProgress = 0; b.hp = Math.max(1, def.hp * 0.1);
    // dispatch nearest idle miner for fidelity
    const builder = this.nearestIdleWorker(cmd.owner, b.pos);
    if (builder) { builder.buildTask = { bid: cmd.building, pos: { ...b.pos }, entId: b.id }; this.setMove(builder, b.pos.x, b.pos.y); }
    this.events.push({ e: "construct", pos: b.pos });
  }

  placementValid(owner: number, building: BuildingId, x: number, y: number): boolean {
    const fp = BUILDING_DEFS[building].footprint;
    const half = Math.floor(fp / 2);
    for (let dy = -half; dy < fp - half; dy++) for (let dx = -half; dx < fp - half; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!this.grid.inBounds(tx, ty)) return false;
      if (this.grid.terrain[this.grid.idx(tx, ty)] !== 0 && this.grid.terrain[this.grid.idx(tx, ty)] !== 3) return false;
      if (this.grid.isBlocked(tx, ty)) return false;
    }
    // build radius (spec §7.3): within BUILD_RADIUS of an owned building
    const near = this.entities.some((e) => e.owner === owner && e.kind === "building" && this.dist(e.pos, { x: x + 0.5, y: y + 0.5 }) <= BUILD_RADIUS + e.radius);
    if (!near) return false;
    // iron/gold mines require a matching deposit nearby (spec §6.3)
    if (building === "iron_mine" || building === "gold_mine") {
      const want: ResKind = building === "iron_mine" ? "iron" : "gold";
      const ok = this.map.deposits.some((d) => d.kind === want && Math.hypot(d.x - x, d.y - y) <= 4);
      if (!ok) return false;
    }
    return true;
  }

  nearestIdleWorker(owner: number, pos: Vec2): Entity | null {
    let best: Entity | null = null; let bd = 1e9;
    for (const e of this.entities) {
      if (e.owner !== owner || e.type !== "miner" || e.dead) continue;
      if (e.buildTask || e.mining || e.mineId != null) continue; // don't pull mining/assigned miners
      const d = this.dist(e.pos, pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  tryTrain(cmd: Extract<Command, { t: "train" }>): void {
    const b = this.byId.get(cmd.building); if (!b || !b.isBuilding || b.constructing) return;
    const p = this.players[b.owner]; if (!p) return;
    const def = BUILDING_DEFS[b.type as BuildingId];
    if (!def.produces || !def.produces.includes(cmd.unit)) return;
    if (b.queue.length >= MAX_QUEUE) { this.events.push({ e: "toast", key: "toast.queueFull", kind: "danger", to: b.owner }); return; }
    const ud = UNIT_DEFS[cmd.unit];
    if (!this.canAfford(p, ud.cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, ud.cost), kind: "danger", to: b.owner }); return; }
    this.pay(p, ud.cost);
    // Logistics research shortens unit build time by 20% (spec §24 → T26 Part C).
    const time = ud.buildTime * (p.research.logistics ? LOGISTICS_BUILD_MULT : 1);
    b.queue.push({ unit: cmd.unit, progress: 0, time });
  }

  cancelQueue(buildingId: number, index: number): void {
    const b = this.byId.get(buildingId); if (!b) return;
    const item = b.queue[index]; if (!item) return;
    const p = this.players[b.owner];
    // Already-started items (any in-progress bay) refund 50%; not-yet-started items refund 100%.
    const frac = item.progress > 0 ? CANCEL_INPROGRESS_REFUND : CANCEL_QUEUED_REFUND;
    this.refund(p, UNIT_DEFS[item.unit].cost, frac);
    b.queue.splice(index, 1);
  }

  // ---------- T26: factory upgrades (parallel bays + assembly speed) ----------
  // Instant on purchase (mechanical caps, not timed). Gated on Research Center Factory Tech.
  tryUpgradeBuilding(buildingId: number, kind: "bay" | "speed" | "level"): void {
    const b = this.byId.get(buildingId); if (!b || !b.isBuilding || b.constructing) return;
    const def = BUILDING_DEFS[b.type as BuildingId];
    const p = this.players[b.owner]; if (!p) return;
    // T30: timed LEVEL upgrade for the Command Center (gates the tech tree) and defensive towers
    // (boost range + damage). Costs are paid up-front and the upgrade takes half the build time.
    if (kind === "level") { this.tryUpgradeLevel(b, def, p); return; }
    if (!def.produces) return; // only producing buildings can take bay/speed upgrades
    if (kind === "bay") {
      if (b.bays >= MAX_BAYS) return;
      const stepIndex = b.bays - 1; // 0 = 1->2, 1 = 2->3
      if (p.research.factoryTech < stepIndex + 1) { this.events.push({ e: "toast", key: "errors.needFactoryTech", kind: "danger", to: b.owner }); return; }
      const cost = BAY_UPGRADE_COSTS[stepIndex];
      if (!this.canAfford(p, cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, cost), kind: "danger", to: b.owner }); return; }
      this.pay(p, cost); b.bays++;
    } else {
      if (b.speedLevel >= MAX_SPEED_LEVEL) return;
      const stepIndex = b.speedLevel; // 0 = 0->1, 1 = 1->2
      if (p.research.factoryTech < stepIndex + 1) { this.events.push({ e: "toast", key: "errors.needFactoryTech", kind: "danger", to: b.owner }); return; }
      const cost = SPEED_UPGRADE_COSTS[stepIndex];
      if (!this.canAfford(p, cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, cost), kind: "danger", to: b.owner }); return; }
      this.pay(p, cost); b.speedLevel++;
    }
    this.events.push({ e: "float", pos: b.pos, text: "▲", color: "#ffd23f" });
  }

  // T30: a timed level upgrade for the Command Center (max L3, gates the build tree) or a defensive
  // tower (max L3, +range/+damage per level). Validated host-side: right building type, not maxed,
  // not already upgrading, affordable. The new level applies when the timer completes.
  tryUpgradeLevel(b: Entity, def: typeof BUILDING_DEFS[BuildingId], p: PlayerState): void {
    if (b.upgrading) return; // one upgrade at a time
    const isCC = b.type === "command_center";
    const isDefense = !!def.weapon && !def.produces && !def.isWall; // guard/cannon/rocket towers
    if (!isCC && !isDefense) return;
    const maxLvl = isCC ? MAX_BASE_LEVEL : MAX_DEFENSE_LEVEL;
    if (b.level >= maxLvl) return;
    const cost = isCC ? CC_UPGRADE_COSTS[b.level - 1] : defenseUpgradeCost(def.cost);
    if (!this.canAfford(p, cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, cost), kind: "danger", to: b.owner }); return; }
    this.pay(p, cost);
    const time = isCC ? CC_UPGRADE_TIMES[b.level - 1] : upgradeTime(def.buildTime);
    b.upgrading = { to: b.level + 1, progress: 0, time };
    this.events.push({ e: "float", pos: b.pos, text: "▲", color: "#ffd23f" });
  }

  // ---------- T26: Research Center timed research ----------
  researchLevelOwned(p: PlayerState, def: ResearchDef): number {
    switch (def.kind) {
      case "weapons": return p.research.weapons;
      case "armor": return p.research.armor;
      case "factoryTech": return p.research.factoryTech;
      case "logistics": return p.research.logistics ? 1 : 0;
    }
  }
  // Researchable now? (prerequisite met, not already owned, not already in progress on this player).
  canResearch(p: PlayerState, def: ResearchDef): boolean {
    if (this.researchLevelOwned(p, def) >= def.level) return false; // already have it
    if (def.requires) { const req = RESEARCH_BY_ID[def.requires]; if (this.researchLevelOwned(p, req) < req.level) return false; }
    // not already researching the same id at another Research Center
    for (const e of this.entities) if (!e.dead && e.owner === p.id && e.researching && e.researching.id === def.id) return false;
    return true;
  }
  tryResearch(buildingId: number, id: string): void {
    const b = this.byId.get(buildingId); if (!b || b.type !== "research_center" || b.constructing) return;
    if (b.researching) return; // slot busy
    const p = this.players[b.owner]; if (!p) return;
    const def = RESEARCH_BY_ID[id]; if (!def) return;
    if (!this.canResearch(p, def)) return;
    if (!this.canAfford(p, def.cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, def.cost), kind: "danger", to: b.owner }); return; }
    this.pay(p, def.cost);
    b.researching = { id, progress: 0, time: def.time };
  }
  cancelResearch(buildingId: number): void {
    const b = this.byId.get(buildingId); if (!b || b.type !== "research_center" || !b.researching) return;
    const def = RESEARCH_BY_ID[b.researching.id];
    if (def) this.refund(this.players[b.owner], def.cost, CANCEL_INPROGRESS_REFUND);
    b.researching = null;
  }
  private completeResearch(b: Entity): void {
    if (!b.researching) return;
    const def = RESEARCH_BY_ID[b.researching.id]; b.researching = null;
    if (!def) return;
    const p = this.players[b.owner]; if (!p) return;
    switch (def.kind) {
      case "weapons": p.research.weapons = Math.max(p.research.weapons, def.level); break;
      case "armor": p.research.armor = Math.max(p.research.armor, def.level); break;
      case "factoryTech": p.research.factoryTech = Math.max(p.research.factoryTech, def.level); break;
      case "logistics": p.research.logistics = true; break;
    }
    this.events.push({ e: "toast", key: "toast.researchDone", kind: "ok", params: { name: def.nameKey }, to: b.owner });
    this.events.push({ e: "rankup", pos: b.pos });
  }

  sell(buildingId: number): void {
    const b = this.byId.get(buildingId); if (!b || !b.isBuilding) return;
    if (b.type === "command_center") return;
    const p = this.players[b.owner];
    this.refund(p, BUILDING_DEFS[b.type as BuildingId].cost, SELL_REFUND);
    this.events.push({ e: "death", pos: b.pos, kind: "building", owner: b.owner });
    this.killEntity(b, false);
  }

  shortfallKey(p: PlayerState, c: Cost): string {
    if (p.gold < (c.gold ?? 0)) return "errors.notEnoughGold";
    if (p.iron < (c.iron ?? 0)) return "errors.notEnoughIron";
    return "errors.notEnoughSilver";
  }

  // ---------- hero abilities (spec §9.3) ----------
  castAbility(cmd: Extract<Command, { t: "ability" }>): void {
    const h = this.byId.get(cmd.hero); if (!h || !h.hero || h.dead) return;
    const slot = cmd.slot; const ab = h.hero.abilities[slot];
    if (ab.rank <= 0) return;
    if (this.time < ab.cdUntil) { this.events.push({ e: "ability", slot: -slot - 1, pos: h.pos, owner: h.owner }); return; }
    const cfg = [ABIL.q, ABIL.w, ABIL.e, ABIL.r][slot];
    if (h.hero.mana < cfg.mana) { this.events.push({ e: "ability", slot: -slot - 1, pos: h.pos, owner: h.owner }); return; }
    const r = ab.rank - 1;
    h.hero.mana -= cfg.mana; ab.cdUntil = this.time + cfg.cd;
    this.events.push({ e: "ability", slot, pos: { x: cmd.x, y: cmd.y }, owner: h.owner });
    if (slot === 0) { // Q burst
      h.hero.burstShots = 3; h.hero.burstBonus = ABIL.q.bonus[r];
    } else if (slot === 1) { // W rally banner
      this.banners.push({ owner: h.owner, pos: { x: cmd.x, y: cmd.y }, until: this.time + ABIL.w.dur, rank: r });
    } else if (slot === 2) { // E combat roll dash
      h.pos = { x: cmd.x + 0.5, y: cmd.y + 0.5 }; h.path = []; h.moveTarget = null;
      h.hero.invulnUntil = this.time + 0.4;
      this.splashDamage({ x: cmd.x + 0.5, y: cmd.y + 0.5 }, 1.5, ABIL.e.dmg[r], "Explosive", h.owner, h);
      this.events.push({ e: "impact", pos: { x: cmd.x + 0.5, y: cmd.y + 0.5 }, kind: "rocket", size: 1.5 });
      this.events.push({ e: "shake", intensity: 4 });
    } else if (slot === 3) { // R orbital strike (delayed)
      this.strikes.push({ owner: h.owner, pos: { x: cmd.x + 0.5, y: cmd.y + 0.5 }, at: this.time + ABIL.r.delay, damage: ABIL.r.dmg[r], radius: ABIL.r.radius });
    }
  }

  // ---------- main tick (fixed 20 Hz) ----------
  tick(): void {
    if (this.winner !== -2) return;
    this.time += TICK_DT;
    this.applyCommands();
    this.economySystem();
    this.productionSystem();
    this.workerSystem();
    this.movementSystem();
    this.combatSystem();
    this.projectileSystem();
    this.strikeSystem();
    this.captureSystem();
    this.heroSystem();
    this.cleanup();
    this.winCheck();
  }

  // ---------- economy (spec §6) ----------
  private economySystem(): void {
    for (const p of this.players) { p.powerGen = 0; p.powerUse = 0; }
    for (const e of this.entities) {
      if (e.kind !== "building" || e.dead || e.constructing) continue;
      const p = this.players[e.owner]; if (!p) continue;
      if (e.power > 0) p.powerGen += e.power; else p.powerUse += -e.power;
      if (e.type === "command_center") p.powerGen += 0; // base already +5 via def power
    }
    for (const p of this.players) p.brownout = (p.powerGen - p.powerUse) < 0;

    // T30: EVERY mine needs at least one miner working inside it. Silver scales with its miners
    // (up to the canonical slot cap); iron / gold / captured oil produce at their fixed canonical
    // interval while occupied, and NOTHING when empty. `minerSlots` is the live occupancy.
    for (const e of this.entities) {
      if (e.dead || e.constructing) continue;
      if (e.type === "silver_mine") {
        const slots = Math.min(e.minerSlots, SILVER_MINE_SLOTS);
        if (slots > 0) {
          e.resAccum += (slots / MINER_OUTPUT_INTERVAL) * TICK_DT;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.players[e.owner].silver += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#c9d1d9" }); }
        }
      } else if (e.type === "iron_mine") {
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / IRON_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.players[e.owner].iron += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#8c98a4" }); }
        }
      } else if (e.type === "gold_mine") {
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / GOLD_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.players[e.owner].gold += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#ffd23f" }); }
        }
      } else if (e.type === "oil_derrick" && e.owner !== NEUTRAL) {
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / OIL_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.players[e.owner].silver += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#c9d1d9" }); }
        }
      }
    }
  }

  // ---------- construction & production (spec §7.3) ----------
  private productionSystem(): void {
    for (const e of this.entities) {
      if (e.kind !== "building" || e.dead) continue;
      if (e.constructing) {
        // progress while a builder is near OR fallback slow rate to avoid stalls
        const builderNear = this.entities.some((m) => m.type === "miner" && m.owner === e.owner && !m.dead && m.buildTask && m.buildTask.entId === e.id && this.dist(m.pos, e.pos) < e.radius + 1.5);
        const rate = builderNear ? 1 : 0.5;
        e.buildProgress += (TICK_DT / e.buildTotal) * rate;
        e.hp = Math.min(e.maxHp, e.maxHp * (0.1 + 0.9 * e.buildProgress));
        if (e.buildProgress >= 1) {
          e.constructing = false; e.buildProgress = 1; e.hp = e.maxHp;
          this.events.push({ e: "toast", key: "toast.buildComplete", kind: "ok", to: e.owner });
          for (const m of this.entities) if (m.buildTask && m.buildTask.entId === e.id) { m.buildTask = null; this.autoAssignMiner(m); }
        }
        continue;
      }
      // training queue — advance the first `bays` items in parallel (T26 Part B). Assembly-speed
      // scales the rate by (1 + 0.25*speedLevel), composed with the brownout penalty.
      if (e.queue.length > 0) {
        const p = this.players[e.owner];
        const brown = (p && p.brownout) ? BROWNOUT_PRODUCTION_MULT : 1;
        const speedMult = 1 + ASSEMBLY_SPEED_PER_LEVEL * e.speedLevel;
        const active = Math.min(Math.max(1, e.bays), e.queue.length);
        const completed: QueueItem[] = [];
        for (let i = 0; i < active; i++) {
          const item = e.queue[i];
          item.progress += (TICK_DT / item.time) * brown * speedMult;
          if (item.progress >= 1) completed.push(item);
        }
        if (completed.length) {
          e.queue = e.queue.filter((q) => !completed.includes(q));
          for (const c of completed) this.spawnTrained(e, c.unit);
        }
      }
      // Research Center timed research (T26 Part C): one research per center at a time.
      if (e.type === "research_center" && e.researching) {
        e.researching.progress += TICK_DT / e.researching.time;
        if (e.researching.progress >= 1) this.completeResearch(e);
      }
      // T30: timed level upgrade (Command Center / defensive tower). Applies the new level when done.
      if (e.upgrading) {
        e.upgrading.progress += TICK_DT / e.upgrading.time;
        if (e.upgrading.progress >= 1) {
          e.level = e.upgrading.to; e.upgrading = null;
          this.events.push({ e: "rankup", pos: e.pos });
          this.events.push({ e: "toast", key: "toast.upgradeComplete", kind: "ok", params: { name: BUILDING_DEFS[e.type as BuildingId].nameKey, lvl: e.level }, to: e.owner });
        }
      }
    }
  }

  private spawnTrained(b: Entity, unit: UnitId): void {
    const free = nearestFree(this.grid, Math.floor(b.pos.x), Math.floor(b.pos.y + b.radius + 1)) || { x: Math.floor(b.pos.x), y: Math.floor(b.pos.y) };
    const u = this.spawn("unit", unit, b.owner, free.x, free.y);
    this.players[b.owner].unitsBuilt++;
    const rally = b.rally;
    if (rally) this.setMove(u, rally.x, rally.y);
    else if (unit === "miner") this.autoAssignMiner(u);
    this.events.push({ e: "toast", key: "toast.unitReadyNamed", kind: "ok", params: { unit: UNIT_DEFS[unit].nameKey }, to: b.owner });
  }

  // ---------- workers (spec §6.3; T30: every mine type, miners enter & hide) ----------
  private workerSystem(): void {
    for (const e of this.entities) {
      if (e.type !== "miner" || e.dead) continue;
      if (e.mineId != null) {
        const mine = this.byId.get(e.mineId);
        if (!mine || mine.dead) { e.mineId = null; e.mining = false; e.inMine = false; continue; }
        if (this.dist(e.pos, mine.pos) <= mine.radius + 1.2) {
          if (!e.mining) {
            const cur = this.countMiners(mine.id);
            if (cur < mineSlotCap(mine.type)) {
              // T30 C2/C3: the miner ENTERS the mine — it works inside and disappears from the map.
              e.mining = true; e.inMine = true; e.path = []; e.moveTarget = null;
              e.pos = { x: mine.pos.x, y: mine.pos.y };
              mine.minerSlots = cur + 1;
            } else {
              e.mineId = null; this.autoAssignMiner(e); // full → look for another free mine
            }
          }
        }
      }
    }
    // recount occupancy authoritatively for ALL mine types (capped by the per-type slot count)
    for (const e of this.entities) {
      if (e.dead || !isMineType(e.type)) continue;
      e.minerSlots = Math.min(this.countMiners(e.id), mineSlotCap(e.type));
    }
  }
  countMiners(mineId: number): number {
    let n = 0;
    for (const e of this.entities) if (e.type === "miner" && !e.dead && e.mining && e.mineId === mineId) n++;
    return n;
  }
  // T30: release every miner working inside a mine that is being destroyed/sold — eject them next to
  // the rubble as idle units (visible again) and auto-reassign them so workers are never lost.
  releaseMiners(mine: Entity): void {
    for (const e of this.entities) {
      if (e.type !== "miner" || e.dead || e.mineId !== mine.id) continue;
      e.mineId = null; e.mining = false; e.inMine = false;
      const free = nearestFree(this.grid, Math.floor(mine.pos.x), Math.floor(mine.pos.y)) || { x: Math.floor(mine.pos.x), y: Math.floor(mine.pos.y) };
      e.pos = { x: free.x + 0.5, y: free.y + 0.5 };
      this.autoAssignMiner(e);
    }
  }
  autoAssignMiner(m: Entity): void {
    // T30: send an idle miner to the nearest owned, built mine of ANY type with a free work slot.
    let best: Entity | null = null; let bd = 1e9;
    for (const e of this.entities) {
      if (!isMineType(e.type) || e.dead || e.owner !== m.owner || e.owner === NEUTRAL || e.constructing) continue;
      if (this.countMiners(e.id) >= mineSlotCap(e.type)) continue;
      const d = this.dist(e.pos, m.pos); if (d < bd) { bd = d; best = e; }
    }
    if (best) { m.mineId = best.id; m.mining = false; m.inMine = false; this.setMove(m, best.pos.x, best.pos.y); }
  }

  // ---------- movement (spec §8.5) ----------
  private movementSystem(): void {
    for (const e of this.entities) {
      if (e.kind !== "unit" || e.dead) continue;
      if (e.mining) continue;
      if (e.path.length === 0 || !e.moveTarget) continue;
      const spd = UNIT_DEFS[e.type as UnitId].speed;
      let wp = e.path[0];
      const dx = wp.x - e.pos.x, dy = wp.y - e.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.18) { e.path.shift(); if (e.path.length === 0) { e.moveTarget = null; } continue; }
      const step = spd * TICK_DT;
      e.facing = Math.atan2(dy, dx);
      if (step >= d) { e.pos.x = wp.x; e.pos.y = wp.y; e.path.shift(); }
      else { e.pos.x += (dx / d) * step; e.pos.y += (dy / d) * step; }
    }
    this.separate();
  }

  private separate(): void {
    const arr = this.entities;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]; if (a.kind !== "unit" || a.dead || a.mining) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]; if (b.kind !== "unit" || b.dead || b.mining) continue;
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2); const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          if (!this.grid.isBlocked(Math.floor(a.pos.x - nx * push), Math.floor(a.pos.y - ny * push))) { a.pos.x -= nx * push; a.pos.y -= ny * push; }
          if (!this.grid.isBlocked(Math.floor(b.pos.x + nx * push), Math.floor(b.pos.y + ny * push))) { b.pos.x += nx * push; b.pos.y += ny * push; }
        }
      }
    }
  }

  // ---------- combat (spec §13) ----------
  private combatSystem(): void {
    for (const e of this.entities) {
      if (e.dead) continue;
      const wd = e.weaponDef; if (!wd) continue;
      if (e.kind === "building" && e.constructing) continue;
      if (e.attackCd > 0) e.attackCd -= TICK_DT;

      // resolve current target
      let tgt = e.target != null ? this.byId.get(e.target) : undefined;
      if (tgt && (tgt.dead || !this.isEnemy(e, tgt))) { tgt = undefined; e.target = null; }

      // auto-acquire if no explicit target and not holding-without-target
      if (!tgt && e.stance !== "hold" || (!tgt && e.kind === "building")) {
        const acq = this.acquire(e, wd);
        if (acq) { tgt = acq; if (e.kind === "unit" && e.stance === "aggressive" && !e.moveTarget) e.target = acq.id; }
      } else if (!tgt && e.stance === "hold") {
        const acq = this.acquire(e, wd, true);
        if (acq) tgt = acq;
      }

      if (!tgt) {
        // attack-move: keep moving to destination
        if (e.stance === "attackmove" && e.attackMoveTarget && e.path.length === 0) {
          this.setMove(e, e.attackMoveTarget.x, e.attackMoveTarget.y);
          if (this.dist(e.pos, e.attackMoveTarget) < 1) { e.stance = "aggressive"; e.attackMoveTarget = null; }
        }
        continue;
      }

      const range = this.effRange(e, wd);
      const d = this.dist(e.pos, tgt.pos);
      // face / aim
      e.turret = Math.atan2(tgt.pos.y - e.pos.y, tgt.pos.x - e.pos.x);

      if (d > range) {
        // chase if a unit and allowed
        if (e.kind === "unit" && e.stance !== "hold") {
          e.repathTimer -= TICK_DT;
          if (e.repathTimer <= 0 || e.path.length === 0) { this.setMove(e, tgt.pos.x, tgt.pos.y); e.repathTimer = 0.5; }
        }
        continue;
      }
      // in range: stop and fire
      if (wd.minRange && d < wd.minRange) {
        // too close (artillery): back off
        if (e.kind === "unit") {
          const away = { x: e.pos.x + (e.pos.x - tgt.pos.x), y: e.pos.y + (e.pos.y - tgt.pos.y) };
          this.setMove(e, away.x, away.y);
        }
        continue;
      }
      e.path = []; e.moveTarget = null;
      if (e.attackCd <= 0) this.fire(e, tgt, wd);
    }
  }

  effRange(e: Entity, wd: NonNullable<Entity["weaponDef"]>): number {
    let r = wd.range + RANK_RANGE[e.rank];
    // T30: a defensive tower's range grows with its level.
    if (e.kind === "building" && e.level > 1) r += (e.level - 1) * DEFENSE_RANGE_PER_LEVEL;
    if (e.kind === "building" && this.players[e.owner]?.brownout) r *= BROWNOUT_TOWER_RANGE_MULT;
    return r;
  }

  // T30: a defensive tower's weapon damage grows with its level (units keep level 1 → unchanged).
  effDamage(e: Entity, wd: NonNullable<Entity["weaponDef"]>): number {
    let d = wd.damage;
    if (e.kind === "building" && e.level > 1) d *= 1 + DEFENSE_DAMAGE_PER_LEVEL * (e.level - 1);
    return d;
  }

  acquire(e: Entity, wd: NonNullable<Entity["weaponDef"]>, inRangeOnly = false): Entity | undefined {
    let best: Entity | undefined; let bestScore = -1; let bd = 1e9;
    const range = this.effRange(e, wd);
    const aggro = e.kind === "building" ? range : Math.max(e.vision, range);
    for (const o of this.entities) {
      if (o.dead || !this.isEnemy(e, o)) continue;
      if (o.inMine) continue; // T30: miners working inside a mine are untargetable
      const isAir = false; // no aircraft tier implemented
      if (o.kind === "unit" && UNIT_DEFS[o.type as UnitId].isVehicle === undefined) { /* */ }
      // can this weapon hit the target armor? (matrix 0 => cannot)
      const mult = damageMultiplier(wd.damageType, this.armorOf(o));
      if (mult <= 0) continue;
      const d = this.dist(e.pos, o.pos);
      if (d > aggro) continue;
      if (inRangeOnly && d > range) continue;
      // preference scoring
      let score = 0;
      if (wd.preferred && this.armorOf(o) === wd.preferred) score += 100;
      score += (200 - d);
      if (score > bestScore) { bestScore = score; best = o; bd = d; }
    }
    return best;
  }

  fire(e: Entity, tgt: Entity, wd: NonNullable<Entity["weaponDef"]>): void {
    let cd = wd.cooldown;
    if (e.kind === "building" && this.players[e.owner]?.brownout) cd /= BROWNOUT_TOWER_FIRE_MULT;
    // rally banner attack-speed buff (spec §9.3 W)
    const banner = this.banners.find((b) => b.owner === e.owner && this.dist(b.pos, e.pos) <= ABIL.w.range);
    if (banner) cd *= ABIL.w.asMult[banner.rank];
    e.attackCd = cd;

    const shots = wd.shots ?? 1;
    let bonus = 0;
    if (e.hero && e.hero.burstShots > 0) { bonus = e.hero.burstBonus; e.hero.burstShots--; }
    const dmg = this.effDamage(e, wd); // T30: level-scaled for defensive towers

    if (wd.projectileSpeed === 0) {
      // hitscan tracer
      this.events.push({ e: "fire", from: { ...e.pos }, to: { ...tgt.pos }, kind: wd.projectile, owner: e.owner, speed: 0, arc: false, shots: 1, shotDelay: 0 });
      this.dealDamage(e, tgt, dmg + bonus, wd.damageType);
    } else {
      for (let s = 0; s < shots; s++) {
        const proj: Projectile = {
          kind: wd.projectile, pos: { ...e.pos }, aim: { ...tgt.pos }, targetId: tgt.id, attackerId: e.id,
          speed: wd.projectileSpeed, damage: dmg + (s === 0 ? bonus : 0), damageType: wd.damageType,
          splash: wd.splash ?? 0, owner: e.owner, arc: wd.projectile === "artillery",
          delay: s * (wd.shotDelay ?? 0), t: 0, total: 0, dead: false, rot: e.turret, trail: [],
        };
        this.projectiles.push(proj);
      }
      this.events.push({ e: "fire", from: { ...e.pos }, to: { ...tgt.pos }, kind: wd.projectile, owner: e.owner, speed: wd.projectileSpeed, arc: wd.projectile === "artillery", shots, shotDelay: wd.shotDelay ?? 0 });
    }
  }

  private projectileSystem(): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      if (pr.delay > 0) { pr.delay -= TICK_DT; continue; }
      // homing for rocket/energy/flak: update aim to live target
      if ((pr.kind === "rocket" || pr.kind === "energy" || pr.kind === "flak")) {
        const t = pr.targetId != null ? this.byId.get(pr.targetId) : undefined;
        if (t && !t.dead) pr.aim = { ...t.pos };
      }
      const dx = pr.aim.x - pr.pos.x, dy = pr.aim.y - pr.pos.y;
      const d = Math.hypot(dx, dy);
      const step = pr.speed * TICK_DT;
      pr.rot = Math.atan2(dy, dx);
      if (d <= step + 0.05) {
        pr.pos = { ...pr.aim };
        this.impact(pr);
        pr.dead = true;
      } else {
        pr.pos.x += (dx / d) * step; pr.pos.y += (dy / d) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  impact(pr: Projectile): void {
    const size = pr.splash > 0 ? pr.splash : 0.5;
    this.events.push({ e: "impact", pos: { ...pr.pos }, kind: pr.kind, size });
    if (pr.splash > 0) { this.events.push({ e: "shake", intensity: Math.min(6, pr.splash * 2) }); }
    const attacker = this.byId.get(pr.attackerId) || null;
    if (pr.splash > 0) {
      this.splashDamage(pr.pos, pr.splash, pr.damage, pr.damageType, pr.owner, attacker);
    } else {
      const t = pr.targetId != null ? this.byId.get(pr.targetId) : undefined;
      if (t && !t.dead && this.dist(t.pos, pr.pos) < 1.2) {
        this.dealDamageRaw(t, pr.damage, pr.damageType, pr.owner, attacker || undefined);
      }
    }
  }

  splashDamage(pos: Vec2, radius: number, dmg: number, type: DamageType, owner: number, source: Entity | null): void {
    for (const o of this.entities) {
      if (o.dead) continue;
      if (o.inMine) continue; // T30: miners inside a mine are shielded from splash
      if (o.owner === owner) continue;
      if (o.owner === NEUTRAL && o.kind === "neutral") continue;
      const d = this.dist(o.pos, pos);
      if (d <= radius + o.radius) {
        const falloff = Math.max(0.4, 1 - (d / (radius + 0.001)) * 0.6); // 100% center -> ~40% edge
        this.dealDamageRaw(o, dmg * falloff, type, owner, source || undefined);
      }
    }
  }

  dealDamage(attacker: Entity, tgt: Entity, base: number, type: DamageType): void {
    this.dealDamageRaw(tgt, base, type, attacker.owner, attacker);
  }
  dealDamageRaw(tgt: Entity, base: number, type: DamageType, owner: number, attacker?: Entity): void {
    if (tgt.dead) return;
    if (tgt.inMine) return; // T30: a miner working inside a mine cannot be hit
    if (tgt.hero && this.time < tgt.hero.invulnUntil) return;
    const mult = damageMultiplier(type, this.armorOf(tgt));
    let dmg = base * mult;
    // attacker veterancy bonus
    if (attacker) dmg *= RANK_DMG[attacker.rank];
    // T26: Weapons research — attacker's army deals +15% per level.
    const op = this.players[owner];
    if (op && op.research.weapons) dmg *= 1 + RESEARCH_DAMAGE_PER_LEVEL * op.research.weapons;
    // T26: Armor research — defender's army takes less (effective +15% HP per level).
    const dp = this.players[tgt.owner];
    if (dp && dp.research.armor) dmg /= 1 + RESEARCH_ARMOR_PER_LEVEL * dp.research.armor;
    // banner armor buff on defender
    const banner = this.banners.find((b) => b.owner === tgt.owner && this.dist(b.pos, tgt.pos) <= ABIL.w.range);
    if (banner) dmg *= 0.85;
    if (dmg <= 0) return;
    tgt.hp -= dmg;
    tgt.hitFlash = 0.12;
    if (tgt.hp <= 0) this.onKill(tgt, owner, attacker);
  }

  onKill(tgt: Entity, owner: number, attacker?: Entity): void {
    if (tgt.dead) return;
    const value = Math.max(20, tgt.maxHp / 4);
    // veterancy for the attacking unit
    if (attacker && attacker.kind === "unit" && !attacker.hero) {
      attacker.xp += value;
      const newRank = this.rankFor(attacker.xp);
      if (newRank > attacker.rank) {
        const oldMax = attacker.maxHp; attacker.rank = newRank;
        attacker.maxHp = UNIT_DEFS[attacker.type as UnitId].hp * RANK_HP[newRank];
        attacker.hp += attacker.maxHp - oldMax;
        this.events.push({ e: "rankup", pos: attacker.pos });
      }
    }
    // hero xp to the owner
    const p = this.players[owner];
    if (p && p.heroId) { const h = this.byId.get(p.heroId); if (h && h.hero) this.gainHeroXp(h, value); }
    // bounty for hero kill
    if (tgt.hero) { if (p) { p.silver += 30; this.events.push({ e: "float", pos: tgt.pos, text: "+30", color: "#ffd23f" }); } }
    this.killEntity(tgt, true);
  }

  rankFor(xp: number): number {
    let r = 0; for (let i = 0; i < VET_THRESHOLDS.length; i++) if (xp >= VET_THRESHOLDS[i]) r = i; return r;
  }

  killEntity(e: Entity, explode: boolean): void {
    if (e.dead) return;
    e.dead = true;
    // T30: a destroyed/sold mine ejects its occupant miners back onto the map (idle, auto-reassigned).
    if (isMineType(e.type)) this.releaseMiners(e);
    const ownerP = this.players[e.owner];
    if (e.kind === "building") { this.occupy(e, false); if (ownerP) { /* */ } for (const pp of this.players) if (pp.id !== e.owner) pp.buildingsDestroyed++; }
    if (e.kind === "unit" && e.type !== "hero" && ownerP) ownerP.unitsLost++;
    if (explode) {
      const kind = e.kind === "building" ? "building" : (e.isVehicle ? "vehicle" : "infantry");
      this.events.push({ e: "death", pos: { ...e.pos }, kind, owner: e.owner });
      if (e.kind === "building") this.events.push({ e: "shake", intensity: e.type === "command_center" ? 12 : 5 });
    }
    // hero death -> respawn timer (spec §9.1)
    if (e.hero) {
      const p = this.players[e.owner];
      p.heroRespawnAt = this.time + HERO_RESPAWN_BASE + HERO_RESPAWN_PER_LEVEL * p.heroLevel;
      this.events.push({ e: "toast", key: "toast.heroDown", kind: "danger", to: e.owner });
    }
  }

  // ---------- orbital / super strikes ----------
  private strikeSystem(): void {
    for (const s of this.strikes) {
      if (this.time >= s.at) {
        this.splashDamage(s.pos, s.radius, s.damage, "Explosive", s.owner, null);
        this.events.push({ e: "impact", pos: s.pos, kind: "artillery", size: s.radius });
        this.events.push({ e: "shake", intensity: 14 });
        this.events.push({ e: "flash", color: "rgba(255,240,200,0.5)" });
        s.at = -1;
      }
    }
    this.strikes = this.strikes.filter((s) => s.at >= 0);
    this.banners = this.banners.filter((b) => b.until > this.time);
  }

  // ---------- capture (spec §12) ----------
  private captureSystem(): void {
    for (const e of this.entities) {
      if (e.type !== "oil_derrick" || e.dead) continue;
      if (e.bountyCd > 0) e.bountyCd -= TICK_DT;
      // presence capture: who has units in radius?
      const owners = new Set<number>();
      let nearOwner = -2;
      for (const u of this.entities) {
        if (u.kind !== "unit" || u.dead) continue;
        if (this.dist(u.pos, e.pos) <= 3) { owners.add(u.owner); nearOwner = u.owner; }
      }
      if (owners.size === 1) {
        const o = [...owners][0];
        if (o !== e.owner) {
          e.captureProgress += TICK_DT / 6;
          e.captureOwner = o;
          if (e.captureProgress >= 1) {
            e.owner = o; e.captureProgress = 0;
            this.occupy(e, true);
            this.events.push({ e: "capture", pos: e.pos, owner: o });
            if (e.bountyCd <= 0) { this.players[o].silver += 50; this.events.push({ e: "float", pos: e.pos, text: "+50", color: "#c9d1d9" }); e.bountyCd = 30; }
            this.events.push({ e: "toast", key: "toast.captured", kind: "ok", params: { name: "buildings.oilDerrick.name" }, to: o });
          }
        }
      } else if (owners.size === 0) {
        e.captureProgress = Math.max(0, e.captureProgress - TICK_DT / 6);
      }
      // engineer channel capture handled via captureTask in workerSystem-like check:
    }
    // engineer capture
    for (const e of this.entities) {
      if (e.type !== "engineer" || e.dead || !e.captureTask) continue;
      const tgt = this.byId.get(e.captureTask.target);
      if (!tgt || tgt.dead) { e.captureTask = null; continue; }
      if (this.dist(e.pos, tgt.pos) <= tgt.radius + 1.2) {
        e.path = []; e.moveTarget = null;
        // channel 3s tracked on entity via captureProgress reuse
        e.captureProgress += TICK_DT / 3;
        if (e.captureProgress >= 1) {
          const wasEnemyStructure = tgt.owner !== NEUTRAL && tgt.kind === "building";
          tgt.owner = e.owner; tgt.captureProgress = 0;
          this.events.push({ e: "capture", pos: tgt.pos, owner: e.owner });
          this.events.push({ e: "toast", key: "toast.captured", kind: "ok", params: { name: tgt.kind === "building" ? BUILDING_DEFS[tgt.type as BuildingId].nameKey : "buildings.oilDerrick.name" }, to: e.owner });
          e.captureTask = null; e.captureProgress = 0;
          if (wasEnemyStructure) this.killEntity(e, false); // consumed
        }
      }
    }
  }

  // ---------- hero (spec §9) ----------
  private heroSystem(): void {
    for (const p of this.players) {
      // respawn
      if (p.heroRespawnAt > 0 && this.time >= p.heroRespawnAt) {
        const cc = this.entities.find((e) => e.owner === p.id && e.type === "command_center" && !e.dead);
        if (cc) {
          const pos = nearestFree(this.grid, Math.floor(cc.pos.x), Math.floor(cc.pos.y + 3)) || { x: Math.floor(cc.pos.x), y: Math.floor(cc.pos.y) };
          const hero = this.spawn("unit", "hero", p.id, pos.x, pos.y);
          hero.hero = { mana: 100, maxMana: 100 + p.heroLevel * 10, abilities: this.heroAbilitiesFor(p.heroLevel), burstShots: 0, burstBonus: 0, invulnUntil: 0 };
          hero.maxHp = 700 + p.heroLevel * 80; hero.hp = hero.maxHp; hero.rank = 0;
          p.heroId = hero.id; p.heroRespawnAt = 0;
          this.events.push({ e: "toast", key: "toast.heroReady", kind: "ok", to: p.id });
        }
      }
    }
    for (const e of this.entities) {
      if (!e.hero || e.dead) continue;
      const p = this.players[e.owner];
      e.hero.mana = Math.min(e.hero.maxMana, e.hero.mana + 5 * TICK_DT);
      this.gainHeroXp(e, HERO_PASSIVE_XP * TICK_DT);
      // heroic self-heal-ish: hero slowly regenerates
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 4 * TICK_DT);
    }
  }

  heroAbilitiesFor(level: number): HeroData["abilities"] {
    const ab = [{ rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }];
    for (let l = 1; l <= level; l++) this.assignPoint(ab, l);
    return ab;
  }
  assignPoint(ab: HeroData["abilities"], level: number): void {
    if (level >= 6 && ab[3].rank < 3) { ab[3].rank++; return; }
    // cycle Q,W,E up to rank 4
    const order = [0, 1, 2];
    let min = 99, mi = 0;
    for (const i of order) if (ab[i].rank < min && ab[i].rank < 4) { min = ab[i].rank; mi = i; }
    if (ab[mi].rank < 4) ab[mi].rank++;
  }

  gainHeroXp(h: Entity, amt: number): void {
    if (!h.hero) return;
    const p = this.players[h.owner];
    p.heroXp += amt;
    while (p.heroLevel < HERO_MAX_LEVEL && p.heroXp >= this.heroXpNeeded(p.heroLevel + 1)) {
      p.heroLevel++;
      this.assignPoint(h.hero.abilities, p.heroLevel);
      h.maxHp += 80; h.hp += 80; h.hero.maxMana += 10; h.hero.mana = h.hero.maxMana;
      this.events.push({ e: "rankup", pos: h.pos });
      this.events.push({ e: "float", pos: h.pos, text: "LVL " + p.heroLevel, color: "#ffd23f" });
    }
  }
  heroXpNeeded(level: number): number { return HERO_XP_PER_LEVEL * level * (level + 1) / 2; }

  // ---------- cleanup / win ----------
  private cleanup(): void {
    if (this.entities.some((e) => e.dead)) {
      this.entities = this.entities.filter((e) => { if (e.dead) { this.byId.delete(e.id); return false; } return true; });
    }
  }

  eliminate(owner: number): void {
    const p = this.players[owner]; if (!p || p.defeated) return;
    p.defeated = true;
    for (const e of this.entities) if (e.owner === owner) this.killEntity(e, e.kind === "building");
  }

  private winCheck(): void {
    for (const p of this.players) {
      if (p.defeated) continue;
      const hasCC = this.entities.some((e) => e.owner === p.id && e.type === "command_center" && !e.dead);
      if (!hasCC) this.eliminate(p.id);
    }
    const alive = this.players.filter((p) => !p.defeated);
    if (alive.length <= 1) this.winner = alive.length === 1 ? alive[0].id : -1;
  }

  drainEvents(): GameEvent[] { const ev = this.events; this.events = []; return ev; }
}
