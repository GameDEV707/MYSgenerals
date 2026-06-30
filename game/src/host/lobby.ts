// MYS Generals — lobby controller (spec §18.3). Engine-agnostic: drives the lobby state
// (slots, colors, heroes, ready, AI, kick, map, split-screen). The menu uses it directly for a
// locally-hosted game (M1); the Node server reuses the exact same logic for LAN lobbies (M2).
import { getMap } from "../sim/map.js";
import { LobbyState, LobbySlot, SlotKind, GameType } from "../net/protocol.js";

export const PALETTE = ["#4ea3ff", "#ff5a4d", "#34d399", "#c084fc", "#fbbf24", "#22d3ee", "#f472b6", "#a3e635"];
// Default side colours for custom-team mode: [0] = blue side, [1] = red side. Editable in the lobby.
export const TEAM_COLORS: [string, string] = ["#4ea3ff", "#ff5a4d"];

export interface PlayerSpec { id: number; isAI: boolean; aiDiff: "easy" | "normal" | "hard"; color: string; hero: number; team: number; }

function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = ""; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class Lobby {
  state: LobbyState;
  onChange?: (s: LobbyState) => void;
  // host-side per-slot metadata (not all serialized to clients)
  local: boolean[] = []; // slot is a local player on the host machine (loopback)

  constructor(hostUrl: string, map = "twin_spear", roomCode = randomRoomCode()) {
    const max = this.maxFor(map);
    const slots: LobbySlot[] = [];
    for (let i = 0; i < max; i++) {
      slots.push(i === 0
        ? { index: 0, kind: "human", name: "Host", color: PALETTE[0], hero: 0, ready: false, team: 0 }
        : { index: i, kind: "open", name: "", color: PALETTE[i % PALETTE.length], hero: 0, ready: false, team: i % 2 });
    }
    this.local = slots.map((_, i) => i === 0);
    this.state = {
      roomCode, map, slots, hostUrl, splitScreen: false, started: false, countdown: 0,
      gameType: "classic", teamColors: [TEAM_COLORS[0], TEAM_COLORS[1]],
    };
  }

  private maxFor(map: string): number { return getMap(map).spawns.length; }
  private changed(): void { this.onChange?.(this.state); }

  setMap(map: string): void {
    if (this.state.started) return;
    const max = this.maxFor(map);
    this.state.map = map;
    const slots = this.state.slots.slice(0, max);
    while (slots.length < max) {
      const i = slots.length;
      slots.push({ index: i, kind: "open", name: "", color: PALETTE[i % PALETTE.length], hero: 0, ready: false, team: i % 2 });
    }
    slots.forEach((s, i) => (s.index = i));
    this.state.slots = slots;
    this.local = slots.map((_, i) => this.local[i] ?? false);
    if (this.splitB >= max) { this.splitB = -1; this.state.splitScreen = false; }
    if (this.state.splitScreen && max < 2) { this.state.splitScreen = false; this.splitB = -1; }
    this.changed();
  }

  // --- find / claim slots ---
  firstSlotOfKind(kind: SlotKind): LobbySlot | undefined { return this.state.slots.find((s) => s.kind === kind); }
  // The host's own browser claims slot 0 (spec §3.2 / §24 T25). Slot 0 starts as a reserved "Host"
  // human slot; this attaches the host's live connection token to it. Returns 0, or -1 if slot 0 is
  // somehow unavailable.
  claimHostSlot(name: string, token: string): number {
    const s = this.state.slots[0];
    if (!s || s.kind === "ai" || s.kind === "closed") return -1;
    s.kind = "human"; s.name = name || "Host"; s.ready = false; s.token = token;
    this.local[0] = false;
    this.changed();
    return 0;
  }
  // a remote human joins (M2); returns the assigned slot index or -1 if full
  claimHumanSlot(name: string, token: string): number {
    const open = this.state.slots.find((s) => s.kind === "open");
    if (!open) return -1;
    open.kind = "human"; open.name = name; open.ready = false; open.token = token;
    this.local[open.index] = false;
    this.changed();
    return open.index;
  }
  releaseSlot(index: number): void {
    const s = this.state.slots[index]; if (!s || index === 0) return;
    s.kind = "open"; s.name = ""; s.ready = false; s.token = undefined; this.local[index] = false;
    this.changed();
  }

  addAI(diff: "easy" | "normal" | "hard" = "normal"): void {
    const open = this.state.slots.find((s) => s.kind === "open");
    if (!open) return;
    open.kind = "ai"; open.ai = diff; open.name = "AI"; open.ready = true; this.local[open.index] = false;
    this.changed();
  }
  // Custom-team mode: add an AI bound to a specific side (used to fill out a team when there aren't
  // enough humans). Falls back to the first open slot, capped by the map's player count.
  addAITeam(team: number, diff: "easy" | "normal" | "hard" = "normal"): void {
    const open = this.state.slots.find((s) => s.kind === "open");
    if (!open) return;
    open.kind = "ai"; open.ai = diff; open.name = "AI"; open.ready = true; open.team = team; this.local[open.index] = false;
    this.changed();
  }
  removeSlot(index: number): void {
    const s = this.state.slots[index]; if (!s || index === 0) return;
    s.kind = "open"; s.name = ""; s.ai = undefined; s.ready = false; s.token = undefined; this.local[index] = false;
    this.changed();
  }
  openSlot(index: number): void { const s = this.state.slots[index]; if (s && index !== 0 && s.kind === "closed") { s.kind = "open"; this.changed(); } }
  closeSlot(index: number): void { const s = this.state.slots[index]; if (s && index !== 0 && (s.kind === "open")) { s.kind = "closed"; this.changed(); } }
  kick(index: number): void { this.removeSlot(index); }

  setColor(index: number, color: string): void {
    const s = this.state.slots[index]; if (!s) return;
    if (this.state.slots.some((o) => o.index !== index && o.color === color && o.kind !== "open" && o.kind !== "closed")) return; // keep colors distinct
    s.color = color; this.changed();
  }
  setHero(index: number, hero: number): void { const s = this.state.slots[index]; if (s) { s.hero = hero; this.changed(); } }
  setReady(index: number, ready: boolean): void { const s = this.state.slots[index]; if (s && s.kind === "human") { s.ready = ready; this.changed(); } }
  setName(index: number, name: string): void { const s = this.state.slots[index]; if (s) { s.name = name; this.changed(); } }

  // --- custom-team mode ---
  // Switch between classic (FFA) and custom-team. Entering team mode seeds a balanced split (slots
  // alternate blue/red); leaving it clears the team assignment (colors revert to the palette).
  setGameType(gt: GameType): void {
    if (this.state.started) return;
    this.state.gameType = gt;
    if (gt === "team") {
      this.state.slots.forEach((s, i) => { if (s.team === undefined) s.team = i % 2; });
    }
    this.changed();
  }
  // Assign a slot to a side (0 = blue, 1 = red) in custom-team mode.
  setTeam(index: number, team: number): void {
    const s = this.state.slots[index]; if (!s) return;
    s.team = team === 1 ? 1 : 0;
    this.changed();
  }
  // Recolour a side. The two sides must stay visually distinct.
  setTeamColor(team: number, color: string): void {
    const other = team === 0 ? 1 : 0;
    if (this.state.teamColors[other] === color) return;
    this.state.teamColors[team === 1 ? 1 : 0] = color;
    this.changed();
  }
  // Participants on a given side (humans + AI).
  teamMembers(team: number): LobbySlot[] {
    return this.participants().filter((s) => (s.team ?? 0) === team);
  }

  // split-screen: the host provides a 2nd LOCAL human (Player B) in the first open slot
  // (spec §18.3 / §21). Player A is the host in slot 0.
  splitB = -1;
  setSplit(on: boolean): void {
    if (this.state.slots.length < 2) on = false;
    if (on && this.splitB < 0) {
      const open = this.state.slots.find((s) => s.kind === "open");
      if (!open) { this.state.splitScreen = false; this.changed(); return; }
      open.kind = "human"; open.name = "Player B"; open.ready = true; open.token = undefined;
      this.local[open.index] = true; this.splitB = open.index;
    } else if (!on && this.splitB >= 0) {
      const s = this.state.slots[this.splitB];
      if (s) { s.kind = "open"; s.name = ""; s.ready = false; this.local[this.splitB] = false; }
      this.splitB = -1;
    }
    this.state.splitScreen = on;
    this.changed();
  }

  participants(): LobbySlot[] { return this.state.slots.filter((s) => s.kind === "human" || s.kind === "ai"); }
  humanSlots(): LobbySlot[] { return this.state.slots.filter((s) => s.kind === "human"); }

  canStart(): boolean {
    const parts = this.participants();
    if (parts.length < 2) return false;
    if (!this.humanSlots().every((s) => s.ready)) return false;
    // Custom-team mode also requires both sides to have at least one participant.
    if (this.state.gameType === "team") {
      if (this.teamMembers(0).length < 1 || this.teamMembers(1).length < 1) return false;
    }
    return true;
  }

  buildPlayers(): PlayerSpec[] {
    const team = this.state.gameType === "team";
    return this.participants().map((s) => ({
      id: s.index, isAI: s.kind === "ai", aiDiff: s.ai ?? "normal", hero: s.hero,
      team: team ? (s.team ?? 0) : -1,
      // In team mode every member of a side shares its colour; classic keeps per-slot colours.
      color: team ? this.state.teamColors[(s.team ?? 0) === 1 ? 1 : 0] : s.color,
    }));
  }
  localPlayerIds(): number[] { return this.state.slots.filter((s, i) => this.local[i] && s.kind === "human").map((s) => s.index); }
}
