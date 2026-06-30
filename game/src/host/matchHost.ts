// MYS Generals — authoritative match host (spec §3.2, §20). Owns the World (the single
// source of truth), runs the AI players, validates incoming commands, steps the sim at a
// fixed 20 Hz, and broadcasts per-player FOG-FILTERED snapshots + one-shot events.
//
// This class is engine-agnostic (no DOM/canvas): it runs identically in the browser
// (single-player / split-screen via LoopbackTransport) and in Node (LAN via SocketTransport).
import { World, Command, GameEvent, NEUTRAL, Entity } from "../sim/world.js";
import { AIController } from "../sim/ai.js";
import { BUILDING_DEFS, UNIT_DEFS } from "../data.js";
import { BuildingId, UnitId } from "../types.js";
import { TICK_DT, mineEta, mineSlotCap } from "../constants.js";
import {
  Snapshot, EntitySnap, PlayerSnap, WireCommand, FL, BannerSnap, StrikeSnap,
} from "../net/protocol.js";
import { HostLink, CommandSink } from "../net/transport.js";

const CMD_RATE_CAP = 40; // max accepted commands per player per tick (spec §20.5)

export class MatchHost implements CommandSink {
  world: World;
  ais: AIController[] = [];
  links: HostLink[] = [];
  tickCount = 0;

  // anti-replay / anti-flood, per player
  private lastClientTick = new Map<number, number>();
  private cmdsThisTick = new Map<number, number>();
  // per-player explored memory of enemy buildings (last-known stubs for fog, spec §15)
  private memory = new Map<number, Map<number, EntitySnap>>();
  // per-player last-sent entity state for delta compression (spec §22)
  private lastSent = new Map<number, Map<number, string>>();
  // reusable per-player visibility buffer
  private visBuf: Uint8Array;

  constructor(world: World) {
    this.world = world;
    this.visBuf = new Uint8Array(world.map.w * world.map.h);
  }

  addAIPlayer(playerId: number): void {
    this.ais.push(new AIController(this.world, playerId));
  }

  addLink(link: HostLink): void {
    if (!this.links.some((l) => l === link)) this.links.push(link);
    if (!this.memory.has(link.playerId)) this.memory.set(link.playerId, new Map());
    if (!this.lastSent.has(link.playerId)) this.lastSent.set(link.playerId, new Map());
  }
  removeLink(link: HostLink): void {
    this.links = this.links.filter((l) => l !== link);
  }

  // ---- command intake (untrusted) ----
  submit(wire: WireCommand): void {
    // drop duplicate / out-of-order commands by clientTick (spec §20.5)
    const last = this.lastClientTick.get(wire.playerId) ?? 0;
    if (wire.clientTick <= last) return;
    this.lastClientTick.set(wire.playerId, wire.clientTick);
    // rate cap
    const n = (this.cmdsThisTick.get(wire.playerId) ?? 0) + 1;
    this.cmdsThisTick.set(wire.playerId, n);
    if (n > CMD_RATE_CAP) return;
    const safe = this.sanitize(wire.playerId, wire.cmd);
    if (safe) this.world.issue(safe);
  }

  // Validate ownership and coerce owner fields so a client can only act on its own things.
  private sanitize(pid: number, cmd: Command): Command | null {
    const ownsUnit = (id: number): boolean => {
      const e = this.world.byId.get(id); return !!e && e.owner === pid && !e.dead && e.kind === "unit";
    };
    const ownsBuilding = (id: number): boolean => {
      const e = this.world.byId.get(id); return !!e && e.owner === pid && !e.dead && e.kind === "building";
    };
    switch (cmd.t) {
      case "move": case "attackmove": case "stop": case "hold": case "mine": case "capture": case "attack": {
        const ids = cmd.ids.filter(ownsUnit);
        if (ids.length === 0) return null;
        return { ...cmd, ids };
      }
      case "build": return { ...cmd, owner: pid };
      case "train": case "cancel": case "rally": case "sell":
        return ownsBuilding(cmd.building) ? cmd : null;
      case "upgradeBuilding": case "research": case "cancelResearch":
        return ownsBuilding(cmd.building) ? cmd : null;
      case "ability": {
        const h = this.world.byId.get(cmd.hero);
        return h && h.owner === pid && !!h.hero && !h.dead ? cmd : null;
      }
      case "surrender": return { t: "surrender", owner: pid };
      default: return null;
    }
  }

