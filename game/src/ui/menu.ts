// MYS Generals — main menu & lobby flow (spec §18.1–§18.3, §24 T33).
import { t, setLang, getLang, onLangChange, Lang, defaultName, setDefaultName } from "../i18n.js";
import { Lobby, PALETTE } from "../host/lobby.js";
import { SessionConfig, SessionPlayer, LocalSpec, Difficulty } from "../client/session.js";
import { getMap, MAP_IDS } from "../sim/map.js";
import { qrMatrix } from "../net/qr.js";
import { LobbyState, ServerMsg } from "../net/protocol.js";
import { SocketTransport } from "../net/socketTransport.js";
import { ClientTransport, LobbyClient, RemoteClientCallbacks } from "../net/transport.js";
import { BrowserHost, PendingInvite } from "../net/webrtcHost.js";
import { joinOnline, WebRTCTransport } from "../net/webrtcTransport.js";
import { LobbyMode, showInvitePanel, showLanInfo } from "./lobbyMode.js";
import { SplitInputConfig, PointerDevice, loadSplitInput, saveSplitInput, resolveSplitInput, hasTouch } from "../client/splitInput.js";
import { ACTION_DEFS, getKeyBindings, keyLabel, setBinding, resetKeyBindings, normalizeKey, BindContext } from "./keyBindings.js";

export interface JoinUI { setStatus: (key: string, isError?: boolean) => void; }
export interface MenuCallbacks {
  onStartLocal: (cfg: SessionConfig) => void;
  onJoin: (opts: { url: string; name: string }, ui: JoinUI) => void;
  // Enter a match as a thin client of a remote/online host (LAN, WebRTC P2P, or the in-browser
  // host's own loopback player). main.ts owns the RemoteSession; the menu just hands it a connected
  // transport + the start message (spec §24 T33).
  onRemoteMatch?: (transport: ClientTransport, startMsg: Extract<ServerMsg, { m: "start" }>) => void;
}

const MAPS = MAP_IDS;

export class Menu {
  root: HTMLElement;
  cb: MenuCallbacks;
  private lobby: Lobby | null = null;
  private splitInput: SplitInputConfig = loadSplitInput();
  // T33 online state: the in-browser host (when this device hosts Online) and the active
  // lobby-aware transport (host's own loopback player, a WebRTC joiner, or a LAN socket).
  private browserHost: BrowserHost | null = null;
  private pendingInvite: PendingInvite | null = null;
  private joinPc: RTCPeerConnection | null = null;

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
        <button class="btn" data-id="p-joinonline">${t("menu.joinOnline")}</button>
        <button class="btn" data-id="p-join">${t("menu.joinGame")}</button>
        <button class="btn" data-id="p-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    (scr.querySelector("[data-id=p-single]") as HTMLElement).onclick = () => this.showSetup();
    (scr.querySelector("[data-id=p-host]") as HTMLElement).onclick = () => this.showLobby();
    (scr.querySelector("[data-id=p-joinonline]") as HTMLElement).onclick = () => this.showJoinOnline();
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
            ${MAPS.map((m) => `<option value="${m}" ${this.spCfg.map === m ? "selected" : ""}>${t(getMap(m).nameKey)}</option>`).join("")}
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
              <select data-id="l-map">${MAPS.map((m) => `<option value="${m}" ${st.map === m ? "selected" : ""}>${t(getMap(m).nameKey)}</option>`).join("")}</select>
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
            ${this.connToggleHtml(false)}
            <div class="field" style="margin-top:8px"><label>${t("lobby.yourName")}</label><input data-id="l-name" maxlength="20" value="${this.escAttr(st.slots[0]?.name && st.slots[0].name !== "Host" ? st.slots[0].name : defaultName())}"/></div>
            <div class="dim lan-note">${t("lobby.localNote")}</div>
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
    // Editable host name (persisted → defaultName for next session and for online/LAN slots).
    const nameInput = scr.querySelector("[data-id=l-name]") as HTMLInputElement | null;
    if (nameInput) nameInput.onchange = () => { const v = nameInput.value.trim() || "Host"; lobby.setName(0, v); setDefaultName(v); };
    // Local/Online toggle: flipping to Online tears down the local lobby and starts the in-browser
    // P2P host (spec §24 T33-C1).
    (scr.querySelector("[data-id=ct-online]") as HTMLElement | null)?.addEventListener("click", () => {
      const v = nameInput?.value.trim(); if (v) setDefaultName(v);
      this.startOnlineHost();
    });
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

  // ---------- Remote lobby (joined a hosted game: LAN socket / online WebRTC / host loopback) ----------
  private remoteTransport: LobbyClient | null = null;
  private remoteSlot = -1;
  private lobbyMode: LobbyMode = "lan";

