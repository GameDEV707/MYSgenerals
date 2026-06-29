import { getMap } from "../sim/map.js";
import { WorldView } from "./worldView.js";
import { Renderer } from "../render/renderer.js";
import { FxRenderer } from "../render/fx.js";
import { InputController } from "../input.js";
import { HUD } from "../ui/hud.js";
class RemoteBundle {
    constructor(playerId, primary, transport, view, fx, renderer, input, hud, root) {
        this.playerId = playerId;
        this.primary = primary;
        this.transport = transport;
        this.view = view;
        this.fx = fx;
        this.renderer = renderer;
        this.input = input;
        this.hud = hud;
        this.root = root;
        this.pending = [];
    }
}
export class RemoteSession {
    constructor(canvas, overlay, audio, locals, startMsg, split = false) {
        this.bundles = [];
        this.raf = 0;
        this.running = false;
        this.last = 0;
        this.resizeHandler = () => this.layout();
        this.onQuit = null;
        this.canvas = canvas;
        this.overlay = overlay;
        this.audio = audio;
        this.locals = locals;
        this.startMsg = startMsg;
        this.split = split && locals.length >= 2;
    }
    start() {
        this.audio.init();
        this.audio.resume();
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
            if (spawn)
                b.renderer.centerOn(spawn.x, spawn.y);
        }
        window.addEventListener("resize", this.resizeHandler);
        this.running = true;
        this.last = performance.now();
        this.raf = requestAnimationFrame((t) => this.loop(t));
    }
    layout() {
        const W = window.innerWidth, H = window.innerHeight;
        this.bundles.forEach((b, i) => {
            if (this.split) {
                const half = Math.floor(W / 2);
                b.renderer.setViewport(i === 0 ? { x: 0, y: 0, w: half, h: H } : { x: half + 1, y: 0, w: W - half - 1, h: H });
            }
            else {
                b.renderer.setViewport(null);
            }
            b.renderer.resize();
        });
    }
    loop(now) {
        if (!this.running)
            return;
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        // clear whole backing store once (renderers clip to their viewports)
        const ctx = this.canvas.getContext("2d");
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
        for (const b of this.bundles) {
            this.processEvents(b, b.pending);
            b.pending = [];
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
    processEvents(b, events) {
        if (events.length === 0)
            return;
        const tc = (o) => b.renderer.teamColor(o);
        const cam = b.renderer.cam;
        const cx = cam.x + b.renderer.W / cam.zoom / 2;
        const half = b.renderer.W / cam.zoom / 2;
        for (const ev of events) {
            b.fx.consume(ev, tc);
            if (!b.primary)
                continue; // only the primary viewport drives audio (shared speakers)
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
    drawDragRect(b) {
        const rect = b.input.dragRect();
        if (!rect)
            return;
        const ctx = b.renderer.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(b.renderer.vx, b.renderer.vy, b.renderer.W, b.renderer.H);
        ctx.clip();
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
        window.removeEventListener("resize", this.resizeHandler);
        this.overlay.innerHTML = "";
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
