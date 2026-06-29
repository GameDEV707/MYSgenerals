// MYS Generals — shared types, ids, and stat definitions (spec §8, §11, §13).

export interface Vec2 { x: number; y: number; }

export type ArmorType = "InfantryLight" | "VehicleHeavy" | "StructureArmored" | "AirLight";
export type DamageType = "Bullet" | "Cannon" | "Explosive" | "Rocket" | "Energy" | "Flame";

export type ResKind = "silver" | "iron" | "gold";
export interface Cost { silver?: number; iron?: number; gold?: number; }

export type EntityKind = "unit" | "building" | "neutral";

// ---- Unit type ids (spec §8) ----
export type UnitId =
  | "miner" | "engineer"
  | "infantry" | "rocket_soldier" | "robot"
  | "light_tank" | "heavy_tank" | "artillery" | "rocket_launcher" | "anti_air"
  | "hero";

// ---- Building type ids (spec §7) ----
export type BuildingId =
  | "command_center" | "silver_mine" | "iron_mine" | "gold_mine" | "power_plant"
  | "barracks" | "war_factory" | "research_center"
  | "guard_tower" | "cannon_tower" | "rocket_tower" | "wall";

// ---- Neutral ids (spec §12; T32 adds the capturable garrisoned outpost / sub-base) ----
export type NeutralId = "oil_derrick" | "outpost";

export interface Weapon {
  damage: number;
  damageType: DamageType;
  range: number;      // tiles
  minRange?: number;  // artillery dead zone
  cooldown: number;   // seconds between shots/volleys
  projectile: ProjectileKind;
  projectileSpeed: number; // tiles/sec (0 => hitscan)
  splash?: number;    // radius tiles
  shots?: number;     // multi-shot volley (rocket launcher 4, AA 2)
  shotDelay?: number; // seconds between volley shots
  targetsAir?: boolean;
  targetsGround?: boolean;
  preferred?: ArmorType; // target priority
}

export type ProjectileKind = "tracer" | "shell" | "rocket" | "artillery" | "energy" | "flame" | "beam" | "flak";

export interface UnitDef {
  id: UnitId;
  nameKey: string;
  hp: number;
  armor: ArmorType;
  speed: number; // tiles/sec
  vision: number; // tiles
  cost: Cost;
  buildTime: number; // seconds
  builtAt: BuildingId[];
  weapon?: Weapon;
  isWorker?: boolean;
  isVehicle?: boolean;
  radius: number; // collision radius in tiles
  icon: string;
}

export interface BuildingDef {
  id: BuildingId;
  nameKey: string;
  hp: number;
  power: number; // + generates, - consumes
  cost: Cost;
  buildTime: number;
  footprint: number; // NxN tiles
  produces?: UnitId[];
  weapon?: Weapon;
  vision: number;
  icon: string;
  category: "economy" | "military" | "defense" | "tech";
  requires?: BuildingId; // tech prerequisite present in base
  isWall?: boolean;
}

export type Status = "slow" | "stun" | "burn";

export interface ActiveStatus { kind: Status; until: number; }
