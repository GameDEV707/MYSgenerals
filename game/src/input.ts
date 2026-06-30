// MYS Generals — input controller (spec §18.7 controls, §21.2 pointer routing, §24 → T23/T24).
// Reads the WorldView and sends Commands through the transport (view.send). One controller drives
// one player's viewport. A controller runs in one of three CONTROL modes (spec §24 → T24):
//   • "single"      — single-player / remote: mouse + the shared Q/W/E/R ability keys + arrow camera.
//   • "p1-keyboard" — split Player 1 (left): a keyboard-driven, on-screen VIRTUAL CURSOR (W/A/S/D
//                      move, E select, Q command) + Z/X/C/V abilities. Ignores the mouse entirely.
//   • "p2-mouse"    — split Player 2 (right): the existing mouse scheme + arrow-key abilities.
// The two split controllers listen to DISJOINT keys (read live from the remappable key-binding
// store), and P2 uses the mouse, so there is no cross-control / input bleed and the screen shows
// two visible cursors (P1's drawn virtual cursor + P2's native OS cursor).
import { Renderer } from "./render/renderer.js";
import { WorldView, ViewEntity, NEUTRAL } from "./client/worldView.js";
import { AudioManager } from "./render/audio.js";
import { BuildingId, UnitId } from "./types.js";
import { getKeyBindings, normalizeKey, Bindings } from "./ui/keyBindings.js";
import { isMineType } from "./constants.js";

export type ControlMode = "single" | "p1-keyboard" | "p2-mouse";

interface PtrPos { x: number; y: number; }

export class InputController {
  r: Renderer; world: WorldView; audio: AudioManager;
  pendingAbility = -1; // -1 none, 0..3 slot awaiting target
  pendingAttackMove = false;
  paused = false;
  // pointer-type this controller listens to (spec §21.2). null = any (single-player).
  pointerType: "mouse" | "touch" | null = null;
  // control scheme (spec §24 → T24): drives keyboard routing and the virtual cursor.
  control: ControlMode = "single";
  private keyboard: boolean;
  private keys = new Set<string>();
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private panning = false;
  private panLast = { x: 0, y: 0 };
  private groups: Record<string, number[]> = {};
  private _mx = 0; private _my = 0;
  // Player-1 keyboard virtual cursor state (screen-space px), clamped to the left viewport.
  private _cx = 0; private _cy = 0; private _curInit = false;
  // true while the P1 select key is held (keyboard click-/box-select in progress).
  private _selecting = false;
  // All pointer contacts THIS controller currently owns (button pressed / finger down), keyed by
  // pointerId. Tracking per-pointer is what lets a touch finger and a mouse button be down at the
  // same time on the same canvas without one "winning" (multi-touch — T23).
  private ptr = new Map<number, PtrPos>();
  // active 2-finger gesture state (touch pan + pinch-zoom)
  private gesture: { cx: number; cy: number; dist: number } | null = null;
  // set when a multi-touch gesture occurred, so the trailing pointerup is not treated as a click
  private gestured = false;
  onAbilityConsumed?: () => void;
  // T26 Part E: the HUD wires these so the keyboard player (p1-keyboard) can drive the command
  // panel — a digit 1..0 activates the Nth grid button, Tab/brackets cycle build categories.
  onPanelDigit?: (index: number) => void;
  onCycleTab?: (dir: number) => void;
  // T27 Part A: category-focus navigation for the keyboard player. `onCategoryFocus` advances a
  // focus highlight across the build-category tabs; `onCategoryConfirm` opens the focused tab and
  // returns true if it consumed the key (so `select` falls back to its normal meaning otherwise);
  // `onCategoryCancel` clears focus (Esc).
  onCategoryFocus?: () => void;
  onCategoryConfirm?: () => boolean;
  onCategoryCancel?: () => void;

  constructor(r: Renderer, world: WorldView, audio: AudioManager, opts?: { pointerType?: "mouse" | "touch" | null; keyboard?: boolean; control?: ControlMode }) {
    this.r = r; this.world = world; this.audio = audio;
    this.pointerType = opts?.pointerType ?? null;
    this.keyboard = opts?.keyboard ?? true;
    this.control = opts?.control ?? "single";
  }

