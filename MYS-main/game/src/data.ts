// MYS Generals — stat tables (spec §7, §8, §11, §13). Numbers are canonical from the spec.
import { ArmorType, DamageType, UnitDef, BuildingDef, UnitId, BuildingId, NeutralId, Cost } from "./types.js";

// Damage-type x armor-type matrix as multipliers (spec §13.1 / §26.3), percentages -> fractions.
const M: Record<DamageType, Record<ArmorType, number>> = {
  Bullet:    { InfantryLight: 1.00, VehicleHeavy: 0.25, StructureArmored: 0.25, AirLight: 0.50 },
  Cannon:    { InfantryLight: 0.50, VehicleHeavy: 1.00, StructureArmored: 0.75, AirLight: 0.00 },
  Explosive: { InfantryLight: 0.75, VehicleHeavy: 0.75, StructureArmored: 1.50, AirLight: 0.00 },
  Rocket:    { InfantryLight: 0.60, VehicleHeavy: 1.20, StructureArmored: 1.00, AirLight: 1.20 },
  Energy:    { InfantryLight: 1.00, VehicleHeavy: 1.00, StructureArmored: 1.00, AirLight: 1.00 },
  Flame:     { InfantryLight: 1.30, VehicleHeavy: 0.40, StructureArmored: 0.90, AirLight: 0.00 },
};

export function damageMultiplier(dmg: DamageType, armor: ArmorType): number {
  return M[dmg][armor];
}

export const UNIT_DEFS: Record<UnitId, UnitDef> = {
  miner: {
    id: "miner", nameKey: "units.miner.name", hp: 90, armor: "InfantryLight", speed: 2.6,
    vision: 5, cost: { silver: 5 }, buildTime: 12, builtAt: ["command_center", "war_factory"],
    isWorker: true, radius: 0.35, icon: "⛏",
  },
  engineer: {
    id: "engineer", nameKey: "units.engineer.name", hp: 80, armor: "InfantryLight", speed: 2.4,
    vision: 5, cost: { gold: 1, silver: 20 }, buildTime: 18, builtAt: ["barracks"],
    isWorker: true, radius: 0.35, icon: "🔧",
  },
  infantry: {
    id: "infantry", nameKey: "units.infantry.name", hp: 120, armor: "InfantryLight", speed: 2.8,
    vision: 6, cost: { silver: 5 }, buildTime: 20, builtAt: ["barracks"], radius: 0.35, icon: "🪖",
    weapon: { damage: 12, damageType: "Bullet", range: 4, cooldown: 0.8, projectile: "tracer", projectileSpeed: 0, targetsGround: true },
  },
  rocket_soldier: {
    id: "rocket_soldier", nameKey: "units.rocketSoldier.name", hp: 110, armor: "InfantryLight", speed: 2.4,
    vision: 7, cost: { silver: 10 }, buildTime: 30, builtAt: ["barracks"], radius: 0.35, icon: "🚀",
    weapon: { damage: 40, damageType: "Rocket", range: 6, cooldown: 2.0, projectile: "rocket", projectileSpeed: 7, splash: 0.6, targetsGround: true, targetsAir: true },
  },
  robot: {
    id: "robot", nameKey: "units.robot.name", hp: 320, armor: "VehicleHeavy", speed: 2.5,
    vision: 6, cost: { silver: 25 }, buildTime: 25, builtAt: ["barracks"], isVehicle: true, radius: 0.45, icon: "🤖",
    weapon: { damage: 28, damageType: "Energy", range: 5, cooldown: 1.0, projectile: "energy", projectileSpeed: 10, targetsGround: true },
  },
  light_tank: {
    id: "light_tank", nameKey: "units.lightTank.name", hp: 520, armor: "VehicleHeavy", speed: 2.4,
    vision: 6, cost: { iron: 6, silver: 35 }, buildTime: 22, builtAt: ["war_factory"], isVehicle: true, radius: 0.5, icon: "🛡",
    weapon: { damage: 45, damageType: "Cannon", range: 5, cooldown: 1.4, projectile: "shell", projectileSpeed: 12, targetsGround: true },
  },
  heavy_tank: {
    id: "heavy_tank", nameKey: "units.heavyTank.name", hp: 950, armor: "VehicleHeavy", speed: 1.8,
    vision: 6, cost: { gold: 2, iron: 14, silver: 60 }, buildTime: 34, builtAt: ["war_factory"], isVehicle: true, radius: 0.6, icon: "⚙",
    weapon: { damage: 80, damageType: "Cannon", range: 6, cooldown: 1.8, projectile: "shell", projectileSpeed: 11, targetsGround: true },
  },
  artillery: {
    id: "artillery", nameKey: "units.artillery.name", hp: 380, armor: "VehicleHeavy", speed: 1.6,
    vision: 7, cost: { gold: 1, iron: 12, silver: 55 }, buildTime: 30, builtAt: ["war_factory"], isVehicle: true, radius: 0.5, icon: "💥",
    weapon: { damage: 110, damageType: "Explosive", range: 11, minRange: 4, cooldown: 3.2, projectile: "artillery", projectileSpeed: 6, splash: 2.0, targetsGround: true },
  },
  rocket_launcher: {
    id: "rocket_launcher", nameKey: "units.rocketLauncher.name", hp: 360, armor: "VehicleHeavy", speed: 1.9,
    vision: 7, cost: { gold: 2, iron: 16, silver: 65 }, buildTime: 32, builtAt: ["war_factory"], isVehicle: true, radius: 0.5, icon: "🎆",
    weapon: { damage: 30, damageType: "Rocket", range: 8, cooldown: 4.0, projectile: "rocket", projectileSpeed: 7, splash: 1.2, shots: 4, shotDelay: 0.05, targetsGround: true, targetsAir: true },
  },
  anti_air: {
    id: "anti_air", nameKey: "units.antiAir.name", hp: 420, armor: "VehicleHeavy", speed: 2.3,
    vision: 7, cost: { iron: 10, silver: 45 }, buildTime: 24, builtAt: ["war_factory"], isVehicle: true, radius: 0.5, icon: "✈",
    weapon: { damage: 22, damageType: "Rocket", range: 7, cooldown: 1.2, projectile: "flak", projectileSpeed: 14, shots: 2, shotDelay: 0.08, targetsAir: true, targetsGround: true, preferred: "AirLight" },
  },
  hero: {
    id: "hero", nameKey: "units.hero.name", hp: 700, armor: "VehicleHeavy", speed: 3.0,
    vision: 8, cost: {}, buildTime: 0, builtAt: [], radius: 0.45, icon: "★",
    weapon: { damage: 35, damageType: "Bullet", range: 5, cooldown: 0.7, projectile: "tracer", projectileSpeed: 0, targetsGround: true, targetsAir: true },
  },
};

