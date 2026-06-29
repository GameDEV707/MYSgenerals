// MYS Generals — in-game HUD (spec §18.4). Vanilla DOM overlay (React-equivalent layer).
// Reads the client WorldView for one player and sends Commands via view.send. For split-screen
// (spec §21.1) each player gets its own HUD instance bound to its own view + root element.
import { WorldView, ViewEntity } from "../client/worldView.js";
import { Renderer } from "../render/renderer.js";
import { InputController } from "../input.js";
import { AudioManager } from "../render/audio.js";
import { BUILDING_DEFS, UNIT_DEFS, BUILD_MENU, RESEARCH_DEFS, RESEARCH_BY_ID } from "../data.js";
import { BuildingId, UnitId, Cost } from "../types.js";
import { MAX_BAYS, MAX_SPEED_LEVEL, ASSEMBLY_SPEED_PER_LEVEL, BAY_UPGRADE_COSTS, SPEED_UPGRADE_COSTS } from "../constants.js";
import { t, onLangChange } from "../i18n.js";
import { HudSide, HudLayout, WidgetState, loadHudLayout, saveHudLayout, clearHudLayout } from "./hudLayout.js";
import { getKeyBindings, keyLabel, BindContext } from "./keyBindings.js";

const ABILITY_ICONS = ["🔫", "🚩", "💨", "☄"];

interface WidgetMeta { key: string; nameKey: string; resizable: boolean; hideable: boolean; }
export type { HudSide } from "./hudLayout.js";

export class HUD {
  root: HTMLElement; world: WorldView; r: Renderer; input: InputController; audio: AudioManager;
  tab = "economy";
  private sig = "";
  onQuit?: () => void; onRematch?: () => void;
  onPauseToggle?: (paused: boolean) => void;
  showRematch = true;
  private toastBox!: HTMLElement;
  private ended = false;
  // when true the HUD is one half of a split screen (no full-screen pause; right-docked menu)
  compact = false;
  // which side of the screen this HUD occupies — drives default anchoring + per-side persistence
  side: HudSide = "single";
  // ---- HUD customization (spec §24 → T23): movable/resizable/hideable button groups ----
  private static WIDGETS: WidgetMeta[] = [
    { key: "resources", nameKey: "widget.resources", resizable: false, hideable: false },
    { key: "commands", nameKey: "widget.commands", resizable: true, hideable: true },
    { key: "selection", nameKey: "widget.selection", resizable: false, hideable: true },
    { key: "hero", nameKey: "widget.hero", resizable: false, hideable: true },
    { key: "minimap", nameKey: "widget.minimap", resizable: true, hideable: true },
  ];
  private layout: HudLayout = {};
  private editing = false;
  private overlays: HTMLElement[] = [];
  private editBar?: HTMLElement;

  constructor(root: HTMLElement, world: WorldView, r: Renderer, input: InputController, audio: AudioManager, side: HudSide = "single") {
    this.root = root; this.world = world; this.r = r; this.input = input; this.audio = audio; this.side = side;
    this.loadLayout();
    this.build();
    this.applyLayout();
    window.addEventListener("resize", () => { this.clampLayout(); this.applyLayout(); if (this.editing) this.refreshOverlays(); });
    onLangChange(() => { this.sig = ""; this.refreshStatic(); if (this.editing) { this.refreshOverlays(); this.buildEditBar(); } });
  }

  private me() { return this.world.players[this.world.me]; }
  private el(html: string): HTMLElement { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; }

