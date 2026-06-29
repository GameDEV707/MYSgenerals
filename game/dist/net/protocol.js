// Snapshot tick rate is 20 Hz (one per sim tick). Clients render ~100 ms in the past and
// interpolate between buffered snapshots (spec §20.4).
export const INTERP_DELAY_MS = 100;
export const FL = {
    constructing: 1, mining: 2, vehicle: 4, weapon: 8, hero: 16, stub: 32,
};
