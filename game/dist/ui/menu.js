// MYS Generals — main menu & lobby flow (spec §18.1–§18.3, §24 T33).
import { t, setLang, getLang, onLangChange, defaultName, setDefaultName } from "../i18n.js";
import { Lobby, PALETTE } from "../host/lobby.js";
import { getMap, MAP_IDS } from "../sim/map.js";
import { qrMatrix } from "../net/qr.js";
import { BrowserHost } from "../net/webrtcHost.js";
import { joinOnline } from "../net/webrtcTransport.js";
import { showInvitePanel, showLanInfo } from "./lobbyMode.js";
import { loadSplitInput, saveSplitInput, resolveSplitInput, hasTouch } from "../client/splitInput.js";
import { ACTION_DEFS, getKeyBindings, keyLabel, setBinding, resetKeyBindings, normalizeKey } from "./keyBindings.js";
const MAPS = MAP_IDS;
export class Menu {
    constructor(root, cb) {
        this.lobby = null;
        this.splitInput = loadSplitInput();
        // T33 online state: the in-browser host (when this device hosts Online) and the active
        // lobby-aware transport (host's own loopback player, a WebRTC joiner, or a LAN socket).
        this.browserHost = null;
        this.pendingInvite = null;
        this.joinPc = null;
        // Online split-screen: whether the host added a local Player 2, and that player's slot index
        // (so the lobby UI can show its name field and suppress the kick button on it).
        this.onlineSplit = false;
        this.localBSlot = -1;
        // ---------- Single Player (vs AI) ----------
        this.spCfg = { map: "twin_rivers", difficulty: "normal", color: PALETTE[0], aiCount: 1 };
        // ---------- Settings → Keyboard (remappable bindings, spec §24 → T24) ----------
        this.capturing = null;
        this.captureHandler = null;
        this.bindGroups = [
            { ctx: "p1", titleKey: "settings.player1" },
            { ctx: "p2", titleKey: "settings.player2" },
            { ctx: "shared", titleKey: "settings.shared" },
        ];
        // ---------- Remote lobby (joined a hosted game: LAN socket / online WebRTC / host loopback) ----------
        this.remoteTransport = null;
        this.remoteSlot = -1;
        this.lobbyMode = "lan";
        this.root = root;
        this.cb = cb;
        onLangChange(() => {
            if (this.root.querySelector("[data-screen=title]"))
                this.showTitle();
            else if (this.root.querySelector("[data-screen=play]"))
                this.showPlayMenu();
            else if (this.root.querySelector("[data-screen=settings]"))
                this.showSettings();
            else if (this.root.querySelector("[data-screen=lobby]") && this.lobby)
                this.renderLobby();
        });
    }
    el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }
    langSwitch() {
        const langs = ["en", "ru", "uz"];
        return `<div class="lang-switch">${langs.map((l) => `<button class="btn ${getLang() === l ? "active" : ""}" data-lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>`;
    }
    wireLang(scr) {
        scr.querySelectorAll("[data-lang]").forEach((b) => b.onclick = () => setLang(b.dataset.lang));
    }
    showTitle() {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        scr.querySelector("[data-id=m-play]").onclick = () => this.showPlayMenu();
        scr.querySelector("[data-id=m-settings]").onclick = () => this.showSettings();
        scr.querySelector("[data-id=m-help]").onclick = () => this.showHelp();
    }
    showPlayMenu() {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        scr.querySelector("[data-id=p-single]").onclick = () => this.showSetup();
        scr.querySelector("[data-id=p-host]").onclick = () => this.showMapSelect();
        scr.querySelector("[data-id=p-joinonline]").onclick = () => this.showJoinOnline();
        scr.querySelector("[data-id=p-join]").onclick = () => this.showJoin();
        scr.querySelector("[data-id=p-back]").onclick = () => this.showTitle();
    }
    showSetup() {
        this.root.innerHTML = "";
        const maxAI = getMap(this.spCfg.map).spawns.length - 1;
        if (this.spCfg.aiCount > maxAI)
            this.spCfg.aiCount = maxAI;
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        scr.querySelector("[data-id=s-map]").onchange = (e) => { this.spCfg.map = e.target.value; this.showSetup(); };
        scr.querySelector("[data-id=s-diff]").onchange = (e) => this.spCfg.difficulty = e.target.value;
        scr.querySelector("[data-id=s-ai]").onchange = (e) => this.spCfg.aiCount = parseInt(e.target.value, 10);
        scr.querySelectorAll("[data-color]").forEach((b) => b.onclick = () => {
            this.spCfg.color = b.dataset.color;
            scr.querySelectorAll("[data-color]").forEach((x) => x.style.outline = "none");
            b.style.outline = "2px solid #fff";
        });
        scr.querySelector("[data-id=s-start]").onclick = () => this.startSingle();
        scr.querySelector("[data-id=s-back]").onclick = () => this.showPlayMenu();
    }
    startSingle() {
        const colors = PALETTE.filter((c) => c !== this.spCfg.color);
        const players = [{ id: 0, isAI: false, aiDiff: this.spCfg.difficulty, color: this.spCfg.color, hero: 0 }];
        for (let i = 1; i <= this.spCfg.aiCount; i++)
            players.push({ id: i, isAI: true, aiDiff: this.spCfg.difficulty, color: colors[(i - 1) % colors.length], hero: 0 });
        const locals = [{ playerId: 0, pointerType: null, keyboard: true, control: "single" }];
        this.root.innerHTML = "";
        this.cb.onStartLocal({ map: this.spCfg.map, players, locals, split: false, showRematch: true, onQuit: () => this.showTitle() });
    }
    // ---------- Map selection (cards: preview, name, size, player count) ----------
    // Shown after choosing "Host Local Game". Each map is a rectangular card with a generated terrain
    // preview, its name, its tile size and the number of players it is tuned for.
    showMapSelect() {
        this.root.innerHTML = "";
        const scr = this.el(`<div class="screen mapselect-screen" data-screen="mapselect">
      ${this.langSwitch()}
      <div class="mapselect">
        <h2>${t("lobby.selectMap")}</h2>
        <div class="map-cards">
          ${MAP_IDS.map((id) => {
            const m = getMap(id);
            return `<div class="map-card" data-map="${id}">
              <canvas class="map-thumb" width="200" height="200" data-thumb="${id}"></canvas>
              <div class="map-card-body">
                <div class="map-card-name">${t(m.nameKey)}</div>
                <div class="map-card-meta">
                  <span class="badge">${t("lobby.mapSize", { w: m.w, h: m.h })}</span>
                  <span class="badge">${t("lobby.mapPlayers", { n: m.spawns.length })}</span>
                </div>
                <div class="map-card-desc dim">${t("lobby.mapDesc." + id)}</div>
              </div>
            </div>`;
        }).join("")}
        </div>
        <div class="row" style="margin-top:14px;justify-content:center">
          <button class="btn" data-id="ms-back">${t("menu.back")}</button>
        </div>
      </div></div>`);
        this.root.appendChild(scr);
        this.wireLang(scr);
        for (const id of MAP_IDS) {
            const c = scr.querySelector(`[data-thumb="${id}"]`);
            if (c)
                this.drawMapThumb(c, id);
        }
        scr.querySelectorAll("[data-map]").forEach((card) => {
            card.onclick = () => this.showLobby(card.dataset.map);
        });
        scr.querySelector("[data-id=ms-back]").onclick = () => this.showPlayMenu();
    }
    // Draw a small top-down terrain preview of a map (grass/cliff/water/road/wall tiles) and mark the
    // player spawn points and capturable neutral points.
    drawMapThumb(canvas, mapId) {
        const m = getMap(mapId);
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        const W = canvas.width, H = canvas.height;
        const colors = ["#3c5a3a", "#5a5048", "#26506b", "#6b6258", "#71727a"]; // grass, cliff, water, road, wall
        const sx = W / m.w, sy = H / m.h;
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, W, H);
        for (let y = 0; y < m.h; y++)
            for (let x = 0; x < m.w; x++) {
                const tv = m.terrain[y * m.w + x];
                if (tv === 0)
                    continue;
                ctx.fillStyle = colors[tv] || colors[0];
                ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
            }
        ctx.fillStyle = "#cdd6df";
        for (const n of m.neutrals) {
            ctx.beginPath();
            ctx.arc(n.x * sx, n.y * sy, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        const spawnColors = ["#4ea3ff", "#ff5a4d", "#34d399", "#c084fc"];
        m.spawns.forEach((s, i) => {
            ctx.fillStyle = spawnColors[i % spawnColors.length];
            ctx.beginPath();
            ctx.arc(s.x * sx, s.y * sy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }
    // ---------- Local Game on this computer (loopback: single-player extras, split-screen, AI) ----------
    // This path runs an in-page MatchHost over LoopbackTransport. A browser cannot run a WebSocket
    // server, so it can NEVER accept remote devices — for that the user runs the real Node host
    // (host.bat / host.sh / host.command). Hence no join URL/QR is shown here (spec §24 T25 #2/#3).
    showLobby(map = "twin_rivers") {
        this.lobby = new Lobby("", map);
        this.lobby.onChange = () => this.renderLobby();
        this.renderLobby();
    }
    renderLobby() {
        const lobby = this.lobby;
        const st = lobby.state;
        const map = getMap(st.map);
        const team = st.gameType === "team";
        const hasOpen = st.slots.some((s) => s.kind === "open");
        this.root.innerHTML = "";
        const scr = this.el(`<div class="screen lobby-screen" data-screen="lobby">
      ${this.langSwitch()}
      <div class="lobby">
        <h2>${t("lobby.title")}</h2>
        <div class="lobby-cols">
          <div class="lobby-main">
            <div class="lobby-mapsummary">
              <canvas class="map-thumb small" width="120" height="120" data-id="l-thumb"></canvas>
              <div class="lobby-mapinfo">
                <div class="map-card-name">${t(map.nameKey)}</div>
                <div class="map-card-meta">
                  <span class="badge">${t("lobby.mapSize", { w: map.w, h: map.h })}</span>
                  <span class="badge">${t("lobby.mapPlayers", { n: map.spawns.length })}</span>
                </div>
                <button class="btn tiny" data-id="l-changemap">${t("lobby.changeMap")}</button>
              </div>
            </div>
            <div class="field" style="margin-top:10px"><label>${t("lobby.gameType")}</label>
              <div class="conn-toggle row" style="gap:6px" data-id="l-gametype">
                <button class="btn tiny ${team ? "" : "active"}" data-gametype="classic">${t("lobby.gtClassic")}</button>
                <button class="btn tiny ${team ? "active" : ""}" data-gametype="team">${t("lobby.gtTeam")}</button>
              </div>
              <div class="dim" style="font-size:11px;margin-top:4px">${team ? t("lobby.gtTeamHint") : t("lobby.gtClassicHint")}</div>
            </div>
            ${team ? this.teamsHtml(lobby) : this.classicSlotsHtml(lobby)}
            <div class="row" style="margin-top:8px">
              <button class="btn" data-id="l-addslot" ${hasOpen ? "" : "disabled"}>${t("lobby.addSlot")}</button>
            </div>
            <div class="dim" style="font-size:11px;margin-top:2px">${t("lobby.addSlotHint", { n: map.spawns.length })}</div>
            <label class="splitrow" style="margin-top:10px"><input type="checkbox" data-id="l-split" ${st.splitScreen ? "checked" : ""}/> ${t("lobby.splitScreen")}</label>
            <div class="dim" style="font-size:11px">${t("lobby.splitHint")}</div>
            ${st.splitScreen ? this.splitInputHtml() : ""}
            ${st.splitScreen && lobby.splitB >= 0 ? `<div class="field" style="margin-top:8px"><label>${t("lobby.player2Name")}</label><input data-id="l-nameb" maxlength="20" value="${this.escAttr(st.slots[lobby.splitB]?.name || "Player B")}"/></div>` : ""}
            <div class="row" style="margin-top:10px">
              <button class="btn primary" data-id="l-start" ${lobby.canStart() ? "" : "disabled"}>${t("lobby.start")}</button>
              <button class="btn" data-id="l-back">${t("menu.back")}</button>
            </div>
            <div class="dim" style="font-size:12px;margin-top:6px">${lobby.canStart() ? t("lobby.allReady") : t("lobby.waiting")}</div>
          </div>
          <div class="lobby-conn">
            <h4>${t("lobby.connection")}</h4>
            ${this.connToggleHtml(false)}
            <div class="field" style="margin-top:8px"><label>${t("lobby.yourName")}</label><input data-id="l-name" maxlength="20" value="${this.escAttr(st.slots[0]?.name && st.slots[0].name !== "Host" ? st.slots[0].name : defaultName())}"/></div>
            ${this.localLinkHtml()}
            <div class="dim lan-note">${t("lobby.localNote")}</div>
            <div class="devices"><h4>${t("lobby.devices")}</h4><div data-id="l-devices">${this.devicesHtml()}</div></div>
          </div>
        </div>
      </div></div>`);
        this.root.appendChild(scr);
        this.wireLang(scr);
        const thumb = scr.querySelector("[data-id=l-thumb]");
        if (thumb)
            this.drawMapThumb(thumb, st.map);
        scr.querySelector("[data-id=l-changemap]").onclick = () => { this.lobby = null; this.showMapSelect(); };
        scr.querySelector("[data-id=l-split]").onchange = (e) => lobby.setSplit(e.target.checked);
        this.wireSplitInput(scr);
        scr.querySelector("[data-id=l-addslot]").onclick = () => {
            if (team)
                lobby.addAITeam(lobby.teamMembers(0).length <= lobby.teamMembers(1).length ? 0 : 1, "normal");
            else
                lobby.addAI("normal");
        };
        scr.querySelector("[data-id=l-back]").onclick = () => { this.lobby = null; this.showPlayMenu(); };
        scr.querySelector("[data-id=l-start]").onclick = () => this.startLobby();
        // game-type toggle
        scr.querySelectorAll("[data-gametype]").forEach((b) => {
            b.onclick = () => lobby.setGameType(b.dataset.gametype);
        });
        // local copyable link
        this.wireLocalLink(scr);
        // Editable host name (persisted → defaultName for next session and for online/LAN slots).
        const nameInput = scr.querySelector("[data-id=l-name]");
        if (nameInput)
            nameInput.onchange = () => { const v = nameInput.value.trim() || "Host"; lobby.setName(0, v); setDefaultName(v); };
        // Editable Player 2 (split-screen) name.
        const nameBInput = scr.querySelector("[data-id=l-nameb]");
        if (nameBInput)
            nameBInput.onchange = () => { if (lobby.splitB >= 0)
                lobby.setName(lobby.splitB, nameBInput.value.trim() || "Player B"); };
        // Local/Online toggle: flipping to Online tears down the local lobby and starts the in-browser
        // P2P host (spec §24 T33-C1).
        scr.querySelector("[data-id=ct-online]")?.addEventListener("click", () => {
            const v = nameInput?.value.trim();
            if (v)
                setDefaultName(v);
            this.startOnlineHost();
        });
        // slot controls (classic rows + team rows share data-slot-act / data-slot-color)
        scr.querySelectorAll("[data-slot-act]").forEach((b) => {
            b.onclick = () => {
                const i = parseInt(b.dataset.slot || "0", 10);
                const act = b.dataset.slotAct;
                if (act === "addai")
                    lobby.addAI("normal");
                else if (act === "kick")
                    lobby.kick(i);
                else if (act === "open")
                    lobby.openSlot(i);
                else if (act === "close")
                    lobby.closeSlot(i);
                else if (act === "ready")
                    lobby.setReady(i, !st.slots[i].ready);
            };
        });
        scr.querySelectorAll("[data-slot-color]").forEach((b) => {
            b.onclick = () => lobby.setColor(parseInt(b.dataset.slot || "0", 10), b.dataset.slotColor);
        });
        // team controls: switch a slot's side, recolour a side, add AI to a side
        scr.querySelectorAll("[data-team-move]").forEach((b) => {
            b.onclick = () => lobby.setTeam(parseInt(b.dataset.slot || "0", 10), parseInt(b.dataset.teamMove || "0", 10));
        });
        scr.querySelectorAll("[data-team-color]").forEach((b) => {
            b.onclick = () => lobby.setTeamColor(parseInt(b.dataset.team || "0", 10), b.dataset.teamColor);
        });
        scr.querySelectorAll("[data-team-addai]").forEach((b) => {
            b.onclick = () => lobby.addAITeam(parseInt(b.dataset.teamAddai || "0", 10), "normal");
        });
    }
    // Classic (FFA) slot list — every occupied / open slot rendered as a row.
    classicSlotsHtml(lobby) {
        return `<div class="slots" data-id="l-slots">${lobby.state.slots.map((s) => this.slotHtml(s)).join("")}</div>`;
    }
    // Custom-team layout — two side panels (blue / red) each listing their members, a side colour
    // picker and an "add AI to this side" button.
    teamsHtml(lobby) {
        const hasOpen = lobby.state.slots.some((s) => s.kind === "open");
        const side = (team) => {
            const color = lobby.state.teamColors[team];
            const members = lobby.teamMembers(team);
            const rows = members.map((s) => this.teamSlotHtml(s, team)).join("") || `<div class="dim" style="font-size:12px;padding:6px">${t("lobby.teamEmpty")}</div>`;
            const swatches = PALETTE.map((c) => `<span class="mini-swatch ${color === c ? "on" : ""}" data-team="${team}" data-team-color="${c}" style="background:${c}"></span>`).join("");
            return `<div class="team-panel" style="border-color:${color}">
        <div class="team-head" style="color:${color}">
          <span>${t("lobby.team" + (team === 0 ? "Blue" : "Red"))}</span>
          <span class="swatches">${swatches}</span>
        </div>
        <div class="team-members">${rows}</div>
        <button class="btn tiny" data-team-addai="${team}" ${hasOpen ? "" : "disabled"}>${t("lobby.addAI")}</button>
      </div>`;
        };
        return `<div class="teams" data-id="l-teams">${side(0)}${side(1)}</div>`;
    }
    teamSlotHtml(s, team) {
        const isHostSlot = s.index === 0;
        const color = this.lobby.state.teamColors[team];
        const name = s.kind === "human" ? (isHostSlot ? (s.name && s.name !== "Host" ? s.name : t("lobby.host")) : (s.name || t("lobby.playerB"))) : t("lobby.aiPlayer");
        const other = team === 0 ? 1 : 0;
        const moveBtn = `<button class="btn tiny" data-slot="${s.index}" data-team-move="${other}">→ ${t("lobby.team" + (other === 0 ? "Blue" : "Red"))}</button>`;
        const kick = (s.kind === "ai" || (!isHostSlot && s.token)) ? `<button class="btn tiny" data-slot="${s.index}" data-slot-act="kick">${t("lobby.kick")}</button>` : "";
        const tag = s.kind === "ai" ? `<span class="badge">${t("lobby.aiPlayer")} · ${t("menu." + (s.ai || "normal"))}</span>` : `<span class="hero">${t("menu.heroCommander")}</span>`;
        // The host readies up from its own row; other humans show a ready badge.
        const ready = s.kind === "human"
            ? (isHostSlot
                ? `<button class="btn tiny ${s.ready ? "primary" : ""}" data-slot="${s.index}" data-slot-act="ready">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</button>`
                : `<span class="badge ${s.ready ? "ok" : ""}">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</span>`)
            : "";
        return `<div class="slot ${s.kind}">
      <span class="slot-dot" style="background:${color}"></span>
      <span class="slot-name">${name}${isHostSlot ? " (" + t("lobby.you") + ")" : ""}</span>
      ${tag}
      <span class="slot-right">${moveBtn}${ready}${kick}</span>
    </div>`;
    }
    // A copyable "local link" for this device, shown in the Local connection panel. In a browser the
    // host cannot accept remote devices (no server), so this is the page's own address — handy for
    // re-opening on this machine; true cross-device LAN still needs host.bat (see the note below it).
    localLinkHtml() {
        let url = "";
        try {
            url = window.location.origin + window.location.pathname;
        }
        catch {
            url = "";
        }
        if (!url || url.startsWith("file"))
            return "";
        return `<div class="join-url" style="margin-top:8px"><label>${t("lobby.localLink")}</label>
      <div class="url-row"><code data-id="l-localurl">${this.escAttr(url)}</code><button class="btn tiny" data-id="l-localcopy">${t("lobby.copy")}</button></div>
    </div>`;
    }
    wireLocalLink(scr) {
        const code = scr.querySelector("[data-id=l-localurl]");
        const btn = scr.querySelector("[data-id=l-localcopy]");
        if (!code || !btn)
            return;
        btn.onclick = () => navigator.clipboard?.writeText(code.textContent || "")
            .then(() => { btn.textContent = t("lobby.copied"); setTimeout(() => { btn.textContent = t("lobby.copy"); }, 1500); })
            .catch(() => { });
    }
    splitInputHtml() {
        const c = this.splitInput;
        const devOpts = (sel) => `<option value="keyboard" ${sel === "keyboard" ? "selected" : ""}>${t("device.keyboard")}</option>` +
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
    wireSplitInput(scr) {
        const left = scr.querySelector("[data-id=si-left]");
        if (!left)
            return;
        const right = scr.querySelector("[data-id=si-right]");
        const swap = scr.querySelector("[data-id=si-swap]");
        const commit = () => { saveSplitInput(this.splitInput); this.rerenderHostLobby(); };
        left.onchange = () => { this.splitInput.left = left.value; commit(); };
        right.onchange = () => { this.splitInput.right = right.value; commit(); };
        swap.onclick = () => {
            const tmp = this.splitInput.left;
            this.splitInput.left = this.splitInput.right;
            this.splitInput.right = tmp;
            commit();
        };
    }
    // Re-render whichever host lobby is active (local renderLobby or the online-host remote lobby).
    rerenderHostLobby() {
        if (this.lobby)
            this.renderLobby();
        else if (this.browserHost)
            this.showRemoteLobby(this.browserHost.gameHost.publicState(), this.browserHost.local, "online-host");
    }
    slotHtml(s) {
        const isHostSlot = s.index === 0;
        const colorPick = (s.kind === "human")
            ? `<div class="swatches">${PALETTE.map((c) => `<span class="mini-swatch ${s.color === c ? "on" : ""}" data-slot="${s.index}" data-slot-color="${c}" style="background:${c}"></span>`).join("")}</div>` : "";
        let right = "";
        if (s.kind === "open")
            right = `<button class="btn tiny" data-slot="${s.index}" data-slot-act="addai">${t("lobby.addAI")}</button><button class="btn tiny" data-slot="${s.index}" data-slot-act="close">${t("lobby.closeSlot")}</button>`;
        else if (s.kind === "closed")
            right = `<span class="dim">${t("lobby.closed")}</span><button class="btn tiny" data-slot="${s.index}" data-slot-act="open">${t("lobby.openSlot")}</button>`;
        else if (s.kind === "ai")
            right = `<span class="badge">${t("lobby.aiPlayer")} · ${t("menu." + (s.ai || "normal"))}</span><button class="btn tiny" data-slot="${s.index}" data-slot-act="kick">${t("lobby.kick")}</button>`;
        else if (s.kind === "human") {
            const label = isHostSlot ? (s.name && s.name !== "Host" ? s.name : t("lobby.host")) : (s.name || t("lobby.playerB"));
            const readyBtn = isHostSlot ? `<button class="btn tiny ${s.ready ? "primary" : ""}" data-slot="${s.index}" data-slot-act="ready">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</button>` : `<span class="badge ${s.ready ? "ok" : ""}">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</span>`;
            const kick = (!isHostSlot && s.token) ? `<button class="btn tiny" data-slot="${s.index}" data-slot-act="kick">${t("lobby.kick")}</button>` : "";
            right = `<span class="badge">${label}${isHostSlot ? " (" + t("lobby.you") + ")" : ""}</span>${readyBtn}${kick}`;
        }
        const heroLabel = (s.kind === "human" || s.kind === "ai") ? `<span class="hero">${t("menu.heroCommander")}</span>` : "";
        const name = s.kind === "human" ? (isHostSlot ? (s.name && s.name !== "Host" ? s.name : t("lobby.host")) : (s.name || t("lobby.playerB"))) : s.kind === "ai" ? t("lobby.aiPlayer") : t("lobby.empty");
        return `<div class="slot ${s.kind}">
      <span class="slot-dot" style="background:${(s.kind === "human" || s.kind === "ai") ? s.color : "#2a3a4a"}"></span>
      <span class="slot-name">${name}</span>
      ${heroLabel}
      ${colorPick}
      <span class="slot-right">${right}</span>
    </div>`;
    }
    devicesHtml() {
        const lobby = this.lobby;
        const humans = lobby.state.slots.filter((s) => s.kind === "human");
        return humans.map((s) => `<div class="device"><span class="slot-dot" style="background:${s.color}"></span>${s.index === 0 ? t("lobby.host") : (s.token ? s.name : t("lobby.playerB"))}${s.ping !== undefined ? ` <span class="dim">${s.ping}ms</span>` : ""}</div>`).join("");
    }
    startLobby() {
        const lobby = this.lobby;
        if (!lobby.canStart())
            return;
        const players = lobby.buildPlayers();
        const localIds = lobby.localPlayerIds();
        const split = lobby.state.splitScreen && localIds.length >= 2;
        let locals;
        if (split) {
            const resolved = resolveSplitInput(this.splitInput);
            locals = localIds.map((pid, i) => ({
                playerId: pid,
                pointerType: resolved[i]?.pointerType ?? null,
                keyboard: resolved[i]?.keyboard ?? false,
                control: resolved[i]?.control ?? "single",
            }));
        }
        else {
            locals = localIds.map((pid) => ({ playerId: pid, pointerType: null, keyboard: true, control: "single" }));
        }
        const cfg = { map: lobby.state.map, players, locals, split, showRematch: true, gameType: lobby.state.gameType, onQuit: () => this.showTitle() };
        this.lobby = null;
        this.root.innerHTML = "";
        this.cb.onStartLocal(cfg);
    }
    // ---------- Join Local Game ----------
    showJoin() {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        const status = scr.querySelector("[data-id=j-status]");
        const ui = { setStatus: (key, isErr) => { status.textContent = t(key); status.className = "status" + (isErr ? " err" : ""); } };
        scr.querySelector("[data-id=j-name]").oninput = (e) => name = e.target.value;
        scr.querySelector("[data-id=j-connect]").onclick = () => {
            const addr = scr.querySelector("[data-id=j-addr]").value.trim();
            if (!addr) {
                ui.setStatus("join.failed", true);
                return;
            }
            ui.setStatus("join.connecting");
            this.cb.onJoin({ url: addr, name }, ui);
        };
        scr.querySelector("[data-id=j-back]").onclick = () => this.showPlayMenu();
    }
    showSettings() {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        this.renderBindings(scr);
        scr.querySelector("[data-id=kb-reset]").onclick = () => { this.stopCapture(); resetKeyBindings(); this.clearConflict(scr); this.renderBindings(scr); };
        scr.querySelector("[data-id=kb-back]").onclick = () => { this.stopCapture(); this.showTitle(); };
    }
    renderBindings(scr) {
        const wrap = scr.querySelector("[data-id=kb-groups]");
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
        wrap.querySelectorAll("[data-act]").forEach((btn) => {
            btn.onclick = () => this.startCapture(btn.dataset.ctx, btn.dataset.act, scr);
        });
        wrap.querySelectorAll("[data-reset-ctx]").forEach((btn) => {
            btn.onclick = () => { this.stopCapture(); resetKeyBindings(btn.dataset.resetCtx); this.clearConflict(scr); this.renderBindings(scr); };
        });
    }
    startCapture(context, action, scr) {
        this.stopCapture();
        this.clearConflict(scr);
        this.capturing = { context, action };
        this.renderBindings(scr);
        this.captureHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const k = normalizeKey(e);
            if (k === "escape") {
                this.stopCapture();
                this.renderBindings(scr);
                return;
            }
            const conflict = setBinding(context, action, k);
            this.stopCapture();
            if (conflict)
                this.showConflict(scr, context, conflict);
            this.renderBindings(scr);
        };
        window.addEventListener("keydown", this.captureHandler, true);
    }
    stopCapture() {
        if (this.captureHandler) {
            window.removeEventListener("keydown", this.captureHandler, true);
            this.captureHandler = null;
        }
        this.capturing = null;
    }
    showConflict(scr, context, conflictAction) {
        const def = ACTION_DEFS.find((a) => a.context === context && a.action === conflictAction);
        const name = def ? t(def.labelKey) : conflictAction;
        const el = scr.querySelector("[data-id=kb-conflict]");
        if (el)
            el.textContent = t("settings.conflict", { action: name });
    }
    clearConflict(scr) {
        const el = scr.querySelector("[data-id=kb-conflict]");
        if (el)
            el.textContent = "";
    }
    showHelp() {
        this.root.innerHTML = "";
        const scr = this.el(`<div class="screen" data-screen="help">
      ${this.langSwitch()}
      <div class="menu" style="width:560px">
        <h2>${t("help.title")}</h2>
        <div class="help-text">${t("help.body").replace(/\n/g, "<br>")}</div>
        <button class="btn" data-id="h-back">${t("menu.back")}</button>
      </div></div>`);
        this.root.appendChild(scr);
        this.wireLang(scr);
        scr.querySelector("[data-id=h-back]").onclick = () => this.showTitle();
    }
    renderQR(canvas, text) {
        const m = qrMatrix(text);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!m)
            return;
        const n = m.length;
        const quiet = 2;
        const total = n + quiet * 2;
        const px = Math.floor(canvas.width / total);
        const off = Math.floor((canvas.width - px * total) / 2);
        ctx.fillStyle = "#000";
        for (let r = 0; r < n; r++)
            for (let c = 0; c < n; c++)
                if (m[r][c])
                    ctx.fillRect(off + (c + quiet) * px, off + (r + quiet) * px, px, px);
    }
    showRemoteLobby(state, transport, mode = "lan") {
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
        // Online host can add a 2nd LOCAL player on this device (split-screen) alongside the online
        // friend(s) — pick a 3–4 player map to leave a slot for the friend (spec §21 / §24 T33).
        const onlineSplitHtml = (mode === "online-host" && isHost) ? `
      <label class="splitrow" style="margin-top:10px"><input type="checkbox" data-id="rl-split" ${this.onlineSplit ? "checked" : ""}/> ${t("lobby.onlineSplit")}</label>
      <div class="dim" style="font-size:11px">${t("lobby.onlineSplitHint")}</div>
      ${this.onlineSplit ? this.splitInputHtml() : ""}
      ${this.onlineSplit && this.localBSlot >= 0 ? `<div class="field" style="margin-top:8px"><label>${t("lobby.player2Name")}</label><input data-id="rl-nameb" maxlength="20" value="${this.escAttr(state.slots[this.localBSlot]?.name || "Player 2")}"/></div>` : ""}` : "";
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
            ${onlineSplitHtml}
            ${isHost ? hostControls : guestControls}
          </div>
          <div class="lobby-conn">
            <h4>${t("lobby.connection")}</h4>
            ${this.connPanelHtml(state, mode, joinUrl)}
          </div>
        </div>
      </div></div>`);
        this.root.appendChild(scr);
        this.wireLang(scr);
        // QR + copy of the LAN join URL (LAN host path only).
        if (showLanInfo(mode)) {
            const qc = scr.querySelector("[data-id=rl-qr]");
            if (qc)
                this.renderQR(qc, joinUrl);
            const copyBtn = scr.querySelector("[data-id=rl-copy]");
            if (copyBtn)
                copyBtn.onclick = () => {
                    navigator.clipboard?.writeText(joinUrl)
                        .then(() => { copyBtn.textContent = t("lobby.copied"); setTimeout(() => { copyBtn.textContent = t("lobby.copy"); }, 1500); })
                        .catch(() => { });
                };
        }
        // Editable name → reflect to all peers + persist for next session (spec §24 T33-D1).
        const nameInput = scr.querySelector("[data-id=rl-name]");
        if (nameInput)
            nameInput.onchange = () => {
                const v = nameInput.value.trim() || "Player";
                transport.sendLobbyAction({ a: "setName", name: v });
                setDefaultName(v);
            };
        // Online host: wire the invite/reply controls + Local toggle.
        if (showInvitePanel(mode))
            this.wireInvitePanel(scr);
        // Online host split-screen: toggle a 2nd LOCAL player + its input devices + editable name.
        if (mode === "online-host" && isHost) {
            const splitCb = scr.querySelector("[data-id=rl-split]");
            if (splitCb)
                splitCb.onchange = () => {
                    if (!this.browserHost)
                        return;
                    if (splitCb.checked) {
                        this.onlineSplit = true;
                        this.browserHost.addLocalB("Player 2");
                        this.localBSlot = this.browserHost.localB ? this.browserHost.localB.playerId : -1;
                    }
                    else {
                        this.onlineSplit = false;
                        this.browserHost.removeLocalB();
                        this.localBSlot = -1;
                    }
                    this.showRemoteLobby(this.browserHost.gameHost.publicState(), this.browserHost.local, "online-host");
                };
            if (this.onlineSplit)
                this.wireSplitInput(scr); // re-renders via showRemoteLobby below on change
            const nameB = scr.querySelector("[data-id=rl-nameb]");
            if (nameB)
                nameB.onchange = () => { this.browserHost?.localB?.sendLobbyAction({ a: "setName", name: nameB.value.trim() || "Player 2" }); };
        }
        // Back / leave the lobby (tear down the online host if we are it).
        scr.querySelector("[data-id=rl-back]").onclick = () => {
            transport.close();
            this.remoteTransport = null;
            this.teardownOnline();
            this.showPlayMenu();
        };
        if (isHost) {
            scr.querySelector("[data-id=rl-map]").onchange = (e) => transport.sendLobbyAction({ a: "setMap", map: e.target.value });
            scr.querySelector("[data-id=rl-addai]").onclick = () => transport.sendLobbyAction({ a: "addAI", diff: "normal" });
            scr.querySelector("[data-id=rl-start]").onclick = () => {
                // The host's Start implies readiness (no separate host ready button); ready then start so
                // the server-side canStart (every human ready, incl. the host) is satisfied.
                transport.sendLobbyAction({ a: "ready", ready: true });
                transport.sendLobbyAction({ a: "start" });
            };
            // Host-only per-slot management.
            scr.querySelectorAll("[data-rl-act]").forEach((b) => {
                b.onclick = () => {
                    const i = parseInt(b.dataset.rlSlot || "0", 10);
                    switch (b.dataset.rlAct) {
                        case "addai":
                            transport.sendLobbyAction({ a: "addAI", diff: "normal" });
                            break;
                        case "kick":
                            transport.sendLobbyAction({ a: "kick", index: i });
                            break;
                        case "open":
                            transport.sendLobbyAction({ a: "openSlot", index: i });
                            break;
                        case "close":
                            transport.sendLobbyAction({ a: "closeSlot", index: i });
                            break;
                    }
                };
            });
        }
        else {
            const readyBtn = scr.querySelector("[data-id=rl-ready]");
            readyBtn.onclick = () => transport.sendLobbyAction({ a: "ready", ready: !(mySlot?.ready) });
        }
        // Color picks apply to my own slot only.
        scr.querySelectorAll("[data-slot-color]").forEach((b) => {
            b.onclick = () => {
                const idx = parseInt(b.dataset.slot || "0", 10);
                if (idx === this.remoteSlot)
                    transport.sendLobbyAction({ a: "setColor", color: b.dataset.slotColor });
            };
        });
    }
    // The host can start once there are ≥2 participants and all OTHER humans are ready. The host's
    // own readiness is implied by clicking Start (the host has no separate ready button), so slot 0
    // is excluded here — the Start handler sends ready+start so the server-side canStart (which does
    // require every human ready, incl. the host) is satisfied. Local split-screen Player B is
    // auto-readied on join, so it never blocks Start either.
    canStartRemote(state) {
        const participants = state.slots.filter((s) => s.kind === "human" || s.kind === "ai");
        if (participants.length < 2)
            return false;
        return state.slots.filter((s) => s.kind === "human" && s.index !== 0).every((s) => s.ready);
    }
    remoteSlotHtml(s, isHost) {
        const isMe = s.index === this.remoteSlot;
        const colorPick = (s.kind === "human" && isMe)
            ? `<div class="swatches">${PALETTE.map((c) => `<span class="mini-swatch ${s.color === c ? "on" : ""}" data-slot="${s.index}" data-slot-color="${c}" style="background:${c}"></span>`).join("")}</div>` : "";
        let label = "";
        if (s.kind === "open")
            label = t("lobby.empty");
        else if (s.kind === "closed")
            label = t("lobby.closed");
        else if (s.kind === "ai")
            label = t("lobby.aiPlayer") + " · " + t("menu." + (s.ai || "normal"));
        else if (s.kind === "human")
            label = (s.index === 0 ? (s.name && s.name !== "Host" ? s.name : t("lobby.host")) : (s.name || t("lobby.human"))) + (isMe ? " (" + t("lobby.you") + ")" : "");
        const readyBadge = s.kind === "human" ? `<span class="badge ${s.ready ? "ok" : ""}">${s.ready ? t("lobby.ready") : t("lobby.notReady")}</span>` : "";
        // Host gets per-slot management buttons — never on its own slot 0.
        let hostBtns = "";
        if (isHost && s.index !== 0) {
            if (s.kind === "open")
                hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="addai">${t("lobby.addAI")}</button><button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="close">${t("lobby.closeSlot")}</button>`;
            else if (s.kind === "closed")
                hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="open">${t("lobby.openSlot")}</button>`;
            else if (s.index !== this.localBSlot)
                hostBtns = `<button class="btn tiny" data-rl-slot="${s.index}" data-rl-act="kick">${t("lobby.kick")}</button>`;
        }
        return `<div class="slot ${s.kind}">
      <span class="slot-dot" style="background:${(s.kind === "human" || s.kind === "ai") ? s.color : "#2a3a4a"}"></span>
      <span class="slot-name">${label}</span>
      ${colorPick}
      <span class="slot-right">${readyBadge}${hostBtns}</span>
    </div>`;
    }
    // ---------- T33 online helpers (Local/Online toggle, invite/reply, Join Online) ----------
    escAttr(s) {
        return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    // The two-way Local/Online toggle shown at the top of the host Connection panel (spec §24 T33-C1).
    connToggleHtml(online) {
        return `<div class="conn-toggle row" style="gap:6px">
      <button class="btn tiny ${online ? "" : "active"}" data-id="ct-local">${t("lobby.modeLocal")}</button>
      <button class="btn tiny ${online ? "active" : ""}" data-id="ct-online">${t("lobby.modeOnline")}</button>
    </div>`;
    }
    deviceListHtml(state) {
        return state.slots.filter((s) => s.kind === "human").map((s) => `<div class="device"><span class="slot-dot" style="background:${s.color}"></span>${s.index === 0 ? t("lobby.host") : (s.name || t("lobby.human"))}</div>`).join("");
    }
    // Connection-panel content for each lobby mode (spec §24 T33-C1).
    connPanelHtml(state, mode, joinUrl) {
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
    wireInvitePanel(scr) {
        scr.querySelector("[data-id=ct-local]")?.addEventListener("click", () => {
            this.teardownOnline();
            this.showLobby(); // back to the Local host lobby
        });
        const newBtn = scr.querySelector("[data-id=rl-newinvite]");
        const wrap = scr.querySelector("[data-id=rl-invitewrap]");
        const inviteBox = scr.querySelector("[data-id=rl-invite]");
        const replyBox = scr.querySelector("[data-id=rl-reply]");
        const status = scr.querySelector("[data-id=rl-invitestatus]");
        const setStatus = (key, err = false) => { if (status) {
            status.textContent = key ? t(key) : "";
            status.className = "status" + (err ? " err" : "");
        } };
        if (newBtn)
            newBtn.onclick = async () => {
                if (!this.browserHost)
                    return;
                newBtn.textContent = t("lobby.generating");
                newBtn.disabled = true;
                try {
                    const invite = await this.browserHost.createInvite();
                    this.pendingInvite = invite;
                    if (inviteBox)
                        inviteBox.value = invite.code;
                    if (wrap)
                        wrap.style.display = "";
                    setStatus("");
                }
                catch {
                    setStatus("online.connectFailed", true);
                }
                finally {
                    newBtn.textContent = t("lobby.newInvite");
                    newBtn.disabled = false;
                }
            };
        const copyBtn = scr.querySelector("[data-id=rl-invitecopy]");
        if (copyBtn)
            copyBtn.onclick = () => {
                if (!inviteBox)
                    return;
                navigator.clipboard?.writeText(inviteBox.value)
                    .then(() => { copyBtn.textContent = t("lobby.copied"); setTimeout(() => { copyBtn.textContent = t("lobby.copy"); }, 1500); })
                    .catch(() => { });
            };
        const applyBtn = scr.querySelector("[data-id=rl-applyreply]");
        if (applyBtn)
            applyBtn.onclick = async () => {
                if (!this.pendingInvite || !replyBox)
                    return;
                const code = replyBox.value.trim();
                if (!code) {
                    setStatus("online.badCode", true);
                    return;
                }
                try {
                    await this.pendingInvite.applyReply(code);
                    setStatus("online.connected");
                    this.pendingInvite = null;
                    replyBox.value = "";
                    if (wrap)
                        wrap.style.display = "none";
                }
                catch {
                    setStatus("online.badCode", true);
                }
            };
    }
    // Local → Online: stand up the in-browser P2P host (GameHost + WebRTC bridge) and connect the
    // host's own player over a loopback transport, so the host uses the same lobby + match path as
    // every joiner (slot 0), with the added invite/reply panel (spec §24 T33-B2/C1).
    startOnlineHost() {
        this.teardownOnline();
        this.lobby = null;
        const cb = {
            onLobby: (state) => { if (this.browserHost)
                this.showRemoteLobby(state, this.browserHost.local, "online-host"); },
            onStart: (startMsg) => {
                if (!this.browserHost)
                    return;
                const resolved = this.onlineSplit ? resolveSplitInput(this.splitInput) : [];
                const locals = [{
                        transport: this.browserHost.local, playerId: startMsg.you,
                        pointerType: this.onlineSplit ? (resolved[0]?.pointerType ?? null) : null,
                        keyboard: this.onlineSplit ? (resolved[0]?.keyboard ?? false) : true,
                        control: this.onlineSplit ? (resolved[0]?.control ?? "single") : "single",
                    }];
                if (this.onlineSplit && this.browserHost.localB) {
                    locals.push({
                        transport: this.browserHost.localB, playerId: this.browserHost.localB.playerId,
                        pointerType: resolved[1]?.pointerType ?? null, keyboard: resolved[1]?.keyboard ?? false, control: resolved[1]?.control ?? "single",
                    });
                }
                this.cb.onRemoteMatch?.(locals, startMsg, this.onlineSplit && locals.length >= 2);
            },
            onHostGone: () => { this.teardownOnline(); this.showTitle(); },
        };
        this.browserHost = new BrowserHost(defaultName(), cb);
        this.browserHost.start();
    }
    // Tear down any online host / joiner connection (called on leaving the lobby or quitting a match).
    teardownOnline() {
        if (this.browserHost) {
            try {
                this.browserHost.stop();
            }
            catch { /* */ }
            this.browserHost = null;
        }
        this.pendingInvite = null;
        this.onlineSplit = false;
        this.localBSlot = -1;
        if (this.joinPc) {
            try {
                this.joinPc.close();
            }
            catch { /* */ }
            this.joinPc = null;
        }
    }
    // ---------- Join Online (paste the host's invite → produce a reply → connect P2P) ----------
    showJoinOnline(prefillInvite) {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        const status = scr.querySelector("[data-id=jo-status]");
        const setStatus = (key, err = false) => { status.textContent = key ? t(key) : ""; status.className = "status" + (err ? " err" : ""); };
        scr.querySelector("[data-id=jo-name]").oninput = (e) => { name = e.target.value; };
        scr.querySelector("[data-id=jo-back]").onclick = () => { this.teardownOnline(); this.showPlayMenu(); };
        scr.querySelector("[data-id=jo-generate]").onclick = async () => {
            const invite = scr.querySelector("[data-id=jo-invite]").value.trim();
            if (!invite) {
                setStatus("online.badCode", true);
                return;
            }
            const nm = name.trim() || "Player";
            setDefaultName(nm);
            setStatus("lobby.generating");
            let transport = null;
            const cb = {
                onLobby: (state) => { if (transport)
                    this.showRemoteLobby(state, transport, "online-guest"); },
                onStart: (startMsg) => { if (transport)
                    this.cb.onRemoteMatch?.([{ transport, playerId: startMsg.you, pointerType: null, keyboard: true, control: "single" }], startMsg, false); },
                onError: (_r, key) => setStatus(key || "online.connectFailed", true),
                onHostGone: () => { this.teardownOnline(); this.showTitle(); },
            };
            try {
                const res = await joinOnline(invite, nm, cb);
                transport = res.transport;
                this.joinPc = res.pc;
                this.remoteTransport = transport;
                const replyWrap = scr.querySelector("[data-id=jo-replywrap]");
                const replyBox = scr.querySelector("[data-id=jo-reply]");
                replyBox.value = res.replyCode;
                replyWrap.style.display = "";
                setStatus("online.waitingHost");
                const rc = scr.querySelector("[data-id=jo-replycopy]");
                rc.onclick = () => navigator.clipboard?.writeText(res.replyCode)
                    .then(() => { rc.textContent = t("lobby.copied"); setTimeout(() => { rc.textContent = t("online.copyReply"); }, 1500); })
                    .catch(() => { });
            }
            catch {
                setStatus("online.badCode", true);
            }
        };
    }
    // ---------- Connecting screen (shown while an auto-join / manual join is in flight) ----------
    showConnecting(addr, onRetry, onCancel) {
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
        this.root.appendChild(scr);
        this.wireLang(scr);
        const statusEl = scr.querySelector("[data-id=c-status]");
        const retryBtn = scr.querySelector("[data-id=c-retry]");
        scr.querySelector("[data-id=c-cancel]").onclick = onCancel;
        retryBtn.onclick = () => {
            retryBtn.style.display = "none";
            statusEl.classList.remove("err");
            statusEl.textContent = t("join.connectingHost");
            onRetry();
        };
        return {
            setStatus: (key, isError) => {
                statusEl.textContent = t(key);
                if (isError) {
                    statusEl.classList.add("err");
                    retryBtn.style.display = "";
                }
                else
                    statusEl.classList.remove("err");
            },
        };
    }
}
