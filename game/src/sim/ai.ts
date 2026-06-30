// MYS Generals — skirmish AI (spec §22). Plays via the same command pipeline as a human.
import { World, Entity, NEUTRAL } from "./world.js";
import { BUILDING_DEFS, UNIT_DEFS } from "../data.js";
import { BuildingId, UnitId, Vec2 } from "../types.js";
import { CC_UPGRADE_COSTS } from "../constants.js";

export class AIController {
  owner: number;
  world: World;
  decisionTimer = 0;
  attackTimer = 0;
  attacking = false;
  cadence: number;
  armyThreshold: number;
  handicap: number;

  constructor(world: World, owner: number) {
    this.world = world; this.owner = owner;
    const p = world.players[owner];
    const diff = p.aiDiff;
    this.cadence = diff === "hard" ? 0.4 : diff === "normal" ? 0.7 : 1.1;
    this.armyThreshold = diff === "hard" ? 6 : diff === "normal" ? 8 : 11;
    this.handicap = diff === "hard" ? 1 : 0;
  }

  update(dt: number): void {
    const p = this.world.players[this.owner];
    if (p.defeated) return;
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;
    this.decisionTimer = this.cadence;

    this.manageEconomy(p);
    this.manageBuildings(p);
    this.manageProduction(p);
    this.manageMilitary(p);
    this.manageHero(p);
    this.manageCapture(p);
  }

  private owned(type: string): Entity[] {
    return this.world.entities.filter((e) => e.owner === this.owner && e.type === type && !e.dead && !e.constructing);
  }
  private ownedAny(type: string): Entity[] {
    return this.world.entities.filter((e) => e.owner === this.owner && e.type === type && !e.dead);
  }
  private cc(): Entity | undefined { return this.world.entities.find((e) => e.owner === this.owner && e.type === "command_center" && !e.dead); }

  private manageEconomy(p: World["players"][number]): void {
    const cc = this.cc();
    // T31: keep a builder. Train one Engineer when we have none idle/spare (it constructs + captures).
    const engineers = this.ownedAny("engineer");
    const idleEngineer = engineers.some((e) => !e.buildTask && !e.captureTask);
    if (cc && engineers.length === 0 && cc.queue.length === 0 && p.silver >= 20) {
      this.world.issue({ t: "train", building: cc.id, unit: "engineer" });
    } else if (cc && engineers.length < 2 && !idleEngineer && cc.queue.length === 0 && p.silver >= 40) {
      this.world.issue({ t: "train", building: cc.id, unit: "engineer" }); // a second builder when the first is busy
    }
    // T31: keep mines staffed — ONE miner per mine (silver/iron/gold each hold a single miner). The
    // oil derrick is captured income (no miner inside), so it is NOT counted as a miner slot here.
    const miners = this.ownedAny("miner").length;
    const slots = this.owned("silver_mine").length + this.owned("iron_mine").length
      + this.owned("gold_mine").length;
    if (cc && miners < slots + 1 && cc.queue.length === 0 && p.silver >= 5) {
      this.world.issue({ t: "train", building: cc.id, unit: "miner" });
    }
    // assign idle miners to a free mine (one per mine; they wait if none is available)
    for (const m of this.ownedAny("miner")) {
      if (!m.mining && m.mineId == null && m.path.length === 0) {
        this.world.autoAssignMiner(m);
      }
    }
  }