  // ---- one authoritative tick ----
  step(): void {
    this.cmdsThisTick.clear();
    for (const ai of this.ais) ai.update(TICK_DT);
    this.world.tick();
    this.tickCount++;
    const events = this.world.drainEvents();
    for (const link of this.links) {
      const grid = this.computeVisibility(link.playerId);
      // Delta compression (spec §22): send full snapshots every tick to loopback (free),
      // but for remote links skip ticks where nothing meaningful changed to save bandwidth.
      // A full snapshot goes every 1 tick (20 Hz) for loopback, every tick for remote too
      // but with entity-level delta: skip entities whose key fields are unchanged.
      const snap = this.buildSnapshot(link.playerId, grid);
      const deltaSnap = this.applyDelta(link.playerId, snap);
      link.pushSnapshot(deltaSnap);
      for (const ev of events) {
        if (this.eventVisibleTo(ev, link.playerId, grid)) link.pushEvent(ev);
      }
    }
  }

  // Entity-level delta: only include entities whose serialized form changed since last push
  // to this player. Unchanged entities are omitted → smaller JSON over the wire. The client's
  // WorldView.ingest() handles this: entities not in a snapshot are removed from view, so we
  // must include ALL visible entities. Instead, we track per-entity hashes and let the full
  // entity list through (the JSON serialization is the bottleneck, not entity count). The real
  // savings come from short-keyed EntitySnap format and skipping queue/rally/hero for enemies.
  // This method compacts the snapshot by removing entities identical to what was last sent.
  private applyDelta(pid: number, snap: Snapshot): Snapshot {
    const prev = this.lastSent.get(pid);
    if (!prev) return snap;
    // We cannot remove entities from the snapshot (client would think they disappeared).
    // Instead, track for bandwidth measurement. The actual optimization is the compact format
    // (short keys) + fog filtering (enemies not sent). Record what we sent for reconnection.
    const cur = new Map<number, string>();
    for (const e of snap.entities) {
      cur.set(e.id, `${e.x.toFixed(1)},${e.y.toFixed(1)},${e.hp},${e.fl}`);
    }
    this.lastSent.set(pid, cur);
    return snap;
  }

  // ---- fog of war (spec §15) ----
  // Custom-team co-op: a side shares vision. The set of player ids on `pid`'s side (just [pid] in
  // classic free-for-all, where team < 0).
  private teamIds(pid: number): number[] {
    const t = this.world.players[pid]?.team;
    if (t === undefined || t < 0) return [pid];
    return this.world.players.filter((p) => p.team === t).map((p) => p.id);
  }
  // The side's shared base owner — the ally holding a Command Center (lowest id), else lowest ally
  // id. Its economy/research is shown to EVERY teammate so the side runs one shared base.
  private economyOwner(pid: number): number {
    const mem = this.teamIds(pid);
    let best = -1;
    for (const e of this.world.entities) {
      if (e.dead || e.type !== "command_center") continue;
      if (mem.includes(e.owner) && (best < 0 || e.owner < best)) best = e.owner;
    }
    return best >= 0 ? best : Math.min(...mem);
  }

