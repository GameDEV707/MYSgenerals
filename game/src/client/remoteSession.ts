// MYS Generals — remote match session. Renders the game for client(s) connected to a host they
// do NOT run the sim for: a Node LAN host (SocketTransport), an online P2P host (WebRTCTransport),
// or — for the in-browser host's own player(s) — the in-page GameHost via LoopbackPeerTransport.
// Unlike MatchSession (which OWNS a MatchHost in-page), this class is a pure THIN CLIENT: it only
// receives snapshots/events and sends commands; the simulation runs on the host. (spec §3.2, §20.4)
//
// It supports ONE local player (LAN / online guest) OR TWO local players on one device
// (split-screen) — e.g. the online host playing alongside a friend on the same laptop while a
// remote friend joins over WebRTC (spec §21, §24 T33). Each local player has its own transport,
// fog-filtered WorldView, camera, fog, selection, HUD and pointer-scoped input, so there is no
// input bleed between split-screen players — mirroring MatchSession's per-viewport model.
import { GameEvent } from "../sim/world.js";
import { getMap } from "../sim/map.js";
import { WorldView } from "./worldView.js";
import { Renderer } from "../render/renderer.js";
import { FxRenderer } from "../render/fx.js";
import { AudioManager, SoundId } from "../render/audio.js";
import { InputController, ControlMode } from "../input.js";
import { HUD } from "../ui/hud.js";
import { ClientTransport } from "../net/transport.js";
import { ServerMsg } from "../net/protocol.js";

// One local player on this device, with its own transport into the host.
export interface RemoteLocalSpec {
  transport: ClientTransport;
  playerId: number;
  pointerType: "mouse" | "touch" | null;
  keyboard: boolean;
  control?: ControlMode;
}

class RemoteBundle {
  pending: GameEvent[] = [];
  constructor(
    public playerId: number,
    public primary: boolean,
    public transport: ClientTransport,
    public view: WorldView,
    public fx: FxRenderer,
    public renderer: Renderer,
    public input: InputController,
    public hud: HUD,
    public root: HTMLElement,
  ) {}
}

export class RemoteSession {
  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private audio: AudioManager;
  private locals: RemoteLocalSpec[];
  private startMsg: Extract<ServerMsg, { m: "start" }>;
  private split: boolean;
  private bundles: RemoteBundle[] = [];
  private raf = 0;
  private running = false;
  private last = 0;
  private resizeHandler = () => this.layout();
  onQuit: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement, overlay: HTMLElement, audio: AudioManager,
    locals: RemoteLocalSpec[], startMsg: Extract<ServerMsg, { m: "start" }>, split = false
  ) {
    this.canvas = canvas; this.overlay = overlay; this.audio = audio;
    this.locals = locals; this.startMsg = startMsg;
    this.split = split && locals.length >= 2;
  }

  start(): void {
    this.audio.init(); this.audio.resume();
    const map = getMap(this.startMsg.map);

    this.overlay.innerHTML = "";
    this.locals.forEach((ls, idx) => {
      const view = new WorldView(map, ls.playerId, (cmd) => ls.transport.sendCommand(cmd));
      ls.transport.onSnapshot((s) => view.ingest(s));
      const fx = new FxRenderer();
      const renderer = new Renderer(this.canvas, view, fx);
      const input = new InputController(renderer, view, this.audio, {
        pointerType: ls.pointerType, keyboard: ls.keyboard, control: ls.control ?? "single",
      });
      input.attach(this.canvas);

      const root = document.createElement("div");
      root.className = "hud-root" + (this.split ? (idx === 0 ? " split-left" : " split-right") : "");
      root.style.pointerEvents = "none";
      this.overlay.appendChild(root);

      const side = this.split ? (idx === 0 ? "left" : "right") : "single";
      const hud = new HUD(root, view, renderer, input, this.audio, side);
      hud.showRematch = false;
      hud.compact = this.split;
      fx.onToast = (key, kind, params) => hud.toast(key, kind, params);
      hud.onQuit = () => { this.onQuit?.(); };

      const b = new RemoteBundle(ls.playerId, idx === 0, ls.transport, view, fx, renderer, input, hud, root);
      ls.transport.onEvent((e) => b.pending.push(e));
      this.bundles.push(b);
    });

    this.layout();
    // Center each camera on its own spawn.
    for (const b of this.bundles) {
      const spawn = map.spawns[b.playerId];
      if (spawn) b.renderer.centerOn(spawn.x, spawn.y);
    }

    window.addEventListener("resize", this.resizeHandler);
    this.running = true; this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private layout(): void {
    const W = window.innerWidth, H = window.innerHeight;
    this.bundles.forEach((b, i) => {
      if (this.split) {
        const half = Math.floor(W / 2);
        b.renderer.setViewport(i === 0 ? { x: 0, y: 0, w: half, h: H } : { x: half + 1, y: 0, w: W - half - 1, h: H });
      } else {
        b.renderer.setViewport(null);
      }
      b.renderer.resize();
    });
  }

  private loop(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

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

  private processEvents(b: RemoteBundle, events: GameEvent[]): void {
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

  private drawDragRect(b: RemoteBundle): void {
    const rect = b.input.dragRect(); if (!rect) return;
    const ctx = b.renderer.ctx;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.renderer.vx, b.renderer.vy, b.renderer.W, b.renderer.H); ctx.clip();
    ctx.strokeStyle = "rgba(52,211,153,0.9)"; ctx.fillStyle = "rgba(52,211,153,0.12)"; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]); ctx.restore();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    this.overlay.innerHTML = "";
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