  private manageBuildings(p: World["players"][number]): void {
    const has = (t: BuildingId) => this.owned(t).length > 0;
    const constructing = this.world.entities.some((e) => e.owner === this.owner && e.constructing);
    if (constructing) return; // build one at a time

    // power before brownout
    const powerMargin = p.powerGen - p.powerUse;
    if (powerMargin <= 2 && p.silver >= 30) { this.build("power_plant"); return; }

    if (!has("power_plant") && p.silver >= 30) { this.build("power_plant"); return; }
    // T32: a stronger income engine — saturate to three silver mines early so the AI can actually
    // afford the iron/gold mines that gate the tech tree (previously it stalled at two and never had
    // the silver+gold to reach a Barracks, so it never fielded an army).
    if (this.owned("silver_mine").length < 3 && p.silver >= 15) { this.build("silver_mine"); return; }
    if (!has("iron_mine") && p.silver >= 20) { this.build("iron_mine"); return; }
    if (!has("gold_mine") && p.iron >= 5 && p.silver >= 25) { this.build("gold_mine"); return; }
    // T30: upgrade the Command Center to unlock the tech tree (Barracks/Cannon need L2; War
    // Factory/Rocket need L3). Drive the level up once the economy basics are in place.
    const cc = this.cc();
    const baseLvl = cc ? cc.level : 1;
    if (cc && !cc.upgrading && !cc.dead) {
      const ccAfford = (lvl: number) => this.world.canAfford(p, CC_UPGRADE_COSTS[lvl - 1]);
      if (baseLvl < 2 && has("power_plant") && this.owned("silver_mine").length >= 1 && ccAfford(baseLvl)) {
        this.world.issue({ t: "upgradeBuilding", building: cc.id, kind: "level" }); return;
      }
      if (baseLvl === 2 && has("barracks") && ccAfford(baseLvl)) {
        this.world.issue({ t: "upgradeBuilding", building: cc.id, kind: "level" }); return;
      }
    }
    if (!has("barracks") && baseLvl >= 2 && p.gold >= 1 && p.iron >= 10 && p.silver >= 30) { this.build("barracks"); return; }
    if (!has("war_factory") && baseLvl >= 3 && has("barracks") && p.gold >= 3 && p.iron >= 15 && p.silver >= 70) { this.build("war_factory"); return; }
    if (this.owned("guard_tower").length < 1 && has("barracks") && p.iron >= 8 && p.silver >= 25) { this.build("guard_tower"); return; }
    if (!has("research_center") && has("war_factory") && p.gold >= 2 && p.iron >= 20 && p.silver >= 60) { this.build("research_center"); return; }
    if (this.owned("rocket_tower").length < 1 && baseLvl >= 3 && has("war_factory") && p.gold >= 1 && p.iron >= 18 && p.silver >= 55) { this.build("rocket_tower"); return; }
    // T-feature: an early-warning Radar once the base hits Level 3 (reveals approaching enemies).
    if (!has("radar") && baseLvl >= 3 && p.gold >= 1 && p.iron >= 20 && p.silver >= 50) { this.build("radar"); return; }
    if (this.owned("guard_tower").length < 3 && has("war_factory") && p.iron >= 8 && p.silver >= 25) { this.build("guard_tower"); return; }
    // keep expanding economy when flush
    if (p.silver >= 60 && this.owned("silver_mine").length < 4) { this.build("silver_mine"); return; }
    if (p.powerGen - p.powerUse <= 4 && p.silver >= 30) { this.build("power_plant"); return; }
  }

  private build(b: BuildingId): void {
    const cc = this.cc(); if (!cc) return;
    const spot = this.findSpot(b, cc.pos);
    if (spot) this.world.issue({ t: "build", owner: this.owner, building: b, x: spot.x, y: spot.y });
  }

  private findSpot(b: BuildingId, center: Vec2): Vec2 | null {
    // iron/gold mines must sit on a matching deposit — search around the nearest deposit.
    if (b === "iron_mine" || b === "gold_mine") {
      const want = b === "iron_mine" ? "iron" : "gold";
      const deps = this.world.map.deposits
        .filter((d) => d.kind === want)
        .sort((a, z) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(z.x - center.x, z.y - center.y));
      for (const d of deps) {
        for (let r = 0; r <= 3; r++) for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const x = Math.round(d.x + Math.cos(ang) * r), y = Math.round(d.y + Math.sin(ang) * r);
          if (this.world.placementValid(this.owner, b, x, y)) return { x, y };
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
        if (this.world.placementValid(this.owner, b, x, y)) return { x, y };
      }
    }
    return null;
  }

  private manageProduction(p: World["players"][number]): void {
    const barracks = this.owned("barracks");
    const factory = this.owned("war_factory");
    // see enemy armor? add counters
    for (const b of barracks) {
      if (b.queue.length >= 2) continue;
      const r = Math.random();
      // mostly combat units, with an occasional Medic / Repair Engineer for sustain.
      let u: UnitId = r < 0.45 ? "infantry" : r < 0.7 ? "rocket_soldier" : r < 0.85 ? "robot" : r < 0.93 ? "medic" : "repair_engineer";
      const ud = UNIT_DEFS[u];
      if (this.world.canAfford(p, ud.cost)) this.world.issue({ t: "train", building: b.id, unit: u });
    }
    for (const f of factory) {
      if (f.queue.length >= 2) continue;
      const r = Math.random();
      let u: UnitId = r < 0.4 ? "light_tank" : r < 0.65 ? "heavy_tank" : r < 0.8 ? "anti_air" : r < 0.9 ? "rocket_launcher" : "artillery";
      const ud = UNIT_DEFS[u];
      if (this.world.canAfford(p, ud.cost)) this.world.issue({ t: "train", building: f.id, unit: u });
    }
  }

  private army(): Entity[] {
    return this.world.entities.filter((e) => e.owner === this.owner && e.kind === "unit" && !e.dead && !!e.weaponDef && e.type !== "hero" && e.type !== "engineer");
  }