  private build(): void {
    this.root.innerHTML = "";
    const hud = this.el(`<div class="hud"></div>`);
    hud.appendChild(this.el(`
      <div class="topbar hud-widget" data-widget="resources">
        <div class="res silver"><span class="dot silver"></span><span class="val" data-id="r-silver">0</span><span class="rate" data-id="r-silver-r"></span></div>
        <div class="res iron"><span class="dot iron"></span><span class="val" data-id="r-iron">0</span></div>
        <div class="res gold"><span class="dot gold"></span><span class="val" data-id="r-gold">0</span></div>
        <div class="power" data-id="power"><span>⚡</span><div class="bar"><div class="fill" data-id="power-fill"></div></div><span class="rate" data-id="power-txt"></span></div>
        <span class="timer" data-id="timer">0:00</span>
        <button class="btn" data-id="btn-edit" title="${t("hud.customize")}">✥</button>
        <button class="btn" data-id="btn-pause">☰</button>
      </div>`));
    hud.appendChild(this.el(`<div class="lowpower-banner" data-id="lowpower" style="display:none">${t("hud.lowPower")}</div>`));
    hud.appendChild(this.el(`<div class="cmdpanel hud-widget" data-widget="commands" data-id="cmdpanel"></div>`));
    hud.appendChild(this.el(`<div class="selinfo hud-widget" data-widget="selection" data-id="selinfo" style="display:none"></div>`));
    hud.appendChild(this.el(`<div class="herobar hud-widget" data-widget="hero" data-id="herobar"></div>`));
    hud.appendChild(this.el(`<div class="minimap-wrap hud-widget" data-widget="minimap" data-id="minimap-wrap"><canvas data-id="minimap" width="160" height="160"></canvas></div>`));
    this.toastBox = this.el(`<div class="toasts" data-id="toasts"></div>`);
    hud.appendChild(this.toastBox);
    this.root.appendChild(hud);
    this.hudRoot = hud;

    (this.q("btn-edit") as HTMLElement).onclick = () => { if (this.editing) this.exitEdit(); else this.enterEdit(); };
    (this.q("btn-pause") as HTMLElement).onclick = () => this.togglePause();
    const panel = this.q("cmdpanel") as HTMLElement;
    panel.addEventListener("click", (e) => this.onPanelClick(e));
    // T26 Part E: let the keyboard player (p1-keyboard) drive this panel with digits 1..0 and
    // cycle build categories with the bound nextTab/prevTab keys.
    this.input.onPanelDigit = (i) => this.activatePanelDigit(i);
    this.input.onCycleTab = (d) => this.cycleBuildTab(d);
    const herobar = this.q("herobar") as HTMLElement;
    herobar.addEventListener("click", (e) => this.onHeroClick(e));
    const mm = this.q("minimap") as HTMLCanvasElement;
    mm.addEventListener("mousedown", (e) => {
      const rect = mm.getBoundingClientRect();
      const wx = (e.clientX - rect.left) / 160 * this.world.map.w;
      const wy = (e.clientY - rect.top) / 160 * this.world.map.h;
      this.r.centerOn(wx, wy);
    });
  }
  private hudRoot!: HTMLElement;
  // scope lookups to this HUD's root so split-screen HUDs don't collide on ids
  private q(id: string): HTMLElement | null { return this.hudRoot.querySelector(`[data-id="${id}"]`); }

  private refreshStatic(): void {
    const lp = this.q("lowpower"); if (lp) lp.textContent = t("hud.lowPower");
  }

  update(_dt: number): void {
    const p = this.me(); if (!p) return;
    this.setText("r-silver", Math.floor(p.silver));
    this.setText("r-iron", Math.floor(p.iron));
    this.setText("r-gold", Math.floor(p.gold));
    const powerEl = this.q("power");
    const fill = this.q("power-fill");
    if (powerEl && fill) {
      const pct = p.powerGen > 0 ? Math.max(0, Math.min(1, (p.powerGen - p.powerUse) / Math.max(1, p.powerGen))) : 0;
      (fill as HTMLElement).style.width = (p.brownout ? 100 : pct * 100) + "%";
      powerEl.classList.toggle("deficit", p.brownout);
      this.setText("power-txt", `${p.powerGen}/${p.powerUse}`);
    }
    const lp = this.q("lowpower"); if (lp) lp.style.display = p.brownout ? "block" : "none";
    const mins = Math.floor(this.world.time / 60), secs = Math.floor(this.world.time % 60);
    this.setText("timer", `${mins}:${secs.toString().padStart(2, "0")}`);

    this.updatePanel();
    this.updateSelInfo();
    this.updateHeroBar();
    this.r.drawMinimap((this.q("minimap") as HTMLCanvasElement).getContext("2d")!, 160);

    if (this.world.winner !== -2 && !this.ended) this.showEnd();
  }

  private setText(id: string, v: string | number): void { const e = this.q(id); if (e) e.textContent = String(v); }

  private selectedEntities(): ViewEntity[] {
    const out: ViewEntity[] = [];
    for (const id of this.r.selection) { const e = this.world.byId.get(id); if (e) out.push(e); }
    return out;
  }

  private updatePanel(): void {
    const me = this.world.me;
    const sel = this.selectedEntities();
    const own = sel.filter((e) => e.owner === me);
    const miner = own.find((e) => e.type === "miner");
    const research = own.find((e) => e.kind === "building" && e.type === "research_center");
    const prod = own.find((e) => e.kind === "building" && BUILDING_DEFS[e.type as BuildingId].produces);
    const kb = this.input.control === "p1-keyboard" ? "K" : "";
    let sig = own.map((e) => e.id + e.type).join(",") + "|" + this.tab + "|" + kb + (miner ? "m" : "");
    if (prod) sig += "|P" + prod.id + ":" + prod.bays + ":" + prod.speedLevel + ":" + prod.queue.map((q) => q.unit).join(".");
    if (research) { const r = this.me().research; sig += "|R" + research.id + ":" + (research.researching ? "act" + research.researching.id : "idle") + ":" + r.weapons + r.armor + r.factoryTech + (r.logistics ? 1 : 0); }
    const panel = this.q("cmdpanel"); if (!panel) return;
    if (sig !== this.sig) { this.sig = sig; panel.innerHTML = this.panelHtml(own, miner, prod, research); this.decorateNumberBadges(panel); }
    if (prod) this.updateProdLive(panel, prod);
    if (research && research.researching) this.updateResearchLive(panel, research);
    this.updateAffordability(panel);
  }