export const BUILDING_DEFS: Record<BuildingId, BuildingDef> = {
  command_center: {
    id: "command_center", nameKey: "buildings.commandCenter.name", hp: 3000, power: 5,
    cost: { silver: 0 }, buildTime: 0, footprint: 4, produces: ["miner"], vision: 9,
    icon: "🏛", category: "economy",
  },
  silver_mine: {
    id: "silver_mine", nameKey: "buildings.silverMine.name", hp: 600, power: -1,
    cost: { silver: 15 }, buildTime: 10, footprint: 3, vision: 4, icon: "⛰", category: "economy",
  },
  iron_mine: {
    id: "iron_mine", nameKey: "buildings.ironMine.name", hp: 700, power: -2,
    cost: { silver: 20 }, buildTime: 12, footprint: 3, vision: 4, icon: "⛓", category: "economy",
  },
  gold_mine: {
    id: "gold_mine", nameKey: "buildings.goldMine.name", hp: 800, power: -2,
    cost: { iron: 5, silver: 25 }, buildTime: 15, footprint: 3, vision: 4, icon: "🏅", category: "economy",
  },
  power_plant: {
    id: "power_plant", nameKey: "buildings.powerPlant.name", hp: 700, power: 10,
    cost: { silver: 30 }, buildTime: 12, footprint: 3, vision: 4, icon: "⚡", category: "economy",
  },
  barracks: {
    id: "barracks", nameKey: "buildings.barracks.name", hp: 1000, power: -2,
    cost: { gold: 1, iron: 10, silver: 30 }, buildTime: 20, footprint: 3,
    produces: ["infantry", "rocket_soldier", "robot", "engineer"], vision: 5, icon: "🏚", category: "military",
  },
  war_factory: {
    id: "war_factory", nameKey: "buildings.warFactory.name", hp: 1600, power: -4,
    cost: { gold: 3, iron: 15, silver: 70 }, buildTime: 35, footprint: 4,
    produces: ["light_tank", "heavy_tank", "artillery", "rocket_launcher", "anti_air", "miner"],
    vision: 5, icon: "🏭", category: "military", requires: "barracks",
  },
  research_center: {
    id: "research_center", nameKey: "buildings.researchCenter.name", hp: 1200, power: -3,
    cost: { gold: 2, iron: 20, silver: 60 }, buildTime: 30, footprint: 3, vision: 5, icon: "🔬", category: "tech",
  },
  guard_tower: {
    id: "guard_tower", nameKey: "buildings.guardTower.name", hp: 900, power: -2,
    cost: { iron: 8, silver: 25 }, buildTime: 15, footprint: 2, vision: 7, icon: "🗼", category: "defense",
    weapon: { damage: 16, damageType: "Bullet", range: 7, cooldown: 0.6, projectile: "tracer", projectileSpeed: 0, targetsGround: true, preferred: "InfantryLight" },
  },
  cannon_tower: {
    id: "cannon_tower", nameKey: "buildings.cannonTower.name", hp: 1100, power: -3,
    cost: { iron: 14, silver: 40 }, buildTime: 18, footprint: 2, vision: 7, icon: "🏰", category: "defense",
    weapon: { damage: 90, damageType: "Cannon", range: 8, cooldown: 2.2, projectile: "shell", projectileSpeed: 12, targetsGround: true, preferred: "VehicleHeavy" },
  },
  rocket_tower: {
    id: "rocket_tower", nameKey: "buildings.rocketTower.name", hp: 1000, power: -3,
    cost: { gold: 1, iron: 18, silver: 55 }, buildTime: 20, footprint: 2, vision: 8, icon: "📡", category: "defense",
    weapon: { damage: 35, damageType: "Rocket", range: 9, cooldown: 1.6, projectile: "rocket", projectileSpeed: 9, splash: 1.0, shots: 2, shotDelay: 0.1, targetsAir: true, targetsGround: true, preferred: "AirLight" },
  },
  wall: {
    id: "wall", nameKey: "buildings.wall.name", hp: 1500, power: 0,
    cost: { iron: 2, silver: 4 }, buildTime: 3, footprint: 1, vision: 2, icon: "🧱", category: "defense", isWall: true,
  },
};

