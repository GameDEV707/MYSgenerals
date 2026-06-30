// MYS Generals — local match session. Runs a MatchHost in-page (single source of truth) and
// renders one or two LOCAL players, each connected by a LoopbackTransport (spec §21.3). One sim,
// N viewports: each local player has its own fog-filtered WorldView, camera, fog, selection,
// HUD and pointer-type-scoped input — so there is no input bleed between split-screen players.
import { World, PlayerState, GameEvent } from "../sim/world.js";
import { getMap } from "../sim/map.js";
import { MatchHost } from "../host/matchHost.js";
import { LoopbackTransport } from "../net/transport.js";
import { WorldView } from "./worldView.js";
import { Renderer } from "../render/renderer.js";
import { FxRenderer } from "../render/fx.js";
import { AudioManager, SoundId } from "../render/audio.js";
import { InputController } from "../input.js";
import { HUD } from "../ui/hud.js";
import { TICK_DT } from "../constants.js";

export type Difficulty = "easy" | "normal" | "hard";
export interface SessionPlayer { id: number; isAI: boolean; aiDiff: Difficulty; color: string; hero: number; }
export interface LocalSpec { playerId: number; pointerType: "mouse" | "touch" | null; keyboard: boolean; control?: import("../input.js").ControlMode; }
export interface SessionConfig {
  map: string;
  players: SessionPlayer[];
  locals: LocalSpec[];
  split: boolean;
  showRematch: boolean;
  onQuit: () => void;
  onRematch?: () => void;
}

class Bundle {
  playerId: number;
  view: WorldView;
  fx: FxRenderer;
  renderer: Renderer;
  input: InputController;
  hud: HUD;
  loop: LoopbackTransport;
  root: HTMLElement;
  pending: GameEvent[] = [];
  primary: boolean;
  constructor(playerId: number, primary: boolean, view: WorldView, fx: FxRenderer, r: Renderer, input: InputController, hud: HUD, loop: LoopbackTransport, root: HTMLElement) {
    this.playerId = playerId; this.primary = primary; this.view = view; this.fx = fx; this.renderer = r; this.input = input; this.hud = hud; this.loop = loop; this.root = root;
  }
}