  // Add 1..0 number badges to the panel's grid action buttons when a keyboard player is active
  // (spec §24 → T26 Part E), so the keyboard player can see which digit triggers each button.
  private decorateNumberBadges(panel: HTMLElement): void {
    if (this.input.control !== "p1-keyboard") return;
    const btns = panel.querySelectorAll<HTMLElement>(".gridbtn");
    btns.forEach((b, i) => {
      if (i >= 10) return;
      const n = i === 9 ? 0 : i + 1;
      const span = document.createElement("span");
      span.className = "numkey"; span.textContent = String(n);
      b.appendChild(span);
    });
  }

  // Live per-frame updates for a producing building's panel: queue ring + remaining seconds on the
  // active bay(s), and the per-train-button queued counts (spec §24 → T26 Part A).
  private updateProdLive(panel: HTMLElement, prod: ViewEntity): void {
    const counts: Record<string, number> = {};
    for (const it of prod.queue) counts[it.unit] = (counts[it.unit] || 0) + 1;
    panel.querySelectorAll<HTMLElement>("[data-id^=qb-]").forEach((el) => {
      const u = (el.getAttribute("data-id") || "").slice(3); const n = counts[u] || 0;
      el.style.display = n ? "flex" : "none"; el.textContent = String(n);
    });
    const active = Math.max(1, prod.bays);
    prod.queue.forEach((it, i) => {
      const ring = panel.querySelector(`[data-id=qr-${i}]`) as HTMLElement | null;
      const tm = panel.querySelector(`[data-id=qt-${i}]`) as HTMLElement | null;
      const isActive = i < active;
      if (ring) ring.style.setProperty("--p", `${isActive ? it.progress * 360 : 0}deg`);
      if (tm) tm.textContent = isActive ? String(Math.ceil((1 - it.progress) * it.time)) : "";
    });
  }

  private updateResearchLive(panel: HTMLElement, rc: ViewEntity): void {
    if (!rc.researching) return;
    const fill = panel.querySelector("[data-id=ra-fill]") as HTMLElement | null;
    const tm = panel.querySelector("[data-id=ra-time]") as HTMLElement | null;
    if (fill) fill.style.width = Math.min(100, rc.researching.progress * 100) + "%";
    if (tm) tm.textContent = Math.ceil((1 - rc.researching.progress) * rc.researching.time) + "s";
  }

  private panelHtml(own: ViewEntity[], miner: ViewEntity | undefined, prod: ViewEntity | undefined, research: ViewEntity | undefined): string {
    if (research) return this.researchPanelHtml(research);
    if (prod) return this.prodPanelHtml(prod);
    if (miner) {
      const tabs = ["economy", "military", "defense", "tech"].map((c) =>
        `<div class="tab ${this.tab === c ? "active" : ""}" data-act="tab" data-cat="${c}">${t("cat." + c)}</div>`).join("");
      const list = (BUILD_MENU[this.tab] || []).map((b) => this.buildBtn(b)).join("");
      return `<h4>${t("units.miner.name")} — ${t("cat.build")}</h4>
        <div class="tabs">${tabs}</div><div class="grid">${list}</div>`;
    }
    if (own.some((e) => e.kind === "unit")) {
      return `<h4>${t("hud.unitsSelected", { count: own.length })}</h4>
        <div class="grid">
          <div class="cmd" data-act="stop"><span class="ic">⏹</span>${t("cmd.stop")}</div>
          <div class="cmd" data-act="hold"><span class="ic">🛑</span>${t("cmd.hold")}</div>
          <div class="cmd" data-act="attackmove"><span class="ic">⚔</span>${t("cmd.attackMove")}</div>
        </div>`;
    }
    if (own.some((e) => e.kind === "building")) {
      return `<h4>${t(BUILDING_DEFS[(own[0].type as BuildingId)].nameKey)}</h4>
        <div class="grid"><div class="cmd" data-act="sell"><span class="ic">💰</span>${t("cmd.sell")}</div></div>`;
    }
    return `<h4>MYS Generals</h4><div style="font-size:12px;color:var(--text-dim)">${t("menu.singlePlayer")}</div>`;
  }

  // Producing-building panel: train buttons + factory upgrades + live FIFO queue strip (T26 A/B).
  private prodPanelHtml(prod: ViewEntity): string {
    const def = BUILDING_DEFS[prod.type as BuildingId];
    const trainBtns = (def.produces || []).map((u) => this.unitBtn(u)).join("");
    const upBtns = this.upgradeBtns(prod);
    return `<h4>${t(def.nameKey)} — ${t("cat.train")}</h4>
      <div class="grid">${trainBtns}${upBtns}</div>
      <div class="qrow"><span class="dimtxt">${t("cmd.rally")}: ${prod.rally ? "✓" : "—"}</span></div>
      ${this.queueStripHtml(prod)}`;
  }

