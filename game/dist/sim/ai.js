// MYS Generals — skirmish AI (spec §22). Plays via the same command pipeline as a human.
import { NEUTRAL } from "./world.js";
import { UNIT_DEFS } from "../data.js";
export class AIController {
    constructor(world, owner) {
        this.decisionTimer = 0;
        this.attackTimer = 0;
        this.attacking = false;
        this.world = world;
        this.owner = owner;
        const p = world.players[owner];
        const diff = p.aiDiff;
        this.cadence = diff === "hard" ? 0.4 : diff === "normal" ? 0.7 : 1.1;
        this.armyThreshold = diff === "hard" ? 6 : diff === "normal" ? 8 : 11;
        this.handicap = diff === "hard" ? 1 : 0;
    }
    update(dt) {
        const p = this.world.players[this.owner];
        if (p.defeated)
            return;
        this.decisionTimer -= dt;
        if (this.decisionTimer > 0)
            return;
        this.decisionTimer = this.cadence;
        this.manageEconomy(p);
        this.manageBuildings(p);
        this.manageProduction(p);
        this.manageMilitary(p);
        this.manageHero(p);
        this.manageCapture(p);
    }
    owned(type) {
        return this.world.entities.filter((e) => e.owner === this.owner && e.type === type && !e.dead && !e.constructing);
    }
    ownedAny(type) {
        return this.world.entities.filter((e) => e.owner === this.owner && e.type === type && !e.dead);
    }
    cc() { return this.world.entities.find((e) => e.owner === this.owner && e.type === "command_center" && !e.dead); }
    manageEconomy(p) {
        // keep silver miners saturated: train miners if fewer than 5
        const miners = this.ownedAny("miner").length;
        const cc = this.cc();
        if (cc && miners < 5 && cc.queue.length === 0 && p.silver >= 5) {
            this.world.issue({ t: "train", building: cc.id, unit: "miner" });
        }
        // assign idle miners
        for (const m of this.ownedAny("miner")) {
            if (!m.mining && m.mineId == null && !m.buildTask && m.path.length === 0) {
                this.world.autoAssignMiner(m);
            }
        }
    }
    manageBuildings(p) {
        const has = (t) => this.owned(t).length > 0;
        const constructing = this.world.entities.some((e) => e.owner === this.owner && e.constructing);
        if (constructing)
            return; // build one at a time
        // power before brownout
        const powerMargin = p.powerGen - p.powerUse;
        if (powerMargin <= 2 && p.silver >= 30) {
            this.build("power_plant");
            return;
        }
        if (!has("power_plant") && p.silver >= 30) {
            this.build("power_plant");
            return;
        }
        if (this.owned("silver_mine").length < 2 && p.silver >= 15) {
            this.build("silver_mine");
            return;
        }
        if (!has("iron_mine") && p.silver >= 20) {
            this.build("iron_mine");
            return;
        }
        if (!has("gold_mine") && p.iron >= 5 && p.silver >= 25) {
            this.build("gold_mine");
            return;
        }
        if (!has("barracks") && p.gold >= 1 && p.iron >= 10 && p.silver >= 30) {
            this.build("barracks");
            return;
        }
        if (!has("war_factory") && has("barracks") && p.gold >= 3 && p.iron >= 15 && p.silver >= 70) {
            this.build("war_factory");
            return;
        }
        if (this.owned("guard_tower").length < 1 && has("barracks") && p.iron >= 8 && p.silver >= 25) {
            this.build("guard_tower");
            return;
        }
        if (!has("research_center") && has("war_factory") && p.gold >= 2 && p.iron >= 20 && p.silver >= 60) {
            this.build("research_center");
            return;
        }
        if (this.owned("rocket_tower").length < 1 && has("war_factory") && p.gold >= 1 && p.iron >= 18 && p.silver >= 55) {
            this.build("rocket_tower");
            return;
        }
        if (this.owned("guard_tower").length < 3 && has("war_factory") && p.iron >= 8 && p.silver >= 25) {
            this.build("guard_tower");
            return;
        }
        // keep expanding economy when flush
        if (p.silver >= 60 && this.owned("silver_mine").length < 3) {
            this.build("silver_mine");
            return;
        }
        if (p.powerGen - p.powerUse <= 4 && p.silver >= 30) {
            this.build("power_plant");
            return;
        }
    }
    build(b) {
        const cc = this.cc();
        if (!cc)
            return;
        const spot = this.findSpot(b, cc.pos);
        if (spot)
            this.world.issue({ t: "build", owner: this.owner, building: b, x: spot.x, y: spot.y });
    }
    findSpot(b, center) {
        // iron/gold mines must sit on a matching deposit — search around the nearest deposit.
        if (b === "iron_mine" || b === "gold_mine") {
            const want = b === "iron_mine" ? "iron" : "gold";
            const deps = this.world.map.deposits
                .filter((d) => d.kind === want)
                .sort((a, z) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(z.x - center.x, z.y - center.y));
            for (const d of deps) {
                for (let r = 0; r <= 3; r++)
                    for (let a = 0; a < 12; a++) {
                        const ang = (a / 12) * Math.PI * 2;
                        const x = Math.round(d.x + Math.cos(ang) * r), y = Math.round(d.y + Math.sin(ang) * r);
                        if (this.world.placementValid(this.owner, b, x, y))
                            return { x, y };
                    }
            }
            return null;
        }
        // spiral search around the base for a valid placement
        const cx = Math.floor(center.x), cy = Math.floor(center.y);
        for (let r = 3; r <= 10; r++) {
            for (let a = 0; a < 24; a++) {
                const ang = (a / 24) * Math.PI * 2;
                const x = Math.round(cx + Math.cos(ang) * r);
                const y = Math.round(cy + Math.sin(ang) * r);
                if (this.world.placementValid(this.owner, b, x, y))
                    return { x, y };
            }
        }
        return null;
    }
    manageProduction(p) {
        const barracks = this.owned("barracks");
        const factory = this.owned("war_factory");
        // see enemy armor? add counters
        for (const b of barracks) {
            if (b.queue.length >= 2)
                continue;
            const r = Math.random();
            let u = r < 0.5 ? "infantry" : r < 0.8 ? "rocket_soldier" : "robot";
            const ud = UNIT_DEFS[u];
            if (this.world.canAfford(p, ud.cost))
                this.world.issue({ t: "train", building: b.id, unit: u });
        }
        for (const f of factory) {
            if (f.queue.length >= 2)
                continue;
            const r = Math.random();
            let u = r < 0.4 ? "light_tank" : r < 0.65 ? "heavy_tank" : r < 0.8 ? "anti_air" : r < 0.9 ? "rocket_launcher" : "artillery";
            const ud = UNIT_DEFS[u];
            if (this.world.canAfford(p, ud.cost))
                this.world.issue({ t: "train", building: f.id, unit: u });
        }
    }
    army() {
        return this.world.entities.filter((e) => e.owner === this.owner && e.kind === "unit" && !e.dead && !!e.weaponDef && e.type !== "hero" && e.type !== "engineer");
    }
    manageMilitary(p) {
        const army = this.army();
        const enemyCC = this.world.entities.find((e) => e.owner !== this.owner && e.owner !== NEUTRAL && e.type === "command_center" && !e.dead);
        if (!enemyCC)
            return;
        // defend: if enemy near our CC, rally army home
        const cc = this.cc();
        if (cc) {
            const threat = this.world.entities.find((e) => e.owner !== this.owner && e.owner !== NEUTRAL && e.kind === "unit" && !e.dead && this.world.dist(e.pos, cc.pos) < 12);
            if (threat) {
                const ids = army.map((a) => a.id);
                if (ids.length)
                    this.world.issue({ t: "attackmove", ids, x: threat.pos.x, y: threat.pos.y });
                this.attacking = false;
                return;
            }
        }
        if (!this.attacking && army.length >= this.armyThreshold) {
            this.attacking = true;
            const ids = army.map((a) => a.id);
            this.world.issue({ t: "attackmove", ids, x: enemyCC.pos.x, y: enemyCC.pos.y });
        }
        else if (this.attacking) {
            if (army.length <= 2)
                this.attacking = false;
            else {
                // keep pressing
                const idle = army.filter((a) => a.path.length === 0 && a.target == null);
                if (idle.length)
                    this.world.issue({ t: "attackmove", ids: idle.map((a) => a.id), x: enemyCC.pos.x, y: enemyCC.pos.y });
            }
        }
    }
    manageHero(p) {
        const hero = p.heroId ? this.world.byId.get(p.heroId) : undefined;
        if (!hero || hero.dead || !hero.hero)
            return;
        // find a juicy enemy cluster
        let best;
        let bd = 1e9;
        for (const e of this.world.entities) {
            if (e.owner === this.owner || e.owner === NEUTRAL || e.dead || e.kind !== "unit")
                continue;
            const d = this.world.dist(e.pos, hero.pos);
            if (d < bd) {
                bd = d;
                best = e;
            }
        }
        if (best && bd < 14) {
            // cast ultimate or E on cluster
            if (hero.hero.abilities[3].rank > 0 && hero.hero.mana >= 120) {
                this.world.issue({ t: "ability", hero: hero.id, slot: 3, x: best.pos.x, y: best.pos.y });
            }
            else if (hero.hero.abilities[0].rank > 0 && hero.hero.mana >= 40) {
                this.world.issue({ t: "ability", hero: hero.id, slot: 0, x: hero.pos.x, y: hero.pos.y });
            }
            if (bd > 5)
                this.world.issue({ t: "attack", ids: [hero.id], target: best.id });
        }
        else {
            // stick near the army center
            const army = this.army();
            if (army.length && hero.path.length === 0) {
                const cxy = army.reduce((s, a) => ({ x: s.x + a.pos.x, y: s.y + a.pos.y }), { x: 0, y: 0 });
                this.world.issue({ t: "move", ids: [hero.id], x: cxy.x / army.length, y: cxy.y / army.length });
            }
        }
    }
    manageCapture(p) {
        // send a spare engineer/army to nearest neutral derrick occasionally
        const derrick = this.world.entities.find((e) => e.type === "oil_derrick" && e.owner !== this.owner && !e.dead);
        if (!derrick)
            return;
        const army = this.army();
        if (army.length > this.armyThreshold + 2) {
            // peel one unit to capture by presence
            const u = army[0];
            this.world.issue({ t: "move", ids: [u.id], x: derrick.pos.x, y: derrick.pos.y });
        }
    }
}
