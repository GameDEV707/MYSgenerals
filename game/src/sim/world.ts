// MYS Generals — authoritative simulation (engine-agnostic, no DOM/canvas imports).
// Implements spec §3.2 (fixed tick), §6 (economy), §8 (units), §7 (buildings),
// §13 (combat), §9 (hero), §10.5 (veterancy), §12 (capture), §23 (win/lose).
import {
  Vec2, UnitId, BuildingId, Cost, ResKind, DamageType, ArmorType, ProjectileKind,
} from "../types.js";
import { UNIT_DEFS, BUILDING_DEFS, NEUTRAL_DEFS, damageMultiplier, RESEARCH_BY_ID, ResearchDef } from "../data.js";
import {
  TICK_DT, START_SILVER, MINER_OUTPUT_INTERVAL, IRON_INTERVAL, GOLD_INTERVAL,
  OIL_INTERVAL, CC_POWER, BROWNOUT_PRODUCTION_MULT, BROWNOUT_TOWER_FIRE_MULT, BROWNOUT_TOWER_RANGE_MULT,
  SELL_REFUND, CANCEL_QUEUED_REFUND, CANCEL_INPROGRESS_REFUND, BUILD_RADIUS, MAX_QUEUE,
  HERO_RESPAWN_BASE, HERO_RESPAWN_PER_LEVEL, HERO_XP_PER_LEVEL, HERO_PASSIVE_XP, HERO_MAX_LEVEL,
  VET_THRESHOLDS, MAX_BAYS, MAX_SPEED_LEVEL, ASSEMBLY_SPEED_PER_LEVEL, BAY_UPGRADE_COSTS,
  SPEED_UPGRADE_COSTS, RESEARCH_DAMAGE_PER_LEVEL, RESEARCH_ARMOR_PER_LEVEL, LOGISTICS_BUILD_MULT,
  MAX_BASE_LEVEL, CC_UPGRADE_COSTS, CC_UPGRADE_TIMES, REQUIRED_BASE_LEVEL, MAX_DEFENSE_LEVEL,
  DEFENSE_RANGE_PER_LEVEL, DEFENSE_DAMAGE_PER_LEVEL, defenseUpgradeCost, upgradeTime,
  mineSlotCap, isMineType, DERRICK_CAPTURE_TIME, OUTPOST_CAPTURE_TIME, OUTPOST_CAPTURE_RADIUS,
  OUTPOST_CAPTURE_BOUNTY, MAX_RADAR_LEVEL, RADAR_VISION,
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
  mineRetry = 0; // T32 D1: consecutive failed attempts to reach an assigned mine (stuck recovery)
  buildRetry = 0; // consecutive ticks an assigned engineer-builder has idled SHORT of its build site (stuck recovery)
  buildTask: { bid: BuildingId; pos: Vec2; entId: number } | null = null;
  captureTask: { target: number } | null = null;
  // support units (Repair Engineer / Medic): the ally currently being serviced (null = seeking).
  healTargetId: number | null = null;
  healFxCd = 0; // throttles the heal-beam visual event so it isn't emitted every tick
  // building
  isBuilding = false;
  constructing = false;
  buildProgress = 0; // 0..1
  buildTotal = 0;
  queue: QueueItem[] = [];
  rally: Vec2 | null = null;
  // Command Center has a SECOND rally flag: `rally` governs where idle Miners gather, `rally2` where
  // idle Engineers gather (other producers use only `rally`).
  rally2: Vec2 | null = null;
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
  team: number;         // custom-team side (0/1); -1 in classic free-for-all
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
  | { t: "rally"; building: number; x: number; y: number; slot?: number }
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
  | { e: "heal"; from: Vec2; to: Vec2; owner: number; kind: "repair" | "medic" }
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

// Support-unit (Medic / Repair Engineer) combat behaviour tuning.
// SUPPORT_DANGER_R: an ARMED enemy within this many tiles of a spot means a battle is still raging
//   there — a support unit will NOT advance into it (it waits / falls back until the area is quiet).
// SUPPORT_REAR_R: a support unit that is idle (no safe patient) pulls back toward its "home" (the
//   Command Center) and is considered safely in the rear once within this distance, so it stops there
//   instead of crowding the base centre.
const SUPPORT_DANGER_R = 9;
const SUPPORT_REAR_R = 4;

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
      if (t === 1 || t === 2 || t === 4) this.grid.blocked[i] = 1; // cliff, water & wall block ground (T32)
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
      // T32: read the neutral definition so an outpost gets its garrison weapon + larger vision.
      const nd = NEUTRAL_DEFS[type as keyof typeof NEUTRAL_DEFS] ?? NEUTRAL_DEFS.oil_derrick;
      e.maxHp = nd.hp; e.hp = nd.hp; e.vision = nd.vision; e.radius = nd.radius;
      e.owner = NEUTRAL; e.captureOwner = NEUTRAL; e.weaponDef = nd.weapon;
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
    // T31: a starting Engineer (builder) on the field, so the player can build from the first second
    this.spawn("unit", "engineer", owner, spawn.x + 2, spawn.y + 3);
    // hero
    this.spawnHero(owner, spawn.x + 2, spawn.y + 2);
  }

  // Spawn (or assign) a single hero for an owner. Used both by spawnBase and by custom-team mode,
  // where extra teammates get ONLY a hero (the team shares one base — spec: custom team).
  spawnHero(owner: number, x: number, y: number): Entity {
    const hero = this.spawn("unit", "hero", owner, x, y);
    hero.hero = { mana: 100, maxMana: 100, abilities: [{ rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }, { rank: 0, cdUntil: 0 }], burstShots: 0, burstBonus: 0, invulnUntil: 0 };
    const p = this.players[owner];
    if (p) p.heroId = hero.id;
    return hero;
  }

  // Set up all players' starting positions for the chosen game type. Players must already be added
  // (this.players populated, ids 0..n-1). Classic = one full base per player at map.spawns[id].
  // Custom team = each SIDE gets ONE shared base (the team's lowest-id member is the base owner) at
  // a team spawn; every other teammate gets their OWN hero AND their OWN builder Engineer near that
  // base — so a 2v2 fields one HQ/mine per side, one hero per player, and a builder for each player.
  spawnAllBases(gameType: "classic" | "team" = "classic"): void {
    if (gameType !== "team" || !this.players.some((p) => p.team >= 0)) {
      for (let i = 0; i < this.players.length; i++) this.spawnBase(i, this.map.spawns[i] ?? this.map.spawns[0]);
      this.setupNeutrals();
      return;
    }
    // Group members by side, preserving id order so the lowest-id member leads (gets the base).
    const sides = new Map<number, number[]>();
    for (const p of this.players) {
      const t = p.team >= 0 ? p.team : 0;
      if (!sides.has(t)) sides.set(t, []);
      sides.get(t)!.push(p.id);
    }
    const teamIds = [...sides.keys()].sort((a, b) => a - b);
    teamIds.forEach((t, si) => {
      const members = sides.get(t)!;
      const spawn = this.map.spawns[si] ?? this.map.spawns[si % this.map.spawns.length];
      const leader = members[0]; // the side's shared-base owner (holds the CC + the shared economy)
      members.forEach((pid, mi) => {
        if (mi === 0) { this.spawnBase(pid, spawn); return; }   // team leader → full shared base + hero
        // Teammate → their OWN hero, PLUS their OWN builder Engineer. The engineer is owned by the
        // side's base owner (the shared economy), so anything it builds joins the single team base
        // and is charged to the shared wallet — while the teammate still drives it (allies share
        // control, see MatchHost.sanitize). This lets every teammate build, not just the leader.
        this.spawnHero(pid, spawn.x + 2 + mi, spawn.y + 4);
        this.spawn("unit", "engineer", leader, spawn.x + 3 + mi, spawn.y + 4);
      });
    });
    this.setupNeutrals();
  }

  setupNeutrals(): void {
    for (const n of this.map.neutrals) this.spawn("neutral", n.kind, NEUTRAL, n.x, n.y);
  }

  // ---------- helpers ----------
  dist(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
  isEnemy(a: Entity, b: Entity): boolean {
    if (a.owner === b.owner) return false;
    if (b.owner === NEUTRAL) return false;
    // Custom-team mode: players on the same side are allies, not enemies.
    const pa = this.players[a.owner], pb = this.players[b.owner];
    if (pa && pb && pa.team >= 0 && pa.team === pb.team) return false;
    return true;
  }

  // ---------- custom-team shared economy (spec §24) ----------
  // Two owners are on the SAME side (custom-team allies). Classic free-for-all (team < 0) → true only
  // for the same player, so all team-aware paths collapse to the original single-player behaviour.
  sameTeam(a: number, b: number): boolean {
    if (a === b) return true;
    const pa = this.players[a], pb = this.players[b];
    return !!pa && !!pb && pa.team >= 0 && pa.team === pb.team;
  }
  // The id of the player that holds the side's SHARED economy — the "bank". It is the lowest-id member
  // that owns a Command Center, else the lowest-id member of the side. In team mode a whole side pools
  // resources, power, research and brownout into this one player, which is EXACTLY the player the HUD
  // shows every teammate (MatchHost.economyOwner / WorldView.economyOwner resolve identically). So a
  // teammate mining, capturing a derrick/outpost, building or researching all feed/charge the ONE
  // shared balance. In classic (team < 0) the bank is the player itself → every economy path unchanged.
  economyOwnerId(owner: number): number {
    const p = this.players[owner];
    if (!p || !(p.team >= 0)) return owner; // classic / no team (undefined or -1) → the player itself
    let cc = -1, low = -1;
    for (const q of this.players) {
      if (q.team !== p.team) continue;
      if (low < 0 || q.id < low) low = q.id;
    }
    for (const e of this.entities) {
      if (e.dead || e.type !== "command_center") continue;
      const op = this.players[e.owner];
      if (op && op.team === p.team && (cc < 0 || op.id < cc)) cc = op.id;
    }
    return cc >= 0 ? cc : (low >= 0 ? low : owner);
  }
  // The PlayerState that holds the side's shared economy (see economyOwnerId).
  bank(owner: number): PlayerState { return this.players[this.economyOwnerId(owner)] ?? this.players[owner]; }
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
          // T34: support units (Medic / Repair Engineer) never leave the buildable boundary. They
          // ignore any move / attack-move order whose destination lies OUTSIDE it — so selecting the
          // whole army and sending it to battle leaves them at home, healing. A move to a point still
          // inside the boundary is honoured (the player can reposition them within the base).
          if (this.isSupport(e) && !this.insideBuildBoundary(e.owner, { x: cmd.x, y: cmd.y })) continue;
          e.target = null; e.captureTask = null; e.mining = false; e.mineId = null; e.healTargetId = null;
          if (cmd.t === "attackmove") { e.stance = "attackmove"; e.attackMoveTarget = { x: cmd.x, y: cmd.y }; }
          else { e.stance = "aggressive"; e.attackMoveTarget = null; }
          this.setMove(e, cmd.x, cmd.y);
        }
        break;
      }
      case "attack": {
        for (const id of cmd.ids) {
          const e = this.byId.get(id); if (!e || e.kind !== "unit" || e.dead) continue;
          if (this.isSupport(e)) continue; // T34: support units don't go to battle — never attack
          e.target = cmd.target; e.stance = "aggressive"; e.captureTask = null; e.healTargetId = null;
        }
        break;
      }
      case "stop": for (const id of cmd.ids) { const e = this.byId.get(id); if (e) { e.path = []; e.moveTarget = null; e.target = null; e.healTargetId = null; } } break;
      case "hold": for (const id of cmd.ids) { const e = this.byId.get(id); if (e) { e.stance = "hold"; e.path = []; e.moveTarget = null; e.healTargetId = null; } } break;
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
      case "rally": { const b = this.byId.get(cmd.building); if (b) { if (cmd.slot === 1) b.rally2 = { x: cmd.x, y: cmd.y }; else b.rally = { x: cmd.x, y: cmd.y }; } break; }
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
    // Custom-team co-op: a build is charged to AND owned by the side's shared base owner (the bank),
    // so every teammate builds into the ONE team base from the ONE shared balance. (The team-aware
    // client + host.sanitize already coerce this for humans; resolving here too covers AI teammates
    // and any direct issue.) Classic (team < 0) resolves to the player themselves → unchanged.
    const owner = this.economyOwnerId(cmd.owner);
    const p = this.players[owner]; if (!p) return;
    const def = BUILDING_DEFS[cmd.building];
    if (!this.canAfford(p, def.cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, def.cost), kind: "danger", to: owner }); return; }
    if (def.requires && !this.entities.some((e) => this.sameTeam(e.owner, owner) && e.type === def.requires && !e.constructing)) {
      this.events.push({ e: "toast", key: "errors.needBuilding", kind: "danger", params: { b: BUILDING_DEFS[def.requires].nameKey }, to: owner }); return;
    }
    // T30 Part A: the Command Center level gates the build tree (Barracks/Cannon need L2, War
    // Factory/Rocket need L3). Reject authoritatively with a clear toast naming the required level.
    const reqLvl = REQUIRED_BASE_LEVEL[cmd.building] ?? 1;
    if (reqLvl > 1 && this.maxBaseLevel(owner) < reqLvl) {
      this.events.push({ e: "toast", key: "errors.needBaseLevel", kind: "danger", params: { lvl: reqLvl }, to: owner }); return;
    }
    if (!this.placementValid(owner, cmd.building, cmd.x, cmd.y)) {
      this.events.push({ e: "toast", key: "errors.invalidPlacement", kind: "danger", to: owner }); return;
    }
    // T28 Part B: power gate — a power-CONSUMING building cannot be started without spare
    // generation. Count current usage + the demand of the side's already-in-progress consumers,
    // so you cannot queue several builds that would collectively exceed supply. Power PRODUCERS
    // (power_plant, command_center) have def.power >= 0 and are never blocked.
    const demand = def.power < 0 ? -def.power : 0;
    if (demand > 0) {
      let committed = p.powerUse;
      for (const e of this.entities) {
        if (!e.dead && e.kind === "building" && this.sameTeam(e.owner, owner) && e.constructing && e.power < 0) committed += -e.power;
      }
      if (committed + demand > p.powerGen) {
        this.events.push({ e: "toast", key: "errors.needPower", kind: "danger", to: owner }); return;
      }
    }
    this.pay(p, def.cost);
    const b = this.spawn("building", cmd.building, owner, cmd.x, cmd.y);
    b.constructing = true; b.buildTotal = def.buildTime; b.buildProgress = 0; b.hp = Math.max(1, def.hp * 0.1);
    // T31: dispatch the nearest idle ENGINEER (builder) to construct it
    const builder = this.nearestIdleWorker(owner, b.pos);
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
    // build radius (spec §7.3): within BUILD_RADIUS of a building / outpost owned by the side
    // (custom-team co-op: any ally's building anchors construction — a captured outpost is a forward
    // SUB-BASE, T32 Part B3). `sameTeam` is owner-only in classic, so this is unchanged there.
    const near = this.entities.some((e) => this.sameTeam(e.owner, owner) && (e.kind === "building" || e.type === "outpost") && this.dist(e.pos, { x: x + 0.5, y: y + 0.5 }) <= BUILD_RADIUS + e.radius);
    if (!near) return false;
    // iron/gold mines require a matching deposit nearby (spec §6.3)
    if (building === "iron_mine" || building === "gold_mine") {
      const want: ResKind = building === "iron_mine" ? "iron" : "gold";
      const ok = this.map.deposits.some((d) => d.kind === want && Math.hypot(d.x - x, d.y - y) <= 4);
      if (!ok) return false;
    }
    return true;
  }

  // T31: the builder is the ENGINEER (the Miner is mining-only). Find the nearest idle engineer —
  // one not already constructing (buildTask) or capturing (captureTask). Custom-team co-op: ANY
  // ally's idle engineer can raise the shared base (so both friends' builders pitch in).
  nearestIdleWorker(owner: number, pos: Vec2): Entity | null {
    let best: Entity | null = null; let bd = 1e9;
    for (const e of this.entities) {
      if (!this.sameTeam(e.owner, owner) || e.type !== "engineer" || e.dead) continue;
      if (e.buildTask || e.captureTask) continue; // don't pull a busy engineer
      const d = this.dist(e.pos, pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Footprint-aware "is this engineer at the build site?" — true when it stands on a tile adjacent
  // to (or inside) the building's NxN footprint, measured in tile (Chebyshev) distance. Mirrors
  // adjacentToMine: the centre tile is occupied by the rising structure, so the closest tile the
  // engineer can actually reach is a footprint neighbour, which a tight centre-distance test misses.
  private atBuildSite(e: Entity, b: Entity): boolean {
    const fp = b.kind === "building" ? BUILDING_DEFS[b.type as BuildingId].footprint : 3;
    const half = Math.floor(fp / 2);
    const ex = Math.floor(e.pos.x), ey = Math.floor(e.pos.y);
    const bx = Math.floor(b.pos.x), by = Math.floor(b.pos.y);
    const cheb = Math.max(Math.abs(ex - bx), Math.abs(ey - by));
    return cheb <= half + 1;
  }

  // A guaranteed-free tile on the ring just outside a building's footprint — the spot an engineer
  // should stand on to work. Returns the nearest free ring tile (falling back to nearestFree of the
  // centre, then the building centre). Used by the build stuck-recovery to re-route a stalled builder.
  private freeApproachTile(b: Entity): Vec2 | undefined {
    const fp = b.kind === "building" ? BUILDING_DEFS[b.type as BuildingId].footprint : 3;
    const half = Math.floor(fp / 2);
    const bx = Math.floor(b.pos.x), by = Math.floor(b.pos.y);
    const lo = -half - 1, hi = fp - half; // ring one tile outside the footprint
    let best: Vec2 | undefined; let bd = 1e9;
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        if (dx !== lo && dx !== hi && dy !== lo && dy !== hi) continue; // ring only
        const tx = bx + dx, ty = by + dy;
        if (this.grid.isBlocked(tx, ty)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { x: tx, y: ty }; }
      }
    }
    if (best) return best;
    const nf = nearestFree(this.grid, bx, by);
    return nf ? { x: nf.x, y: nf.y } : { x: b.pos.x, y: b.pos.y };
  }

  // T34: a SUPPORT unit (Repair Engineer / Medic) — it carries an auto heal/repair ability, never
  // fights, and is confined to the base's buildable boundary (see insideBuildBoundary).
  isSupport(e: Entity): boolean { return e.kind === "unit" && !!UNIT_DEFS[e.type as UnitId].heal; }

  // T34: the "buildable boundary" — the area within BUILD_RADIUS of any of the owner's buildings (or
  // an owned outpost sub-base). This mirrors the `near` test in placementValid (i.e. exactly where
  // the player may place buildings). Support units stay inside it and only service allies inside it.
  insideBuildBoundary(owner: number, pos: Vec2): boolean {
    return this.entities.some((e) => !e.dead && e.owner === owner && (e.kind === "building" || e.type === "outpost") && this.dist(e.pos, pos) <= BUILD_RADIUS + e.radius);
  }

  // Where a strayed support unit retreats to to get back inside the boundary — the Command Center,
  // or failing that any owned building / outpost.
  private supportHome(owner: number): Vec2 | undefined {
    const cc = this.ownerCC(owner);
    if (cc) return cc.pos;
    const b = this.entities.find((e) => !e.dead && e.owner === owner && (e.kind === "building" || e.type === "outpost"));
    return b ? b.pos : undefined;
  }

  tryTrain(cmd: Extract<Command, { t: "train" }>): void {
    const b = this.byId.get(cmd.building); if (!b || !b.isBuilding || b.constructing) return;
    const p = this.bank(b.owner); if (!p) return;
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
    const p = this.bank(b.owner);
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
    const p = this.bank(b.owner); if (!p) return;
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
    const isRadar = b.type === "radar";
    const isDefense = !!def.weapon && !def.produces && !def.isWall; // guard/cannon/rocket towers
    if (!isCC && !isDefense && !isRadar) return;
    const maxLvl = isCC ? MAX_BASE_LEVEL : isRadar ? MAX_RADAR_LEVEL : MAX_DEFENSE_LEVEL;
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
    const p = this.bank(b.owner); if (!p) return;
    const def = RESEARCH_BY_ID[id]; if (!def) return;
    if (!this.canResearch(p, def)) return;
    if (!this.canAfford(p, def.cost)) { this.events.push({ e: "toast", key: this.shortfallKey(p, def.cost), kind: "danger", to: b.owner }); return; }
    this.pay(p, def.cost);
    b.researching = { id, progress: 0, time: def.time };
  }
  cancelResearch(buildingId: number): void {
    const b = this.byId.get(buildingId); if (!b || b.type !== "research_center" || !b.researching) return;
    const def = RESEARCH_BY_ID[b.researching.id];
    if (def) this.refund(this.bank(b.owner), def.cost, CANCEL_INPROGRESS_REFUND);
    b.researching = null;
  }
  private completeResearch(b: Entity): void {
    if (!b.researching) return;
    const def = RESEARCH_BY_ID[b.researching.id]; b.researching = null;
    if (!def) return;
    const p = this.bank(b.owner); if (!p) return;
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
    const p = this.bank(b.owner);
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
    this.updateNavField();
    this.applyCommands();
    this.economySystem();
    this.productionSystem();
    this.workerSystem();
    this.healSystem();
    this.idleWorkerSystem();
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
      // Custom-team co-op: power is a SHARED grid — every building feeds the side's one bank.
      const p = this.bank(e.owner); if (!p) continue;
      if (e.power > 0) p.powerGen += e.power; else p.powerUse += -e.power;
    }
    // Mirror the (shared) grid onto every member so per-owner reads (towers / production / build
    // gate) and each teammate's HUD see the side's true power state + brownout. In classic the bank
    // is the player itself, so this is a no-op.
    for (const p of this.players) { const b = this.bank(p.id); p.powerGen = b.powerGen; p.powerUse = b.powerUse; p.brownout = (b.powerGen - b.powerUse) < 0; }

    // T30: EVERY mine needs at least one miner working inside it. Silver scales with its miners
    // (up to the canonical slot cap); iron / gold / captured oil produce at their fixed canonical
    // interval while occupied, and NOTHING when empty. `minerSlots` is the live occupancy. All yield
    // is banked to the side's shared economy (this.bank) so a teammate's mines/derricks pay the team.
    for (const e of this.entities) {
      if (e.dead || e.constructing) continue;
      if (e.type === "silver_mine") {
        // T31: one miner works a silver mine → its single-miner rate (no multi-miner scaling).
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / MINER_OUTPUT_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.bank(e.owner).silver += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#c9d1d9" }); }
        }
      } else if (e.type === "iron_mine") {
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / IRON_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.bank(e.owner).iron += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#8c98a4" }); }
        }
      } else if (e.type === "gold_mine") {
        if (e.minerSlots > 0) {
          e.resAccum += TICK_DT / GOLD_INTERVAL;
          while (e.resAccum >= 1) { e.resAccum -= 1; this.bank(e.owner).gold += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#ffd23f" }); }
        }
      } else if (e.type === "oil_derrick" && e.owner !== NEUTRAL) {
        // T33: a CAPTURED oil derrick is a passive income point — it pays out on its own once owned
        // (no miner walks into it). Miners are no longer routed here (see isMineType), so its yield
        // must not be gated on `minerSlots`. Banked to the side so a teammate's derrick pays the team.
        e.resAccum += TICK_DT / OIL_INTERVAL;
        while (e.resAccum >= 1) { e.resAccum -= 1; this.bank(e.owner).silver += 1; this.events.push({ e: "float", pos: e.pos, text: "+1", color: "#c9d1d9" }); }
      }
    }
  }

  // ---------- construction & production (spec §7.3) ----------
  private productionSystem(): void {
    for (const e of this.entities) {
      if (e.kind !== "building" || e.dead) continue;
      if (e.constructing) {
        // T34: ONE engineer builds ONE building. A building advances ONLY while its assigned
        // engineer-builder is actually working at the site — there is NO fallback auto-progress, so
        // a lone engineer must finish one building before the next can rise. If a constructing
        // building has NO assigned builder (its engineer died, or none was free when it was placed),
        // dispatch the nearest idle engineer to it; otherwise it simply waits its turn.
        const builder = this.entities.find((m) => m.type === "engineer" && m.owner === e.owner && !m.dead && m.buildTask && m.buildTask.entId === e.id);
        // "At the site" = within the old euclidean tolerance OR standing on a tile adjacent to the
        // footprint (footprint-aware, like the miner's adjacentToMine). The latter is what fixes the
        // "engineer freezes one tile beside the thing it should build" bug: the build target tile is
        // occupied by the rising structure, so A* can only stop on a free neighbour, which for a 3×3/4×4
        // footprint sits beyond a tight centre-distance check.
        const builderNear = !!builder && (this.dist(builder.pos, e.pos) < e.radius + 1.5 || this.atBuildSite(builder, e));
        if (builderNear) {
          e.buildProgress += (TICK_DT / e.buildTotal);
          e.hp = Math.min(e.maxHp, e.maxHp * (0.1 + 0.9 * e.buildProgress));
          if (builder) builder.buildRetry = 0;
        } else if (!builder) {
          const nb = this.nearestIdleWorker(e.owner, e.pos);
          if (nb) { nb.buildTask = { bid: e.type as BuildingId, pos: { ...e.pos }, entId: e.id }; this.setMove(nb, e.pos.x, e.pos.y); }
        } else if (builder.path.length === 0 && builder.moveTarget == null) {
          // The assigned builder has an empty path but is NOT yet at the site — it idled short (its
          // path ended on a far free tile, it was shoved out by separation, or no path existed at
          // dispatch). Re-route it onto a guaranteed-free tile right beside the footprint so it
          // closes the final gap instead of standing there forever (mirrors the miner stuck-recovery).
          builder.buildRetry++;
          const spot = this.freeApproachTile(e);
          if (spot) this.setMove(builder, spot.x, spot.y);
        }
        if (e.buildProgress >= 1) {
          e.constructing = false; e.buildProgress = 1; e.hp = e.maxHp;
          this.events.push({ e: "toast", key: "toast.buildComplete", kind: "ok", to: e.owner });
          // T31: free the engineer-builder (it idles near the finished building, ready for the next job).
          for (const m of this.entities) if (m.buildTask && m.buildTask.entId === e.id) { m.buildTask = null; m.moveTarget = null; m.path = []; m.buildRetry = 0; }
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
          // Radar's reveal radius grows with its level (it has no weapon — vision IS its upgrade).
          if (e.type === "radar") e.vision = RADAR_VISION[Math.min(RADAR_VISION.length - 1, e.level - 1)];
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
    // A Miner always goes to work a free mine on spawn (the rally "flag" only governs where it idles
    // when there is NO free mine — handled in idleWorkerSystem). The Engineer is routed to its OWN
    // flag (rally2) by idleWorkerSystem. Every other unit honours the building's rally flag: combat
    // units / healers gather there; without a flag they stay put.
    if (unit === "miner") this.autoAssignMiner(u);
    else if (unit === "engineer") { /* idleWorkerSystem routes idle engineers to the engineer flag */ }
    else if (b.rally) this.setMove(u, b.rally.x, b.rally.y);
    this.events.push({ e: "toast", key: "toast.unitReadyNamed", kind: "ok", params: { unit: UNIT_DEFS[unit].nameKey }, to: b.owner });
  }

  // ---------- workers (spec §6.3; T30: miners enter & hide; T31: one miner per mine, idle miners wait) ----------
  private workerSystem(): void {
    for (const e of this.entities) {
      if (e.type !== "miner" || e.dead) continue;
      if (e.mineId != null) {
        const mine = this.byId.get(e.mineId);
        // Drop a stale/invalid claim (mine gone, no longer a mine, no longer ours, or still building)
        // and look for a fresh one instead of freezing on it.
        if (!mine || mine.dead || !isMineType(mine.type) || mine.owner !== e.owner || mine.constructing) {
          e.mineId = null; e.mining = false; e.inMine = false;
          if (!mine || mine.dead) this.autoAssignMiner(e);
          continue;
        }
        if (this.adjacentToMine(e, mine)) {
          if (!e.mining) {
            const cur = this.countMiners(mine.id);
            if (cur < mineSlotCap(mine.type)) {
              // T30 C2/C3: the miner ENTERS the mine — it works inside and disappears from the map.
              e.mining = true; e.inMine = true; e.path = []; e.moveTarget = null; e.mineRetry = 0;
              e.pos = { x: mine.pos.x, y: mine.pos.y };
              mine.minerSlots = cur + 1;
            } else {
              e.mineId = null; this.autoAssignMiner(e); // full → look for another free mine
            }
          }
        } else if (!e.mining && e.path.length === 0 && e.moveTarget == null) {
          // T32 D1: assigned to a mine but idled SHORT of it (its path ended early or was blocked).
          // Re-path; if it genuinely can't be reached after a few tries, RELEASE the stale claim and
          // re-route to another reachable free mine instead of stalling here forever.
          const path = findPath(this.grid, e.pos.x, e.pos.y, mine.pos.x, mine.pos.y);
          e.mineRetry++;
          if (path && e.mineRetry < 6) { e.path = path; e.moveTarget = { x: mine.pos.x, y: mine.pos.y }; }
          else { e.mineId = null; e.mineRetry = 0; this.autoAssignMiner(e); }
        }
      } else if (!e.mining && !e.inMine && e.path.length === 0 && e.moveTarget == null) {
        // T31 B3: an idle, unassigned miner WAITS near the base and auto-enters the next mine that is
        // built or freed (one miner per mine) — no manual micro needed.
        this.autoAssignMiner(e);
      }
    }
    // recount occupancy authoritatively for ALL mine types (capped by the per-type slot count)
    for (const e of this.entities) {
      if (e.dead || !isMineType(e.type)) continue;
      e.minerSlots = Math.min(this.countMiners(e.id), mineSlotCap(e.type));
    }
  }

  // T33: a miner counts as "at" a mine when it stands on a tile ADJACENT to (or inside) the mine's
  // footprint, measured in tile (Chebyshev) distance. The old check compared the euclidean distance
  // to the mine CENTRE against a fixed threshold (radius + 1.2 ≈ 2.7) — but the only free tile a
  // miner could reach is often a DIAGONAL neighbour of a 3×3 mine, whose centre sits ~2.83 tiles from
  // the mine centre. That exceeded the threshold, so the miner halted one tile out and never entered
  // ("standing beside the gold mine"). Footprint-aware tile adjacency fixes that for any mine size.
  private adjacentToMine(e: Entity, mine: Entity): boolean {
    const fp = mine.kind === "building" ? BUILDING_DEFS[mine.type as BuildingId].footprint : 3;
    const half = Math.floor(fp / 2);
    const ex = Math.floor(e.pos.x), ey = Math.floor(e.pos.y);
    const mx = Math.floor(mine.pos.x), my = Math.floor(mine.pos.y);
    const cheb = Math.max(Math.abs(ex - mx), Math.abs(ey - my));
    return cheb <= half + 1;
  }
  countMiners(mineId: number): number {
    let n = 0;
    for (const e of this.entities) if (e.type === "miner" && !e.dead && e.mining && e.mineId === mineId) n++;
    return n;
  }
  // T31: miners that have CLAIMED a mine (walking toward it or already inside) — used so two idle
  // miners assigned together pick two different mines instead of both heading to the nearest one.
  claimedMiners(mineId: number): number {
    let n = 0;
    for (const e of this.entities) if (e.type === "miner" && !e.dead && e.mineId === mineId) n++;
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
    // T30/T31: send an idle miner to an owned, built, free mine (one per mine). "Claimed" counts
    // miners already walking toward / inside a mine, so miners spread out instead of stacking.
    // T32 D1: prefer the nearest REACHABLE free mine — a mine the miner can actually path to — and
    // skip ones it cannot reach (so it never claims an unreachable mine and stalls). If none is
    // provably reachable, fall back to the nearest so it still tries.
    const cands: Entity[] = [];
    for (const e of this.entities) {
      if (!isMineType(e.type) || e.dead || e.owner !== m.owner || e.owner === NEUTRAL || e.constructing) continue;
      if (this.claimedMiners(e.id) >= mineSlotCap(e.type)) continue;
      cands.push(e);
    }
    cands.sort((a, b) => this.dist(a.pos, m.pos) - this.dist(b.pos, m.pos));
    let chosen: Entity | null = null;
    for (const e of cands) {
      if (findPath(this.grid, m.pos.x, m.pos.y, e.pos.x, e.pos.y)) { chosen = e; break; }
    }
    if (!chosen && cands.length) chosen = cands[0]; // none provably reachable → try the nearest anyway
    if (chosen) { m.mineId = chosen.id; m.mining = false; m.inMine = false; m.mineRetry = 0; this.setMove(m, chosen.pos.x, chosen.pos.y); }
  }

  // ---------- support units: auto-heal / auto-repair ----------
  // The owner's primary (built, non-constructing) Command Center — the workers' "home" and the
  // fallback gather point when no rally flag is set.
  private ownerCC(owner: number): Entity | undefined {
    return this.entities.find((e) => e.owner === owner && e.type === "command_center" && !e.dead && !e.constructing);
  }

  // Can support unit `e` (with heal ability `kind`) service target `t`? Only friendly, alive,
  // damaged targets of the right class. "mechanical" → tanks/robots (VehicleHeavy units) + defensive
  // towers/radar (combat or sensor structures); "infantry" → foot soldiers (InfantryLight units that
  // carry a weapon — workers and other support units are excluded).
  private healable(kind: "mechanical" | "infantry", e: Entity, t: Entity): boolean {
    if (t.dead || t.owner !== e.owner || t.id === e.id) return false;
    if (t.hp >= t.maxHp) return false;
    if (t.constructing) return false;
    if (kind === "mechanical") {
      if (t.kind === "unit") return this.armorOf(t) === "VehicleHeavy" && t.type !== "hero";
      if (t.kind === "building") {
        const d = BUILDING_DEFS[t.type as BuildingId];
        return (!!d.weapon && !d.produces && !d.isWall) || t.type === "radar"; // towers + radar
      }
      return false;
    }
    // infantry medic: wounded foot soldiers (light armour + a weapon)
    return t.kind === "unit" && this.armorOf(t) === "InfantryLight" && !!t.weaponDef;
  }

  // Is a battle still raging within `radius` tiles of `pos` (from `e`'s point of view)? True when any
  // living, ARMED enemy (a unit/tower/outpost that carries a weapon) sits within range. Support units
  // (Medic / Repair Engineer) use this to stay OUT of firefights: they never advance toward a spot
  // while it is contested — they only tend the wounded once the area has fallen quiet.
  private combatNear(e: Entity, pos: Vec2, radius: number): boolean {
    for (const o of this.entities) {
      if (o.dead || o.inMine) continue;
      if (!o.weaponDef) continue;           // only things that can actually shoot create danger
      if (!this.isEnemy(e, o)) continue;
      if (this.dist(o.pos, pos) <= radius) return true;
    }
    return false;
  }

  private healSystem(): void {
    for (const e of this.entities) {
      if (e.kind !== "unit" || e.dead) continue;
      const heal = UNIT_DEFS[e.type as UnitId].heal;
      if (!heal) continue;
      if (e.healFxCd > 0) e.healFxCd -= TICK_DT;
      const home = this.supportHome(e.owner);
      // T34: a support unit is leashed to the buildable boundary. If it has strayed outside (chased a
      // patient out, got pushed, or its base shrank), drop the patient and walk back inside before
      // doing anything else — it only heals/repairs allies that have returned inside the boundary.
      if (!this.insideBuildBoundary(e.owner, e.pos)) {
        e.healTargetId = null;
        if (home && e.path.length === 0 && e.moveTarget == null) this.setMove(e, home.x, home.y);
        continue;
      }
      // Combat avoidance: while fighting is happening near the support unit, it must NOT push forward
      // to heal — it drops any patient and falls back toward the rear (its home / Command Center),
      // waiting there until the battle stops. Only once the area is quiet again does it move up to the
      // wounded. (Honours the player's "hold" stance: a held unit waits in place rather than retreating.)
      if (this.combatNear(e, e.pos, SUPPORT_DANGER_R)) {
        e.healTargetId = null;
        if (home && e.stance !== "hold" && e.path.length === 0 && e.moveTarget == null && this.dist(e.pos, home) > SUPPORT_REAR_R) {
          this.setMove(e, home.x, home.y);
        }
        continue;
      }
      // validate / drop the current target (it must still be serviceable, inside the boundary, AND
      // not currently under fire — if a fresh fight breaks out around the patient, abandon it).
      let tgt = e.healTargetId != null ? this.byId.get(e.healTargetId) : undefined;
      if (tgt && (!this.healable(heal.targets, e, tgt) || !this.insideBuildBoundary(e.owner, tgt.pos) || this.combatNear(e, tgt.pos, SUPPORT_DANGER_R))) { tgt = undefined; e.healTargetId = null; }
      // no target → seek the nearest damaged serviceable ally that is OUT of combat (only while idle,
      // so a player move order isn't overridden). With no safe patient to tend, the support unit pulls
      // back to the rear so it isn't loitering on the front line waiting for the next casualty.
      if (!tgt) {
        if (e.path.length === 0 && e.moveTarget == null && e.stance !== "hold") {
          const found = this.nearestHealTarget(e, heal);
          if (found) { e.healTargetId = found.id; this.setMove(e, found.pos.x, found.pos.y); }
          else if (home && this.dist(e.pos, home) > SUPPORT_REAR_R) this.setMove(e, home.x, home.y);
        }
        continue;
      }
      const reach = tgt.radius + e.radius + 1.0;
      const d = this.dist(e.pos, tgt.pos);
      if (d > reach) {
        // walk to the patient (refresh the path if it has run out)
        if (e.path.length === 0) { e.repathTimer -= TICK_DT; if (e.repathTimer <= 0) { this.setMove(e, tgt.pos.x, tgt.pos.y); e.repathTimer = 0.4; } }
        continue;
      }
      // in range → stop and restore HP gradually
      e.path = []; e.moveTarget = null;
      e.facing = Math.atan2(tgt.pos.y - e.pos.y, tgt.pos.x - e.pos.x);
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal.rate * TICK_DT);
      if (e.healFxCd <= 0) {
        this.events.push({ e: "heal", from: { ...e.pos }, to: { ...tgt.pos }, owner: e.owner, kind: heal.targets === "mechanical" ? "repair" : "medic" });
        this.events.push({ e: "float", pos: { x: tgt.pos.x, y: tgt.pos.y - tgt.radius }, text: "+", color: heal.targets === "mechanical" ? "#7ad7ff" : "#34d399" });
        e.healFxCd = 0.25;
      }
      if (tgt.hp >= tgt.maxHp) e.healTargetId = null; // fully restored → seek the next patient (or fall back to the rear)
    }
  }

  private nearestHealTarget(e: Entity, heal: { range: number; targets: "mechanical" | "infantry" }): Entity | undefined {
    let best: Entity | undefined; let bd = heal.range;
    for (const o of this.entities) {
      if (!this.healable(heal.targets, e, o)) continue;
      if (!this.insideBuildBoundary(e.owner, o.pos)) continue; // T34: only patients inside the base boundary
      if (this.combatNear(e, o.pos, SUPPORT_DANGER_R)) continue; // don't run into a firefight — wait for it to end
      const d = this.dist(e.pos, o.pos);
      if (d <= bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------- idle workers: gather at the Command Center's rally "flags" (or near the CC) ----------
  // The Command Center has TWO flags: a Miner with no free mine walks to the MINER flag (`rally`),
  // an Engineer with no build/capture task walks to the ENGINEER flag (`rally2`). With no flag set
  // for that job, the worker loiters around the Command Center.
  private idleWorkerSystem(): void {
    for (const e of this.entities) {
      if (e.dead || e.kind !== "unit") continue;
      if (e.type !== "miner" && e.type !== "engineer") continue;
      if (e.type === "miner" && (e.mining || e.inMine || e.mineId != null)) continue;
      if (e.type === "engineer" && (e.buildTask || e.captureTask)) continue;
      if (e.path.length > 0 || e.moveTarget != null) continue; // already moving / tasked
      const cc = this.ownerCC(e.owner); if (!cc) continue;
      const flag = e.type === "miner" ? cc.rally : cc.rally2;
      const dest = flag ?? cc.pos;
      const arriveR = flag ? 2.5 : cc.radius + 3;
      if (this.dist(e.pos, dest) > arriveR) this.setMove(e, dest.x, dest.y);
    }
  }

  // ---------- movement (spec §8.5) ----------
  // T33: rebuild the navigation SOFT-COST layer from the live unit positions. A STATIONARY unit (one
  // not currently following a path, e.g. holding position, idling, or arrived) stamps a traversal
  // penalty on its tile so other units PATH AROUND it instead of marching straight into it and then
  // shoving each other (the "soldiers jam on the road and can't get through" bug). Moving units are
  // left out (they clear the lane themselves), and the penalty is soft so a unit can still squeeze
  // through a fully-occupied chokepoint when there is genuinely no detour.
  private updateNavField(): void {
    this.grid.clearSoftCost();
    const PENALTY = 4;
    for (const e of this.entities) {
      if (e.kind !== "unit" || e.dead || e.inMine) continue;
      if (e.path.length > 0) continue; // a moving unit is not a standing obstacle
      this.grid.addSoftCost(Math.floor(e.pos.x), Math.floor(e.pos.y), PENALTY);
    }
  }

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
    // T26: Weapons research — attacker's army deals +15% per level (custom-team: the side's shared
    // research, so a teammate's own hero/units benefit from the team's tech, read from the bank).
    const op = this.bank(owner);
    if (op && op.research.weapons) dmg *= 1 + RESEARCH_DAMAGE_PER_LEVEL * op.research.weapons;
    // T26: Armor research — defender's army takes less (effective +15% HP per level).
    const dp = this.bank(tgt.owner);
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
    // hero xp to the owner (each player drives their OWN hero, so xp stays per-player)
    const p = this.players[owner];
    if (p && p.heroId) { const h = this.byId.get(p.heroId); if (h && h.hero) this.gainHeroXp(h, value); }
    // bounty for hero kill → the side's shared balance (custom-team: banked, not the killer's purse)
    if (tgt.hero) { const bk = this.bank(owner); if (bk) { bk.silver += 30; this.events.push({ e: "float", pos: tgt.pos, text: "+30", color: "#ffd23f" }); } }
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
      // T32: both the oil derrick (income) and the outpost (garrisoned sub-base) capture by presence.
      const isDerrick = e.type === "oil_derrick";
      const isOutpost = e.type === "outpost";
      if ((!isDerrick && !isOutpost) || e.dead) continue;
      if (e.bountyCd > 0) e.bountyCd -= TICK_DT;
      const radius = isOutpost ? OUTPOST_CAPTURE_RADIUS : 3;
      const time = isOutpost ? OUTPOST_CAPTURE_TIME : DERRICK_CAPTURE_TIME;
      // presence capture: who has (visible, non-mining) units in radius?
      const owners = new Set<number>();
      for (const u of this.entities) {
        if (u.kind !== "unit" || u.dead || u.inMine) continue;
        if (this.dist(u.pos, e.pos) <= radius) owners.add(u.owner);
      }
      if (owners.size === 1) {
        const o = [...owners][0];
        if (o !== e.owner) {
          e.captureProgress += TICK_DT / time;
          e.captureOwner = o;
          if (e.captureProgress >= 1) {
            e.owner = o; e.captureProgress = 0;
            this.occupy(e, true);
            this.events.push({ e: "capture", pos: e.pos, owner: o });
            const name = isOutpost ? "buildings.outpost.name" : "buildings.oilDerrick.name";
            if (e.bountyCd <= 0) {
              const bounty = isOutpost ? OUTPOST_CAPTURE_BOUNTY : 50;
              // Custom-team co-op: the capture bonus is banked to the SIDE's shared balance, so a
              // teammate (e.g. the 2nd player's hero) capturing a derrick/outpost credits the team.
              this.bank(o).silver += bounty;
              this.events.push({ e: "float", pos: e.pos, text: "+" + bounty, color: "#c9d1d9" });
              e.bountyCd = 30;
            }
            this.events.push({ e: "toast", key: "toast.captured", kind: "ok", params: { name }, to: o });
          }
        }
      } else if (owners.size === 0) {
        e.captureProgress = Math.max(0, e.captureProgress - TICK_DT / time);
      }
      // (Engineer channel capture is handled below via captureTask.)
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
          this.events.push({ e: "toast", key: "toast.captured", kind: "ok", params: { name: tgt.kind === "building" ? BUILDING_DEFS[tgt.type as BuildingId].nameKey : tgt.type === "outpost" ? "buildings.outpost.name" : "buildings.oilDerrick.name" }, to: e.owner });
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
    // A "faction" is a custom-team side (team >= 0) or, in classic, the player alone (their own id).
    // A faction survives only while it still holds a Command Center; when its last CC falls, every
    // member of that faction is eliminated together (so a team shares its base's fate).
    const factionOf = (p: PlayerState): string => (p.team >= 0 ? `t${p.team}` : `p${p.id}`);
    const ccByFaction = new Map<string, boolean>();
    for (const p of this.players) if (!ccByFaction.has(factionOf(p))) ccByFaction.set(factionOf(p), false);
    for (const e of this.entities) {
      if (e.dead || e.type !== "command_center") continue;
      const p = this.players[e.owner]; if (p) ccByFaction.set(factionOf(p), true);
    }
    for (const p of this.players) {
      if (p.defeated) continue;
      if (!ccByFaction.get(factionOf(p))) this.eliminate(p.id);
    }
    const aliveFactions = new Set<string>();
    for (const p of this.players) if (!p.defeated) aliveFactions.add(factionOf(p));
    if (aliveFactions.size <= 1) {
      const alive = this.players.filter((p) => !p.defeated);
      this.winner = alive.length >= 1 ? alive[0].id : -1;
    }
  }

  drainEvents(): GameEvent[] { const ev = this.events; this.events = []; return ev; }
}
