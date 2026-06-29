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
