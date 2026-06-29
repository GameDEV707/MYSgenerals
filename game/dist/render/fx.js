const CAP = { particles: 1400, explosions: 120, texts: 80, decals: 90, tracers: 200, projectiles: 240 };
// Quality-scaled caps (spec §22): phones on Low get significantly fewer simultaneous effects.
const CAPS = {
    low: { particles: 400, explosions: 40, texts: 40, decals: 30, tracers: 80, projectiles: 80 },
    med: { particles: 1400, explosions: 120, texts: 80, decals: 90, tracers: 200, projectiles: 240 },
    high: { particles: 2400, explosions: 200, texts: 120, decals: 150, tracers: 300, projectiles: 400 },
};
export class FxRenderer {
    constructor() {
        this.particles = [];
        this.explosions = [];
        this.muzzles = [];
        this.texts = [];
        this.decals = [];
        this.tracers = [];
        this.pings = [];
        this.projectiles = [];
        this.cmdMarkers = [];
        this.shake = 0;
        this.flash = null;
        this.quality = "med";
        this.reduceMotion = false;
    }
    qScale() { return this.quality === "high" ? 1.4 : this.quality === "low" ? 0.5 : 1; }
    // Cosmetic prediction marker: instant visual at the move/attack target (spec §20.4).
    // Called directly by the input controller before the command even reaches the server.
    addCmdMarker(x, y, kind, color) {
        this.cmdMarkers.push({ x, y, age: 0, color, kind });
        if (this.cmdMarkers.length > 20)
            this.cmdMarkers.shift();
    }
    consume(ev, teamColor) {
        switch (ev.e) {
            case "fire": {
                this.muzzles.push({ x: ev.from.x, y: ev.from.y, angle: Math.atan2(ev.to.y - ev.from.y, ev.to.x - ev.from.x), age: 0 });
                if (ev.kind === "tracer" || ev.speed === 0) {
                    this.tracers.push({ x1: ev.from.x, y1: ev.from.y, x2: ev.to.x, y2: ev.to.y, age: 0, color: ev.owner === 0 ? "#fff2a8" : "#ffd0a8" });
                }
                else {
                    // spawn cosmetic flying projectile(s); salvos ripple + fan out slightly (spec §16.2)
                    const dist = Math.hypot(ev.to.x - ev.from.x, ev.to.y - ev.from.y);
                    const total = ev.speed > 0 ? dist / ev.speed : 0.2;
                    const base = Math.atan2(ev.to.y - ev.from.y, ev.to.x - ev.from.x);
                    for (let s = 0; s < Math.max(1, ev.shots); s++) {
                        const fan = (ev.shots > 1 ? (s - (ev.shots - 1) / 2) * 0.14 : 0);
                        const tox = ev.to.x + Math.cos(base + Math.PI / 2) * fan;
                        const toy = ev.to.y + Math.sin(base + Math.PI / 2) * fan;
                        this.projectiles.push({ kind: ev.kind, x: ev.from.x, y: ev.from.y, fromX: ev.from.x, fromY: ev.from.y, toX: tox, toY: toy, t: -s * ev.shotDelay, total, rot: base, arc: ev.arc, owner: ev.owner });
                    }
                }
                break;
            }
            case "impact":
                this.explode(ev.pos, ev.kind, ev.size);
                break;
            case "death":
                this.death(ev.pos, ev.kind, teamColor(ev.owner));
                break;
            case "float":
                this.texts.push({ x: ev.pos.x, y: ev.pos.y, text: ev.text, color: ev.color, age: 0 });
                break;
            case "construct":
                this.burst(ev.pos, 10, "#c9a87a", 0.6);
                break;
            case "capture":
                this.burst(ev.pos, 24, teamColor(ev.owner), 1.0);
                this.pings.push({ x: ev.pos.x, y: ev.pos.y, age: 0, color: teamColor(ev.owner) });
                break;
            case "rankup":
                this.texts.push({ x: ev.pos.x, y: ev.pos.y, text: "▲", color: "#ffd23f", age: 0 });
                this.burst(ev.pos, 8, "#ffd23f", 0.6);
                break;
            case "shake":
                if (!this.reduceMotion)
                    this.shake = Math.max(this.shake, ev.intensity);
                break;
            case "flash":
                if (!this.reduceMotion)
                    this.flash = { color: ev.color, a: 1 };
                break;
            case "ability":
                this.ability(ev.slot, ev.pos, teamColor(ev.owner));
                break;
            case "toast":
                if (this.onToast)
                    this.onToast(ev.key, ev.kind, ev.params);
                break;
        }
    }
    ability(slot, pos, color) {
        if (slot < 0)
            return; // denied (handled by UI shake)
        if (slot === 1)
            this.burst(pos, 20, "#ffd23f", 1.2); // banner
        else if (slot === 2)
            this.burst(pos, 24, "#cfd8e0", 1.4); // roll shock
        else
            this.burst(pos, 16, color, 1.0);
    }
    explode(pos, kind, size) {
        this.explosions.push({ x: pos.x, y: pos.y, age: 0, life: 0.45 + size * 0.08, size, kind });
        const n = Math.round((kind === "tracer" ? 4 : 14 + size * 8) * this.qScale());
        this.burst(pos, n, kind === "energy" ? "#7ad7ff" : kind === "flame" ? "#ff9a3c" : "#ffb45a", 0.5 + size * 0.3);
        if (size >= 1)
            this.decals.push({ x: pos.x, y: pos.y, age: 0, life: 8, size: size * 0.7 });
        this.capArrays();
    }
    death(pos, kind, color) {
        if (kind === "infantry")
            this.burst(pos, 8, "#b04a3a", 0.5);
        else if (kind === "vehicle") {
            this.explode(pos, "shell", 1.2);
            this.burst(pos, 18, "#444", 1.0);
        }
        else if (kind === "building") {
            this.explode(pos, "artillery", 2.0);
            this.burst(pos, 30, "#777", 1.6);
            this.decals.push({ x: pos.x, y: pos.y, age: 0, life: 12, size: 2 });
        }
        this.capArrays();
    }
    burst(pos, count, color, spread) {
        count = Math.round(count * this.qScale());
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = Math.random() * spread;
            this.particles.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - spread * 0.3, age: 0, life: 0.4 + Math.random() * 0.5, size: 1 + Math.random() * 2.5, color, grav: 1.2 });
        }
    }
    capArrays() {
        const c = CAPS[this.quality];
        if (this.particles.length > c.particles)
            this.particles.splice(0, this.particles.length - c.particles);
        if (this.explosions.length > c.explosions)
            this.explosions.splice(0, this.explosions.length - c.explosions);
        if (this.decals.length > c.decals)
            this.decals.splice(0, this.decals.length - c.decals);
        if (this.texts.length > c.texts)
            this.texts.splice(0, this.texts.length - c.texts);
        if (this.tracers.length > c.tracers)
            this.tracers.splice(0, this.tracers.length - c.tracers);
        if (this.projectiles.length > c.projectiles)
            this.projectiles.splice(0, this.projectiles.length - c.projectiles);
    }
    update(dt) {
        for (const p of this.particles) {
            p.age += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.grav * dt;
        }
        this.particles = this.particles.filter((p) => p.age < p.life);
        // cosmetic projectiles: advance along from→to; trail smoke; recycle on arrival
        for (const pr of this.projectiles) {
            pr.t += dt;
            if (pr.t < 0)
                continue;
            const k = pr.total > 0 ? Math.min(1, pr.t / pr.total) : 1;
            pr.x = pr.fromX + (pr.toX - pr.fromX) * k;
            pr.y = pr.fromY + (pr.toY - pr.fromY) * k;
            pr.rot = Math.atan2(pr.toY - pr.fromY, pr.toX - pr.fromX);
            if ((pr.kind === "rocket" || pr.kind === "flak") && Math.random() < 0.8) {
                this.particles.push({ x: pr.x, y: pr.y, vx: 0, vy: 0, age: 0, life: 0.35, size: 2, color: "#cfcfcf", grav: -0.1 });
            }
        }
        this.projectiles = this.projectiles.filter((pr) => pr.total <= 0 ? pr.t < 0.25 : pr.t < pr.total);
        for (const e of this.explosions)
            e.age += dt;
        this.explosions = this.explosions.filter((e) => e.age < e.life);
        for (const m of this.muzzles)
            m.age += dt;
        this.muzzles = this.muzzles.filter((m) => m.age < 0.07);
        for (const tr of this.tracers)
            tr.age += dt;
        this.tracers = this.tracers.filter((tr) => tr.age < 0.08);
        for (const t of this.texts) {
            t.age += dt;
            t.y -= dt * 0.8;
        }
        this.texts = this.texts.filter((t) => t.age < 0.8);
        for (const d of this.decals)
            d.age += dt;
        this.decals = this.decals.filter((d) => d.age < d.life);
        for (const pg of this.pings)
            pg.age += dt;
        this.pings = this.pings.filter((pg) => pg.age < 1.2);
        for (const cm of this.cmdMarkers)
            cm.age += dt;
        this.cmdMarkers = this.cmdMarkers.filter((cm) => cm.age < 0.6);
        if (this.shake > 0)
            this.shake = Math.max(0, this.shake - dt * 20);
        if (this.flash) {
            this.flash.a -= dt * 2.2;
            if (this.flash.a <= 0)
                this.flash = null;
        }
    }
    shakeOffset() {
        if (this.shake <= 0)
            return { x: 0, y: 0 };
        return { x: (Math.random() - 0.5) * this.shake, y: (Math.random() - 0.5) * this.shake };
    }
    // ground-level effects drawn under entities
    drawGround(ctx, toX, toY, z) {
        // command markers (cosmetic prediction, spec §20.4)
        for (const cm of this.cmdMarkers) {
            const k = cm.age / 0.6;
            const r = z * (0.3 + k * 0.5);
            ctx.globalAlpha = (1 - k) * 0.7;
            ctx.strokeStyle = cm.color;
            ctx.lineWidth = cm.kind === "attack" ? 2.5 : 1.8;
            ctx.beginPath();
            ctx.arc(toX(cm.x), toY(cm.y), r, 0, Math.PI * 2);
            ctx.stroke();
            if (cm.kind === "attack") {
                // cross for attack
                const s = r * 0.4;
                ctx.beginPath();
                ctx.moveTo(toX(cm.x) - s, toY(cm.y) - s);
                ctx.lineTo(toX(cm.x) + s, toY(cm.y) + s);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(toX(cm.x) + s, toY(cm.y) - s);
                ctx.lineTo(toX(cm.x) - s, toY(cm.y) + s);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        // decals
        for (const d of this.decals) {
            const a = (1 - d.age / d.life) * 0.5;
            ctx.fillStyle = `rgba(20,15,12,${a})`;
            ctx.beginPath();
            ctx.ellipse(toX(d.x), toY(d.y), d.size * z, d.size * z * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    // overhead effects drawn above entities
    draw(ctx, toX, toY, z) {
        // tracers
        ctx.lineWidth = 2;
        for (const tr of this.tracers) {
            ctx.strokeStyle = tr.color;
            ctx.globalAlpha = 1 - tr.age / 0.08;
            ctx.beginPath();
            ctx.moveTo(toX(tr.x1), toY(tr.y1));
            ctx.lineTo(toX(tr.x2), toY(tr.y2));
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // muzzle flashes
        for (const m of this.muzzles) {
            const x = toX(m.x), y = toY(m.y);
            ctx.fillStyle = "rgba(255,230,150,0.9)";
            ctx.beginPath();
            ctx.arc(x + Math.cos(m.angle) * z * 0.4, y + Math.sin(m.angle) * z * 0.4, z * 0.22, 0, Math.PI * 2);
            ctx.fill();
        }
        // particles
        for (const p of this.particles) {
            ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
            ctx.fillStyle = p.color;
            ctx.fillRect(toX(p.x) - p.size / 2, toY(p.y) - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
        // cosmetic flying projectiles (spec §16.2) — distinct per weapon type
        for (const p of this.projectiles) {
            if (p.t < 0)
                continue;
            const x = toX(p.x), y = toY(p.y);
            if (p.kind === "rocket" || p.kind === "flak") {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(p.rot);
                ctx.fillStyle = "#ddd";
                ctx.fillRect(-z * 0.2, -z * 0.08, z * 0.4, z * 0.16);
                ctx.fillStyle = "#ff8a3c";
                ctx.fillRect(-z * 0.3, -z * 0.05, z * 0.12, z * 0.1);
                ctx.restore();
            }
            else if (p.kind === "shell") {
                ctx.fillStyle = "#ffd27a";
                ctx.beginPath();
                ctx.arc(x, y, z * 0.1, 0, Math.PI * 2);
                ctx.fill();
            }
            else if (p.kind === "energy") {
                ctx.fillStyle = "#7ad7ff";
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.arc(x, y, z * 0.15, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            else if (p.kind === "artillery") {
                const k = p.total > 0 ? p.t / p.total : 1;
                const h = Math.sin(k * Math.PI) * z * 1.6;
                ctx.fillStyle = "rgba(0,0,0,0.3)";
                ctx.beginPath();
                ctx.ellipse(x, y, z * 0.18, z * 0.1, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#bbb";
                ctx.beginPath();
                ctx.arc(x, y - h, z * 0.12, 0, Math.PI * 2);
                ctx.fill();
            }
            else {
                ctx.fillStyle = "#ffd27a";
                ctx.beginPath();
                ctx.arc(x, y, z * 0.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
        // explosions (expanding rings + glow)
        for (const e of this.explosions) {
            const k = e.age / e.life;
            const r = e.size * z * (0.3 + k * 1.1);
            const x = toX(e.x), y = toY(e.y);
            ctx.globalAlpha = (1 - k) * 0.8;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, "rgba(255,240,180,0.95)");
            grad.addColorStop(0.5, "rgba(255,140,40,0.7)");
            grad.addColorStop(1, "rgba(120,40,10,0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            // shockwave ring
            ctx.globalAlpha = (1 - k) * 0.5;
            ctx.strokeStyle = "rgba(255,255,255,0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, r * 1.1, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // pings
        for (const pg of this.pings) {
            const k = pg.age / 1.2;
            const r = z * (0.5 + k * 2);
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = pg.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(toX(pg.x), toY(pg.y), r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // floating text
        ctx.textAlign = "center";
        ctx.font = `bold ${Math.max(11, z * 0.6)}px Noto Sans, sans-serif`;
        for (const t of this.texts) {
            ctx.globalAlpha = Math.max(0, 1 - t.age / 0.8);
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillText(t.text, toX(t.x) + 1, toY(t.y) + 1);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, toX(t.x), toY(t.y));
        }
        ctx.globalAlpha = 1;
    }
    drawFlash(ctx, w, h) {
        if (!this.flash)
            return;
        ctx.globalAlpha = Math.max(0, this.flash.a);
        ctx.fillStyle = this.flash.color;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
    }
}
