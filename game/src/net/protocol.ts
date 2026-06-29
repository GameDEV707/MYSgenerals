// MYS Generals — network protocol (spec §20.3). Defines the Command / Snapshot / Event
// messages exchanged between clients and the authoritative host. The SAME protocol is used
// for in-process loopback (single-player / split-screen) and WebSocket (LAN), so there is
// exactly one simulation path; only the Transport differs.
import { Command, GameEvent } from "../sim/world.js";

export { Command, GameEvent };

// Snapshot tick rate is 20 Hz (one per sim tick). Clients render ~100 ms in the past and
// interpolate between buffered snapshots (spec §20.4).
export const INTERP_DELAY_MS = 100;

// A command as it travels client → host: tagged with the sender and a monotonically
// increasing clientTick so the host can drop duplicates / out-of-order commands (§20.5).
export interface WireCommand {
  playerId: number;
  clientTick: number;
  cmd: Command;
}

// Compact, fog-filtered per-player view of one entity (spec §15, §20.3).
// Short keys keep snapshots small for phones.
export interface EntitySnap {
  id: number;
  k: "u" | "b" | "n";   // kind: unit / building / neutral
  t: string;            // type id (UnitId | BuildingId | NeutralId)
  o: number;            // owner (-1 neutral)
  x: number; y: number; // position (tiles)
  f: number;            // facing (radians)
  tu: number;           // turret (radians)
  hp: number; mhp: number;
  r: number;            // radius (tiles)
  vis: number;          // vision radius (tiles) — used by the recipient to compute own fog
  rank: number;
  fl: number;           // bit flags: 1 constructing, 2 mining, 4 isVehicle, 8 hasWeapon, 16 hero, 32 stub(last-known)
  bp?: number;          // build progress 0..1 (constructing)
  cp?: number;          // capture progress 0..1 (neutral)
  co?: number;          // capture owner (neutral, contesting color)
  // own-entity-only extras (never leaked for enemies):
  q?: { unit: string; progress: number; time: number }[]; // production queue
  ral?: [number, number];                                  // rally point
  bay?: number;                                            // T26: parallel build bays (producer)
  spd?: number;                                            // T26: assembly-speed level (producer)
  rs?: { id: string; progress: number; time: number };     // T26: active research (research center)
  mn?: { s: number; p: number; res: string; idle: boolean; free: boolean }; // T29: own resource-mine extraction ETA (s = seconds to next +1; idle → s 0, idle true). `free` = has a spare miner slot (no miner inside or walking to it).
  lvl?: number;                                              // T30: building level (CC / defensive tower) — own-entity only, omitted when 1
  up?: { to: number; progress: number; time: number };       // T30: active timed level upgrade
  hero?: { mana: number; maxMana: number; ab: { rank: number; cd: number }[] };
}

export const FL = {
  constructing: 1, mining: 2, vehicle: 4, weapon: 8, hero: 16, stub: 32,
} as const;

export interface PlayerSnap {
  id: number;
  color: string;
  defeated: boolean;
  // full economy only for the recipient ("you"); enemies omit these to avoid leaking.
  silver?: number; iron?: number; gold?: number;
  powerGen?: number; powerUse?: number; brownout?: boolean;
  heroId?: number; heroLevel?: number; heroXp?: number; heroRespawnAt?: number;
  research?: { weapons: number; armor: number; factoryTech: number; logistics: boolean }; // T26 (recipient only)
  unitsBuilt?: number; unitsLost?: number; buildingsDestroyed?: number;
}

export interface BannerSnap { owner: number; x: number; y: number; }
export interface StrikeSnap { owner: number; x: number; y: number; at: number; radius: number; }

export interface Snapshot {
  tick: number;
  time: number;       // host sim time (seconds)
  you: number;        // recipient playerId
  winner: number;     // -2 ongoing, -1 draw, >=0 winner
  players: PlayerSnap[];
  entities: EntitySnap[];
  banners: BannerSnap[];
  strikes: StrikeSnap[];
}

// ---- Lobby protocol (spec §18.3) ----
export type SlotKind = "open" | "closed" | "human" | "ai";
export interface LobbySlot {
  index: number;
  kind: SlotKind;
  name: string;
  color: string;
  hero: number;          // hero id (0 = Commander)
  ready: boolean;
  ai?: "easy" | "normal" | "hard";
  ping?: number;
  token?: string;        // reconnection token (host-side; not broadcast to others)
}

export interface LobbyState {
  roomCode: string;
  map: string;
  slots: LobbySlot[];
  hostUrl: string;
  splitScreen: boolean;  // host runs 2 local players (mouse + touch)
  started: boolean;
  countdown: number;     // seconds remaining (0 = none)
}

// Messages over the wire (WebSocket). Loopback bypasses serialization but uses the same shapes.
export type ClientMsg =
  | { m: "hello"; name: string; token?: string }
  | { m: "cmd"; data: WireCommand }
  | { m: "lobby"; action: LobbyAction }
  | { m: "ping"; t: number };

export type LobbyAction =
  | { a: "setColor"; color: string }
  | { a: "setHero"; hero: number }
  | { a: "ready"; ready: boolean }
  | { a: "setName"; name: string }
  // host-only actions:
  | { a: "setMap"; map: string }
  | { a: "addAI"; diff: "easy" | "normal" | "hard" }
  | { a: "removeSlot"; index: number }
  | { a: "openSlot"; index: number }
  | { a: "closeSlot"; index: number }
  | { a: "kick"; index: number }
  | { a: "setSplit"; on: boolean }
  | { a: "start" };

export type ServerMsg =
  | { m: "welcome"; playerId: number; token: string; you: number }
  | { m: "lobby"; state: LobbyState }
  | { m: "start"; map: string; players: { id: number; color: string; isAI: boolean; aiDiff: "easy" | "normal" | "hard"; hero: number }[]; you: number }
  | { m: "snapshot"; data: Snapshot }
  | { m: "event"; data: GameEvent }
  | { m: "pong"; t: number }
  | { m: "error"; reason: string; key?: string }
  | { m: "hostgone" };
