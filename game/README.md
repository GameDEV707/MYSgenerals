# MYS Generals

A real-time strategy base-builder with a DOTA-style hero, built per the specification in
[`../MYSgenerals.md`](../MYSgenerals.md). Trilingual (Uzbek / Russian / English).

> **Build context:** the sandbox this was built in has **no npm registry access**, so the
> spec's prescribed stack (Phaser/React/Vite/Electron/Socket.IO/…) could not be installed.
> The game is therefore implemented **dependency-free** in TypeScript + HTML5 Canvas + WebAudio,
> while preserving the spec's architecture (engine-agnostic authoritative sim, thin render/HUD,
> command + event pipeline). See [`PROGRESS.md`](PROGRESS.md) for the full per-task status.

## Play

The game runs in any modern browser. It must be served over HTTP (opening
`index.html` directly with `file://` won't work, because ES modules need HTTP).
The compiled `dist/` is included, so **you don't need to build anything to play** —
you only need a way to serve the folder.

### Windows

Requires [Node.js](https://nodejs.org) (the only dependency). Then either:

- **Double-click `run.bat`**, or
- in PowerShell: `./run.ps1`, or
- in a terminal: `node serve.mjs`

Then open the printed URL (default <http://localhost:8000/>) in your browser.

> Tip: `run.bat` / `serve.mjs` use only Node's built-in modules — no `npm install`,
> no Python, no bash required.

### macOS / Linux

```bash
cd game
./run.sh            # uses Node if present, else Python 3
# or directly:  node serve.mjs   /   python3 -m http.server 8000
```

### Rebuilding after editing `src/` (optional)

Needs the TypeScript compiler (`npm install -g typescript`).

```bash
# Windows:        build.bat
# macOS/Linux:    ./build.sh      (or: tsc -p tsconfig.json)
```

### Controls

| Action | Input |
|---|---|
| Select / box-select | Left-click / left-drag |
| Move / attack / capture | Right-click |
| Attack-move | `A` then left-click |
| Stop / Hold | `S` / `H` |
| Hero abilities | `Q` `W` `E` `R` (then click target for W/E/R) |
| Control groups | `Ctrl`+`0–9` to set, `0–9` to recall |
| Camera | Arrow keys / screen-edge / middle-mouse drag |
| Zoom | Mouse wheel |
| Build | Select an **Engineer** → category tab → click a building → place. While placing, the command/selection/hero panels **hide** so the map is unobstructed; a **Cancel build** button (or `Esc` / right-click) backs out |
| Train | Select a production building → click a unit |
| Production queue | Select a producer → the queue strip shows order + progress; click a slot to cancel |
| Factory upgrades | Select a Barracks / War Factory → **Production Bay** (build 2–3 at once) / **Assembly Speed** (+25% / +50%) |
| Base & tower upgrades | Select the **Command Center** → **Upgrade → Lvl 2/3** (unlocks Barracks at L2, War Factory at L3). Select a **defensive tower** → **Upgrade → Lvl 2/3** (its range + damage grow; the selection shows its range ring) |
| Research | Select the Research Center → start a global upgrade (needs a built Research Center) |
| Keyboard build (P1) | In keyboard control, `1`–`0` activate the command-panel buttons; with a builder selected, **`Space`** moves across the build categories and **`E`** opens the highlighted one (`]` / `[` also cycle directly). The switch key is remappable in Settings → Keyboard |
| Keyboard zoom (P1) | In keyboard control, **`Shift`** zooms in and **`Ctrl`** zooms out (remappable in Settings → Keyboard). The mouse player uses the wheel |
| Capture outpost / derrick | Move units onto it and hold the area (or send an Engineer to channel-capture) |
| Minimap | Click to jump |
| Pause | `☰` button (top-right) |

## Production, factory upgrades & research (Generals-style)

Selecting a **Barracks**, **War Factory** or **Command Center** shows its **live build queue**: a strip
of slots in build order, each with the unit's icon, and a **progress ring + countdown** on the slot(s)
currently building. **Click a slot to cancel** it (a not-yet-started unit refunds 100%, an in-progress
one 50%). A thin head-item bar is also drawn over your producing buildings on the map, and each train
button shows how many of that unit are queued.

**Factory upgrades** (on any producing building):

- **Production Bay** — `1 → 2 → 3` units built **in parallel**. Requires Factory Tech I (→2) / II (→3).
- **Assembly Speed** — `+25% / +50%` faster building. Requires Factory Tech I (+25%) / II (+50%).

**Research Center tech tree** (one-time, timed global upgrades; one research per centre at a time):

| Research | Effect | Requires |
|---|---|---|
| Weapons I / II | +15% / +30% damage for all your units | — / Weapons I |
| Armor I / II | +15% / +30% effective HP for all your units | — / Armor I |
| Factory Tech I / II | Unlocks Production Bay 2 & Speed +25% / Bay 3 & Speed +50% | — / Factory Tech I |
| Logistics | −20% unit build time | — |

While a research runs, the Research Center panel shows its name, a progress bar and a **Cancel** button
(50% refund), and a progress bar is drawn on the building. Effects apply to your whole army at hit time
(retroactively), so researching Armor protects units you already built.

## Distinct unit silhouettes

Every unit type now draws a distinct vector silhouette (miner, engineer, infantry, rocket soldier,
robot, light/heavy tank, artillery, rocket launcher, anti-air, hero) with team colour, dark outline and
the rank pip preserved — so tanks, artillery, rocket launchers and anti-air (and the various infantry)
are recognisable at a glance.

## Tidy on-screen status indicators

World-space overlays are laid out by a single ordered helper (`entityOverlayLayout`) so they never
overlap: the rank/level pip, the HP bar, and a **single** secondary bar (construction **or** production
**or** research) each get their own fixed row above the entity. HP bars are shown only when relevant
(selected, hovered, recently hit, damaged, or for your hero), keeping the battlefield uncluttered, and
persistent hero status (HP, level, ability cooldowns) lives in the fixed hero HUD cluster rather than
floating over the map — a clean, Generals/Dota-style readout.

The **hero ability cluster** (level, HP/mana, abilities) appears **only when the hero is selected**, docked
tidily in the command area so it never overlaps the command buttons.

## Unobstructed placement, cancel-build & mine readouts

When you pick a building to place, the **command, selection and hero panels hide** so the whole
battlefield is visible while you choose where to drop it; they return the instant placement ends. A
clear **Cancel build** button is shown during placement (alongside `Esc` and right-click) so touch and
keyboard players can always back out. This applies per split-screen side independently.

Selecting one of **your own resource mines** shows a **countdown to the next unit of metal** (a
"next {resource} in {n}s" line plus a resource-coloured progress bar, and a thin progress ring over the
mine on the map). An **idle Silver Mine** with no assigned miners shows an *"assign miners"* hint instead.
Enemy mines stay fog-hidden.

The **Silver, Iron and Gold mines** now carry a **distinct resource-coloured emblem** — silver, iron and
gold — both **on the map** and on the **build-menu buttons**, so the three are instantly tellable apart.

## Base leveling, upgradeable defenses & worked mines

**The Command Center levels up.** Select it and click **Upgrade → Lvl N** to raise the base to **Level 2**
then **Level 3** (each costs resources and takes time — an upgrade is **half** the length of a build).
The base level **gates the build tree**:

| Command Center level | Unlocks |
|---|---|
| **Lvl 1** (start) | Mines, Power Plant, Research Center, **Guard Tower**, Wall |
| **Lvl 2** | **Barracks** (infantry) + **Cannon Tower** |
| **Lvl 3** | **War Factory** (tanks) + **Rocket Tower** |

Locked buildings are greyed in the build menu with a *"Requires Command Center Lvl N"* hint and unlock
the moment the base reaches that level.

**Defenses are upgradeable (max Level 3).** Select a Guard / Cannon / Rocket Tower to see the **radius it
sees and fires in** (a bright attack-range ring + a faint vision ring) and its **level · range · damage**.
**Upgrade → Lvl N** raises its **range (+1 tile) and damage (+25%)** per level; the upgrade takes half the
tower's build time, and a level pip (L2/L3) marks upgraded buildings on the map.

**Every mine needs a miner working inside it.** A mine with no miner sits **idle** and produces nothing.
Train a **Miner** at the Command Center (5 silver); it **automatically walks to a free mine, goes inside,
and works** — disappearing from the map (it no longer loiters beside the mine). **One miner works each
mine**; if every mine is already staffed (or none is built yet) a new Miner **waits** near the base and
**automatically enters** the next mine the moment one is built or freed. If a mine is destroyed, its
miner is **released** back onto the map and re-assigned.

**Builders and miners are separate jobs.** The **Engineer** is the builder: **select it, pick what to
build, and it constructs** it (it also captures oil derricks). You **start with one Engineer** so you
can build immediately, and you can train more at the Command Center — a **Miner for 5 silver** (digs)
or an **Engineer for 20 silver** (builds). Miners never build; Engineers never mine.

## Maps, fortified bases & capturable outposts (sub-bases)

The maps are big, **fortified multi-base** arenas in the Dota / C&C Generals mould — a few **big main
bases** plus several **small capturable sub-bases**:

| Map | Size | Bases |
|---|---|---|
| **Twin Rivers** | 80×80 | 2 fortified bases, a river with bridges, **4** outposts |
| **Crossfire** | 88×88 | 4 fortified corner bases around a central plateau, **4** outposts |
| **Iron Crossroads** | 96×96 | 4 fortified main bases + a walled central cross, **6** outposts |

**Fortified bases & walls.** Every main base is enclosed on its two centre-facing sides by a **stone
wall** with a wide **gate**, plus **cliff/rock obstacle clusters** for cover. Walls and cliffs block
movement and can't be built on, so attackers are funnelled through the gate. (You can still build your
own **Wall** structures too.)

**Capturable outposts (sub-bases).** Scattered across the map are neutral **outposts** — garrisoned
defensive towers that **fire on anyone who approaches** and **cannot be destroyed by attack**. You take
one by **holding it under fire** (bring a tanky force or an Engineer): whoever captures it **owns** it.
A captured outpost then **defends and grants vision for you**, acts as a **forward build anchor** (you
can build a sub-base around it, handy for the contested expansion deposits placed nearby), and can be
**lost to an enemy re-capture**. The garrison is fixed-strength — it never levels up.

## Power

Each power-consuming building needs spare generation. When power usage reaches **90%** a **LOW POWER**
warning appears (a full deficit turns it red and slows production), and trying to build a power-hungry
structure with no headroom is refused with a "not enough power" message — build a **Power Plant** first.
Power producers are never blocked.

## Online play (over the internet, no host.bat, no server)

You can play **online over the internet** straight from the browser — **no `host.bat`, no server we
run**. Gameplay is **peer-to-peer** (WebRTC data channel, STUN-only for NAT discovery); the host runs
the authoritative game in their browser tab and friends connect directly.

Because it is truly serverless, the invite is a **two-step code exchange** (rather than a one-click
link):

### Host an online game

1. **Play → Host Local Game**, then in the **Connection** panel flip the toggle to
   **Online (invite a friend)**.
2. Click **Create invite** and **Copy** the invite code (also shareable as a `#join=…` link).
3. Send it to your friend (any chat). When they send back their **reply code**, paste it into
   **Paste the reply code** and click **Connect device** — they appear as a lobby slot.
4. Repeat **Create invite** for each additional friend (2–4 players), then **Start Match**.

### Join an online game

1. **Play → Join Online Game** (or just open a `#join=…` link, which pre-fills the invite).
2. Paste the host's invite code and click **Generate reply**.
3. **Copy** the reply code and send it back to the host. Once they apply it you drop straight into
   the lobby and then the match — connected **directly, peer-to-peer**.

> **STUN-only / TURN deferred:** most networks connect over free STUN. A minority of strict/symmetric
> NATs (~10–20%) need a **TURN relay**, which would be a server we operate, so it is **out of scope**
> (documented in the lobby). If a direct connection can't be formed, try a different network.

### Local host (this device) — also no launcher

The **Local (this device)** toggle (the default) runs single-player, **split-screen** and **vs-AI**
entirely in the tab with **no launcher**. Every player can also **edit their own name** in the lobby
(it persists across sessions).

## Multiplayer (LAN)

Single-player and local split-screen run entirely in the browser tab (`run.bat` / `serve.mjs`
above, default port 8000). To let **other devices on the same Wi-Fi join a match**, you run the
real host server instead — it serves the game *and* runs the authoritative simulation, and other
phones/laptops join by opening a link or scanning a QR code. No address typing, no `localhost`.

### Host a game

Requires [Node.js](https://nodejs.org). From the `game/` folder:

- **Windows:** double-click **`host.bat`**
- **macOS:** double-click **`host.command`**
- **Linux:** `./host.sh`

(Optional port: `host.bat 3000` / `./host.sh 3000`; default is **3000**.)

This starts the host server and opens the game in your browser — you are **slot 0** and play in
the browser like everyone else (the host machine correctly uses `localhost`). The terminal **and**
the in-game lobby show a **LAN join URL** (e.g. `http://192.168.1.42:3000`), a **room code**, and a
**QR code**.

### Join from another device

On any phone/laptop **on the same Wi-Fi**, either:

- open the **LAN URL** shown on the host (the `http://192.168.x.x:3000` one — **not** `localhost`), or
- **scan the QR code** from the host's lobby screen.

The page auto-connects straight into the lobby (the shared link carries `?room=…` and the host
injects a marker, so no manual "Join" step is needed). A manual **Join Local Game → enter address**
option is still available from the main menu as a fallback.

### First-run notes

- **Same network:** every device must be on the same Wi-Fi / LAN. Guest/AP-isolation networks that
  block device-to-device traffic won't work.
- **Firewall:** the first time you host, your OS may ask whether to allow Node.js to accept incoming
  connections — **allow it** (on Windows tick *Private networks*).

## Project layout

```
game/
├─ index.html, styles.css        # shell + UI styling
├─ serve.mjs                     # zero-dependency static server for LOCAL play (Node built-ins only)
├─ run.bat, run.ps1, run.sh      # local-play launchers (Windows / PowerShell / Unix), port 8000
├─ launch.mjs                    # starts the LAN host server + opens the host's browser
├─ host.bat, host.sh, host.command  # one-click LAN multiplayer host (Win / Linux / macOS), port 3000
├─ build.bat, build.sh           # optional TypeScript compile
├─ src/
│  ├─ constants.ts, types.ts, data.ts, i18n.ts   # shared core (numbers, defs, damage matrix, locales)
│  ├─ sim/        # engine-agnostic authoritative simulation (no DOM): world, grid, map, ai
│  ├─ net/        # protocol, loopback + WebSocket + WebRTC transports, serverless signaling codec, QR
│  ├─ host/       # engine-agnostic GameHost (authoritative loop) + Lobby + MatchHost
│  ├─ server/     # authoritative Node host: static serving + RFC6455 WebSocket + lobby
│  ├─ render/     # canvas renderer, pooled FX, WebAudio
│  ├─ ui/         # menu + lobby + HUD (DOM overlay)
│  ├─ input.ts    # selection / commands / camera / placement / hotkeys
│  └─ main.ts     # entry: tick loop, wiring, ?room= / served-by-host auto-join
├─ dist/          # compiled ES modules (committed so it runs without a toolchain)
│  └─ server/     # compiled host server (run: node dist/server/host.js [port])
└─ test/          # headless tests (sim, net, host, lobby, input, hud, stress, split, keys, LAN)
```

## Tests

Dependency-free Node test suites (run after `build.sh`):

```bash
NODE_OPTIONS="" node test/smoke.mjs       # simulation: damage matrix, economy, veterancy, win/lose, i18n parity
NODE_OPTIONS="" node test/net.mjs         # LAN protocol: lobby join, ready/start, fog-filtered snapshots
NODE_OPTIONS="" node test/host.mjs        # authoritative host: anti-maphack, command ownership
NODE_OPTIONS="" node test/lobby.mjs       # lobby slot model
NODE_OPTIONS="" node test/lan.mjs         # T25: host serves the game (200) + auto-join marker + slot assignment
# plus: input.mjs, hudlayout.mjs, stress.mjs, split.mjs, keybindings.mjs, kbinput.mjs
NODE_OPTIONS="" node test/production.mjs   # T26: parallel bays, assembly speed, cancel/refund, queue-full toast
NODE_OPTIONS="" node test/research.mjs     # T26: research effects (damage/armor/build-time) + Factory Tech gating
NODE_OPTIONS="" node test/visuals.mjs      # T26: unitShape() — 11 distinct unit silhouettes
NODE_OPTIONS="" node test/keyboard.mjs     # T26: digit → command-panel activation, no control-group clash
NODE_OPTIONS="" node test/catnav.mjs       # T27: Space→E keyboard build-category navigation
NODE_OPTIONS="" node test/overlay.mjs      # T27: entityOverlayLayout() — non-overlapping status overlays
NODE_OPTIONS="" node test/power.mjs        # T28: power gate (reject under-power build) + powerStatus thresholds
NODE_OPTIONS="" node test/zoom.mjs         # T28: Player-1 keyboard zoom (Shift/Ctrl) within bounds
NODE_OPTIONS="" node test/heropanel.mjs    # T28: hero ability panel visible only when hero selected
NODE_OPTIONS="" node test/mineeta.mjs      # T29: mine extraction ETA helper (silver slots / iron / gold / oil; idle)
NODE_OPTIONS="" node test/placement.mjs    # T29: placement-visibility predicate + Cancel-build clears r.placing
NODE_OPTIONS="" node test/basetech.mjs     # T30: Command-Center level gates the build tree (Barracks L2, War Factory L3)
NODE_OPTIONS="" node test/upgrades.mjs     # T30: CC + defensive-tower level upgrades (half build time, +range/+damage, capped)
NODE_OPTIONS="" node test/minework.mjs     # T30: worked-mine economy — unmanned = idle; miner enters/hides; release on death
NODE_OPTIONS="" node test/workers.mjs      # T31: split worker roles — Engineer builds, Miner mines (one per mine), idle miners wait
NODE_OPTIONS="" node test/maps.mjs         # T32: bigger fortified maps — wall/obstacle terrain, gate reachability, outposts, new big map
NODE_OPTIONS="" node test/outpost.mjs      # T32: capturable garrisoned outpost — fires on intruders, invulnerable, capture = ownership, build anchor
NODE_OPTIONS="" node test/minefind.mjs     # T32: reachability-aware miner assignment (skips walled-off mines; re-routes when stuck)
NODE_OPTIONS="" node test/gamehost.mjs     # T33: transport-agnostic GameHost over a mock peer sink — join/lobby/ready/start, fog snapshots, command ownership
NODE_OPTIONS="" node test/signal.mjs       # T33: serverless WebRTC invite/reply codec — encode→decode round-trip, tolerant parsing, rejects junk
NODE_OPTIONS="" node test/online.mjs        # T33: editable-name persistence (localStorage) + Local/Online toggle predicates
```

> **Online (WebRTC) is user-verified.** The sandbox has no outbound internet and the headless runner has
> no `RTCPeerConnection`, so the **real peer-to-peer connection is verified manually in a browser**. The
> transport-agnostic pieces (`GameHost`, the signaling codec, name editing, the mode toggle) are covered
> by the suites above.

