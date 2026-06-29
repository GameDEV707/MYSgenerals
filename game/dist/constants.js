export const TILE = 24; // pixels per tile
export const TICK_HZ = 20; // simulation ticks per second (§3.2)
export const TICK_DT = 1 / TICK_HZ; // seconds per tick (0.05)
export const START_SILVER = 15; // §26.1
export const MINER_OUTPUT_INTERVAL = 10; // seconds per +1 silver, per miner (§26.1)
export const SILVER_MINE_SLOTS = 3; // work slots (§26.1)
export const IRON_INTERVAL = 15; // +1 iron / 15 s
export const GOLD_INTERVAL = 30; // +1 gold / 30 s
export const OIL_INTERVAL = 5; // captured oil derrick: +1 silver / 5 s (§12.1)
export const CC_POWER = 5; // Command Center base power (§6.2)
export const POWER_PLANT_OUTPUT = 10; // §26.1
// Brown-out penalties (§6.4)
export const BROWNOUT_PRODUCTION_MULT = 0.5;
export const BROWNOUT_TOWER_FIRE_MULT = 0.6;
export const BROWNOUT_TOWER_RANGE_MULT = 0.8;
// Refunds (§6.6 / §26.1)
export const SELL_REFUND = 0.5;
export const CANCEL_QUEUED_REFUND = 1.0;
export const CANCEL_INPROGRESS_REFUND = 0.5;
export const BUILD_RADIUS = 8; // tiles from an owned building (§7.3)
export const MAX_QUEUE = 8; // §7.3
// ---- T26: factory upgrades (parallel bays + assembly speed) ----
export const MAX_BAYS = 3; // a producing building can build up to 3 units in parallel
export const MAX_SPEED_LEVEL = 2; // assembly-speed upgrade caps at +50%
export const ASSEMBLY_SPEED_PER_LEVEL = 0.25; // each level adds +25% assembly rate (x1.0/x1.25/x1.5)
// Upgrade costs, indexed by the level being PURCHASED (0 = first step, 1 = second step). The first
// step needs Factory Tech I, the second Factory Tech II (gated on the Research Center, Part C).
export const BAY_UPGRADE_COSTS = [
    { gold: 1, iron: 15, silver: 60 }, // bays 1 -> 2 (requires Factory Tech I)
    { gold: 2, iron: 30, silver: 120 }, // bays 2 -> 3 (requires Factory Tech II)
];
export const SPEED_UPGRADE_COSTS = [
    { iron: 10, silver: 50 }, // speed 0 -> 1, +25% (requires Factory Tech I)
    { gold: 1, iron: 20, silver: 100 }, // speed 1 -> 2, +50% total (requires Factory Tech II)
];
// ---- T26: Research Center global tech ----
export const RESEARCH_DAMAGE_PER_LEVEL = 0.15; // Weapons: +15% outgoing damage / level
export const RESEARCH_ARMOR_PER_LEVEL = 0.15; // Armor: +15% effective HP / level (incoming /1.15)
export const LOGISTICS_BUILD_MULT = 0.8; // Logistics: -20% unit build time
// ---- T28: power status thresholds (pure; shared by the HUD warning + tests) ----
export const LOW_POWER_RATIO = 0.9; // usage ≥ 90% of generation → "low power" warning
// Classify a player's power: "deficit" when usage exceeds generation (brownout / production slow),
// "low" once usage reaches 90% of generation (warning), otherwise "ok".
export function powerStatus(gen, use) {
    if (use > gen)
        return "deficit";
    if (gen > 0 ? use >= LOW_POWER_RATIO * gen : use > 0)
        return "low";
    return "ok";
}
// ---- T30: Command Center leveling + tech-gated build tree (spec §24 → T30 Part A) ----
// Starting balance (tunable in T21). The base starts at Level 1 and can be upgraded twice.
export const MAX_BASE_LEVEL = 3;
// Cost indexed by the level being LEFT (0 = L1→L2, 1 = L2→L3).
export const CC_UPGRADE_COSTS = [
    { silver: 80, iron: 15 }, // L1 → L2
    { gold: 2, silver: 150, iron: 30 }, // L2 → L3
];
// Timed upgrade durations (seconds), same indexing. These are explicit (the CC has no buildTime).
export const CC_UPGRADE_TIMES = [20, 30];
// Minimum Command-Center level required to BUILD each building (default 1 when absent). Barracks +
// Cannon Tower need L2; War Factory + Rocket Tower need L3. Everything else is available at L1.
export const REQUIRED_BASE_LEVEL = {
    barracks: 2, cannon_tower: 2,
    war_factory: 3, rocket_tower: 3,
};
// ---- T30: upgradeable defenses (spec §24 → T30 Part B) ----
export const MAX_DEFENSE_LEVEL = 3; // towers upgrade 1 → 2 → 3
export const DEFENSE_RANGE_PER_LEVEL = 1; // +1 tile range per level above 1
export const DEFENSE_DAMAGE_PER_LEVEL = 0.25; // +25% weapon damage per level above 1
export const DEFENSE_UPGRADE_COST_FRAC = 0.75; // each upgrade ≈ 75% of the base build cost
// Cost of one defense upgrade: 75% of the building's base build cost (rounded), per step.
export function defenseUpgradeCost(base) {
    const scale = (n) => (n ? Math.max(1, Math.round(n * DEFENSE_UPGRADE_COST_FRAC)) : undefined);
    const out = {};
    if (base.silver)
        out.silver = scale(base.silver);
    if (base.iron)
        out.iron = scale(base.iron);
    if (base.gold)
        out.gold = scale(base.gold);
    return out;
}
// The canonical T30 rule: a level upgrade takes HALF the time a comparable build would.
export function upgradeTime(buildTime) { return Math.max(1, Math.ceil(buildTime / 2)); }
// ---- T30: worked-mine economy (spec §24 → T30 Part C) ----
// Work slots per mine type: silver scales with miners up to its canonical cap; iron/gold/oil need
// exactly one miner working inside. A mine with zero occupancy produces nothing.
export function mineSlotCap(type) {
    return type === "silver_mine" ? SILVER_MINE_SLOTS : 1;
}
export function isMineType(type) {
    return type === "silver_mine" || type === "iron_mine" || type === "gold_mine" || type === "oil_derrick";
}
export function mineEta(type, resAccum, minerSlots) {
    const accum = Math.max(0, Math.min(1, resAccum));
    const remain = 1 - accum;
    const occupied = Math.max(0, minerSlots) > 0;
    switch (type) {
        case "silver_mine": {
            const slots = Math.min(Math.max(0, minerSlots), SILVER_MINE_SLOTS);
            if (slots <= 0)
                return { seconds: null, progress: 0, resource: "silver", idle: true };
            const ratePerSec = slots / MINER_OUTPUT_INTERVAL; // +1 every MINER_OUTPUT_INTERVAL per miner
            return { seconds: remain / ratePerSec, progress: accum, resource: "silver", idle: false };
        }
        case "iron_mine":
            if (!occupied)
                return { seconds: null, progress: 0, resource: "iron", idle: true };
            return { seconds: remain * IRON_INTERVAL, progress: accum, resource: "iron", idle: false };
        case "gold_mine":
            if (!occupied)
                return { seconds: null, progress: 0, resource: "gold", idle: true };
            return { seconds: remain * GOLD_INTERVAL, progress: accum, resource: "gold", idle: false };
        case "oil_derrick":
            if (!occupied)
                return { seconds: null, progress: 0, resource: "silver", idle: true };
            return { seconds: remain * OIL_INTERVAL, progress: accum, resource: "silver", idle: false };
        default: return null;
    }
}
// Hero (§9 / §26.1)
export const HERO_MAX_LEVEL = 10;
export const HERO_RESPAWN_BASE = 8; // 8 s + 4 s * level
export const HERO_RESPAWN_PER_LEVEL = 4;
export const HERO_XP_PER_LEVEL = 120; // xp needed grows; base step
export const HERO_PASSIVE_XP = 1; // per second trickle
// Veterancy thresholds (§26.4)
export const VET_THRESHOLDS = [0, 100, 300, 700];
// Deposit reserves (§6.3)
export const DEPOSIT_SILVER = 1500;
export const DEPOSIT_IRON = 800;
export const DEPOSIT_GOLD = 400;
export const SNAPSHOT_SECONDS_LIMIT = 0; // unused (single-process)