  // The Research Center panel (replaces the bare Sell view): timed-research catalog, or the active
  // research with a progress bar + cancel button while one is running (spec §24 → T26 Part C).
  private researchPanelHtml(rc: ViewEntity): string {
    const head = `<h4>${t("buildings.researchCenter.name")} — ${t("research.title")}</h4>`;
    if (rc.researching) {
      const def = RESEARCH_BY_ID[rc.researching.id];
      return `${head}
        <div class="research-active">
          <div class="ra-name">${t("research.researching")} ${def ? t(def.nameKey) : ""}</div>
          <div class="bar"><div class="fill" data-id="ra-fill" style="width:0%"></div></div>
          <div class="ra-time"><span data-id="ra-time"></span></div>
        </div>
        <div class="grid"><div class="cmd gridbtn" data-act="cancelResearch"><span class="ic">✕</span><span>${t("research.cancel")}</span></div></div>`;
    }
    const btns = RESEARCH_DEFS.map((d) => this.researchBtn(d)).join("");
    return `${head}
      <div class="grid research-grid">${btns}</div>
      <div class="grid"><div class="cmd" data-act="sell"><span class="ic">💰</span>${t("cmd.sell")}</div></div>`;
  }

  private researchOwned(def: typeof RESEARCH_DEFS[number]): boolean {
    const r = this.me().research;
    switch (def.kind) {
      case "weapons": return r.weapons >= def.level;
      case "armor": return r.armor >= def.level;
      case "factoryTech": return r.factoryTech >= def.level;
      case "logistics": return r.logistics;
    }
  }
  private researchBtn(def: typeof RESEARCH_DEFS[number]): string {
    const owned = this.researchOwned(def);
    const locked = !!def.requires && !this.researchOwned(RESEARCH_BY_ID[def.requires]);
    const dis = owned || locked ? "disabled" : "";
    const sub = owned ? t("research.owned") : locked ? t("research.locked") : `${this.costStr(def.cost)} · ${def.time}s`;
    const costAttr = !owned && !locked ? `data-cost='${JSON.stringify(def.cost)}'` : "";
    return `<div class="cmd gridbtn ${dis}" data-act="research" data-rid="${def.id}" ${costAttr} title="${t(def.nameKey)} — ${t(def.descKey)}">
      <span class="ic">🔬</span><span>${t(def.nameKey)}</span><span class="cost">${sub}</span></div>`;
  }

  // Two factory-upgrade buttons (Production Bay, Assembly Speed), gated on Factory Tech (Part C).
  private upgradeBtns(prod: ViewEntity): string {
    const r = this.me().research;
    const bayMax = prod.bays >= MAX_BAYS;
    const bayLocked = !bayMax && r.factoryTech < prod.bays;            // step (bays-1) needs FT >= bays
    const bayCost = bayMax ? null : BAY_UPGRADE_COSTS[prod.bays - 1];
    const bayLabel = `${t("upgrade.bay")} (${prod.bays}/${MAX_BAYS})`;
    const speedMax = prod.speedLevel >= MAX_SPEED_LEVEL;
    const speedLocked = !speedMax && r.factoryTech < prod.speedLevel + 1;
    const speedCost = speedMax ? null : SPEED_UPGRADE_COSTS[prod.speedLevel];
    const speedLabel = `${t("upgrade.speed")} (+${ASSEMBLY_SPEED_PER_LEVEL * 100 * prod.speedLevel}%)`;
    return this.upBtn("bay", "🏗", bayLabel, bayCost, bayMax, bayLocked)
      + this.upBtn("speed", "⚙", speedLabel, speedCost, speedMax, speedLocked);
  }
  private upBtn(kind: "bay" | "speed", icon: string, label: string, cost: Cost | null, maxed: boolean, locked: boolean): string {
    const dis = maxed || locked ? "disabled" : "";
    const reason = maxed ? t("upgrade.maxed") : locked ? t("upgrade.needTech") : "";
    const sub = maxed ? t("upgrade.maxedShort") : cost ? this.costStr(cost) : "";
    const costAttr = cost && !maxed && !locked ? `data-cost='${JSON.stringify(cost)}'` : "";
    return `<div class="cmd gridbtn upgrade ${dis}" data-act="upgrade" data-kind="${kind}" ${costAttr} title="${label}${reason ? " — " + reason : ""}">
      <span class="ic">${icon}</span><span>${label}</span><span class="cost">${sub}</span></div>`;
  }

  // FIFO queue strip: per-slot unit icon, a radial progress ring + remaining seconds on the active
  // bay(s), click-to-cancel. Wires the previously-orphan `.radial` CSS (spec §24 → T26 Part A).
  private queueStripHtml(prod: ViewEntity): string {
    if (!prod.queue.length) return `<div class="queue empty">${t("hud.queueEmpty")}</div>`;
    const active = Math.max(1, prod.bays);
    const slots = prod.queue.map((it, i) => {
      const d = UNIT_DEFS[it.unit as UnitId];
      return `<div class="qslot ${i < active ? "active" : ""}" data-act="cancel" data-idx="${i}" title="${t(d.nameKey)} — ${t("hud.cancel")}">
        <span class="qic">${d.icon}</span>
        <div class="radial" data-id="qr-${i}" style="--p:0deg"></div>
        <span class="qtime" data-id="qt-${i}"></span>
        <span class="qx">✕</span>
      </div>`;
    }).join("");
    return `<div class="queue">${slots}</div>`;
  }