  showRemoteLobby(state: LobbyState, transport: LobbyClient, mode: LobbyMode = "lan"): void {
    this.remoteTransport = transport;
    this.lobbyMode = mode;
    this.root.innerHTML = "";
    // Our slot is whatever the host assigned at welcome (slot 0 = the host's own player).
    this.remoteSlot = transport.playerId;
    const isHost = this.remoteSlot === 0;
    const mySlot = this.remoteSlot >= 0 ? state.slots[this.remoteSlot] : undefined;
    const joinUrl = `${state.hostUrl}/?room=${state.roomCode}`;

    const mapField = isHost
      ? `<select data-id="rl-map">${MAPS.map((m) => `<option value="${m}" ${state.map === m ? "selected" : ""}>${t(getMap(m).nameKey)}</option>`).join("")}</select>`
      : `<span class="badge">${t(getMap(state.map).nameKey)}</span>`;

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
            ${mySlot && mySlot.kind === "human" ? `<div class="field" style="margin-top:8px"><label>${t("lobby.yourName")}</label><input data-id="rl-name" maxlength="20" value="${this.escAttr(mySlot.name)}"/></div>` : ""}
            ${isHost ? hostControls : guestControls}
          </div>
          <div class="lobby-conn">
            <h4>${t("lobby.connection")}</h4>
            ${this.connPanelHtml(state, mode, joinUrl)}
          </div>
        </div>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);

    // QR + copy of the LAN join URL (LAN host path only).
    if (showLanInfo(mode)) {
      const qc = scr.querySelector("[data-id=rl-qr]") as HTMLCanvasElement | null;
      if (qc) this.renderQR(qc, joinUrl);
      const copyBtn = scr.querySelector("[data-id=rl-copy]") as HTMLElement | null;
      if (copyBtn) copyBtn.onclick = () => {
        navigator.clipboard?.writeText(joinUrl)
          .then(() => { copyBtn.textContent = t("lobby.copied"); setTimeout(() => { copyBtn.textContent = t("lobby.copy"); }, 1500); })
          .catch(() => { /* clipboard may be unavailable over plain http */ });
      };
    }

    // Editable name → reflect to all peers + persist for next session (spec §24 T33-D1).
    const nameInput = scr.querySelector("[data-id=rl-name]") as HTMLInputElement | null;
    if (nameInput) nameInput.onchange = () => {
      const v = nameInput.value.trim() || "Player";
      transport.sendLobbyAction({ a: "setName", name: v });
      setDefaultName(v);
    };

    // Online host: wire the invite/reply controls + Local toggle.
    if (showInvitePanel(mode)) this.wireInvitePanel(scr);

