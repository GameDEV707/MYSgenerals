import { getMap } from "../sim/map.js";
import { WorldView } from "./worldView.js";
import { Renderer } from "../render/renderer.js";
import { FxRenderer } from "../render/fx.js";
import { InputController } from "../input.js";
import { HUD } from "../ui/hud.js";
export class RemoteSession {
    constructor(canvas, overlay, audio, transport, startMsg) {
        this.pending = [];
        this.raf = 0;
        this.running = false;
        this.last = 0;
        this.onQuit = null;
        this.canvas = canvas;
        this.overlay = overlay;
        this.audio = audio;
        this.transport = transport;
        this.startMsg = startMsg;
    }
    start() {
        this.audio.init();
        this.audio.resume();
        const map = getMap(this.startMsg.map);
        const me = this.startMsg.you;
        this.view = new WorldView(map, me, (cmd) => this.transport.sendCommand(cmd));
        this.transport.onSnapshot((s) => this.view.ingest(s));
        this.transport.onEvent((e) => this.pending.push(e));
        this.fx = new FxRenderer();
        this.renderer = new Renderer(this.canvas, this.view, this.fx);
        this.input = new InputController(this.renderer, this.view, this.audio, { pointerType: null, keyboard: true, control: "single" });
        this.input.attach(this.canvas);
        this.overlay.innerHTML = "";
        const root = document.createElement("div");
        root.className = "hud-root";
        root.style.pointerEvents = "none";
        this.overlay.appendChild(root);
        this.hud = new HUD(root, this.view, this.renderer, this.input, this.audio);
        this.hud.showRematch = false;
        this.hud.compact = false;
        this.fx.onToast = (key, kind, params) => this.hud.toast(key, kind, params);
        this.hud.onQuit = () => { this.onQuit?.(); };
        this.renderer.resize();
        // Center camera on our spawn
        const myPlayer = this.startMsg.players.find((p) => p.id === me);
        if (myPlayer) {
            const spawn = map.spawns[me];
            if (spawn)
                this.renderer.centerOn(spawn.x, spawn.y);
        }
        this.running = true;
        this.last = performance.now();
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    loop(now) {
        if (!this.running)
            return;
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        // Process events
        this.processEvents(this.pending);
        this.pending = [];
        this.view.interpolate(now, dt);
        this.fx.update(dt);
        this.renderer.update(dt);
        this.input.updateCamera(dt);
        const ctx = this.canvas.getContext("2d");
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
        this.renderer.draw();
        this.drawDragRect();
        this.hud.update(dt);
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    processEvents(events) {
        if (events.length === 0)
            return;
        const tc = (o) => this.renderer.teamColor(o);
        const cam = this.renderer.cam;
        const cx = cam.x + this.renderer.W / cam.zoom / 2;
        const half = this.renderer.W / cam.zoom / 2;
        for (const ev of events) {
            this.fx.consume(ev, tc);
            if (ev.e === "fire")
                this.sfx(ev.kind, ev.from.x, cx, half);
            else if (ev.e === "impact")
                this.sfx(ev.size >= 2 ? "bigexplode" : "explode", ev.pos.x, cx, half);
            else if (ev.e === "death" && ev.kind === "building")
                this.sfx("bigexplode", ev.pos.x, cx, half);
            else if (ev.e === "death" && ev.kind === "vehicle")
                this.sfx("explode", ev.pos.x, cx, half);
            else if (ev.e === "capture")
                this.sfx("capture", ev.pos.x, cx, half);
            else if (ev.e === "rankup")
                this.sfx("rankup", ev.pos.x, cx, half);
            else if (ev.e === "construct")
                this.sfx("build", ev.pos.x, cx, half);
        }
    }
    sfx(id, x, camCx, half) {
        const pan = Math.max(-1, Math.min(1, (x - camCx) / half));
        const vol = Math.max(0.2, 1 - Math.abs(x - camCx) / (half * 2.2));
        this.audio.play(id, pan, vol);
    }
    drawDragRect() {
        const rect = this.input.dragRect();
        if (!rect)
            return;
        const ctx = this.renderer.ctx;
        ctx.save();
        ctx.strokeStyle = "rgba(52,211,153,0.9)";
        ctx.fillStyle = "rgba(52,211,153,0.12)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash([]);
        ctx.restore();
    }
    stop() {
        this.running = false;
        cancelAnimationFrame(this.raf);
        this.overlay.innerHTML = "";
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