  attach(canvas: HTMLCanvasElement): void {
    // PointerEvents carry `pointerType` ("mouse" | "touch" | "pen") so we can route mouse → one
    // player and touch → the other with zero bleed. Down is bound on the canvas; move/up/cancel on
    // the window so a drag that leaves the canvas still completes for the owning pointer.
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => { if (this.acceptsWheel(e)) this.onWheel(e); }, { passive: false });
    if (this.keyboard) {
      window.addEventListener("keydown", (e) => this.onKey(e));
      window.addEventListener("keyup", (e) => this.onKeyUp(e));
    }
    // Prevent default touch actions on canvas (no browser scrolling/zoom in split-screen)
    canvas.style.touchAction = "none";
  }

  private matchesType(e: PointerEvent): boolean { return !this.pointerType || e.pointerType === this.pointerType; }
  // T34: the split-screen MOUSE player (p2-mouse) confines its cursor to its own viewport half — the
  // native cursor is hidden and we draw a custom crosshair clamped to this renderer's viewport, so
  // the pointer can never wander into the other player's side. (No confinement in single-player.)
  private confined(): boolean { return this.control === "p2-mouse"; }
  // A pointer-DOWN is accepted only inside this controller's viewport AND for its pointer type.
  // The keyboard player (P1) never accepts the mouse — the mouse belongs entirely to Player 2.
  private acceptsPointer(e: PointerEvent): boolean { return this.control !== "p1-keyboard" && this.matchesType(e) && this.r.contains(e.clientX, e.clientY); }
  // The wheel belongs to the mouse; only zoom when it is over this viewport and we accept the mouse.
  private acceptsWheel(e: WheelEvent): boolean {
    if (this.control === "p1-keyboard" || this.pointerType === "touch") return false;
    return this.r.contains(e.clientX, e.clientY);
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.acceptsPointer(e)) return;
    this.audio.resume();
    this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.r.contains(e.clientX, e.clientY)) this.r.mouseWorld = this.r.screenToWorld(e.clientX, e.clientY);

    // Multi-touch: a 2nd touch contact starts a pan/pinch gesture and cancels any select-drag.
    if (e.pointerType === "touch" && this.ptr.size >= 2) {
      this.beginGesture();
      this.dragStart = null; this.dragging = false; this.panning = false;
      this.updatePointerHint();
      return;
    }

    if (e.button === 1) { this.panning = true; this.panLast = { x: e.clientX, y: e.clientY }; e.preventDefault(); this.updatePointerHint(); return; }
    if (e.button === 2) { this.onRightClick(e); this.updatePointerHint(); return; }

    const w = this.r.screenToWorld(e.clientX, e.clientY);
    if (this.pendingAttackMove) {
      const units = this.ownUnits();
      if (units.length) { this.world.send({ t: "attackmove", ids: units, x: w.x, y: w.y }); this.audio.play("click"); this.r.fx.addCmdMarker(w.x, w.y, "attack", "#ffa726"); }
      this.pendingAttackMove = false; this.updatePointerHint(); return;
    }
    if (this.r.placing) { this.placeBuilding(w.x, w.y); this.updatePointerHint(); return; }
    if (this.pendingAbility >= 0) { this.castPending(w.x, w.y); this.updatePointerHint(); return; }
    this.dragStart = { x: e.clientX, y: e.clientY }; this.dragging = false; this.gestured = false;
    this._mx = e.clientX; this._my = e.clientY;
    this.updatePointerHint();
  }

  private onPointerMove(e: PointerEvent): void {
    // The keyboard player ignores the mouse entirely (it drives a virtual cursor instead).
    if (this.control === "p1-keyboard") return;
    // Only process moves for our pointer type (avoids cross-contamination in split-screen).
    if (!this.matchesType(e)) return;
    const owns = this.ptr.has(e.pointerId);
    if (owns) this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // T34: confine the mouse player's cursor to its viewport half. We clamp the on-screen cursor and
    // the world-pointer to this renderer's rectangle so they never cross the split divider. While the
    // game is over the custom cursor is dropped and the real OS cursor is restored (see MatchSession).
    if (this.confined()) {
      const over = this.world.winner !== -2;
      const px = Math.max(this.r.vx, Math.min(this.r.vx + this.r.W - 1, e.clientX));
      const py = Math.max(this.r.vy, Math.min(this.r.vy + this.r.H - 1, e.clientY));
      this._mx = px; this._my = py;
      this.r.mouseWorld = this.r.screenToWorld(px, py);
      this.r.mouseCursor = over ? null : { x: px, y: py };
    } else if (this.r.contains(e.clientX, e.clientY)) {
      this.r.mouseWorld = this.r.screenToWorld(e.clientX, e.clientY);
    }

    // Two-finger gesture (touch pan + pinch-zoom) takes precedence over single-pointer handling.
    if (this.gesture && this.ptr.size >= 2) { this.updateGesture(); this.updatePointerHint(); return; }

    if (this.panning) {
      this.r.cam.x -= (e.clientX - this.panLast.x) / this.r.cam.zoom;
      this.r.cam.y -= (e.clientY - this.panLast.y) / this.r.cam.zoom;
      this.panLast = { x: e.clientX, y: e.clientY }; this.r.clampCam();
    }
    if (this.dragStart && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) > 6) this.dragging = true;
    if (this.confined()) {
      this._mx = Math.max(this.r.vx, Math.min(this.r.vx + this.r.W - 1, e.clientX));
      this._my = Math.max(this.r.vy, Math.min(this.r.vy + this.r.H - 1, e.clientY));
    } else { this._mx = e.clientX; this._my = e.clientY; }
    this.updatePointerHint();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.control === "p1-keyboard") return;
    if (!this.matchesType(e)) return;
    const owns = this.ptr.has(e.pointerId);
    this.ptr.delete(e.pointerId);
    this.updatePointerHint();

    if (this.gesture) {
      if (this.ptr.size < 2) { this.gesture = null; this.panning = false; this.dragStart = null; this.dragging = false; }
      else this.beginGesture(); // re-seat the gesture on the remaining contacts
      return;
    }
    if (e.button === 1) { this.panning = false; return; }
    if (!owns) return;                 // we never started this interaction
    if (e.button !== 0 || !this.dragStart) return;
    if (this.gestured) { this.gestured = false; this.dragStart = null; this.dragging = false; return; }
    if (this.dragging) this.boxSelect(this.dragStart.x, this.dragStart.y, e.clientX, e.clientY, e.shiftKey);
    else this.clickSelect(e.clientX, e.clientY, e.shiftKey);
    this.dragStart = null; this.dragging = false;
  }

  private beginGesture(): void {
    const pts = [...this.ptr.values()];
    if (pts.length < 2) { this.gesture = null; return; }
    const [a, b] = pts;
    this.gesture = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    this.gestured = true;
  }

  private updateGesture(): void {
    if (!this.gesture) return;
    const pts = [...this.ptr.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    // pan by centroid movement
    this.r.cam.x -= (cx - this.gesture.cx) / this.r.cam.zoom;
    this.r.cam.y -= (cy - this.gesture.cy) / this.r.cam.zoom;
    // pinch-zoom about the centroid
    const before = this.r.screenToWorld(cx, cy);
    this.r.cam.zoom = Math.max(10, Math.min(48, this.r.cam.zoom * (dist / this.gesture.dist)));
    const after = this.r.screenToWorld(cx, cy);
    this.r.cam.x += before.x - after.x; this.r.cam.y += before.y - after.y;
    this.gesture.cx = cx; this.gesture.cy = cy; this.gesture.dist = dist;
    this.r.clampCam();
  }

  // Per-player on-canvas pointer indicator (so the touch player has a visible "cursor" next to the
  // mouse player's OS cursor — two distinct pointers, T23). Only shown for the touch stream; the
  // mouse stream already has the native cursor.
  private updatePointerHint(): void {
    if (this.pointerType !== "touch") { this.r.pointerHint = null; return; }
    let live: PtrPos | null = null;
    for (const p of this.ptr.values()) { if (this.r.contains(p.x, p.y)) { live = p; break; } }
    this.r.pointerHint = live ? { x: live.x, y: live.y } : null;
  }

  dragRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.dragStart || !this.dragging) return null;
    // clamp the selection rectangle to this viewport so it never visually bleeds across the divider
    const clampX = (v: number) => Math.max(this.r.vx, Math.min(this.r.vx + this.r.W, v));
    const clampY = (v: number) => Math.max(this.r.vy, Math.min(this.r.vy + this.r.H, v));
    const sx = clampX(this.dragStart.x), sy = clampY(this.dragStart.y);
    const mx = clampX(this._mx), my = clampY(this._my);
    return { x: Math.min(sx, mx), y: Math.min(sy, my), w: Math.abs(mx - sx), h: Math.abs(my - sy) };
  }

  private entityAt(sx: number, sy: number): ViewEntity | undefined {
    const w = this.r.screenToWorld(sx, sy);
    let best: ViewEntity | undefined; let bd = 1e9;
    for (const e of this.world.entities) {
      if (e.stub) continue;
      const rr = (e.kind === "building" ? e.radius : e.radius + 0.4);
      const d = Math.hypot(e.pos.x - w.x, e.pos.y - w.y);
      if (d < rr && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private clickSelect(sx: number, sy: number, add: boolean): void {
    const e = this.entityAt(sx, sy);
    if (!add) this.r.selection.clear();
    if (e) { this.r.selection.add(e.id); this.audio.play("click"); }
  }

  private boxSelect(x1: number, y1: number, x2: number, y2: number, add: boolean): void {
    if (!add) this.r.selection.clear();
    const a = this.r.screenToWorld(Math.min(x1, x2), Math.min(y1, y2));
    const b = this.r.screenToWorld(Math.max(x1, x2), Math.max(y1, y2));
    let any = false;
    for (const e of this.world.entities) {
      if (e.owner !== this.world.me || e.kind !== "unit") continue;
      if (e.pos.x >= a.x && e.pos.x <= b.x && e.pos.y >= a.y && e.pos.y <= b.y) { this.r.selection.add(e.id); any = true; }
    }
    if (any) this.audio.play("click");
  }

  private ownUnits(): number[] {
    const ids: number[] = [];
    for (const id of this.r.selection) { const e = this.world.byId.get(id); if (e && e.owner === this.world.me && e.kind === "unit") ids.push(id); }
    return ids;
  }

  setPlacing(b: BuildingId | null): void {
    this.r.placing = b ? { building: b } : null; this.pendingAbility = -1;
  }
  setAbility(slot: number): void {
    const hero = this.heroEntity(); if (!hero || !hero.hero) return;
    if (hero.hero.abilities[slot].rank <= 0) { this.audio.play("deny"); return; }
    if (slot === 0) {
      this.world.send({ t: "ability", hero: hero.id, slot, x: hero.pos.x, y: hero.pos.y });
      this.audio.play("ability"); this.pendingAbility = -1;
    } else { this.pendingAbility = slot; this.r.placing = null; }
  }

  private heroEntity(): ViewEntity | undefined {
    const id = this.world.players[this.world.me]?.heroId; return id ? this.world.byId.get(id) : undefined;
  }

  private onRightClick(e: MouseEvent | PointerEvent): void {
    if (this.r.placing) { this.r.placing = null; return; }
    if (this.pendingAbility >= 0) { this.pendingAbility = -1; return; }
    this.issueCommandAt(e.clientX, e.clientY);
  }

  // Issue a move/attack/capture/rally command at a screen point (shared by the mouse right-click
  // and Player 1's keyboard "command" key). Pure command logic — no placing/ability gating here.
  private issueCommandAt(sx: number, sy: number): void {
    const w = this.r.screenToWorld(sx, sy);
    const me = this.world.me;
    const selBuildings = [...this.r.selection].map((i) => this.world.byId.get(i)).filter((b): b is ViewEntity => !!b && b.owner === me && b.kind === "building");
    const units = this.ownUnits();
    const tgt = this.entityAt(sx, sy);
    if (units.length === 0 && selBuildings.length > 0) {
      for (const b of selBuildings) this.world.send({ t: "rally", building: b.id, x: w.x, y: w.y });
      this.audio.play("click"); this.r.fx.addCmdMarker(w.x, w.y, "move", "#34d399"); return;
    }
    if (units.length === 0) return;
    if (tgt && tgt.owner !== me && tgt.owner !== NEUTRAL) {
      this.world.send({ t: "attack", ids: units, target: tgt.id }); this.audio.play("click");
      this.r.fx.addCmdMarker(tgt.pos.x, tgt.pos.y, "attack", "#ff5a4d"); return;
    }
    // Miner → work an OWNED mine of ANY type (silver / iron / gold / captured oil). Only mines with a
    // spare slot are accepted; sending a miner to a taken mine is rejected so it doesn't trek over
    // and then wander off to a distant free mine. (The silver-only check here was the main cause of
    // miners "staggering" when right-clicked onto iron/gold mines, which fell through to a move.)
    if (tgt && tgt.owner === me && isMineType(tgt.type)) {
      const miners = units.filter((id) => this.world.byId.get(id)?.type === "miner");
      if (miners.length) {
        if (tgt.mineEta && tgt.mineEta.free === false) { this.audio.play("deny"); return; }
        this.world.send({ t: "mine", ids: miners, target: tgt.id }); this.audio.play("click");
        this.r.fx.addCmdMarker(tgt.pos.x, tgt.pos.y, "move", "#34d399"); return;
      }
    }
    if (tgt && tgt.type === "oil_derrick") {
      const engs = units.filter((id) => this.world.byId.get(id)?.type === "engineer");
      if (engs.length) { this.world.send({ t: "capture", ids: engs, target: tgt.id }); this.audio.play("click"); this.r.fx.addCmdMarker(tgt.pos.x, tgt.pos.y, "move", "#ffd23f"); return; }
      this.world.send({ t: "move", ids: units, x: tgt.pos.x, y: tgt.pos.y }); this.r.fx.addCmdMarker(tgt.pos.x, tgt.pos.y, "move", "#34d399"); return;
    }
    this.world.send({ t: "move", ids: units, x: w.x, y: w.y });
    this.audio.play("click");
    this.r.fx.addCmdMarker(w.x, w.y, "move", "#34d399");
  }

  // ===== Player 1 keyboard virtual-cursor actions (spec §24 → T24) =====
  // "Command" key: place a building, confirm an ability target, finish an attack-move, otherwise
  // issue the move/attack/capture command at the cursor (the keyboard equivalent of a mouse click).
  private commandAtCursor(): void {
    const sx = this._cx, sy = this._cy;
    const w = this.r.screenToWorld(sx, sy);
    if (this.r.placing) { this.placeBuilding(w.x, w.y); return; }
    if (this.pendingAbility >= 0) { this.castPending(w.x, w.y); return; }
    if (this.pendingAttackMove) {
      const units = this.ownUnits();
      if (units.length) { this.world.send({ t: "attackmove", ids: units, x: w.x, y: w.y }); this.audio.play("click"); this.r.fx.addCmdMarker(w.x, w.y, "attack", "#ffa726"); }
      this.pendingAttackMove = false; return;
    }
    this.issueCommandAt(sx, sy);
  }

  // "Select" key down: start a click-/box-select anchored at the cursor (mirrors a left mouse press).
  private beginCursorSelect(): void {
    this.dragStart = { x: this._cx, y: this._cy };
    this.dragging = false; this._selecting = true;
    this._mx = this._cx; this._my = this._cy;
  }
  // "Select" key up: complete it — a drag → box-select, a tap → click-select (mirrors mouse up).
  private endCursorSelect(): void {
    if (!this._selecting) return;
    if (this.dragStart && this.dragging) this.boxSelect(this.dragStart.x, this.dragStart.y, this._cx, this._cy, false);
    else if (this.dragStart) this.clickSelect(this._cx, this._cy, false);
    this.dragStart = null; this.dragging = false; this._selecting = false;
  }
  private cancelCursorSelect(): void { this._selecting = false; this.dragStart = null; this.dragging = false; }

  // ability slot bound to key `k` within a context's bindings, or -1.
  private abilitySlot(b: Bindings, k: string): number {
    if (k === b.ability1) return 0;
    if (k === b.ability2) return 1;
    if (k === b.ability3) return 2;
    if (k === b.ability4) return 3;
    return -1;
  }

  private placeBuilding(wx: number, wy: number): void {
    if (!this.r.placing) return;
    const tx = Math.floor(wx), ty = Math.floor(wy);
    this.world.send({ t: "build", owner: this.world.me, building: this.r.placing.building, x: tx, y: ty });
    this.audio.play("build");
    this.r.placing = null;
  }

  private castPending(wx: number, wy: number): void {
    const hero = this.heroEntity(); if (!hero) { this.pendingAbility = -1; return; }
    this.world.send({ t: "ability", hero: hero.id, slot: this.pendingAbility, x: Math.floor(wx), y: Math.floor(wy) });
    this.audio.play(this.pendingAbility === 3 ? "ultimate" : "ability");
    this.pendingAbility = -1;
    if (this.onAbilityConsumed) this.onAbilityConsumed();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.r.screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    this.r.cam.zoom = Math.max(10, Math.min(48, this.r.cam.zoom * factor));
    const after = this.r.screenToWorld(e.clientX, e.clientY);
    this.r.cam.x += before.x - after.x; this.r.cam.y += before.y - after.y; this.r.clampCam();
  }

  // train/command helpers used by the HUD too
  trainFromSelection(u: UnitId): void {
    for (const id of this.r.selection) {
      const e = this.world.byId.get(id);
      if (e && e.owner === this.world.me && e.kind === "building") this.world.send({ t: "train", building: e.id, unit: u });
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.keyboard) return;
    const k = normalizeKey(e);
    this.keys.add(k);
    if (k === "escape") {
      this.r.placing = null; this.pendingAbility = -1; this.pendingAttackMove = false;
      this.onCategoryCancel?.();
      this.cancelCursorSelect();
      return;
    }
    if (e.repeat) return; // held keys: movement is polled in updateCamera; don't re-fire discrete actions
    if (this.control === "p1-keyboard") this.onKeyP1(k);
    else if (this.control === "p2-mouse") this.onKeyP2(k);
    else this.onKeySingle(k, e);
  }

  private onKeyUp(e: KeyboardEvent): void {
    const k = normalizeKey(e);
    this.keys.delete(k);
    // Player 1 completes a keyboard select on release of the select key.
    if (this.control === "p1-keyboard" && k === getKeyBindings().p1.select) this.endCursorSelect();
  }

  // Player 1 (left, keyboard virtual cursor): select / command / abilities. Cursor movement keys
  // (W/A/S/D by default) are polled in updateCamera; here we only handle the discrete actions.
  private onKeyP1(k: string): void {
    const b = getKeyBindings().p1;
    if (k === b.command) { this.commandAtCursor(); return; }
    // T27 Part A: Space moves a focus highlight across the build categories; the select key (E)
    // opens the focused category. If no category is focused, select falls back to cursor-select.
    if (k === b.cycleCategory) { this.onCategoryFocus?.(); return; }
    if (k === b.select) {
      if (this.onCategoryConfirm && this.onCategoryConfirm()) return; // consumed the focused category
      this.beginCursorSelect(); return;
    }
    if (k === b.nextTab) { this.onCycleTab?.(1); return; }
    if (k === b.prevTab) { this.onCycleTab?.(-1); return; }
    // Digits 1..0 activate command-panel grid buttons #1..#10 (0 = the 10th), in visible order
    // (build → placing mode, train → queue, upgrade/research → buy). p1-keyboard has no control
    // groups, so this never clashes with single-player control-group recall (spec §24 → T26 E3).
    if (/^[0-9]$/.test(k)) { const idx = k === "0" ? 9 : parseInt(k, 10) - 1; this.onPanelDigit?.(idx); return; }
    const slot = this.abilitySlot(b, k);
    if (slot >= 0) this.setAbility(slot);
  }

  // Player 2 (right, mouse): only the hero ability keys (arrows by default). The mouse handles
  // select/command/zoom/pan; no keyboard camera (arrows are abilities), so there is no conflict.
  private onKeyP2(k: string): void {
    const slot = this.abilitySlot(getKeyBindings().p2, k);
    if (slot >= 0) this.setAbility(slot);
  }

  // Single-player / shared: the classic mouse + Q/W/E/R ability keys, stop/hold/attack-move and
  // Ctrl+0-9 control groups. Camera (arrows by default) is polled in updateCamera.
  private onKeySingle(k: string, e: KeyboardEvent): void {
    const b = getKeyBindings().shared;
    const units = this.ownUnits();
    const slot = this.abilitySlot(b, k);
    if (slot >= 0 && !e.ctrlKey) { this.setAbility(slot); return; }
    if (k === b.stop && units.length) { this.world.send({ t: "stop", ids: units }); return; }
    if (k === b.hold && units.length) { this.world.send({ t: "hold", ids: units }); return; }
    if (k === b.attackMove && units.length) { this.pendingAttackMove = true; return; }
    if (/^[0-9]$/.test(k)) {
      if (e.ctrlKey) { this.groups[k] = [...this.r.selection]; }
      else { const g = this.groups[k]; if (g) { this.r.selection = new Set(g.filter((id) => this.world.byId.has(id))); } }
    }
  }

  updateCamera(dt: number): void {
    const sp = 18 * dt / this.r.cam.zoom * 24;
    if (this.control === "p1-keyboard") { this.updateVirtualCursor(dt, sp); return; }
    // Keyboard camera (single-player / shared scheme): pan with the bound camera keys (arrows).
    if (this.keyboard && this.control === "single") {
      const b = getKeyBindings().shared;
      if (this.keys.has(b.cameraUp)) this.r.cam.y -= sp;
      if (this.keys.has(b.cameraDown)) this.r.cam.y += sp;
      if (this.keys.has(b.cameraLeft)) this.r.cam.x -= sp;
      if (this.keys.has(b.cameraRight)) this.r.cam.x += sp;
    }
    // Edge-scroll only when the owning pointer hovers inside THIS viewport (no cross-half scroll).
    const mx = this._mx, my = this._my;
    if (this.r.contains(mx, my) && !this.gesture) {
      const edge = 12;
      if (mx < this.r.vx + edge) this.r.cam.x -= sp; else if (mx > this.r.vx + this.r.W - edge) this.r.cam.x += sp;
      if (my < this.r.vy + edge) this.r.cam.y -= sp; else if (my > this.r.vy + this.r.H - edge) this.r.cam.y += sp;
    }
    this.r.clampCam();
  }

  // Move Player 1's on-screen virtual cursor with the bound cursor keys, clamped to the left
  // viewport; pan the camera when the cursor reaches a viewport edge (spec §24 → T24).
  private updateVirtualCursor(dt: number, sp: number): void {
    const r = this.r;
    if (!this._curInit) { this._cx = r.vx + r.W / 2; this._cy = r.vy + r.H / 2; this._curInit = true; }
    const b = getKeyBindings().p1;
    const csp = 760 * dt; // cursor speed (px/s)
    let dx = 0, dy = 0;
    if (this.keys.has(b.cursorUp)) dy -= 1;
    if (this.keys.has(b.cursorDown)) dy += 1;
    if (this.keys.has(b.cursorLeft)) dx -= 1;
    if (this.keys.has(b.cursorRight)) dx += 1;
    if (dx && dy) { const inv = Math.SQRT1_2; dx *= inv; dy *= inv; }
    this._cx += dx * csp; this._cy += dy * csp;
    // T28 Part C: held keyboard zoom — zoom about the cursor, clamped like the wheel/pinch (10..48).
    let zf = 0;
    if (this.keys.has(b.zoomIn)) zf += 1;
    if (this.keys.has(b.zoomOut)) zf -= 1;
    if (zf !== 0) {
      const before = r.screenToWorld(this._cx, this._cy);
      const factor = zf > 0 ? 1 + 1.8 * dt : 1 - 1.8 * dt;
      r.cam.zoom = Math.max(10, Math.min(48, r.cam.zoom * factor));
      const after = r.screenToWorld(this._cx, this._cy);
      r.cam.x += before.x - after.x; r.cam.y += before.y - after.y;
    }
    const m = 3;
    this._cx = Math.max(r.vx + m, Math.min(r.vx + r.W - m, this._cx));
    this._cy = Math.max(r.vy + m, Math.min(r.vy + r.H - m, this._cy));
    // Edge-pan when the cursor pushes against the viewport edge.
    const edge = 28;
    if (dx < 0 && this._cx <= r.vx + edge) r.cam.x -= sp;
    else if (dx > 0 && this._cx >= r.vx + r.W - edge) r.cam.x += sp;
    if (dy < 0 && this._cy <= r.vy + edge) r.cam.y -= sp;
    else if (dy > 0 && this._cy >= r.vy + r.H - edge) r.cam.y += sp;
    r.clampCam();
    this._mx = this._cx; this._my = this._cy;
    r.mouseWorld = r.screenToWorld(this._cx, this._cy);
    r.virtualCursor = { x: this._cx, y: this._cy };
    // Promote a held select into a box-select once the cursor has moved past the threshold.
    if (this._selecting && this.dragStart && Math.hypot(this._cx - this.dragStart.x, this._cy - this.dragStart.y) > 6) this.dragging = true;
  }
}