export const NEUTRAL_VISION: Record<NeutralId, number> = { oil_derrick: 5 };

// ---- T26: Research Center catalog (spec §24 → T26 Part C). Each research is a ONE-TIME global
// upgrade with a cost (paid on start) and a research time (a progress bar on the building). `level`
// is the player-research level this entry grants (so Weapons II requires Weapons I, etc.). The
// `kind` maps the research to its slot on PlayerState.research and its in-game effect. ----
export type ResearchKind = "weapons" | "armor" | "factoryTech" | "logistics";
export interface ResearchDef {
  id: string;
  kind: ResearchKind;
  level: number;        // resulting level (1 or 2); logistics uses 1 (boolean)
  nameKey: string;
  descKey: string;
  cost: Cost;
  time: number;         // seconds
  requires?: string;    // prerequisite research id
}

export const RESEARCH_DEFS: ResearchDef[] = [
  { id: "weapons1", kind: "weapons", level: 1, nameKey: "research.weapons1.name", descKey: "research.weapons.desc", cost: { gold: 1, iron: 10, silver: 40 }, time: 25 },
  { id: "weapons2", kind: "weapons", level: 2, nameKey: "research.weapons2.name", descKey: "research.weapons.desc", cost: { gold: 2, iron: 20, silver: 80 }, time: 35, requires: "weapons1" },
  { id: "armor1", kind: "armor", level: 1, nameKey: "research.armor1.name", descKey: "research.armor.desc", cost: { gold: 1, iron: 12, silver: 40 }, time: 25 },
  { id: "armor2", kind: "armor", level: 2, nameKey: "research.armor2.name", descKey: "research.armor.desc", cost: { gold: 2, iron: 24, silver: 80 }, time: 35, requires: "armor1" },
  { id: "factory1", kind: "factoryTech", level: 1, nameKey: "research.factory1.name", descKey: "research.factory1.desc", cost: { gold: 1, iron: 15, silver: 50 }, time: 30 },
  { id: "factory2", kind: "factoryTech", level: 2, nameKey: "research.factory2.name", descKey: "research.factory2.desc", cost: { gold: 3, iron: 30, silver: 100 }, time: 45, requires: "factory1" },
  { id: "logistics", kind: "logistics", level: 1, nameKey: "research.logistics.name", descKey: "research.logistics.desc", cost: { gold: 1, iron: 10, silver: 60 }, time: 30 },
];

export const RESEARCH_BY_ID: Record<string, ResearchDef> = {};
for (const r of RESEARCH_DEFS) RESEARCH_BY_ID[r.id] = r;

// Buildable lists per category for the build menu (spec §18.4).
export const BUILD_MENU: Record<string, BuildingId[]> = {
  economy: ["silver_mine", "iron_mine", "gold_mine", "power_plant"],
  military: ["barracks", "war_factory"],
  defense: ["guard_tower", "cannon_tower", "rocket_tower", "wall"],
  tech: ["research_center"],
};