  private costStr(c: Cost): string {
    const parts: string[] = [];
    if (c.silver) parts.push(`⬜${c.silver}`);
    if (c.iron) parts.push(`⬛${c.iron}`);
    if (c.gold) parts.push(`🟨${c.gold}`);
    return parts.join(" ");
  }
  private buildBtn(b: BuildingId): string {
    const d = BUILDING_DEFS[b];
    return `<div class="cmd gridbtn" data-act="build" data-b="${b}" data-cost='${JSON.stringify(d.cost)}' title="${t(d.nameKey)}">
      <span class="ic">${d.icon}</span><span>${t(d.nameKey)}</span><span class="cost">${this.costStr(d.cost)}</span></div>`;
  }
  private unitBtn(u: UnitId): string {
    const d = UNIT_DEFS[u];
    return `<div class="cmd gridbtn" data-act="train" data-u="${u}" data-cost='${JSON.stringify(d.cost)}' title="${t(d.nameKey)}">
      <span class="ic">${d.icon}</span><span>${t(d.nameKey)}</span><span class="cost">${this.costStr(d.cost)}</span>
      <span class="qbadge" data-id="qb-${u}" style="display:none">0</span></div>`;
  }

  private updateAffordability(panel: HTMLElement): void {
    const p = this.me();
    panel.querySelectorAll<HTMLElement>(".cmd[data-cost]").forEach((btn) => {
      try {
        const c = JSON.parse(btn.dataset.cost || "{}") as Cost;
        const ok = p.silver >= (c.silver ?? 0) && p.iron >= (c.iron ?? 0) && p.gold >= (c.gold ?? 0);
        btn.classList.toggle("disabled", !ok);
      } catch { /* */ }
    });
  }

  private onPanelClick(ev: Event): void {
    const el = (ev.target as HTMLElement).closest(".tab, .qslot, .gridbtn, .cmd") as HTMLElement | null; if (!el) return;
    if (el.dataset.act === "tab") { this.tab = el.dataset.cat || "economy"; this.sig = ""; return; }
    this.activateCmd(el);
  }

  // Activate one command-panel button (shared by mouse clicks and the keyboard digit path, T26 E1).
  private activateCmd(el: HTMLElement): void {
    const me = this.world.me;
    const act = el.dataset.act;
    if (act === "build") { this.input.setPlacing(el.dataset.b as BuildingId); this.audio.play("click"); return; }
    if (act === "train") { this.input.trainFromSelection(el.dataset.u as UnitId); this.audio.play("click"); return; }
    if (act === "upgrade") { const b = this.selectedProd(); if (b) this.world.send({ t: "upgradeBuilding", building: b.id, kind: el.dataset.kind as "bay" | "speed" }); this.audio.play("click"); return; }
    if (act === "research") { const b = this.selectedResearch(); if (b && el.dataset.rid) this.world.send({ t: "research", building: b.id, id: el.dataset.rid }); this.audio.play("click"); return; }
    if (act === "cancelResearch") { const b = this.selectedResearch(); if (b) this.world.send({ t: "cancelResearch", building: b.id }); this.audio.play("click"); return; }
    if (act === "cancel") { const b = this.selectedProd(); if (b) this.world.send({ t: "cancel", building: b.id, index: parseInt(el.dataset.idx || "0", 10) }); this.audio.play("click"); return; }
    const units = this.selectedEntities().filter((e) => e.owner === me && e.kind === "unit").map((e) => e.id);
    if (act === "stop") this.world.send({ t: "stop", ids: units });
    if (act === "hold") this.world.send({ t: "hold", ids: units });
    if (act === "attackmove") this.input.pendingAttackMove = true;
    if (act === "sell") { for (const e of this.selectedEntities()) if (e.owner === me && e.kind === "building") this.world.send({ t: "sell", building: e.id }); }
    this.audio.play("click");
  }

  // The selected producing building / research center shown in the panel (for keyboard activation).
  private selectedProd(): ViewEntity | undefined {
    return this.selectedEntities().find((e) => e.owner === this.world.me && e.kind === "building" && !!BUILDING_DEFS[e.type as BuildingId].produces);
  }
  private selectedResearch(): ViewEntity | undefined {
    return this.selectedEntities().find((e) => e.owner === this.world.me && e.type === "research_center");
  }

  // T26 Part E: a digit key activates the Nth grid action button (in visible order).
  private activatePanelDigit(index: number): void {
    const panel = this.q("cmdpanel"); if (!panel) return;
    const btns = panel.querySelectorAll<HTMLElement>(".gridbtn");
    const el = btns[index]; if (el) this.activateCmd(el);
  }
  // T26 Part E: cycle the miner build categories (only meaningful when the miner panel is shown).
  private cycleBuildTab(dir: number): void {
    const cats = ["economy", "military", "defense", "tech"];
    const i = cats.indexOf(this.tab);
    if (i < 0) return;
    this.tab = cats[(i + dir + cats.length) % cats.length];
    this.sig = "";
  }