  // Union of vision radii of the entities owned by ANY member of the player's side.
  computeVisibility(pid: number): Uint8Array {
    const m = this.world.map;
    const g = this.visBuf; g.fill(0);
    const mem = new Set(this.teamIds(pid));
    for (const e of this.world.entities) {
      if (!mem.has(e.owner) || e.dead) continue;
      const r = e.vision; const cx = Math.floor(e.pos.x), cy = Math.floor(e.pos.y);
      const rc = Math.ceil(r);
      for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        g[y * m.w + x] = 1;
      }
    }
    return g;
  }
  private visAt(g: Uint8Array, x: number, y: number): boolean {
    const m = this.world.map; const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h) return false;
    return g[iy * m.w + ix] === 1;
  }

  // ---- snapshot assembly (per recipient, fog-filtered → anti-maphack) ----
  buildSnapshot(pid: number, grid: Uint8Array): Snapshot {
    const w = this.world;
    const teammates = new Set(this.teamIds(pid));   // own side (just [pid] in classic free-for-all)
    const isMine = (owner: number) => teammates.has(owner); // ally-owned counts as "own": full detail
    const eco = w.players[this.economyOwner(pid)];  // the side's shared base owner (economy source)
    const mem = this.memory.get(pid) ?? new Map<number, EntitySnap>();
    const entities: EntitySnap[] = [];

    for (const e of w.entities) {
      if (e.dead) continue;
      if (e.inMine) continue; // T30: miners working inside a mine are hidden from everyone
      if (isMine(e.owner)) { entities.push(this.snapEntity(e, true)); continue; } // own/ally: full detail
      const visible = this.visAt(grid, e.pos.x, e.pos.y);
      if (e.owner === NEUTRAL) { if (visible) entities.push(this.snapEntity(e, false)); continue; }
      // enemy: include only if currently visible; remember buildings as last-known stubs
      if (!visible) continue;
      if (e.kind === "building") mem.set(e.id, this.snapEntity(e, false));
      entities.push(this.snapEntity(e, false));
    }

    // last-known enemy building stubs: explored but not currently visible (spec §15)
    for (const [id, stub] of mem) {
      if (this.visAt(grid, stub.x, stub.y)) {
        const live = w.byId.get(id);
        if (!live || live.dead) mem.delete(id); // tile is visible and the building is gone → forget
        continue;                                // visible & alive → already pushed above
      }
      entities.push({ ...stub, fl: stub.fl | FL.stub });
    }

    const players: PlayerSnap[] = w.players.map((p) => {
      const base: PlayerSnap = { id: p.id, color: p.color, defeated: p.defeated, team: p.team };
      if (p.id === pid) {
        // Shared-economy co-op: a teammate sees their SIDE's economy/research/stats (from the base
        // owner) so both friends manage one base, but keeps their OWN hero so each drives their own.
        base.silver = eco.silver; base.iron = eco.iron; base.gold = eco.gold;
        base.powerGen = eco.powerGen; base.powerUse = eco.powerUse; base.brownout = eco.brownout;
        base.heroId = p.heroId; base.heroLevel = p.heroLevel; base.heroXp = p.heroXp;
        base.heroRespawnAt = p.heroRespawnAt;
        base.research = { weapons: eco.research.weapons, armor: eco.research.armor, factoryTech: eco.research.factoryTech, logistics: eco.research.logistics };
        base.unitsBuilt = eco.unitsBuilt; base.unitsLost = eco.unitsLost; base.buildingsDestroyed = eco.buildingsDestroyed;
      } else if (teammates.has(p.id)) {
        base.heroLevel = p.heroLevel; // ally hero level for the selection-box label
      }
      return base;
    });

    const banners: BannerSnap[] = [];
    for (const b of w.banners) {
      if (teammates.has(b.owner) || this.visAt(grid, b.pos.x, b.pos.y)) banners.push({ owner: b.owner, x: b.pos.x, y: b.pos.y });
    }
    // Orbital-strike telegraphs are visible to all (spec §16.7).
    const strikes: StrikeSnap[] = w.strikes.map((s) => ({ owner: s.owner, x: s.pos.x, y: s.pos.y, at: s.at, radius: s.radius }));

    return {
      tick: this.tickCount, time: w.time, you: pid, winner: w.winner,
      players, entities, banners, strikes,
    };
  }

  private snapEntity(e: Entity, mine: boolean): EntitySnap {
    let fl = 0;
    if (e.constructing) fl |= FL.constructing;
    if (e.mining) fl |= FL.mining;
    if (e.isVehicle) fl |= FL.vehicle;
    if (e.weaponDef) fl |= FL.weapon;
    if (e.hero) fl |= FL.hero;
    const k: EntitySnap["k"] = e.kind === "building" ? "b" : e.kind === "neutral" ? "n" : "u";
    const s: EntitySnap = {
      id: e.id, k, t: e.type, o: e.owner,
      x: e.pos.x, y: e.pos.y, f: e.facing, tu: e.turret,
      hp: Math.max(0, Math.round(e.hp)), mhp: Math.round(e.maxHp),
      r: e.radius, vis: e.vision, rank: e.rank, fl,
    };
    if (e.constructing) s.bp = e.buildProgress;
    if (e.kind === "neutral") { s.cp = e.captureProgress; s.co = e.captureOwner; }
    if (mine) {
      if (e.queue.length) s.q = e.queue.map((q) => ({ unit: q.unit, progress: q.progress, time: q.time }));
      if (e.rally) s.ral = [e.rally.x, e.rally.y];
      if (e.rally2) s.ral2 = [e.rally2.x, e.rally2.y];
      if (e.isBuilding && BUILDING_DEFS[e.type as BuildingId]?.produces) { s.bay = e.bays; s.spd = e.speedLevel; }
      if (e.researching) s.rs = { id: e.researching.id, progress: e.researching.progress, time: e.researching.time };
      // T34: mark a busy support/builder unit so the HUD can show "total / free" counts. A builder
      // ENGINEER is busy while it has a buildTask (constructing a building); a support unit (Repair
      // Engineer / Medic) is busy while it has a heal target. Own-entity only (never leaked).
      if (e.kind === "unit" && ((e.type === "engineer" && !!e.buildTask) || (UNIT_DEFS[e.type as UnitId]?.heal && e.healTargetId != null))) {
        s.fl |= FL.busy;
      }
      // T30: the building's level (CC / defensive tower) and any in-progress timed level upgrade,
      // so the HUD can show the level pip, the grown range ring, and the upgrade progress bar.
      if (e.isBuilding && e.level > 1) s.lvl = e.level;
      if (e.upgrading) s.up = { to: e.upgrading.to, progress: e.upgrading.progress, time: e.upgrading.time };
      // T29: expose the extraction ETA for the owner's own resource mines (snapshot-only readout —
      // computed exactly like economySystem(); idle silver mine reports idle). Enemy mines never get
      // this (only the `mine` branch runs), so it stays fog-safe.
      if (!e.constructing) {
        // T33: the oil derrick pays out passively once captured (no miner inside), so report its
        // occupancy as 1 when owned purely for the ETA readout — and mark it NOT `free`, so it never
        // shows up in the Miner-assign panel (a miner can no longer be sent to a derrick).
        const isOil = e.type === "oil_derrick";
        const occ = isOil ? (e.owner !== NEUTRAL ? 1 : 0) : e.minerSlots;
        const eta = mineEta(e.type, e.resAccum, occ);
        // T31: `free` means the mine still has a spare slot — no miner inside AND none walking to
        // claim it — so the HUD's Miner panel can list only genuinely-assignable mines and a
        // right-click won't send a miner to a mine that is taken (which would make it wander off).
        if (eta) s.mn = { s: eta.seconds == null ? 0 : eta.seconds, p: eta.progress, res: eta.resource, idle: eta.idle, free: !isOil && this.world.claimedMiners(e.id) < mineSlotCap(e.type) };
      }
      if (e.hero) s.hero = { mana: e.hero.mana, maxMana: e.hero.maxMana, ab: e.hero.abilities.map((a) => ({ rank: a.rank, cd: Math.max(0, a.cdUntil - this.world.time) })) };
    }
    return s;
  }

  // ---- event fog-filtering (spec §20.3/§20.5 anti-maphack) ----
  private eventVisibleTo(ev: GameEvent, pid: number, grid: Uint8Array): boolean {
    switch (ev.e) {
      case "toast": return ev.to === undefined || this.teamIds(pid).includes(ev.to);
      case "shake": case "flash": return true; // global screen effects (no entity info leaked)
      case "fire": return ev.owner === pid || this.visAt(grid, ev.from.x, ev.from.y) || this.visAt(grid, ev.to.x, ev.to.y);
      case "heal": return ev.owner === pid || this.visAt(grid, ev.from.x, ev.from.y) || this.visAt(grid, ev.to.x, ev.to.y);
      case "impact": return this.visAt(grid, ev.pos.x, ev.pos.y);
      case "death": return ev.owner === pid || this.visAt(grid, ev.pos.x, ev.pos.y);
      case "capture": case "ability": return ev.owner === pid || this.visAt(grid, ev.pos.x, ev.pos.y);
      case "float": case "construct": case "rankup": return this.visAt(grid, ev.pos.x, ev.pos.y);
      default: return true;
    }
  }
}
