// MYS Generals — main menu & lobby flow (spec §18.1–§18.3).
import { t, setLang, getLang, onLangChange, Lang } from "../i18n.js";
import { Lobby, PALETTE } from "../host/lobby.js";
import { SessionConfig, SessionPlayer, LocalSpec, Difficulty } from "../client/session.js";
import { getMap } from "../sim/map.js";
import { qrMatrix } from "../net/qr.js";
import { LobbyState } from "../net/protocol.js";
import { SocketTransport } from "../net/socketTransport.js";
import { SplitInputConfig, PointerDevice, loadSplitInput, saveSplitInput, resolveSplitInput, hasTouch } from "../client/splitInput.js";
import { ACTION_DEFS, getKeyBindings, keyLabel, setBinding, resetKeyBindings, normalizeKey, BindContext } from "./keyBindings.js";

export interface JoinUI { setStatus: (key: string, isError?: boolean) => void; }
export interface MenuCallbacks {
  onStartLocal: (cfg: SessionConfig) => void;
  onJoin: (opts: { url: string; name: string }, ui: JoinUI) => void;
}

const MAPS = ["twin_rivers", "crossfire"];

export class Menu {
  root: HTMLElement;
  cb: MenuCallbacks;
  private lobby: Lobby | null = null;
  private splitInput: SplitInputConfig = loadSplitInput();

  constructor(root: HTMLElement, cb: MenuCallbacks) {
    this.root = root; this.cb = cb;
    onLangChange(() => {
      if (this.root.querySelector("[data-screen=title]")) this.showTitle();
      else if (this.root.querySelector("[data-screen=play]")) this.showPlayMenu();
      else if (this.root.querySelector("[data-screen=settings]")) this.showSettings();
      else if (this.root.querySelector("[data-screen=lobby]") && this.lobby) this.renderLobby();
    });
  }

