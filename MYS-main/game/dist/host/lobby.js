// MYS Generals — lobby controller (spec §18.3). Engine-agnostic: drives the lobby state
// (slots, colors, heroes, ready, AI, kick, map, split-screen). The menu uses it directly for a
// locally-hosted game (M1); the Node server reuses the exact same logic for LAN lobbies (M2).
import { getMap } from "../sim/map.js";
export const PALETTE = ["#4ea3ff", "#ff5a4d", "#34d399", "#c084fc"];
function randomRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let s = "";
    for (let i = 0; i < 4; i++)
        s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}
export class Lobby {
    constructor(hostUrl, map = "twin_rivers", roomCode = randomRoomCode()) {
        // host-side per-slot metadata (not all serialized to clients)
        this.local = []; // slot is a local player on the host machine (loopback)
        // split-screen: the host provides a 2nd LOCAL human (Player B) in the first open slot
        // (spec §18.3 / §21). Player A is the host in slot 0.
        this.splitB = -1;
        const max = this.maxFor(map);
        const slots = [];
        for (let i = 0; i < max; i++) {
            slots.push(i === 0
                ? { index: 0, kind: "human", name: "Host", color: PALETTE[0], hero: 0, ready: false }
                : { index: i, kind: "open", name: "", color: PALETTE[i % PALETTE.length], hero: 0, ready: false });
        }
        this.local = slots.map((_, i) => i === 0);
        this.state = { roomCode, map, slots, hostUrl, splitScreen: false, started: false, countdown: 0 };
    }
    maxFor(map) { return getMap(map).spawns.length; }
    changed() { this.onChange?.(this.state); }
    setMap(map) {
        if (this.state.started)
            return;
        const max = this.maxFor(map);
        this.state.map = map;
        const slots = this.state.slots.slice(0, max);
        while (slots.length < max) {
            const i = slots.length;
            slots.push({ index: i, kind: "open", name: "", color: PALETTE[i % PALETTE.length], hero: 0, ready: false });
        }
        slots.forEach((s, i) => (s.index = i));
        this.state.slots = slots;
        this.local = slots.map((_, i) => this.local[i] ?? false);
        if (this.splitB >= max) {
            this.splitB = -1;
            this.state.splitScreen = false;
        }
        if (this.state.splitScreen && max < 2) {
            this.state.splitScreen = false;
            this.splitB = -1;
        }
        this.changed();
    }
    // --- find / claim slots ---
    firstSlotOfKind(kind) { return this.state.slots.find((s) => s.kind === kind); }
    // The host's own browser claims slot 0 (spec §3.2 / §24 T25). Slot 0 starts as a reserved "Host"
    // human slot; this attaches the host's live connection token to it. Returns 0, or -1 if slot 0 is
    // somehow unavailable.
    claimHostSlot(name, token) {
        const s = this.state.slots[0];
        if (!s || s.kind === "ai" || s.kind === "closed")
            return -1;
        s.kind = "human";
        s.name = name || "Host";
        s.ready = false;
        s.token = token;
        this.local[0] = false;
        this.changed();
        return 0;
    }
    // a remote human joins (M2); returns the assigned slot index or -1 if full
    claimHumanSlot(name, token) {
        const open = this.state.slots.find((s) => s.kind === "open");
        if (!open)
            return -1;
        open.kind = "human";
        open.name = name;
        open.ready = false;
        open.token = token;
        this.local[open.index] = false;
        this.changed();
        return open.index;
    }
    releaseSlot(index) {
        const s = this.state.slots[index];
        if (!s || index === 0)
            return;
        s.kind = "open";
        s.name = "";
        s.ready = false;
        s.token = undefined;
        this.local[index] = false;
        this.changed();
    }
    addAI(diff = "normal") {
        const open = this.state.slots.find((s) => s.kind === "open");
        if (!open)
            return;
        open.kind = "ai";
        open.ai = diff;
        open.name = "AI";
        open.ready = true;
        this.local[open.index] = false;
        this.changed();
    }
    removeSlot(index) {
        const s = this.state.slots[index];
        if (!s || index === 0)
            return;
        s.kind = "open";
        s.name = "";
        s.ai = undefined;
        s.ready = false;
        s.token = undefined;
        this.local[index] = false;
        this.changed();
    }
    openSlot(index) { const s = this.state.slots[index]; if (s && index !== 0 && s.kind === "closed") {
        s.kind = "open";
        this.changed();
    } }
    closeSlot(index) { const s = this.state.slots[index]; if (s && index !== 0 && (s.kind === "open")) {
        s.kind = "closed";
        this.changed();
    } }
    kick(index) { this.removeSlot(index); }
    setColor(index, color) {
        const s = this.state.slots[index];
        if (!s)
            return;
        if (this.state.slots.some((o) => o.index !== index && o.color === color && o.kind !== "open" && o.kind !== "closed"))
            return; // keep colors distinct
        s.color = color;
        this.changed();
    }
    setHero(index, hero) { const s = this.state.slots[index]; if (s) {
        s.hero = hero;
        this.changed();
    } }
    setReady(index, ready) { const s = this.state.slots[index]; if (s && s.kind === "human") {
        s.ready = ready;
        this.changed();
    } }
    setName(index, name) { const s = this.state.slots[index]; if (s) {
        s.name = name;
        this.changed();
    } }
    setSplit(on) {
        if (this.state.slots.length < 2)
            on = false;
        if (on && this.splitB < 0) {
            const open = this.state.slots.find((s) => s.kind === "open");
            if (!open) {
                this.state.splitScreen = false;
                this.changed();
                return;
            }
            open.kind = "human";
            open.name = "Player B";
            open.ready = true;
            open.token = undefined;
            this.local[open.index] = true;
            this.splitB = open.index;
        }
        else if (!on && this.splitB >= 0) {
            const s = this.state.slots[this.splitB];
            if (s) {
                s.kind = "open";
                s.name = "";
                s.ready = false;
                this.local[this.splitB] = false;
            }
            this.splitB = -1;
        }
        this.state.splitScreen = on;
        this.changed();
    }
    participants() { return this.state.slots.filter((s) => s.kind === "human" || s.kind === "ai"); }
    humanSlots() { return this.state.slots.filter((s) => s.kind === "human"); }
    canStart() {
        const parts = this.participants();
        if (parts.length < 2)
            return false;
        return this.humanSlots().every((s) => s.ready);
    }
    buildPlayers() {
        return this.participants().map((s) => ({
            id: s.index, isAI: s.kind === "ai", aiDiff: s.ai ?? "normal", color: s.color, hero: s.hero,
        }));
    }
    localPlayerIds() { return this.state.slots.filter((s, i) => this.local[i] && s.kind === "human").map((s) => s.index); }
}