export class MatchSession {
  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private audio: AudioManager;
  host!: MatchHost;
  world!: World;
  bundles: Bundle[] = [];
  private raf = 0; private running = false; private last = 0; private acc = 0;
  private cfg!: SessionConfig;
  private resizeHandler = () => this.layout();

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, audio: AudioManager) {
    this.canvas = canvas; this.overlay = overlay; this.audio = audio;
  }

  start(cfg: SessionConfig): void {
    this.cfg = cfg;
    this.audio.init(); this.audio.resume();
    const map = getMap(cfg.map);
    const world = new World(map);
    const mk = (p: SessionPlayer, id: number): PlayerState => ({
      id, silver: 15, iron: 0, gold: 0, color: p.color, isAI: p.isAI, aiDiff: p.aiDiff, defeated: false,
      powerGen: 0, powerUse: 0, brownout: false, heroId: 0, heroLevel: 1, heroXp: 0, heroRespawnAt: 0,
      research: { weapons: 0, armor: 0, factoryTech: 0, logistics: false },
      unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0,
    });
    // Lobby slots can be sparse; the sim needs contiguous player ids (players[id]). Compact to
    // 0..n-1 in id order and remap local-player references accordingly.
    const sorted = [...cfg.players].sort((a, b) => a.id - b.id);
    const idMap = new Map<number, number>();
    sorted.forEach((p, i) => idMap.set(p.id, i));
    sorted.forEach((p, i) => world.addPlayer(mk(p, i)));
    sorted.forEach((_, i) => world.spawnBase(i, map.spawns[i]));
    world.setupNeutrals();

    this.host = new MatchHost(world);
    this.world = world;
    sorted.forEach((p, i) => { if (p.isAI) this.host.addAIPlayer(i); });

    const locals: LocalSpec[] = cfg.locals.map((ls) => ({ ...ls, playerId: idMap.get(ls.playerId) ?? 0 }));

    this.overlay.innerHTML = "";
    const split = cfg.split && locals.length >= 2;
    locals.forEach((ls, idx) => {
      const loop = new LoopbackTransport(ls.playerId, this.host);
      this.host.addLink(loop);
      const view = new WorldView(map, ls.playerId, (cmd) => loop.sendCommand(cmd));
      loop.onSnapshot((s) => view.ingest(s));
      const fx = new FxRenderer();
      const renderer = new Renderer(this.canvas, view, fx);
      const input = new InputController(renderer, view, this.audio, { pointerType: ls.pointerType, keyboard: ls.keyboard, control: ls.control ?? "single" });
      input.attach(this.canvas);
      const root = document.createElement("div");
      root.className = "hud-root" + (split ? (idx === 0 ? " split-left" : " split-right") : "");
      root.style.pointerEvents = "none"; // widgets re-enable via .hud > *
      this.overlay.appendChild(root);
      const side = split ? (idx === 0 ? "left" : "right") : "single";
      const hud = new HUD(root, view, renderer, input, this.audio, side);
      hud.showRematch = cfg.showRematch && idx === 0;
      hud.compact = split;
      fx.onToast = (key, kind, params) => hud.toast(key, kind, params);
      hud.onQuit = () => this.quit();
      hud.onRematch = () => this.rematch();
      const b = new Bundle(ls.playerId, idx === 0, view, fx, renderer, input, hud, loop, root);
      loop.onEvent((e) => b.pending.push(e));
      this.bundles.push(b);
    });

    this.layout();
    // prime one snapshot so the first frame has state, then center each camera on its base
    this.host.step();
    for (const b of this.bundles) this.bundles.length && b.renderer.centerOn(map.spawns[b.playerId].x, map.spawns[b.playerId].y);
    // T34: seed the split-screen mouse player's confined cursor at its viewport centre so it is
    // visible immediately (the native cursor is hidden in split mode — see the loop below).
    for (const b of this.bundles) {
      if (b.input.control === "p2-mouse") b.renderer.mouseCursor = { x: b.renderer.vx + b.renderer.W / 2, y: b.renderer.vy + b.renderer.H / 2 };
    }

    window.addEventListener("resize", this.resizeHandler);
    this.running = true; this.last = performance.now(); this.acc = 0;
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private layout(): void {
    const split = this.cfg.split && this.bundles.length >= 2;
    const W = window.innerWidth, H = window.innerHeight;
    this.bundles.forEach((b, i) => {
      if (split) {
        const half = Math.floor(W / 2);
        b.renderer.setViewport(i === 0 ? { x: 0, y: 0, w: half, h: H } : { x: half + 1, y: 0, w: W - half - 1, h: H });
      } else {
        b.renderer.setViewport(null);
      }
      b.renderer.resize();
    });
  }

  private get paused(): boolean { return this.bundles.some((b) => b.input.paused); }

  private loop(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.paused && this.host.world.winner === -2) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_DT && steps < 6) { this.host.step(); this.acc -= TICK_DT; steps++; }
    }
    // T34: cursor management. While a split-screen match is running the native OS cursor is hidden
    // (each mouse player draws its own confined crosshair). When the game ends we restore the real
    // OS cursor (default arrow) and drop the custom cursors so the win/lose screen is navigable.
    const over = this.host.world.winner !== -2;
    const split = this.cfg.split && this.bundles.length >= 2;
    this.canvas.style.cursor = over ? "default" : (split ? "none" : "crosshair");
    if (over) for (const b of this.bundles) b.renderer.mouseCursor = null;
    // clear whole backing store once (renderers clip to their viewports)
    const ctx = this.canvas.getContext("2d")!;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
    for (const b of this.bundles) {
      this.processEvents(b, b.pending); b.pending = [];
      b.view.interpolate(now, dt);
      b.fx.update(dt);
      b.renderer.update(dt);
      b.input.updateCamera(dt);
      b.renderer.draw();
      this.drawDragRect(b);
      b.hud.update(dt);
    }
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private processEvents(b: Bundle, events: GameEvent[]): void {
    if (events.length === 0) return;
    const tc = (o: number) => b.renderer.teamColor(o);
    const cam = b.renderer.cam;
    const cx = cam.x + b.renderer.W / cam.zoom / 2;
    const half = b.renderer.W / cam.zoom / 2;
    for (const ev of events) {
      b.fx.consume(ev, tc);
      if (!b.primary) continue; // only the primary viewport drives audio (shared speakers)
      if (ev.e === "fire") this.sfx(ev.kind as SoundId, ev.from.x, cx, half);
      else if (ev.e === "impact") this.sfx(ev.size >= 2 ? "bigexplode" : "explode", ev.pos.x, cx, half);
      else if (ev.e === "death" && ev.kind === "building") this.sfx("bigexplode", ev.pos.x, cx, half);
      else if (ev.e === "death" && ev.kind === "vehicle") this.sfx("explode", ev.pos.x, cx, half);
      else if (ev.e === "capture") this.sfx("capture", ev.pos.x, cx, half);
      else if (ev.e === "rankup") this.sfx("rankup", ev.pos.x, cx, half);
      else if (ev.e === "construct") this.sfx("build", ev.pos.x, cx, half);
    }
  }
  private sfx(id: SoundId, x: number, camCx: number, half: number): void {
    const pan = Math.max(-1, Math.min(1, (x - camCx) / half));
    const vol = Math.max(0.2, 1 - Math.abs(x - camCx) / (half * 2.2));
    this.audio.play(id, pan, vol);
  }

  private drawDragRect(b: Bundle): void {
    const rect = b.input.dragRect(); if (!rect) return;
    const ctx = b.renderer.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.renderer.vx, b.renderer.vy, b.renderer.W, b.renderer.H); ctx.clip();
    ctx.strokeStyle = "rgba(52,211,153,0.9)"; ctx.fillStyle = "rgba(52,211,153,0.12)"; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]); ctx.restore();
  }

  private rematch(): void { this.stop(); this.overlay.innerHTML = ""; this.start(this.cfg); }
  quit(): void { this.stop(); this.overlay.innerHTML = ""; const ctx = this.canvas.getContext("2d")!; ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.cfg.onQuit(); }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf); window.removeEventListener("resize", this.resizeHandler); this.canvas.style.cursor = ""; }
}