  private el(html: string): HTMLElement { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; }
  private langSwitch(): string {
    const langs: Lang[] = ["en", "ru", "uz"];
    return `<div class="lang-switch">${langs.map((l) => `<button class="btn ${getLang() === l ? "active" : ""}" data-lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>`;
  }
  private wireLang(scr: HTMLElement): void {
    scr.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) => b.onclick = () => setLang(b.dataset.lang as Lang));
  }

  showTitle(): void {
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen" data-screen="title">
      ${this.langSwitch()}
      <div class="logo">${t("menu.title")}<small>${t("menu.subtitle")}</small></div>
      <div class="menu">
        <button class="btn primary" data-id="m-play">${t("menu.play")}</button>
        <button class="btn" data-id="m-settings">${t("menu.settings")}</button>
        <button class="btn" data-id="m-help">${t("menu.howToPlay")}</button>
      </div>
      <div class="hint">© MYS Generals</div>
    </div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    (scr.querySelector("[data-id=m-play]") as HTMLElement).onclick = () => this.showPlayMenu();
    (scr.querySelector("[data-id=m-settings]") as HTMLElement).onclick = () => this.showSettings();
    (scr.querySelector("[data-id=m-help]") as HTMLElement).onclick = () => this.showHelp();
  }

  private showPlayMenu(): void {
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen" data-screen="play">
      ${this.langSwitch()}
      <div class="menu">
        <h2>${t("menu.play")}</h2>
        <button class="btn primary" data-id="p-single">${t("menu.singlePlayer")}</button>
        <button class="btn" data-id="p-host">${t("menu.hostGame")}</button>
        <button class="btn" data-id="p-join">${t("menu.joinGame")}</button>
        <button class="btn" data-id="p-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    (scr.querySelector("[data-id=p-single]") as HTMLElement).onclick = () => this.showSetup();
    (scr.querySelector("[data-id=p-host]") as HTMLElement).onclick = () => this.showLobby();
    (scr.querySelector("[data-id=p-join]") as HTMLElement).onclick = () => this.showJoin();
    (scr.querySelector("[data-id=p-back]") as HTMLElement).onclick = () => this.showTitle();
  }

  // ---------- Single Player (vs AI) ----------
  private spCfg = { map: "twin_rivers", difficulty: "normal" as Difficulty, color: PALETTE[0], aiCount: 1 };
  private showSetup(): void {
    this.root.innerHTML = "";
    const maxAI = getMap(this.spCfg.map).spawns.length - 1;
    if (this.spCfg.aiCount > maxAI) this.spCfg.aiCount = maxAI;
    const scr = this.el(`<div class="screen" data-screen="setup">
      ${this.langSwitch()}
      <div class="menu">
        <h2>${t("menu.singlePlayer")}</h2>
        <div class="field"><label>${t("menu.map")}</label>
          <select data-id="s-map">
            ${MAPS.map((m) => `<option value="${m}" ${this.spCfg.map === m ? "selected" : ""}>${t(m === "twin_rivers" ? "menu.mapA" : "menu.mapB")}</option>`).join("")}
          </select></div>
        <div class="field"><label>${t("menu.difficulty")}</label>
          <select data-id="s-diff">
            <option value="easy">${t("menu.easy")}</option>
            <option value="normal" selected>${t("menu.normal")}</option>
            <option value="hard">${t("menu.hard")}</option>
          </select></div>
        <div class="field"><label>${t("menu.hero")}</label>
          <select data-id="s-hero"><option>${t("menu.heroCommander")}</option></select></div>
        <div class="field" data-id="s-aiwrap"><label>${t("lobby.aiPlayer")} (1–${maxAI})</label>
          <select data-id="s-ai">${Array.from({ length: maxAI }, (_, i) => `<option value="${i + 1}" ${this.spCfg.aiCount === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></div>
        <div class="field"><label>${t("menu.color")}</label>
          <div class="row" data-id="s-colors">${PALETTE.map((c) => `<button class="btn swatch" data-color="${c}" style="background:${c};width:36px;height:36px;${this.spCfg.color === c ? "outline:2px solid #fff" : ""}"></button>`).join("")}</div></div>
        <button class="btn primary" data-id="s-start">${t("menu.start")}</button>
        <button class="btn" data-id="s-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    (scr.querySelector("[data-id=s-map]") as HTMLSelectElement).onchange = (e) => { this.spCfg.map = (e.target as HTMLSelectElement).value; this.showSetup(); };
    (scr.querySelector("[data-id=s-diff]") as HTMLSelectElement).onchange = (e) => this.spCfg.difficulty = (e.target as HTMLSelectElement).value as Difficulty;
    (scr.querySelector("[data-id=s-ai]") as HTMLSelectElement).onchange = (e) => this.spCfg.aiCount = parseInt((e.target as HTMLSelectElement).value, 10);
    scr.querySelectorAll<HTMLElement>("[data-color]").forEach((b) => b.onclick = () => {
      this.spCfg.color = b.dataset.color!;
      scr.querySelectorAll<HTMLElement>("[data-color]").forEach((x) => x.style.outline = "none");
      b.style.outline = "2px solid #fff";
    });
    (scr.querySelector("[data-id=s-start]") as HTMLElement).onclick = () => this.startSingle();
    (scr.querySelector("[data-id=s-back]") as HTMLElement).onclick = () => this.showPlayMenu();
  }

  private startSingle(): void {
    const colors = PALETTE.filter((c) => c !== this.spCfg.color);
    const players: SessionPlayer[] = [{ id: 0, isAI: false, aiDiff: this.spCfg.difficulty, color: this.spCfg.color, hero: 0 }];
    for (let i = 1; i <= this.spCfg.aiCount; i++) players.push({ id: i, isAI: true, aiDiff: this.spCfg.difficulty, color: colors[(i - 1) % colors.length], hero: 0 });
    const locals: LocalSpec[] = [{ playerId: 0, pointerType: null, keyboard: true, control: "single" }];
    this.root.innerHTML = "";
    this.cb.onStartLocal({ map: this.spCfg.map, players, locals, split: false, showRematch: true, onQuit: () => this.showTitle() });
  }

  // ---------- Local Game on this computer (loopback: single-player extras, split-screen, AI) ----------
  // This path runs an in-page MatchHost over LoopbackTransport. A browser cannot run a WebSocket
  // server, so it can NEVER accept remote devices — for that the user runs the real Node host
  // (host.bat / host.sh / host.command). Hence no join URL/QR is shown here (spec §24 T25 #2/#3).
  private showLobby(): void {
    this.lobby = new Lobby("");
    this.lobby.onChange = () => this.renderLobby();
    this.renderLobby();
  }

  private renderLobby(): void {
    const lobby = this.lobby!; const st = lobby.state;
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen lobby-screen" data-screen="lobby">
      ${this.langSwitch()}
      <div class="lobby">
        <h2>${t("lobby.title")}</h2>
        <div class="lobby-cols">
          <div class="lobby-main">
            <div class="field"><label>${t("menu.map")}</label>
              <select data-id="l-map">${MAPS.map((m) => `<option value="${m}" ${st.map === m ? "selected" : ""}>${t(m === "twin_rivers" ? "menu.mapA" : "menu.mapB")}</option>`).join("")}</select>
              <div class="mapdesc">${t("lobby.mapDesc." + st.map)}<br><span class="dim">${t("lobby.recommended", { n: getMap(st.map).spawns.length })}</span></div>
            </div>
            <div class="slots" data-id="l-slots">${st.slots.map((s) => this.slotHtml(s)).join("")}</div>
            <label class="splitrow"><input type="checkbox" data-id="l-split" ${st.splitScreen ? "checked" : ""}/> ${t("lobby.splitScreen")}</label>
            <div class="dim" style="font-size:11px">${t("lobby.splitHint")}</div>
            ${st.splitScreen ? this.splitInputHtml() : ""}
            <div class="row" style="margin-top:10px">
              <button class="btn" data-id="l-addai">${t("lobby.addAI")}</button>
              <button class="btn primary" data-id="l-start" ${lobby.canStart() ? "" : "disabled"}>${t("lobby.start")}</button>
              <button class="btn" data-id="l-back">${t("menu.back")}</button>
            </div>
            <div class="dim" style="font-size:12px;margin-top:6px">${lobby.canStart() ? t("lobby.allReady") : t("lobby.waiting")}</div>
          </div>
          <div class="lobby-conn">
            <h4>${t("lobby.connection")}</h4>
            <div class="dim lan-note">${t("lobby.localOnlyNote")}</div>
            <div class="devices"><h4>${t("lobby.devices")}</h4><div data-id="l-devices">${this.devicesHtml()}</div></div>
          </div>
        </div>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);

    (scr.querySelector("[data-id=l-map]") as HTMLSelectElement).onchange = (e) => lobby.setMap((e.target as HTMLSelectElement).value);
    (scr.querySelector("[data-id=l-split]") as HTMLInputElement).onchange = (e) => lobby.setSplit((e.target as HTMLInputElement).checked);
    this.wireSplitInput(scr);
    (scr.querySelector("[data-id=l-addai]") as HTMLElement).onclick = () => lobby.addAI("normal");
    (scr.querySelector("[data-id=l-back]") as HTMLElement).onclick = () => { this.lobby = null; this.showPlayMenu(); };
    (scr.querySelector("[data-id=l-start]") as HTMLElement).onclick = () => this.startLobby();
    // slot controls
    scr.querySelectorAll<HTMLElement>("[data-slot-act]").forEach((b) => {
      b.onclick = () => {
        const i = parseInt(b.dataset.slot || "0", 10);
        const act = b.dataset.slotAct;
        if (act === "addai") lobby.addAI("normal");
        else if (act === "kick") lobby.kick(i);
        else if (act === "open") lobby.openSlot(i);
        else if (act === "close") lobby.closeSlot(i);
        else if (act === "ready") lobby.setReady(i, !st.slots[i].ready);
      };
    });
    scr.querySelectorAll<HTMLElement>("[data-slot-color]").forEach((b) => {
      b.onclick = () => lobby.setColor(parseInt(b.dataset.slot || "0", 10), b.dataset.slotColor!);
    });
  }

  private splitInputHtml(): string {
    const c = this.splitInput;
    const devOpts = (sel: PointerDevice) =>
      `<option value="keyboard" ${sel === "keyboard" ? "selected" : ""}>${t("device.keyboard")}</option>` +
      `<option value="mouse" ${sel === "mouse" ? "selected" : ""}>${t("device.mouse")}</option>` +
      `<option value="touch" ${sel === "touch" ? "selected" : ""}>${t("device.touch")}</option>`;
    const note = hasTouch() ? "" : `<div class="dim" style="font-size:11px;margin-top:6px">${t("lobby.noTouchHint")}</div>`;
    return `<div class="split-input">
      <div class="dim" style="font-size:12px;margin:10px 0 4px">${t("lobby.inputDevices")}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="gap:3px"><span class="dim" style="font-size:11px">${t("lobby.playerLeft")}</span>
          <select data-id="si-left">${devOpts(c.left)}</select></label>
        <label class="field" style="gap:3px"><span class="dim" style="font-size:11px">${t("lobby.playerRight")}</span>
          <select data-id="si-right">${devOpts(c.right)}</select></label>
        <button class="btn tiny" data-id="si-swap">⇄ ${t("lobby.swapDevices")}</button>
      </div>${note}</div>`;
  }

  private wireSplitInput(scr: HTMLElement): void {
    const left = scr.querySelector("[data-id=si-left]") as HTMLSelectElement | null;
    if (!left) return;
    const right = scr.querySelector("[data-id=si-right]") as HTMLSelectElement;
    const swap = scr.querySelector("[data-id=si-swap]") as HTMLElement;
    const commit = () => { saveSplitInput(this.splitInput); this.renderLobby(); };
    left.onchange = () => { this.splitInput.left = left.value as PointerDevice; commit(); };
    right.onchange = () => { this.splitInput.right = right.value as PointerDevice; commit(); };
    swap.onclick = () => {
      const tmp = this.splitInput.left; this.splitInput.left = this.splitInput.right; this.splitInput.right = tmp;
      commit();
    };
  }

  private slotHtml(s: import("../net/protocol.js").LobbySlot): string {
    const isHostSlot = s.index === 0;
    const colorPick = (s.kind === "human")
      ? `<div class="swatches">${PALETTE.map((c) => `<span class="mini-swatch ${s.color === c ? "on" : ""}" data-slot="${s.index}" data-slot-color="${c}" style="background:${c}"></span>`).join("")}</div>` : "";
    let right = "";
    if (s.kind === "open") right = `<button class="btn tiny" data-slot="${s.index}" data-slot-act="addai">${t("lobby.addAI")}</button><button class="btn tiny" data-slot="${s.index}" data-slot-act="close">${t("lobby.closeSlot")}</button>`;
    else if (s.kind === "closed") right = `<span class="dim">${t("lobby.closed")}</span><button class="btn tiny" data-slot="${s.index}" data-slot-act="open">${t("lobby.openSlot")}</button>`;
    else if (s.kind === "ai") right = `<span class="badge">${t("lobby.aiPlayer")} · ${t("menu." + (s.ai || "normal"))}</span><button class="btn tiny" data-slot="${s.index}" data-slot-act="kick">${t("lobby.kick")}</button>`;
    else if (s.kind === "human") {
      const label = isHostSlot ? t("lobby.host") : (s.token ? s.name : t("lobby.playerB"));
      const readyBtn = isHostSlot ? `<button class="btn tiny ${s.ready ? "primary" : ""}" data-slot="${s.index}" data-slot-act="ready">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</button>` : `<span class="badge ${s.ready ? "ok" : ""}">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</span>`;
      const kick = (!isHostSlot && s.token) ? `<button class="btn tiny" data-slot="${s.index}" data-slot-act="kick">${t("lobby.kick")}</button>` : "";
      right = `<span class="badge">${label}${isHostSlot ? " (" + t("lobby.you") + ")" : ""}</span>${readyBtn}${kick}`;
    }
    const heroLabel = (s.kind === "human" || s.kind === "ai") ? `<span class="hero">${t("menu.heroCommander")}</span>` : "";
    const name = s.kind === "human" ? (isHostSlot ? t("lobby.host") : (s.token ? s.name : t("lobby.playerB"))) : s.kind === "ai" ? t("lobby.aiPlayer") : t("lobby.empty");
    return `<div class="slot ${s.kind}">
      <span class="slot-dot" style="background:${(s.kind === "human" || s.kind === "ai") ? s.color : "#2a3a4a"}"></span>
      <span class="slot-name">${name}</span>
      ${heroLabel}
      ${colorPick}
      <span class="slot-right">${right}</span>
    </div>`;
  }

  private devicesHtml(): string {
    const lobby = this.lobby!;
    const humans = lobby.state.slots.filter((s) => s.kind === "human");
    return humans.map((s) => `<div class="device"><span class="slot-dot" style="background:${s.color}"></span>${s.index === 0 ? t("lobby.host") : (s.token ? s.name : t("lobby.playerB"))}${s.ping !== undefined ? ` <span class="dim">${s.ping}ms</span>` : ""}</div>`).join("");
  }

  private startLobby(): void {
    const lobby = this.lobby!;
    if (!lobby.canStart()) return;
    const players = lobby.buildPlayers();
    const localIds = lobby.localPlayerIds();
    const split = lobby.state.splitScreen && localIds.length >= 2;
    let locals: LocalSpec[];
    if (split) {
      const resolved = resolveSplitInput(this.splitInput);
      locals = localIds.map((pid, i) => ({
        playerId: pid,
        pointerType: resolved[i]?.pointerType ?? null,
        keyboard: resolved[i]?.keyboard ?? false,
        control: resolved[i]?.control ?? "single",
      }));
    } else {
      locals = localIds.map((pid) => ({ playerId: pid, pointerType: null, keyboard: true, control: "single" }));
    }
    const cfg: SessionConfig = { map: lobby.state.map, players, locals, split, showRematch: true, onQuit: () => this.showTitle() };
    this.lobby = null;
    this.root.innerHTML = "";
    this.cb.onStartLocal(cfg);
  }

  // ---------- Join Local Game ----------
  private showJoin(): void {
    this.root.innerHTML = "";
    let name = "Player";
    const scr = this.el(`<div class="screen" data-screen="join">
      ${this.langSwitch()}
      <div class="menu">
        <h2>${t("join.title")}</h2>
        <div class="field"><label>${t("join.name")}</label><input data-id="j-name" value="${name}"/></div>
        <div class="field"><label>${t("join.address")}</label><input data-id="j-addr" placeholder="http://192.168.x.x:3000"/></div>
        <div class="dim" style="font-size:12px">${t("join.hint")}</div>
        <div class="status" data-id="j-status"></div>
        <button class="btn primary" data-id="j-connect">${t("join.connect")}</button>
        <button class="btn" data-id="j-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    const status = scr.querySelector("[data-id=j-status]") as HTMLElement;
    const ui: JoinUI = { setStatus: (key, isErr) => { status.textContent = t(key); status.className = "status" + (isErr ? " err" : ""); } };
    (scr.querySelector("[data-id=j-name]") as HTMLInputElement).oninput = (e) => name = (e.target as HTMLInputElement).value;
    (scr.querySelector("[data-id=j-connect]") as HTMLElement).onclick = () => {
      const addr = (scr.querySelector("[data-id=j-addr]") as HTMLInputElement).value.trim();
      if (!addr) { ui.setStatus("join.failed", true); return; }
      ui.setStatus("join.connecting");
      this.cb.onJoin({ url: addr, name }, ui);
    };
    (scr.querySelector("[data-id=j-back]") as HTMLElement).onclick = () => this.showPlayMenu();
  }

  // ---------- Settings → Keyboard (remappable bindings, spec §24 → T24) ----------
  private capturing: { context: BindContext; action: string } | null = null;
  private captureHandler: ((e: KeyboardEvent) => void) | null = null;

  private showSettings(): void {
    this.stopCapture();
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen" data-screen="settings">
      ${this.langSwitch()}
      <div class="menu settings-menu">
        <h2>${t("settings.title")} — ${t("settings.keyboard")}</h2>
        <div class="dim settings-hint">${t("settings.hint")}</div>
        <div class="kb-conflict status err" data-id="kb-conflict"></div>
        <div class="kb-groups" data-id="kb-groups"></div>
        <div class="dim" style="font-size:11px;margin-top:8px">${t("settings.controlGroups")}</div>
        <div class="dim" style="font-size:11px;margin-top:4px">${t("settings.panelKeys")}</div>
        <div class="row" style="margin-top:14px;justify-content:space-between">
          <button class="btn" data-id="kb-reset">${t("settings.reset")}</button>
          <button class="btn primary" data-id="kb-back">${t("menu.back")}</button>
        </div>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    this.renderBindings(scr);
    (scr.querySelector("[data-id=kb-reset]") as HTMLElement).onclick = () => { this.stopCapture(); resetKeyBindings(); this.clearConflict(scr); this.renderBindings(scr); };
    (scr.querySelector("[data-id=kb-back]") as HTMLElement).onclick = () => { this.stopCapture(); this.showTitle(); };
  }

  private bindGroups: { ctx: BindContext; titleKey: string }[] = [
    { ctx: "p1", titleKey: "settings.player1" },
    { ctx: "p2", titleKey: "settings.player2" },
    { ctx: "shared", titleKey: "settings.shared" },
  ];

  private renderBindings(scr: HTMLElement): void {
    const wrap = scr.querySelector("[data-id=kb-groups]") as HTMLElement;
    const b = getKeyBindings();
    wrap.innerHTML = this.bindGroups.map((g) => {
      const rows = ACTION_DEFS.filter((a) => a.context === g.ctx).map((a) => {
        const cap = this.capturing && this.capturing.context === g.ctx && this.capturing.action === a.action;
        const label = cap ? t("settings.pressKey") : keyLabel(b[g.ctx][a.action]);
        return `<div class="kb-row">
          <span class="kb-action">${t(a.labelKey)}</span>
          <button class="btn tiny kb-key ${cap ? "capturing" : ""}" data-ctx="${g.ctx}" data-act="${a.action}">${label}</button>
        </div>`;
      }).join("");
      return `<div class="kb-group">
        <div class="kb-group-head"><h4>${t(g.titleKey)}</h4><button class="btn tiny" data-reset-ctx="${g.ctx}">${t("settings.resetGroup")}</button></div>
        <div class="kb-rows">${rows}</div>
      </div>`;
    }).join("");
    wrap.querySelectorAll<HTMLElement>("[data-act]").forEach((btn) => {
      btn.onclick = () => this.startCapture(btn.dataset.ctx as BindContext, btn.dataset.act!, scr);
    });
    wrap.querySelectorAll<HTMLElement>("[data-reset-ctx]").forEach((btn) => {
      btn.onclick = () => { this.stopCapture(); resetKeyBindings(btn.dataset.resetCtx as BindContext); this.clearConflict(scr); this.renderBindings(scr); };
    });
  }

  private startCapture(context: BindContext, action: string, scr: HTMLElement): void {
    this.stopCapture();
    this.clearConflict(scr);
    this.capturing = { context, action };
    this.renderBindings(scr);
    this.captureHandler = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      const k = normalizeKey(e);
      if (k === "escape") { this.stopCapture(); this.renderBindings(scr); return; }
      const conflict = setBinding(context, action, k);
      this.stopCapture();
      if (conflict) this.showConflict(scr, context, conflict);
      this.renderBindings(scr);
    };
    window.addEventListener("keydown", this.captureHandler, true);
  }

  private stopCapture(): void {
    if (this.captureHandler) { window.removeEventListener("keydown", this.captureHandler, true); this.captureHandler = null; }
    this.capturing = null;
  }

  private showConflict(scr: HTMLElement, context: BindContext, conflictAction: string): void {
    const def = ACTION_DEFS.find((a) => a.context === context && a.action === conflictAction);
    const name = def ? t(def.labelKey) : conflictAction;
    const el = scr.querySelector("[data-id=kb-conflict]") as HTMLElement | null;
    if (el) el.textContent = t("settings.conflict", { action: name });
  }
  private clearConflict(scr: HTMLElement): void {
    const el = scr.querySelector("[data-id=kb-conflict]") as HTMLElement | null;
    if (el) el.textContent = "";
  }

  private showHelp(): void {
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen" data-screen="help">
      ${this.langSwitch()}
      <div class="menu" style="width:560px">
        <h2>${t("help.title")}</h2>
        <div class="help-text">${t("help.body").replace(/\n/g, "<br>")}</div>
        <button class="btn" data-id="h-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    (scr.querySelector("[data-id=h-back]") as HTMLElement).onclick = () => this.showTitle();
  }

  private renderQR(canvas: HTMLCanvasElement, text: string): void {
    const m = qrMatrix(text);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!m) return;
    const n = m.length; const quiet = 2; const total = n + quiet * 2;
    const px = Math.floor(canvas.width / total);
    const off = Math.floor((canvas.width - px * total) / 2);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(off + (c + quiet) * px, off + (r + quiet) * px, px, px);
  }

  // ---------- Remote lobby (client joined a hosted game via SocketTransport) ----------
  private remoteTransport: SocketTransport | null = null;
  private remoteSlot = -1;

  showRemoteLobby(state: LobbyState, transport: SocketTransport): void {
    this.remoteTransport = transport;
    this.root.innerHTML = "";
    // Our slot is whatever the server assigned at welcome (slot 0 = the host's own browser).
    this.remoteSlot = transport.playerId;
    const isHost = this.remoteSlot === 0;
    const mySlot = this.remoteSlot >= 0 ? state.slots[this.remoteSlot] : undefined;
    const joinUrl = `${state.hostUrl}/?room=${state.roomCode}`;

    const mapField = isHost
      ? `<select data-id="rl-map">${MAPS.map((m) => `<option value="${m}" ${state.map === m ? "selected" : ""}>${t(m === "twin_rivers" ? "menu.mapA" : "menu.mapB")}</option>`).join("")}</select>`
      : `<span class="badge">${t(state.map === "twin_rivers" ? "menu.mapA" : "menu.mapB")}</span>`;

    const hostControls = `
      <div class="row" style="margin-top:10px">
        <button class="btn" data-id="rl-addai">${t("lobby.addAI")}</button>
        <button class="btn primary" data-id="rl-start" ${this.canStartRemote(state) ? "" : "disabled"}>${t("lobby.start")}</button>
        <button class="btn" data-id="rl-back">${t("menu.back")}</button>
      </div>
      <div class="dim" style="font-size:12px;margin-top:6px">${this.canStartRemote(state) ? t("lobby.lanReady") : t("lobby.waiting")}</div>`;
    const guestControls = `
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-id="rl-ready">${mySlot?.ready ? t("lobby.notReady") : t("lobby.ready")}</button>
        <button class="btn" data-id="rl-back">${t("menu.back")}</button>
      </div>
      <div class="dim" style="font-size:12px;margin-top:6px">${state.slots.filter((s) => s.kind === "human").every((s) => s.ready) ? t("lobby.allReady") : t("lobby.waitingHost")}</div>`;

    const scr = this.el(`<div class="screen lobby-screen" data-screen="rlobby">
      ${this.langSwitch()}
      <div class="lobby">
        <h2>${t("lobby.title")}</h2>
        <div class="lobby-cols">
          <div class="lobby-main">
            <div class="field"><label>${t("menu.map")}</label>
              ${mapField}
              <div class="mapdesc">${t("lobby.mapDesc." + state.map)}</div>
            </div>
            <div class="slots" data-id="rl-slots">${state.slots.map((s) => this.remoteSlotHtml(s, isHost)).join("")}</div>
            ${isHost ? hostControls : guestControls}
          </div>
          <div class="lobby-conn">
            <h4>${t("lobby.connection")}</h4>
            <div class="lan-url"><span class="badge">${t("lobby.roomCode")}: ${state.roomCode}</span></div>
            <div class="join-url"><label>${t("lobby.joinUrl")}</label>
              <div class="url-row"><code data-id="rl-url">${joinUrl}</code><button class="btn tiny" data-id="rl-copy">${t("lobby.copy")}</button></div>
            </div>
            <canvas data-id="rl-qr" width="168" height="168" class="qr"></canvas>
            <div class="dim" style="font-size:11px">${t("lobby.scan")}</div>
            <div class="lan-note dim" style="margin-top:10px;font-size:12px;line-height:1.5">
              <div>📶 ${t("lobby.sameWifi")}</div>
              <div>🔗 ${t("lobby.useLanLink")}</div>
              <div>🛡️ ${t("lobby.firewallNote")}</div>
            </div>
          </div>
        </div>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);

    // QR of the LAN join URL (so other devices can scan it straight off the host screen).
    const qc = scr.querySelector("[data-id=rl-qr]") as HTMLCanvasElement | null;
    if (qc) this.renderQR(qc, joinUrl);

    // Copy link to clipboard.
    const copyBtn = scr.querySelector("[data-id=rl-copy]") as HTMLElement | null;
    if (copyBtn) copyBtn.onclick = () => {
      navigator.clipboard?.writeText(joinUrl)
        .then(() => { copyBtn.textContent = t("lobby.copied"); setTimeout(() => { copyBtn.textContent = t("lobby.copy"); }, 1500); })
        .catch(() => { /* clipboard may be unavailable over plain http */ });
    };

    // Back / leave the lobby.
    (scr.querySelector("[data-id=rl-back]") as HTMLElement).onclick = () => {
      transport.close();
      this.remoteTransport = null;
      this.showPlayMenu();
    };

    if (isHost) {
      (scr.querySelector("[data-id=rl-map]") as HTMLSelectElement).onchange = (e) =>
        transport.sendLobbyAction({ a: "setMap", map: (e.target as HTMLSelectElement).value });
      (scr.querySelector("[data-id=rl-addai]") as HTMLElement).onclick = () =>
        transport.sendLobbyAction({ a: "addAI", diff: "normal" });
      (scr.querySelector("[data-id=rl-start]") as HTMLElement).onclick = () =>
        transport.sendLobbyAction({ a: "start" });
      // Host-only per-slot management.
      scr.querySelectorAll<HTMLElement>("[data-rl-act]").forEach((b) => {
        b.onclick = () => {
          const i = parseInt(b.dataset.rlSlot || "0", 10);
          switch (b.dataset.rlAct) {
            case "addai": transport.sendLobbyAction({ a: "addAI", diff: "normal" }); break;
            case "kick": transport.sendLobbyAction({ a: "kick", index: i }); break;
            case "open": transport.sendLobbyAction({ a: "openSlot", index: i }); break;
            case "close": transport.sendLobbyAction({ a: "closeSlot", index: i }); break;
          }
        };
      });
    } else {
      const readyBtn = scr.querySelector("[data-id=rl-ready]") as HTMLElement;
      readyBtn.onclick = () => transport.sendLobbyAction({ a: "ready", ready: !(mySlot?.ready) });
    }

    // Color picks apply to my own slot only.
    scr.querySelectorAll<HTMLElement>("[data-slot-color]").forEach((b) => {
      b.onclick = () => {
        const idx = parseInt(b.dataset.slot || "0", 10);
        if (idx === this.remoteSlot) transport.sendLobbyAction({ a: "setColor", color: b.dataset.slotColor! });
      };
    });
  }

  // Same rule the host enforces (≥2 participants and all humans ready) so the Start button
  // matches what the server will accept.
  private canStartRemote(state: LobbyState): boolean {
    const participants = state.slots.filter((s) => s.kind === "human" || s.kind === "ai");
    if (participants.length < 2) return false;
    return state.slots.filter((s) => s.kind === "human").every((s) => s.ready);
  }

  private remoteSlotHtml(s: import("../net/protocol.js").LobbySlot, isHost: boolean): string {
    const isMe = s.index === this.remoteSlot;
    const colorPick = (s.kind === "human" && isMe)
      ? `<div class="swatches">${PALETTE.map((c) => `<span class="mini-swatch ${s.color === c ? "on" : ""}" data-slot="${s.index}" data-slot-color="${c}" style="background:${c}"></span>`).join("")}</div>` : "";
    let label = "";
    if (s.kind === "open") label = t("lobby.empty");
    else if (s.kind === "closed") label = t("lobby.closed");
    else if (s.kind === "ai") label = t("lobby.aiPlayer") + " · " + t("menu." + (s.ai || "normal"));
    else if (s.kind === "human") label = (s.index === 0 ? t("lobby.host") : (s.name || t("lobby.human"))) + (isMe ? " (" + t("lobby.you") + ")" : "");
    const readyBadge = s.kind === "human" ? `<span class="badge ${s.ready ? "ok" : ""}">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</span>` : "";
    // Host gets per-slot management buttons — never on its own slot 0.
    let hostBtns = "";
    if (isHost && s.index !== 0) {
      if (s.kind === "open") hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="addai">${t("lobby.addAI")}</button><button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="close">${t("lobby.closeSlot")}</button>`;
      else if (s.kind === "closed") hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="open">${t("lobby.openSlot")}</button>`;
      else hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="kick">${t("lobby.kick")}</button>`;
    }
    return `<div class="slot ${s.kind}">
      <span class="slot-dot" style="background:${(s.kind === "human" || s.kind === "ai") ? s.color : "#2a3a4a"}"></span>
      <span class="slot-name">${label}</span>
      ${colorPick}
      <span class="slot-right">${readyBadge}${hostBtns}</span>
    </div>`;
  }

  // ---------- Connecting screen (shown while an auto-join / manual join is in flight) ----------
  showConnecting(addr: string, onRetry: () => void, onCancel: () => void): JoinUI {
    this.root.innerHTML = "";
    const scr = this.el(`<div class="screen" data-screen="connecting">
      ${this.langSwitch()}
      <div class="menu" style="width:460px;text-align:center">
        <h2>${t("join.title")}</h2>
        <div class="connect-status" data-id="c-status">${t("join.connectingHost")}</div>
        <div class="dim" style="margin:8px 0"><code>${addr}</code></div>
        <div class="row" style="justify-content:center;margin-top:12px">
          <button class="btn" data-id="c-retry" style="display:none">${t("join.retry")}</button>
          <button class="btn" data-id="c-cancel">${t("menu.back")}</button>
        </div>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    const statusEl = scr.querySelector("[data-id=c-status]") as HTMLElement;
    const retryBtn = scr.querySelector("[data-id=c-retry]") as HTMLElement;
    (scr.querySelector("[data-id=c-cancel]") as HTMLElement).onclick = onCancel;
    retryBtn.onclick = () => {
      retryBtn.style.display = "none";
      statusEl.classList.remove("err");
      statusEl.textContent = t("join.connectingHost");
      onRetry();
    };
    return {
      setStatus: (key: string, isError?: boolean) => {
        statusEl.textContent = t(key);
        if (isError) { statusEl.classList.add("err"); retryBtn.style.display = ""; }
        else statusEl.classList.remove("err");
      },
    };
  }
}