  private updateSelInfo(): void {
    const box = this.q("selinfo"); if (!box) return;
    if (this.layout.selection?.hidden) { box.style.display = "none"; return; }
    const sel = this.selectedEntities();
    if (sel.length === 0) { box.style.display = "none"; return; }
    box.style.display = "block";
    const e = sel[0];
    const name = e.kind === "building" ? t(BUILDING_DEFS[e.type as BuildingId].nameKey)
      : e.kind === "neutral" ? t("buildings.oilDerrick.name") : t(UNIT_DEFS[e.type as UnitId].nameKey);
    const chev = e.rank > 0 ? `<span class="chev">${"›".repeat(e.rank)}</span>` : "";
    let extra = "";
    if (e.hero) { const p = this.world.players[e.owner]; extra = `<div style="font-size:12px">Lvl ${p.heroLevel}</div><div class="bar mana"><div class="fill" style="width:${e.hero.mana / e.hero.maxMana * 100}%"></div></div>`; }
    box.innerHTML = `<div class="name">${name} ${chev}</div>
      <div class="bar"><div class="fill" style="width:${Math.max(0, e.hp / e.maxHp * 100)}%"></div></div>
      <div style="font-size:12px;color:var(--text-dim)">HP ${Math.ceil(e.hp)}/${e.maxHp}</div>
      ${extra}
      ${sel.length > 1 ? `<div style="margin-top:4px;font-size:12px">${t("hud.unitsSelected", { count: sel.length })}</div>` : ""}`;
  }

  private updateHeroBar(): void {
    const bar = this.q("herobar"); if (!bar) return;
    const p = this.me();
    const hero = p.heroId ? this.world.byId.get(p.heroId) : undefined;
    if (!hero || !hero.hero) {
      const respawn = p.heroRespawnAt > 0 ? Math.ceil(p.heroRespawnAt - this.world.time) : 0;
      bar.innerHTML = `<div class="hero-portrait"><div>${t("units.hero.name")}</div><div class="respawn">${respawn > 0 ? respawn : "…"}</div></div>`;
      return;
    }
    const h = hero.hero;
    const keys = this.abilityKeyLabels();
    const abilities = [0, 1, 2, 3].map((s) => {
      const ab = h.abilities[s];
      const cd = Math.max(0, ab.cdUntil - this.world.time);
      const cdPct = cd > 0 ? Math.min(1, cd / [8, 16, 10, 70][s]) : 0;
      const pips = [0, 1, 2, 3].map((i) => `<span class="pip ${i < ab.rank ? "on" : ""}"></span>`).join("");
      const dis = ab.rank <= 0 ? "opacity:0.4" : "";
      return `<div class="ability" data-slot="${s}" style="${dis}" title="${t("abilities." + ["q","w","e","r"][s] + ".name")} (${keys[s]})">
        <span class="key">${keys[s]}</span><span>${ABILITY_ICONS[s]}</span>
        <div class="pips">${pips}</div>
        ${cd > 0 ? `<div class="cd" style="--p:${cdPct * 360}deg">${Math.ceil(cd)}</div>` : ""}
        ${this.input.pendingAbility === s ? `<div class="cd" style="--p:0deg;border:2px solid var(--accent)"></div>` : ""}
      </div>`;
    }).join("");
    bar.innerHTML = `<div class="hero-portrait">
        <div class="lvl">★ Lvl ${p.heroLevel}</div>
        <div class="bar"><div class="fill" style="width:${hero.hp / hero.maxHp * 100}%"></div></div>
        <div class="bar mana"><div class="fill" style="width:${h.mana / h.maxMana * 100}%"></div></div>
      </div>${abilities}`;
  }
  // The four hero ability hotkey labels for THIS player, read live from the binding store so HUD
  // hints always match the current (remappable) keys. Left HUD = P1 keys, right HUD = P2 keys,
  // single-player = the shared scheme (spec §24 → T24).
  private abilityKeyLabels(): string[] {
    const ctx: BindContext = this.side === "left" ? "p1" : this.side === "right" ? "p2" : "shared";
    const b = getKeyBindings()[ctx];
    return [keyLabel(b.ability1), keyLabel(b.ability2), keyLabel(b.ability3), keyLabel(b.ability4)];
  }

  private onHeroClick(ev: Event): void {
    const el = (ev.target as HTMLElement).closest(".ability") as HTMLElement | null; if (!el) return;
    this.input.setAbility(parseInt(el.dataset.slot || "0", 10));
  }

  toast(key: string, kind?: string, params?: Record<string, string | number>): void {
    // Some toasts carry an i18n key as a param value (e.g. a unit/building/research name) so the
    // sim stays engine-agnostic; translate those dotted keys here before interpolation.
    let p = params;
    if (params) {
      p = {};
      for (const k of Object.keys(params)) {
        const v = params[k];
        p[k] = typeof v === "string" && /^(units|buildings|abilities|research|cat)\./.test(v) ? t(v) : v;
      }
    }
    const node = this.el(`<div class="toast ${kind || ""}">${t(key, p)}</div>`);
    this.toastBox.appendChild(node);
    if (kind === "danger") this.audio.play("deny"); else this.audio.play("ready");
    setTimeout(() => node.remove(), 3200);
    while (this.toastBox.children.length > 5) this.toastBox.firstElementChild?.remove();
  }