  private manageMilitary(p: World["players"][number]): void {
    const army = this.army();
    const enemyCC = this.world.entities.find((e) => e.owner !== this.owner && e.owner !== NEUTRAL && e.type === "command_center" && !e.dead);
    if (!enemyCC) return;

    // defend: if enemy near our CC, rally army home
    const cc = this.cc();
    if (cc) {
      const threat = this.world.entities.find((e) => e.owner !== this.owner && e.owner !== NEUTRAL && e.kind === "unit" && !e.dead && this.world.dist(e.pos, cc.pos) < 12);
      if (threat) {
        const ids = army.map((a) => a.id);
        if (ids.length) this.world.issue({ t: "attackmove", ids, x: threat.pos.x, y: threat.pos.y });
        this.attacking = false;
        return;
      }
    }

    if (!this.attacking && army.length >= this.armyThreshold) {
      this.attacking = true;
      const ids = army.map((a) => a.id);
      this.world.issue({ t: "attackmove", ids, x: enemyCC.pos.x, y: enemyCC.pos.y });
    } else if (this.attacking) {
      if (army.length <= 2) this.attacking = false;
      else {
        // keep pressing
        const idle = army.filter((a) => a.path.length === 0 && a.target == null);
        if (idle.length) this.world.issue({ t: "attackmove", ids: idle.map((a) => a.id), x: enemyCC.pos.x, y: enemyCC.pos.y });
      }
    }
  }

  private manageHero(p: World["players"][number]): void {
    const hero = p.heroId ? this.world.byId.get(p.heroId) : undefined;
    if (!hero || hero.dead || !hero.hero) return;
    // find a juicy enemy cluster
    let best: Entity | undefined; let bd = 1e9;
    for (const e of this.world.entities) {
      if (e.owner === this.owner || e.owner === NEUTRAL || e.dead || e.kind !== "unit") continue;
      const d = this.world.dist(e.pos, hero.pos); if (d < bd) { bd = d; best = e; }
    }
    if (best && bd < 14) {
      // cast ultimate or E on cluster
      if (hero.hero.abilities[3].rank > 0 && hero.hero.mana >= 120) {
        this.world.issue({ t: "ability", hero: hero.id, slot: 3, x: best.pos.x, y: best.pos.y });
      } else if (hero.hero.abilities[0].rank > 0 && hero.hero.mana >= 40) {
        this.world.issue({ t: "ability", hero: hero.id, slot: 0, x: hero.pos.x, y: hero.pos.y });
      }
      if (bd > 5) this.world.issue({ t: "attack", ids: [hero.id], target: best.id });
    } else {
      // stick near the army center
      const army = this.army();
      if (army.length && hero.path.length === 0) {
        const cxy = army.reduce((s, a) => ({ x: s.x + a.pos.x, y: s.y + a.pos.y }), { x: 0, y: 0 });
        this.world.issue({ t: "move", ids: [hero.id], x: cxy.x / army.length, y: cxy.y / army.length });
      }
    }
  }

  private manageCapture(p: World["players"][number]): void {
    const cc = this.cc(); if (!cc) return;
    const farLimit = this.world.map.w * 0.6;
    const derricks = this.world.entities.filter((e) => e.type === "oil_derrick" && e.owner !== this.owner && !e.dead);
    const outposts = this.world.entities.filter((e) => e.type === "outpost" && e.owner !== this.owner && !e.dead);

    // T32: EARLY economy boost — grab the nearest neutral oil derrick with the idle hero (presence
    // capture; a derrick pays +1 silver / 5 s, which meaningfully accelerates the tech chain). Only
    // when we own no derrick yet and it isn't suicidally far across the map.
    const ownsDerrick = this.world.entities.some((e) => e.type === "oil_derrick" && e.owner === this.owner && !e.dead);
    const hero = p.heroId ? this.world.byId.get(p.heroId) : undefined;
    if (!ownsDerrick && derricks.length && hero && !hero.dead) {
      const d = derricks.slice().sort((a, b) => this.world.dist(a.pos, cc.pos) - this.world.dist(b.pos, cc.pos))[0];
      if (this.world.dist(d.pos, cc.pos) < farLimit && hero.path.length === 0 && hero.target == null && this.world.dist(hero.pos, d.pos) > 2.5) {
        this.world.issue({ t: "move", ids: [hero.id], x: d.pos.x, y: d.pos.y });
      }
    }

    // Army squad contests the capturable sub-bases. Prefer an OUTPOST (forward base + defense) over a
    // derrick, nearest first. Peel a small idle squad — but only when we're not committed to an
    // all-out attack (avoids army thrash).
    if (this.attacking) return;
    const targets = [...outposts, ...derricks];
    if (!targets.length) return;
    targets.sort((a, b) => {
      const pa = a.type === "outpost" ? 0 : 1, pb = b.type === "outpost" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return this.world.dist(a.pos, cc.pos) - this.world.dist(b.pos, cc.pos);
    });
    const tgt = targets[0];
    const army = this.army();
    if (army.length >= Math.max(3, this.armyThreshold - 2)) {
      const squad = army.filter((a) => a.path.length === 0 && a.target == null).slice(0, 3);
      if (squad.length) this.world.issue({ t: "attackmove", ids: squad.map((a) => a.id), x: tgt.pos.x, y: tgt.pos.y });
    }
  }
}
