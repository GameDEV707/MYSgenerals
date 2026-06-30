import { BUILDING_DEFS } from "../data.js";
import { FL, INTERP_DELAY_MS } from "../net/protocol.js";
export const NEUTRAL = -1;
export class ViewEntity {
    constructor(id) {
        this.kind = "unit";
        this.type = "";
        this.owner = -1;
        this.pos = { x: 0, y: 0 };
        this.facing = 0;
        this.turret = 0;
        this.hp = 1;
        this.maxHp = 1;
        this.radius = 0.4;
        this.vision = 4;
        this.rank = 0;
        this.constructing = false;
        this.mining = false;
        this.isVehicle = false;
        this.hasWeapon = false;
        this.busy = false; // T34: own builder engineer is constructing / own support unit is healing
        this.hero = null;
        this.stub = false; // last-known building (drawn dimmed)
        this.buildProgress = 0;
        this.captureProgress = 0;
        this.captureOwner = NEUTRAL;
        this.queue = [];
        this.rally = null;
        this.rally2 = null; // Command Center's engineer flag
        this.bays = 1; // T26 (own producing buildings)
        this.speedLevel = 0; // T26 (own producing buildings)
        this.researching = null; // T26 (own research center)
        // T29: own resource-mine extraction ETA (own mines only; null otherwise). seconds = null when idle.
        this.mineEta = null;
        // T30: building level (CC / defensive tower) and any in-progress timed level upgrade (own only).
        this.level = 1;
        this.upgrading = null;
        this.hitFlash = 0;
        this.dead = false; // always false in the view (snapshots omit dead entities)
        this.id = id;
    }
}
function angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI)
        d -= Math.PI * 2;
    while (d < -Math.PI)
        d += Math.PI * 2;
    return a + d * t;
}
export class WorldView {
    constructor(map, me, send) {
        this.time = 0;
        this.winner = -2;
        this.entities = [];
        this.byId = new Map();
        this.players = [];
        this.banners = [];
        this.strikes = [];
        this.buffer = [];
        this.latest = null;
        this.prevHp = new Map();
        this.flash = new Map();
        this.playMs = -1; // interpolation playhead, in host-ms
        // Interpolation statistics for debugging / adaptive quality
        this.bufferDepth = 0; // current number of buffered snapshots (exposed for HUD/debug)
        this.interpAlpha = 0; // last interpolation alpha (exposed for debug)
        this.snapRate = 0; // measured snapshots per second
        this.snapTimes = []; // wall-clock times of recent ingest() calls for rate calc
        this.map = map;
        this.me = me;
        this.send = send;
        this.blocked = new Uint8Array(map.w * map.h);
    }
    ingest(snap) {
        // detect damage (hp drop) on the authoritative set to trigger hit flashes
        for (const e of snap.entities) {
            const old = this.prevHp.get(e.id);
            if (old !== undefined && e.hp < old - 0.5)
                this.flash.set(e.id, 0.12);
        }
        this.prevHp.clear();
        for (const e of snap.entities)
            this.prevHp.set(e.id, e.hp);
        this.latest = snap;
        this.winner = snap.winner;
        this.buffer.push({ hostMs: snap.time * 1000, snap });
        // Keep buffer bounded: 40 snapshots (2 seconds at 20 Hz) max
        if (this.buffer.length > 40)
            this.buffer.shift();
        // Track snapshot arrival rate for adaptive quality / debug
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        this.snapTimes.push(now);
        while (this.snapTimes.length > 0 && this.snapTimes[0] < now - 2000)
            this.snapTimes.shift();
        this.snapRate = this.snapTimes.length / 2; // per second
    }
    // Called once per render frame: advance the playhead and rebuild entities with interpolated
    // positions (render ~INTERP_DELAY_MS in the past — spec §20.4).
    interpolate(_nowMs, dt) {
        if (!this.latest || this.buffer.length === 0)
            return;
        this.time = this.latest.time;
        this.winner = this.latest.winner;
        this.rebuildPlayers(this.latest);
        this.bufferDepth = this.buffer.length;
        const lastMs = this.buffer[this.buffer.length - 1].hostMs;
        const firstMs = this.buffer[0].hostMs;
        const target = lastMs - INTERP_DELAY_MS;
        if (this.playMs < 0)
            this.playMs = target;
        this.playMs += dt * 1000;
        // Adaptive convergence: gently pull toward target to absorb jitter without pops.
        // A stronger pull (0.15) when buffer is overfull, gentler (0.08) when thin.
        const convergence = this.buffer.length > 20 ? 0.15 : this.buffer.length < 5 ? 0.05 : 0.10;
        this.playMs += (target - this.playMs) * convergence;
        // Hard clamp: never read ahead of latest or behind the buffer start
        if (this.playMs > lastMs)
            this.playMs = lastMs;
        if (this.playMs < firstMs)
            this.playMs = firstMs;
        const renderTime = this.playMs;
        let a = null, b = null;
        for (let i = 0; i < this.buffer.length; i++) {
            if (this.buffer[i].hostMs <= renderTime)
                a = this.buffer[i];
            if (this.buffer[i].hostMs >= renderTime) {
                b = this.buffer[i];
                break;
            }
        }
        const to = b ? b.snap : this.latest; // authoritative "current" set (discrete fields)
        const from = a ? a.snap : to;
        let alpha = 0;
        const am = a ? a.hostMs : 0, bm = b ? b.hostMs : 0;
        if (a && b && bm > am)
            alpha = (renderTime - am) / (bm - am);
        alpha = Math.max(0, Math.min(1, alpha));
        this.interpAlpha = alpha;
        const fromById = new Map();
        for (const e of from.entities)
            fromById.set(e.id, e);
        const keep = new Set();
        for (const es of to.entities) {
            keep.add(es.id);
            let ve = this.byId.get(es.id);
            if (!ve) {
                ve = new ViewEntity(es.id);
                this.byId.set(es.id, ve);
            }
            this.apply(ve, es);
            const pe = fromById.get(es.id);
            if (pe) {
                ve.pos.x = pe.x + (es.x - pe.x) * alpha;
                ve.pos.y = pe.y + (es.y - pe.y) * alpha;
                ve.facing = angleLerp(pe.f, es.f, alpha);
                ve.turret = angleLerp(pe.tu, es.tu, alpha);
            }
            else {
                ve.pos.x = es.x;
                ve.pos.y = es.y;
                ve.facing = es.f;
                ve.turret = es.tu;
            }
            // hit flash (client-derived)
            const f = this.flash.get(es.id);
            if (f !== undefined) {
                ve.hitFlash = f;
                const nf = f - dt;
                if (nf <= 0)
                    this.flash.delete(es.id);
                else
                    this.flash.set(es.id, nf);
            }
            else
                ve.hitFlash = 0;
        }
        // remove entities no longer present
        for (const id of [...this.byId.keys()])
            if (!keep.has(id))
                this.byId.delete(id);
        this.entities = [...this.byId.values()];
        this.banners = to.banners.map((b2) => ({ owner: b2.owner, pos: { x: b2.x, y: b2.y } }));
        this.strikes = to.strikes.map((s) => ({ owner: s.owner, pos: { x: s.x, y: s.y }, at: s.at, radius: s.radius }));
    }
    apply(ve, es) {
        ve.kind = es.k === "b" ? "building" : es.k === "n" ? "neutral" : "unit";
        ve.type = es.t;
        ve.owner = es.o;
        ve.hp = es.hp;
        ve.maxHp = es.mhp;
        ve.radius = es.r;
        ve.vision = es.vis;
        ve.rank = es.rank;
        ve.constructing = (es.fl & FL.constructing) !== 0;
        ve.mining = (es.fl & FL.mining) !== 0;
        ve.isVehicle = (es.fl & FL.vehicle) !== 0;
        ve.hasWeapon = (es.fl & FL.weapon) !== 0;
        ve.busy = (es.fl & FL.busy) !== 0;
        ve.stub = (es.fl & FL.stub) !== 0;
        ve.buildProgress = es.bp ?? (ve.constructing ? 0 : 1);
        ve.captureProgress = es.cp ?? 0;
        ve.captureOwner = es.co ?? NEUTRAL;
        ve.queue = es.q ?? [];
        ve.rally = es.ral ? { x: es.ral[0], y: es.ral[1] } : null;
        ve.rally2 = es.ral2 ? { x: es.ral2[0], y: es.ral2[1] } : null;
        ve.bays = es.bay ?? 1;
        ve.speedLevel = es.spd ?? 0;
        ve.researching = es.rs ? { id: es.rs.id, progress: es.rs.progress, time: es.rs.time } : null;
        ve.mineEta = es.mn ? { seconds: es.mn.idle ? null : es.mn.s, progress: es.mn.p, resource: es.mn.res, idle: es.mn.idle, free: es.mn.free ?? true } : null;
        ve.level = es.lvl ?? 1;
        ve.upgrading = es.up ? { to: es.up.to, progress: es.up.progress, time: es.up.time } : null;
        if (es.hero) {
            ve.hero = { mana: es.hero.mana, maxMana: es.hero.maxMana, abilities: es.hero.ab.map((a) => ({ rank: a.rank, cdUntil: this.time + a.cd })) };
        }
        else
            ve.hero = null;
    }
    rebuildPlayers(snap) {
        for (const ps of snap.players) {
            let pv = this.players[ps.id];
            if (!pv) {
                pv = { id: ps.id, color: ps.color, defeated: false, team: ps.team ?? -1, silver: 0, iron: 0, gold: 0, powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0, research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false }, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0 };
                this.players[ps.id] = pv;
            }
            pv.color = ps.color;
            pv.defeated = ps.defeated;
            pv.team = ps.team ?? -1;
            if (ps.id === snap.you) {
                pv.silver = ps.silver;
                pv.iron = ps.iron;
                pv.gold = ps.gold;
                pv.powerGen = ps.powerGen;
                pv.powerUse = ps.powerUse;
                pv.brownout = ps.brownout;
                pv.heroId = ps.heroId;
                pv.heroLevel = ps.heroLevel;
                pv.heroXp = ps.heroXp;
                pv.heroRespawnAt = ps.heroRespawnAt;
                if (ps.research)
                    pv.research = ps.research;
                pv.unitsBuilt = ps.unitsBuilt;
                pv.unitsLost = ps.unitsLost;
                pv.buildingsDestroyed = ps.buildingsDestroyed;
            }
        }
    }
    // ---- cosmetic placement preview (host does the authoritative check) ----
    placementValid(_owner, building, x, y) {
        const m = this.map;
        this.blocked.fill(0);
        for (let i = 0; i < m.terrain.length; i++) {
            const t = m.terrain[i];
            if (t === 1 || t === 2 || t === 4)
                this.blocked[i] = 1;
        }
        let nearOwn = false;
        for (const e of this.entities) {
            // T32: buildings AND owned outposts (forward sub-bases) block tiles + anchor construction.
            const isBuilding = e.kind === "building";
            const isOutpost = e.type === "outpost";
            if (!isBuilding && !isOutpost)
                continue;
            const fp = BUILDING_DEFS[e.type]?.footprint ?? 3;
            const half = Math.floor(fp / 2);
            const cx = Math.floor(e.pos.x), cy = Math.floor(e.pos.y);
            for (let dy = -half; dy < fp - half; dy++)
                for (let dx = -half; dx < fp - half; dx++) {
                    const tx = cx + dx, ty = cy + dy;
                    if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h)
                        this.blocked[ty * m.w + tx] = 1;
                }
            if (e.owner === this.me && (isBuilding || isOutpost) && Math.hypot(e.pos.x - (x + 0.5), e.pos.y - (y + 0.5)) <= 8 + e.radius)
                nearOwn = true;
        }
        const fp = BUILDING_DEFS[building].footprint, half = Math.floor(fp / 2);
        for (let dy = -half; dy < fp - half; dy++)
            for (let dx = -half; dx < fp - half; dx++) {
                const tx = x + dx, ty = y + dy;
                if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h)
                    return false;
                const t = m.terrain[ty * m.w + tx];
                if (t !== 0 && t !== 3)
                    return false;
                if (this.blocked[ty * m.w + tx])
                    return false;
            }
        if (!nearOwn)
            return false;
        if (building === "iron_mine" || building === "gold_mine") {
            const want = building === "iron_mine" ? "iron" : "gold";
            if (!m.deposits.some((d) => d.kind === want && Math.hypot(d.x - x, d.y - y) <= 4))
                return false;
        }
        return true;
    }
    playerColor(owner) {
        if (owner === NEUTRAL)
            return "#9aa4ad";
        return this.players[owner]?.color ?? "#888";
    }
}