  private togglePause(): void {
    const exist = this.hudRoot.querySelector("[data-id=pausemenu]");
    if (exist) { exist.remove(); this.input.paused = false; this.onPauseToggle?.(false); return; }
    this.input.paused = true; this.onPauseToggle?.(true);
    const m = this.el(`<div class="screen" data-id="pausemenu" style="background:rgba(5,8,12,0.8)">
      <div class="menu"><h2>${t("hud.paused")}</h2>
        <button class="btn primary" data-id="p-resume">${t("hud.resume")}</button>
        <button class="btn danger" data-id="p-surrender">${t("hud.surrender")}</button>
        <button class="btn" data-id="p-quit">${t("hud.quitToMenu")}</button>
      </div></div>`);
    this.hudRoot.appendChild(m);
    (m.querySelector("[data-id=p-resume]") as HTMLElement).onclick = () => { m.remove(); this.input.paused = false; this.onPauseToggle?.(false); };
    (m.querySelector("[data-id=p-surrender]") as HTMLElement).onclick = () => { this.world.send({ t: "surrender", owner: this.world.me }); m.remove(); this.input.paused = false; this.onPauseToggle?.(false); };
    (m.querySelector("[data-id=p-quit]") as HTMLElement).onclick = () => { m.remove(); this.input.paused = false; this.onQuit?.(); };
  }

  private showEnd(): void {
    this.ended = true;
    const win = this.world.winner === this.world.me;
    const p = this.me();
    this.audio.play(win ? "ready" : "alarm");
    const m = this.el(`<div class="endscreen">
      <div class="banner ${win ? "win" : "lose"}">${win ? t("hud.victory") : t("hud.defeat")}</div>
      <div class="stats">
        ${t("stats.unitsBuilt")}: ${p.unitsBuilt}<br>
        ${t("stats.unitsLost")}: ${p.unitsLost}<br>
        ${t("stats.buildingsDestroyed")}: ${p.buildingsDestroyed}<br>
        ${t("stats.time")}: ${Math.floor(this.world.time / 60)}:${Math.floor(this.world.time % 60).toString().padStart(2, "0")}
      </div>
      <div class="row">
        ${this.showRematch ? `<button class="btn primary" data-id="e-rematch">${t("hud.rematch")}</button>` : ""}
        <button class="btn" data-id="e-quit">${t("hud.quitToMenu")}</button>
      </div></div>`);
    this.root.appendChild(m);
    const rm = m.querySelector("[data-id=e-rematch]") as HTMLElement | null;
    if (rm) rm.onclick = () => this.onRematch?.();
    (m.querySelector("[data-id=e-quit]") as HTMLElement).onclick = () => this.onQuit?.();
  }

  // ===================== HUD customization (spec §24 → T23) =====================
  private widgetEl(key: string): HTMLElement | null { return this.hudRoot.querySelector(`[data-widget="${key}"]`); }

  private loadLayout(): void { this.layout = loadHudLayout(this.side); }
  private saveLayout(): void { saveHudLayout(this.side, this.layout); }

  // Apply the stored layout (inline overrides) on top of the side-anchored CSS defaults.
  private applyLayout(): void {
    for (const w of HUD.WIDGETS) {
      const el = this.widgetEl(w.key); if (!el) continue;
      const s = this.layout[w.key] || {};
      if (w.key !== "selection") el.style.display = s.hidden ? "none" : "";
      if (s.x != null && s.y != null) {
        el.style.left = s.x + "px"; el.style.top = s.y + "px";
        el.style.right = "auto"; el.style.bottom = "auto"; el.style.transform = "none";
      } else {
        el.style.left = ""; el.style.top = ""; el.style.right = ""; el.style.bottom = ""; el.style.transform = "";
      }
      if (w.resizable) {
        el.style.width = s.w != null ? s.w + "px" : "";
        el.style.height = s.h != null ? s.h + "px" : "";
        if (w.key === "minimap" && s.w != null) {
          const c = el.querySelector("canvas") as HTMLElement | null;
          if (c) { const d = Math.max(80, s.w - 12); c.style.width = d + "px"; c.style.height = d + "px"; }
        }
      }
    }
  }

  // Keep custom positions inside the (possibly resized) viewport half.
  private clampLayout(): void {
    const rect = this.hudRoot.getBoundingClientRect();
    for (const w of HUD.WIDGETS) {
      const s = this.layout[w.key]; if (!s || s.x == null || s.y == null) continue;
      const el = this.widgetEl(w.key); const ew = el?.offsetWidth ?? 100, eh = el?.offsetHeight ?? 60;
      s.x = Math.max(0, Math.min(Math.max(0, rect.width - ew), s.x));
      s.y = Math.max(0, Math.min(Math.max(0, rect.height - eh), s.y));
    }
  }

  private setWidget(key: string, patch: Partial<WidgetState>, defer = false): void {
    this.layout[key] = { ...(this.layout[key] || {}), ...patch };
    this.applyLayout();
    if (!defer) this.saveLayout();
  }