    // Back / leave the lobby (tear down the online host if we are it).
    (scr.querySelector("[data-id=rl-back]") as HTMLElement).onclick = () => {
      transport.close();
      this.remoteTransport = null;
      this.teardownOnline();
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
    else if (s.kind === "human") label = (s.index === 0 ? (s.name && s.name !== "Host" ? s.name : t("lobby.host")) : (s.name || t("lobby.human"))) + (isMe ? " (" + t("lobby.you") + ")" : "");
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

  // ---------- T33 online helpers (Local/Online toggle, invite/reply, Join Online) ----------
  private escAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // The two-way Local/Online toggle shown at the top of the host Connection panel (spec §24 T33-C1).
  private connToggleHtml(online: boolean): string {
    return `<div class="conn-toggle row" style="gap:6px">
      <button class="btn tiny ${online ? "" : "active"}" data-id="ct-local">${t("lobby.modeLocal")}</button>
      <button class="btn tiny ${online ? "active" : ""}" data-id="ct-online">${t("lobby.modeOnline")}</button>
    </div>`;
  }

  private deviceListHtml(state: LobbyState): string {
    return state.slots.filter((s) => s.kind === "human").map((s) =>
      `<div class="device"><span class="slot-dot" style="background:${s.color}"></span>${s.index === 0 ? t("lobby.host") : (s.name || t("lobby.human"))}</div>`).join("");
  }

  // Connection-panel content for each lobby mode (spec §24 T33-C1).
  private connPanelHtml(state: LobbyState, mode: LobbyMode, joinUrl: string): string {
    if (mode === "online-host") {
      return `${this.connToggleHtml(true)}
        <div class="dim" style="font-size:12px;margin-top:8px">${t("lobby.onlineHostHint")}</div>
        <div class="invite-box" style="margin-top:8px">
          <button class="btn" data-id="rl-newinvite">${t("lobby.createInvite")}</button>
          <div data-id="rl-invitewrap" style="display:none;margin-top:8px">
            <label>${t("lobby.inviteCode")}</label>
            <textarea data-id="rl-invite" class="codebox" readonly rows="3"></textarea>
            <button class="btn tiny" data-id="rl-invitecopy">${t("lobby.copy")}</button>
            <label style="margin-top:8px;display:block">${t("lobby.pasteReply")}</label>
            <textarea data-id="rl-reply" class="codebox" rows="3"></textarea>
            <button class="btn tiny" data-id="rl-applyreply">${t("lobby.connectDevice")}</button>
            <div class="status" data-id="rl-invitestatus"></div>
          </div>
        </div>
        <div class="devices"><h4>${t("lobby.devices")}</h4><div data-id="rl-devices">${this.deviceListHtml(state)}</div></div>
        <div class="dim" style="font-size:11px;margin-top:8px">${t("lobby.noTurnNote")}</div>`;
    }
    if (mode === "online-guest") {
      return `<div class="dim lan-note">${t("lobby.onlineConnected")}</div>
        <div class="devices"><h4>${t("lobby.devices")}</h4><div>${this.deviceListHtml(state)}</div></div>`;
    }
    // lan
    return `<div class="lan-url"><span class="badge">${t("lobby.roomCode")}: ${state.roomCode}</span></div>
      <div class="join-url"><label>${t("lobby.joinUrl")}</label>
        <div class="url-row"><code data-id="rl-url">${joinUrl}</code><button class="btn tiny" data-id="rl-copy">${t("lobby.copy")}</button></div>
      </div>
      <canvas data-id="rl-qr" width="168" height="168" class="qr"></canvas>
      <div class="dim" style="font-size:11px">${t("lobby.scan")}</div>
      <div class="lan-note dim" style="margin-top:10px;font-size:12px;line-height:1.5">
        <div>📶 ${t("lobby.sameWifi")}</div>
        <div>🔗 ${t("lobby.useLanLink")}</div>
        <div>🛡️ ${t("lobby.firewallNote")}</div>
      </div>`;
  }

  // Wire the online-host invite/reply controls (one invite at a time, repeated per joiner).
  private wireInvitePanel(scr: HTMLElement): void {
    (scr.querySelector("[data-id=ct-local]") as HTMLElement | null)?.addEventListener("click", () => {
      this.teardownOnline();
      this.showLobby(); // back to the Local host lobby
    });
    const newBtn = scr.querySelector("[data-id=rl-newinvite]") as HTMLButtonElement | null;
    const wrap = scr.querySelector("[data-id=rl-invitewrap]") as HTMLElement | null;
    const inviteBox = scr.querySelector("[data-id=rl-invite]") as HTMLTextAreaElement | null;
    const replyBox = scr.querySelector("[data-id=rl-reply]") as HTMLTextAreaElement | null;
    const status = scr.querySelector("[data-id=rl-invitestatus]") as HTMLElement | null;
    const setStatus = (key: string, err = false) => { if (status) { status.textContent = key ? t(key) : ""; status.className = "status" + (err ? " err" : ""); } };
    if (newBtn) newBtn.onclick = async () => {
      if (!this.browserHost) return;
      newBtn.textContent = t("lobby.generating"); newBtn.disabled = true;
      try {
        const invite = await this.browserHost.createInvite();
        this.pendingInvite = invite;
        if (inviteBox) inviteBox.value = invite.code;
        if (wrap) wrap.style.display = "";
        setStatus("");
      } catch { setStatus("online.connectFailed", true); }
      finally { newBtn.textContent = t("lobby.newInvite"); newBtn.disabled = false; }
    };
    const copyBtn = scr.querySelector("[data-id=rl-invitecopy]") as HTMLElement | null;
    if (copyBtn) copyBtn.onclick = () => {
      if (!inviteBox) return;
      navigator.clipboard?.writeText(inviteBox.value)
        .then(() => { copyBtn.textContent = t("lobby.copied"); setTimeout(() => { copyBtn.textContent = t("lobby.copy"); }, 1500); })
        .catch(() => { /* */ });
    };
    const applyBtn = scr.querySelector("[data-id=rl-applyreply]") as HTMLElement | null;
    if (applyBtn) applyBtn.onclick = async () => {
      if (!this.pendingInvite || !replyBox) return;
      const code = replyBox.value.trim();
      if (!code) { setStatus("online.badCode", true); return; }
      try {
        await this.pendingInvite.applyReply(code);
        setStatus("online.connected");
        this.pendingInvite = null;
        replyBox.value = "";
        if (wrap) wrap.style.display = "none";
      } catch { setStatus("online.badCode", true); }
    };
  }

  // Local → Online: stand up the in-browser P2P host (GameHost + WebRTC bridge) and connect the
  // host's own player over a loopback transport, so the host uses the same lobby + match path as
  // every joiner (slot 0), with the added invite/reply panel (spec §24 T33-B2/C1).
  private startOnlineHost(): void {
    this.teardownOnline();
    this.lobby = null;
    const cb: RemoteClientCallbacks = {
      onLobby: (state) => { if (this.browserHost) this.showRemoteLobby(state, this.browserHost.local, "online-host"); },
      onStart: (startMsg) => { if (this.browserHost) this.cb.onRemoteMatch?.(this.browserHost.local, startMsg); },
      onHostGone: () => { this.teardownOnline(); this.showTitle(); },
    };
    this.browserHost = new BrowserHost(defaultName(), cb);
    this.browserHost.start();
  }

  // Tear down any online host / joiner connection (called on leaving the lobby or quitting a match).
  teardownOnline(): void {
    if (this.browserHost) { try { this.browserHost.stop(); } catch { /* */ } this.browserHost = null; }
    this.pendingInvite = null;
    if (this.joinPc) { try { this.joinPc.close(); } catch { /* */ } this.joinPc = null; }
  }

  // ---------- Join Online (paste the host's invite → produce a reply → connect P2P) ----------
  showJoinOnline(prefillInvite?: string): void {
    this.teardownOnline();
    this.root.innerHTML = "";
    let name = defaultName();
    const scr = this.el(`<div class="screen" data-screen="joinonline">
      ${this.langSwitch()}
      <div class="menu" style="width:540px">
        <h2>${t("online.title")}</h2>
        <div class="field"><label>${t("join.name")}</label><input data-id="jo-name" maxlength="20" value="${this.escAttr(name)}"/></div>
        <div class="field"><label>${t("online.invitePrompt")}</label><textarea data-id="jo-invite" class="codebox" rows="3">${this.escAttr(prefillInvite || "")}</textarea></div>
        <div class="dim" style="font-size:12px">${t("online.hint")}</div>
        <div class="status" data-id="jo-status"></div>
        <div data-id="jo-replywrap" style="display:none;margin-top:8px">
          <label>${t("online.replyReady")}</label>
          <textarea data-id="jo-reply" class="codebox" readonly rows="3"></textarea>
          <button class="btn tiny" data-id="jo-replycopy">${t("online.copyReply")}</button>
        </div>
        <button class="btn primary" data-id="jo-generate">${t("online.generateReply")}</button>
        <button class="btn" data-id="jo-back">${t("menu.back")}</button>
      </div></div>`);
    this.root.appendChild(scr); this.wireLang(scr);
    const status = scr.querySelector("[data-id=jo-status]") as HTMLElement;
    const setStatus = (key: string, err = false) => { status.textContent = key ? t(key) : ""; status.className = "status" + (err ? " err" : ""); };
    (scr.querySelector("[data-id=jo-name]") as HTMLInputElement).oninput = (e) => { name = (e.target as HTMLInputElement).value; };
    (scr.querySelector("[data-id=jo-back]") as HTMLElement).onclick = () => { this.teardownOnline(); this.showPlayMenu(); };
    (scr.querySelector("[data-id=jo-generate]") as HTMLElement).onclick = async () => {
      const invite = (scr.querySelector("[data-id=jo-invite]") as HTMLTextAreaElement).value.trim();
      if (!invite) { setStatus("online.badCode", true); return; }
      const nm = name.trim() || "Player"; setDefaultName(nm);
      setStatus("lobby.generating");
      let transport: WebRTCTransport | null = null;
      const cb: RemoteClientCallbacks = {
        onLobby: (state) => { if (transport) this.showRemoteLobby(state, transport, "online-guest"); },
        onStart: (startMsg) => { if (transport) this.cb.onRemoteMatch?.(transport, startMsg); },
        onError: (_r, key) => setStatus(key || "online.connectFailed", true),
        onHostGone: () => { this.teardownOnline(); this.showTitle(); },
      };
      try {
        const res = await joinOnline(invite, nm, cb);
        transport = res.transport;
        this.joinPc = res.pc;
        this.remoteTransport = transport;
        const replyWrap = scr.querySelector("[data-id=jo-replywrap]") as HTMLElement;
        const replyBox = scr.querySelector("[data-id=jo-reply]") as HTMLTextAreaElement;
        replyBox.value = res.replyCode;
        replyWrap.style.display = "";
        setStatus("online.waitingHost");
        const rc = scr.querySelector("[data-id=jo-replycopy]") as HTMLElement;
        rc.onclick = () => navigator.clipboard?.writeText(res.replyCode)
          .then(() => { rc.textContent = t("lobby.copied"); setTimeout(() => { rc.textContent = t("online.copyReply"); }, 1500); })
          .catch(() => { /* */ });
      } catch { setStatus("online.badCode", true); }
    };
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
