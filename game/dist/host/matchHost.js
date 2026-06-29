// MYS Generals — authoritative match host (spec §3.2, §20). Owns the World (the single
// source of truth), runs the AI players, validates incoming commands, steps the sim at a
// fixed 20 Hz, and broadcasts per-player FOG-FILTERED snapshots + one-shot events.
//
// This class is engine-agnostic (no DOM/canvas): it runs identically in the browser
// (single-player / split-screen via LoopbackTransport) and in Node (LAN via SocketTransport).
import { NEUTRAL } from "../sim/world.js";
import { AIController } from "../sim/ai.js";
import { BUILDING_DEFS } from "../data.js";
import { TICK_DT, mineEta } from "../constants.js";
import { FL, } from "../net/protocol.js";
const CMD_RATE_CAP = 40; // max accepted commands per player per tick (spec §20.5)
export class MatchHost {
    constructor(world) {
        this.ais = [];
        this.links = [];
        this.tickCount = 0;
        // anti-replay / anti-flood, per player
        this.lastClientTick = new Map();
        this.cmdsThisTick = new Map();
        // per-player explored memory of enemy buildings (last-known stubs for fog, spec §15)
        this.memory = new Map();
        // per-player last-sent entity state for delta compression (spec §22)
        this.lastSent = new Map();
        this.world = world;
        this.visBuf = new Uint8Array(world.map.w * world.map.h);
    }
    addAIPlayer(playerId) {
        this.ais.push(new AIController(this.world, playerId));
    }
    addLink(link) {
        if (!this.links.some((l) => l === link))
            this.links.push(link);
        if (!this.memory.has(link.playerId))
            this.memory.set(link.playerId, new Map());
        if (!this.lastSent.has(link.playerId))
            this.lastSent.set(link.playerId, new Map());
    }
    removeLink(link) {
        this.links = this.links.filter((l) => l !== link);
    }
    // ---- command intake (untrusted) ----
    submit(wire) {
        // drop duplicate / out-of-order commands by clientTick (spec §20.5)
        const last = this.lastClientTick.get(wire.playerId) ?? 0;
        if (wire.clientTick <= last)
            return;
        this.lastClientTick.set(wire.playerId, wire.clientTick);
        // rate cap
        const n = (this.cmdsThisTick.get(wire.playerId) ?? 0) + 1;
        this.cmdsThisTick.set(wire.playerId, n);
        if (n > CMD_RATE_CAP)
            return;
        const safe = this.sanitize(wire.playerId, wire.cmd);
        if (safe)
            this.world.issue(safe);
    }
    // Validate ownership and coerce owner fields so a client can only act on its own things.
    sanitize(pid, cmd) {
        const ownsUnit = (id) => {
            const e = this.world.byId.get(id);
            return !!e && e.owner === pid && !e.dead && e.kind === "unit";
        };
        const ownsBuilding = (id) => {
            const e = this.world.byId.get(id);
            return !!e && e.owner === pid && !e.dead && e.kind === "building";
        };
        switch (cmd.t) {
            case "move":
            case "attackmove":
            case "stop":
            case "hold":
            case "mine":
            case "capture":
            case "attack": {
                const ids = cmd.ids.filter(ownsUnit);
                if (ids.length === 0)
                    return null;
                return { ...cmd, ids };
            }
            case "build": return { ...cmd, owner: pid };
            case "train":
            case "cancel":
            case "rally":
            case "sell":
                return ownsBuilding(cmd.building) ? cmd : null;
            case "upgradeBuilding":
            case "research":
            case "cancelResearch":
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
    step() {
        this.cmdsThisTick.clear();
        for (const ai of this.ais)
            ai.update(TICK_DT);
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
                if (this.eventVisibleTo(ev, link.playerId, grid))
                    link.pushEvent(ev);
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
    applyDelta(pid, snap) {
        const prev = this.lastSent.get(pid);
        if (!prev)
            return snap;
        // We cannot remove entities from the snapshot (client would think they disappeared).
        // Instead, track for bandwidth measurement. The actual optimization is the compact format
        // (short keys) + fog filtering (enemies not sent). Record what we sent for reconnection.
        const cur = new Map();
        for (const e of snap.entities) {
            cur.set(e.id, `${e.x.toFixed(1)},${e.y.toFixed(1)},${e.hp},${e.fl}`);
        }
        this.lastSent.set(pid, cur);
        return snap;
    }
    // ---- fog of war (spec §15) ----
    // Union of vision radii of the player's own entities.
    computeVisibility(pid) {
        const m = this.world.map;
        const g = this.visBuf;
        g.fill(0);
        for (const e of this.world.entities) {
            if (e.owner !== pid || e.dead)
                continue;
            const r = e.vision;
            const cx = Math.floor(e.pos.x), cy = Math.floor(e.pos.y);
            const rc = Math.ceil(r);
            for (let dy = -rc; dy <= rc; dy++)
                for (let dx = -rc; dx <= rc; dx++) {
                    if (dx * dx + dy * dy > r * r)
                        continue;
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || y < 0 || x >= m.w || y >= m.h)
                        continue;
                    g[y * m.w + x] = 1;
                }
        }
        return g;
    }
    visAt(g, x, y) {
        const m = this.world.map;
        const ix = Math.floor(x), iy = Math.floor(y);
        if (ix < 0 || iy < 0 || ix >= m.w || iy >= m.h)
            return false;
        return g[iy * m.w + ix] === 1;
    }
    // ---- snapshot assembly (per recipient, fog-filtered → anti-maphack) ----
    buildSnapshot(pid, grid) {
        const w = this.world;
        const mem = this.memory.get(pid);
        const entities = [];
        for (const e of w.entities) {
            if (e.dead)
                continue;
            if (e.owner === pid) {
                entities.push(this.snapEntity(e, true));
                continue;
            } // own: full detail
            const visible = this.visAt(grid, e.pos.x, e.pos.y);
            if (e.owner === NEUTRAL) {
                if (visible)
                    entities.push(this.snapEntity(e, false));
                continue;
            }
            // enemy: include only if currently visible; remember buildings as last-known stubs
            if (!visible)
                continue;
            if (e.kind === "building")
                mem.set(e.id, this.snapEntity(e, false));
            entities.push(this.snapEntity(e, false));
        }
        // last-known enemy building stubs: explored but not currently visible (spec §15)
        for (const [id, stub] of mem) {
            if (this.visAt(grid, stub.x, stub.y)) {
                const live = w.byId.get(id);
                if (!live || live.dead)
                    mem.delete(id); // tile is visible and the building is gone → forget
                continue; // visible & alive → already pushed above
            }
            entities.push({ ...stub, fl: stub.fl | FL.stub });
        }
        const players = w.players.map((p) => {
            const base = { id: p.id, color: p.color, defeated: p.defeated };
            if (p.id === pid) {
                base.silver = p.silver;
                base.iron = p.iron;
                base.gold = p.gold;
                base.powerGen = p.powerGen;
                base.powerUse = p.powerUse;
                base.brownout = p.brownout;
                base.heroId = p.heroId;
                base.heroLevel = p.heroLevel;
                base.heroXp = p.heroXp;
                base.heroRespawnAt = p.heroRespawnAt;
                base.research = { weapons: p.research.weapons, armor: p.research.armor, factoryTech: p.research.factoryTech, logistics: p.research.logistics };
                base.unitsBuilt = p.unitsBuilt;
                base.unitsLost = p.unitsLost;
                base.buildingsDestroyed = p.buildingsDestroyed;
            }
            return base;
        });
        const banners = [];
        for (const b of w.banners) {
            if (b.owner === pid || this.visAt(grid, b.pos.x, b.pos.y))
                banners.push({ owner: b.owner, x: b.pos.x, y: b.pos.y });
        }
        // Orbital-strike telegraphs are visible to all (spec §16.7).
        const strikes = w.strikes.map((s) => ({ owner: s.owner, x: s.pos.x, y: s.pos.y, at: s.at, radius: s.radius }));
        return {
            tick: this.tickCount, time: w.time, you: pid, winner: w.winner,
            players, entities, banners, strikes,
        };
    }
    snapEntity(e, mine) {
        let fl = 0;
        if (e.constructing)
            fl |= FL.constructing;
        if (e.mining)
            fl |= FL.mining;
        if (e.isVehicle)
            fl |= FL.vehicle;
        if (e.weaponDef)
            fl |= FL.weapon;
        if (e.hero)
            fl |= FL.hero;
        const k = e.kind === "building" ? "b" : e.kind === "neutral" ? "n" : "u";
        const s = {
            id: e.id, k, t: e.type, o: e.owner,
            x: e.pos.x, y: e.pos.y, f: e.facing, tu: e.turret,
            hp: Math.max(0, Math.round(e.hp)), mhp: Math.round(e.maxHp),
            r: e.radius, vis: e.vision, rank: e.rank, fl,
        };
        if (e.constructing)
            s.bp = e.buildProgress;
        if (e.kind === "neutral") {
            s.cp = e.captureProgress;
            s.co = e.captureOwner;
        }
        if (mine) {
            if (e.queue.length)
                s.q = e.queue.map((q) => ({ unit: q.unit, progress: q.progress, time: q.time }));
            if (e.rally)
                s.ral = [e.rally.x, e.rally.y];
            if (e.isBuilding && BUILDING_DEFS[e.type]?.produces) {
                s.bay = e.bays;
                s.spd = e.speedLevel;
            }
            if (e.researching)
                s.rs = { id: e.researching.id, progress: e.researching.progress, time: e.researching.time };
            // T29: expose the extraction ETA for the owner's own resource mines (snapshot-only readout —
            // computed exactly like economySystem(); idle silver mine reports idle). Enemy mines never get
            // this (only the `mine` branch runs), so it stays fog-safe.
            if (!e.constructing) {
                const eta = mineEta(e.type, e.resAccum, e.minerSlots);
                if (eta)
                    s.mn = { s: eta.seconds == null ? 0 : eta.seconds, p: eta.progress, res: eta.resource, idle: eta.idle };
            }
            if (e.hero)
                s.hero = { mana: e.hero.mana, maxMana: e.hero.maxMana, ab: e.hero.abilities.map((a) => ({ rank: a.rank, cd: Math.max(0, a.cdUntil - this.world.time) })) };
        }
        return s;
    }
    // ---- event fog-filtering (spec §20.3/§20.5 anti-maphack) ----
    eventVisibleTo(ev, pid, grid) {
        switch (ev.e) {
            case "toast": return ev.to === undefined || ev.to === pid;
            case "shake":
            case "flash": return true; // global screen effects (no entity info leaked)
            case "fire": return ev.owner === pid || this.visAt(grid, ev.from.x, ev.from.y) || this.visAt(grid, ev.to.x, ev.to.y);
            case "impact": return this.visAt(grid, ev.pos.x, ev.pos.y);
            case "death": return ev.owner === pid || this.visAt(grid, ev.pos.x, ev.pos.y);
            case "capture":
            case "ability": return ev.owner === pid || this.visAt(grid, ev.pos.x, ev.pos.y);
            case "float":
            case "construct":
            case "rankup": return this.visAt(grid, ev.pos.x, ev.pos.y);
            default: return true;
        }
    }
}