  private enterEdit(): void {
    this.editing = true;
    this.hudRoot.classList.add("editing");
    this.refreshOverlays();
    this.buildEditBar();
  }
  private exitEdit(): void {
    this.editing = false;
    this.hudRoot.classList.remove("editing");
    this.clearOverlays();
    this.editBar?.remove(); this.editBar = undefined;
    this.saveLayout();
  }
  private resetLayout(): void {
    this.layout = {};
    clearHudLayout(this.side);
    this.applyLayout();
    this.refreshOverlays();
    this.buildEditBar();
  }

  private clearOverlays(): void { for (const o of this.overlays) o.remove(); this.overlays = []; }

  private refreshOverlays(): void {
    this.clearOverlays();
    if (!this.editing) return;
    const rootRect = this.hudRoot.getBoundingClientRect();
    for (const w of HUD.WIDGETS) {
      if (this.layout[w.key]?.hidden) continue;
      const el = this.widgetEl(w.key); if (!el || el.style.display === "none") continue;
      const r = el.getBoundingClientRect();
      const ov = this.el(`<div class="widget-edit">
        <span class="we-label">${t(w.nameKey)}</span>
        ${w.hideable ? `<button class="we-hide" title="${t("hud.hide")}">✕</button>` : ""}
        ${w.resizable ? `<span class="we-resize" title="${t("hud.editHint")}"></span>` : ""}
      </div>`);
      ov.style.left = (r.left - rootRect.left) + "px";
      ov.style.top = (r.top - rootRect.top) + "px";
      ov.style.width = r.width + "px";
      ov.style.height = r.height + "px";
      this.hudRoot.appendChild(ov);
      this.overlays.push(ov);
      this.wireOverlay(ov, el, w);
    }
  }

  // Only the player's OWN device may drag/resize their HUD (touch player via touch, mouse via mouse).
  private acceptEditPointer(e: PointerEvent): boolean {
    const pt = this.input.pointerType;
    return !pt || e.pointerType === pt;
  }

  private wireOverlay(ov: HTMLElement, el: HTMLElement, w: WidgetMeta): void {
    const hide = ov.querySelector(".we-hide") as HTMLElement | null;
    if (hide) {
      hide.addEventListener("pointerdown", (e) => e.stopPropagation());
      hide.addEventListener("click", (e) => { e.stopPropagation(); this.setWidget(w.key, { hidden: true }); this.refreshOverlays(); this.buildEditBar(); });
    }
    const rz = ov.querySelector(".we-resize") as HTMLElement | null;

    ov.addEventListener("pointerdown", (e) => {
      if (!this.acceptEditPointer(e)) return;
      const onResize = rz && (e.target === rz);
      if ((e.target as HTMLElement).closest(".we-hide")) return;
      e.preventDefault(); e.stopPropagation();
      try { ov.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const rootRect = this.hudRoot.getBoundingClientRect();
      const base = el.getBoundingClientRect();
      const ox = base.left - rootRect.left, oy = base.top - rootRect.top;
      const bw = base.width, bh = base.height;
      const sx = e.clientX, sy = e.clientY;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        if (onResize) {
          const nw = Math.max(120, Math.round(bw + (ev.clientX - sx)));
          const nh = w.key === "minimap" ? nw : Math.max(90, Math.round(bh + (ev.clientY - sy)));
          this.setWidget(w.key, { w: nw, h: nh }, true);
          ov.style.width = nw + "px"; ov.style.height = nh + "px";
        } else {
          let nx = Math.round(ox + (ev.clientX - sx)), ny = Math.round(oy + (ev.clientY - sy));
          nx = Math.max(0, Math.min(Math.max(0, rootRect.width - bw), nx));
          ny = Math.max(0, Math.min(Math.max(0, rootRect.height - bh), ny));
          this.setWidget(w.key, { x: nx, y: ny }, true);
          ov.style.left = nx + "px"; ov.style.top = ny + "px";
        }
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        this.saveLayout();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }

  private buildEditBar(): void {
    this.editBar?.remove();
    const hidden = HUD.WIDGETS.filter((w) => w.hideable && this.layout[w.key]?.hidden);
    const hiddenHtml = hidden.length
      ? `<span class="dim">${t("hud.hiddenGroups")}</span>` + hidden.map((w) => `<button class="btn tiny" data-show="${w.key}">${t("hud.show")}: ${t(w.nameKey)}</button>`).join("")
      : "";
    const bar = this.el(`<div class="hud-edit-bar">
      <span class="dim">${t("hud.editHint")}</span>
      ${hiddenHtml}
      <button class="btn tiny" data-id="he-reset">${t("hud.resetLayout")}</button>
      <button class="btn tiny primary" data-id="he-done">${t("hud.editDone")}</button>
    </div>`);
    this.hudRoot.appendChild(bar);
    this.editBar = bar;
    bar.querySelectorAll<HTMLElement>("[data-show]").forEach((b) => b.onclick = () => { this.setWidget(b.dataset.show!, { hidden: false }); this.refreshOverlays(); this.buildEditBar(); });
    (bar.querySelector("[data-id=he-reset]") as HTMLElement).onclick = () => this.resetLayout();
    (bar.querySelector("[data-id=he-done]") as HTMLElement).onclick = () => this.exitEdit();
  }
}
