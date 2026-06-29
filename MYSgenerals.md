# MYS Generals — Complete Game Specification & Build Task Plan

> **Project codename:** `MYS Generals`
> **Genre:** Real-Time Strategy (RTS) base-builder, in the spirit of *Command & Conquer: Generals*, fused with a *DOTA*-style single hero per player.
> **Platforms:** Browser (offline web app) first; packaged to desktop `.exe` via Electron for the host.
> **Players:** 1 (vs AI) to 4 (local network). Two players can share one laptop via split-screen; extra players join from phones/other laptops over local Wi-Fi.
> **Languages:** Uzbek (Latin), Russian (Cyrillic), English — full UTF-8 i18n, no broken glyphs.
> **Spec language:** English. (In-game text is trilingual; see §5 and §25.)

---

## 0. How to read this document

This file is **both** a design specification **and** a strict, ordered build plan.

- **§1–§23** describe *what the game is* — every system, every number, every animation, every screen. Nothing here is optional unless explicitly marked `[OPTIONAL]` or `[STRETCH]`.
- **§24** is the **Build Task Plan**: an ordered list of tasks `T0 … T22`. Each task has a *Goal*, a *Scope checklist* (every item must be implemented), and *Definition of Done (DoD)* acceptance criteria. A task is only complete when every checklist item is done and every DoD line passes.
- **§25** is the dedicated **Localization Finalization** task, run after the game is functionally complete.
- **§26** is the **Appendix**: consolidated constants, the full stat tables, and the trilingual glossary.

**Rule of completeness:** if any micro-detail (a muzzle flash, a coin sparkle, a tooltip fade) is described in §1–§23, it is in scope for the corresponding task in §24. "It works but the animation is missing" is **not** done.

**Numeric canon:** the economy numbers given by the design owner are fixed and must not be re-balanced during the build phase (only in the balancing task `T21`):

| Fact | Value |
|---|---|
| Starting silver | 15 |
| Miner output | +1 silver / 10 s |
| Iron mine cost / output | 20 silver → +1 iron / 15 s |
| Gold mine cost / output | 5 iron + 25 silver → +1 gold / 30 s |
| Barracks cost | 1 gold + 10 iron + 30 silver |
| Infantry | 5 silver, 20 s build |
| Rocket Soldier ("gunner") | 10 silver, 30 s build |
| Robot | 25 silver, 25 s build |
| War Factory (tank factory) | 3 gold + 15 iron + 70 silver |

All other numbers in this document are the starting balance and may be tuned in `T21`.

---

## 1. Game Overview

MYS Generals is a top-down 2D real-time strategy game. Each player starts in their own corner of the map with a **Command Center** and a single **Miner** already working the adjacent **Silver Mine**. From that seed, players grow an economy (silver → iron → gold → power), construct production buildings, train armies (infantry, vehicles, aircraft), research **Generals**-style upgrades, build defensive towers and walls, and capture neutral points scattered across the map for extra income and territory.

On top of the army-vs-army RTS layer sits a **single controllable Hero** per player — a *DOTA*-style "super hero" with four leveling abilities, an experience bar, a respawn timer, and an optional artifact shop. The hero is a swing unit: powerful, irreplaceable when alive, costly when dead.

**The objective:** eliminate every enemy by destroying **or capturing** their Command Center. The last player (or team) with a standing Command Center wins. Capturing neutral points and enemy structures (via the **Engineer**) accelerates this by denying resources and converting territory.

### 1.1 The 60-second pitch of a match

1. **0:00** — You start with 15 silver and one miner ticking +1 silver / 10 s.
2. **0:30** — You build an Iron Mine and a Power Plant; iron begins flowing.
3. **2:00** — A Gold Mine and a Barracks come online; the first riflemen march out.
4. **4:00** — Your Hero has reached level 3; you push a neutral Oil Derrick and capture it for passive income.
5. **7:00** — A War Factory pumps out tanks; you research Uranium Shells; rocket soldiers screen against enemy armor.
6. **12:00** — Defensive Rocket Towers and walls hold your flank while your Hero ultimate + a tank column crack the enemy's front.
7. **18:00** — A charged Super Weapon levels the enemy Command Center, or your Engineer captures it. Victory.

---

## 2. Design Pillars & Core Loop

### 2.1 Design pillars

1. **Readable RTS, instantly.** Every unit, building, projectile, and status is identifiable at a glance by silhouette, color, and icon. Nothing ambiguous.
2. **Economy is the spine.** Silver → Iron → Gold → Power is a strict dependency chain. Every strategic decision trades economy tempo against military tempo.
3. **The Hero is the spice.** One hero per player creates DOTA-style highs (a clutch ultimate) without turning the game into a MOBA. The hero never fully replaces the army.
4. **Generals-flavored escalation.** Power plants, veterancy, weapon upgrades, garrisonable bunkers, capturable tech, and a single devastating Super Weapon give the late game a recognizable *Generals* shape.
5. **Juice everywhere.** Every action has feedback: a muzzle flash, a rising "+1", a screen shake, a flag raise. Feedback is a first-class feature, not polish.
6. **Local-first multiplayer.** No accounts, no internet. One machine hosts; everyone else opens a browser. Two can share a laptop.
7. **Trilingual by construction.** Uzbek, Russian, English are equal first-class locales from day one; no string is ever hardcoded.

### 2.2 The core gameplay loop

```
            ┌────────────────────────────────────────────────┐
            │                                                  │
            ▼                                                  │
   Gather resources ──► Build economy ──► Build production     │
   (Silver/Iron/Gold/Power)                    │               │
            ▲                                   ▼               │
            │                          Train army + level Hero  │
            │                                   │               │
   Capture neutral points ◄── Expand territory ─┤               │
            │                                   ▼               │
            └──────────── Attack / Defend ──► Destroy or        │
                          (towers, walls,      capture enemy ───┘
                           upgrades, hero)     Command Center
```

The player cycles this loop continuously; the AI and human opponents run the same loop. Tension comes from when to break out of "grow" and into "fight."

---

## 3. Technology Stack & Architecture

### 3.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict mode) | One language across client, server, and shared simulation. |
| World rendering | **Phaser 3** | Mature 2D WebGL engine: tilemaps, sprites, **multi-camera** (needed for split-screen), input, tweens, particle emitters, camera shake. |
| UI / HUD / menus | **React 18** | Declarative, dynamic HUD: resource bars, build menus, lobby, tooltips. |
| UI styling | CSS Modules + a small design-token file | Themeable, no runtime CSS-in-JS overhead during streaming. |
| Build tool | **Vite** | Fast dev server, TS support, easy Electron integration. |
| i18n | **i18next** + `react-i18next` | Namespaced JSON locales, runtime language switch, interpolation, plurals. |
| Networking | **Socket.IO** (WebSocket) | Reliable local-network real-time messaging, rooms, reconnection. |
| Host server | **Node.js** (Express + Socket.IO) | Authoritative simulation host + static file serving + lobby. |
| Pathfinding | **easystarjs** (A* grid) with a custom flow-field fallback for large groups | Cheap, deterministic, good enough for grid maps. |
| State (UI) | **Zustand** | Lightweight store bridging Phaser game state ↔ React HUD. |
| Desktop packaging | **Electron** (host only) | Bundles Node server + Chromium frontend into one `.exe`; clients just use a browser. |
| Audio | **Howler.js** | Sprite-based SFX, music, volume buses, spatial-ish panning. |
| Testing | **Vitest** (unit) + Playwright `[OPTIONAL]` (smoke) | Validate simulation math and core flows. |

**Rationale for Electron over Tauri (host):** the host must run an embedded Node + Socket.IO server to serve the game to phones and other laptops. Electron bundles Node natively, so the server starts when the `.exe` launches. Tauri's Rust backend would require re-implementing the server in Rust or bundling a Node sidecar — more work for no benefit at this scale. `[STRETCH]` A Tauri build can be revisited later for a smaller binary.

### 3.2 Architecture: authoritative host, thin clients

- **One machine is the host.** It runs the authoritative game **simulation** (the single source of truth for all units, resources, HP, positions) and a Socket.IO server.
- **Every player — including the host's own screen — is a client.** Clients **render** the world and **send commands** (move here, build this, cast ability). Clients never decide outcomes; they request, the host resolves.
- **Tick model:** the simulation runs at a fixed **20 ticks/second** (50 ms). The host broadcasts **state snapshots** at 15–20 Hz; clients **interpolate** between snapshots for smooth motion and run a lightweight local prediction for the player's own cursor/selection only (never for authoritative results).
- **Determinism is not required** in the authoritative model (the host is the only simulator), which dramatically simplifies development versus lockstep. Snapshots carry the truth.
- **Local play (1 player or split-screen) uses the same architecture** with an in-process "loopback" transport instead of a network socket, so there is exactly **one** code path for the simulation.

```
        ┌──────────────────────────── HOST MACHINE ───────────────────────────┐
        │                                                                      │
        │   Node + Socket.IO server  ◄──loopback──►  Host's own game client    │
        │   ┌───────────────────────┐                (Player 1, + Player 2     │
        │   │  Authoritative Sim    │                 if split-screen)         │
        │   │  (20 ticks/sec)       │                                          │
        │   │  - entities/resources │                                          │
        │   │  - combat resolution  │                                          │
        │   │  - win/lose checks    │                                          │
        │   └──────────┬────────────┘                                          │
        │              │ snapshots (15–20 Hz) / events                          │
        └──────────────┼───────────────────────────────────────────────────────┘
                       │  (local Wi-Fi, no internet)
        ┌──────────────┴───────────┐        ┌───────────────────────────┐
        │  Phone client (Player 3) │        │  Laptop client (Player 4) │
        │  browser, WebSocket      │        │  browser, WebSocket       │
        └──────────────────────────┘        └───────────────────────────┘
```

### 3.3 Shared simulation package

The simulation is engine-agnostic TypeScript with **no Phaser/React imports**, so it can run inside Node (host) and be unit-tested headlessly. The client wraps it for rendering; the host wraps it for authority.

```
packages/
  sim/        # pure TS: entities, systems, combat math, economy, rules
  shared/     # types, constants, the command & snapshot protocol, i18n keys
  client/     # Phaser + React app (renders sim state, sends commands)
  server/     # Node + Socket.IO host (owns the sim, broadcasts snapshots)
  desktop/    # Electron wrapper for the host
```

---

## 4. Project Structure

```
mys-generals/
├─ package.json                 # workspaces / monorepo root
├─ tsconfig.base.json
├─ vite.config.ts
├─ packages/
│  ├─ shared/
│  │  ├─ src/
│  │  │  ├─ constants.ts        # ALL tunable numbers (see §26)
│  │  │  ├─ ids.ts              # enum-like string ids for units/buildings/abilities
│  │  │  ├─ protocol.ts         # Command, Snapshot, Event message types
│  │  │  ├─ damageTable.ts      # damage-type × armor-type matrix (§13)
│  │  │  └─ i18nKeys.ts         # typed keys for every string
│  ├─ sim/
│  │  ├─ src/
│  │  │  ├─ World.ts            # the world container + tick()
│  │  │  ├─ entities/           # Entity, components (Transform, Health, …)
│  │  │  ├─ systems/            # MovementSystem, CombatSystem, EconomySystem, …
│  │  │  ├─ pathfinding/        # easystar wrapper + flow field
│  │  │  ├─ ai/                 # skirmish bot (T12)
│  │  │  └─ rules/              # win/lose, capture, veterancy
│  ├─ client/
│  │  ├─ index.html
│  │  ├─ src/
│  │  │  ├─ main.tsx            # boots React shell + Phaser game
│  │  │  ├─ game/               # Phaser scenes, renderers, input, VFX
│  │  │  │  ├─ scenes/          # BootScene, MenuScene, MatchScene
│  │  │  │  ├─ render/          # EntityRenderer, ProjectileRenderer, FxRenderer
│  │  │  │  ├─ input/           # selection, commands, camera, touch+mouse
│  │  │  │  └─ vfx/             # particle configs, explosions, trails (§16)
│  │  │  ├─ ui/                 # React HUD, menus, lobby, settings
│  │  │  ├─ net/                # client transport (socket or loopback)
│  │  │  ├─ store/              # Zustand bridge
│  │  │  ├─ audio/              # Howler manager (§17)
│  │  │  └─ i18n/               # i18next init + locale loading
│  │  └─ public/
│  │     ├─ assets/             # sprites, atlases, audio, fonts, maps
│  │     └─ locales/            # en.json, ru.json, uz.json (§5, §26)
│  ├─ server/
│  │  └─ src/
│  │     ├─ index.ts            # Express + Socket.IO bootstrap, prints LAN URL + QR
│  │     ├─ MatchHost.ts        # owns the sim, applies commands, broadcasts
│  │     └─ Lobby.ts            # rooms, player slots, ready states
│  └─ desktop/
│     ├─ electron-main.ts       # spawns server, opens host window, shows join info
│     └─ build config
└─ docs/
   └─ MYSgenerals.md            # this file
```

**Asset pipeline:** sprites are packed into texture atlases (TexturePacker or `free-tex-packer`); maps are authored in **Tiled** and exported as JSON; audio is bundled as Howler audio sprites where practical. A small Node script (`scripts/pack-assets.ts`) regenerates atlases.

---

## 5. Internationalization (i18n) System

The game ships in **Uzbek (Latin)**, **Russian (Cyrillic)**, and **English**, all equal. This section defines the *system*; the *final wording* is finalized and proofread in **§25 / Task T20** after the game is functionally complete.

### 5.1 Hard requirements

1. **UTF-8 everywhere.** All locale files, source files, and the build output are UTF-8 (no BOM). The HTML document declares `<meta charset="utf-8">`. This guarantees Cyrillic (`Серебро`) and Uzbek special letters (`Oʻ`, `Gʻ`, `oʻ`, `gʻ`, `ʼ`) never render as `Ð¡` or `�`.
2. **Uzbek orthography.** Uzbek Latin uses the modifier letter apostrophe **U+02BB** (`ʻ`) for `oʻ`/`gʻ` and **U+02BC** (`ʼ`) for the glottal stop — **not** the ASCII `'`. All Uzbek strings use the correct code points. The QA task verifies this.
3. **Font coverage.** The chosen UI font(s) must contain **Latin Extended + Cyrillic** glyph coverage. Default: **Noto Sans** (UI) and **Noto Sans Mono** `[OPTIONAL]` for the terminal-style menu accent; both cover Cyrillic and Uzbek Latin. Fonts are bundled locally (no CDN dependency at runtime) and declared with `@font-face`. A fallback stack (`"Noto Sans", "Segoe UI", Arial, sans-serif`) is set so a missing glyph never shows a tofu box for a covered script.
4. **No hardcoded user-facing strings.** Every label, tooltip, notification, unit name, ability description, and error goes through `t('key')`. A lint rule (`i18next/no-literal-string` on the React layer) enforces this. The simulation never contains display strings — it emits **keys** (e.g. `event.unitLost`) that the client translates.
5. **Typed keys.** `shared/i18nKeys.ts` exports a typed union of every key so a missing translation is a compile-time/CI error, not a silent `[object Object]`.
6. **Runtime switching.** Language can change in the main menu and in the in-game settings without reload; React re-renders and Phaser text objects subscribe to a language-changed event and refresh.
7. **Interpolation & plurals.** Counts use i18next interpolation and plural rules per locale: e.g. `t('hud.unitsSelected', { count })` → English `"3 units selected"`, Russian uses the 3-form plural (`1 юнит`, `2 юнита`, `5 юнитов`), Uzbek uses its single-plural form.
8. **Number & time formatting.** Resource numbers and timers format via `Intl.NumberFormat`/`Intl.DateTimeFormat` with the active locale where it matters (thousands separators differ; Russian uses a space).

### 5.2 Locale file structure

Locales are split into namespaces to keep files manageable and lazy-loadable:

```
public/locales/
  en/  menu.json  hud.json  units.json  buildings.json  abilities.json  upgrades.json  tips.json  errors.json
  ru/  …same namespaces…
  uz/  …same namespaces…
```

Key naming convention: `namespace.section.item[.subfield]`.
Examples: `menu.main.play`, `units.infantry.name`, `units.infantry.desc`, `buildings.warFactory.name`, `abilities.hero.orbitalStrike.name`, `abilities.hero.orbitalStrike.tooltip`, `upgrades.uraniumShells.name`, `errors.notEnoughSilver`.

### 5.3 Starter glossary (foundation only — finalized in T20)

This is a *seed* so the build phase has correct text immediately. The full proofread/expansion happens in §25. (Full table in §26.7.)

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Silver | Kumush | Серебро |
| Iron | Temir | Железо |
| Gold | Oltin | Золото |
| Power | Energiya | Энергия |
| Command Center | Bosh shtab | Штаб |
| Barracks | Kazarma | Казарма |
| War Factory | Harbiy zavod | Военный завод |
| Infantry | Piyoda askar | Пехотинец |
| Rocket Soldier | Raketachi | Ракетчик |
| Robot | Robot | Робот |
| Hero | Qahramon | Герой |
| Victory | Gʻalaba | Победа |
| Defeat | Magʻlubiyat | Поражение |
| Play | Oʻynash | Играть |

### 5.4 Definition of done for the i18n *system* (the wording is T20)

- Switching language updates **100%** of visible text (menus, HUD, tooltips, floating combat text labels, end screen) with zero English fallback leaking when a non-English locale is active.
- A deliberately corrupted byte test (loading a locale with multibyte chars) renders Cyrillic and Uzbek letters correctly on Windows Chrome, Android Chrome, and the Electron host.
- CI fails if any key exists in `en` but is missing in `ru` or `uz` (and vice-versa).

---

## 6. Resource & Economy System

Four resources gate everything. They form a strict dependency ladder: **Silver** funds the early game, **Iron** unlocks mid structures, **Gold** unlocks high-tech production, and **Power** is a *soft* prerequisite that throttles you if you over-expand.

### 6.1 The four resources

| Resource | Symbol/color | Source | Base rate | Role |
|---|---|---|---|---|
| **Silver** | Light grey coin | Miner working a Silver Mine | +1 / 10 s per miner | Universal early currency; trains infantry, builds basics. |
| **Iron** | Dark steel ingot | Iron Mine | +1 / 15 s per mine | Mid-tier: vehicles, towers, advanced buildings. |
| **Gold** | Yellow bar | Gold Mine | +1 / 30 s per mine | High-tier: War Factory, Research, Super Weapon, hero artifacts. |
| **Power** | Blue lightning | Power Plant (generates), buildings (consume) | +10 per plant; buildings draw 1–6 | Soft gate; deficit slows production & weakens defenses. |

Silver, Iron, and Gold are **stockpiles** (you bank them). Power is a **balance** (generation minus consumption); it is not banked.

### 6.2 Starting state (every player)

- 1 **Command Center** (placed at the player's start location).
- 1 **Silver Mine** adjacent to the Command Center, with **1 Miner already inside it working** (so silver ticks from second 0).
- **15 Silver**, 0 Iron, 0 Gold.
- Power: the Command Center provides a small base **+5 Power**, enough for the first couple of buildings.
- 1 **Hero** spawned at the Command Center (level 1).

### 6.3 Miners and resource gathering

- A **Miner** (worker unit) is the gatherer **and** the builder (Generals-style dozer/worker hybrid).
- A Silver Mine has a finite number of **work slots** (default **3**). More miners in one mine = more parallel +1 ticks (up to the slot cap), so a fully-saturated mine yields **+3 silver / 10 s**.
- Iron Mines and Gold Mines are **structures you build on a deposit** and auto-produce without a miner inside (they represent automated extraction); their rate is per-building, not per-miner. `[DESIGN]` This keeps the silver economy active (miners) and the iron/gold economy passive (built mines), matching the owner's description.
- Mines sit on finite **deposits**; each deposit has a large but finite reserve (default Silver 1500, Iron 800, Gold 400). When a deposit depletes, the mine stops producing and shows an "exhausted" state. This pushes expansion to neutral deposits. `[OPTIONAL: deposits can be set to infinite per-map]`
- Extra miners are trained at the **Command Center** (cost **5 silver**, build **12 s**). A Miner can be ordered to a mine (enters a slot) or to a build site.

### 6.4 Power system (Generals-style)

- Each **Power Plant** supplies **+10 Power**. The Command Center supplies **+5**.
- Buildings **consume** power while operational (see §7 table). Total consumption is summed.
- **Power balance = total generation − total consumption.**
  - **Balance ≥ 0:** everything runs normally.
  - **Balance < 0 (brown-out):** all **production buildings train/build at 50% speed**, all **defensive towers fire at 60% rate and lose 20% range**, and the **radar/minimap of low-priority buildings dims**. A red **"LOW POWER"** banner appears.
  - Power deficit never destroys buildings; it strangles output. Restoring power instantly removes penalties.
- **Power Plant Upgrade — "Overcharge"** (researched at the plant): +50% output from that plant but it now takes splash damage radius +1 when destroyed (small risk/reward). `[OPTIONAL]`
- Destroying an enemy Power Plant to force a brown-out is a valid raid tactic — telegraphed by the enemy's banner.

### 6.5 Economy UI feedback

- A top **resource bar** shows current Silver / Iron / Gold with their per-minute rate as a small `+N/m` ghost number, and a Power gauge (generation vs consumption, green when positive, red when negative).
- On every resource tick, the counter **rolls** to the new value (tween, 200 ms) rather than snapping.
- On collection at a mine, a small **"+1"** in the resource color floats up from the mine and fades (see §16.6).
- Attempting an action you can't afford flashes the relevant resource number red and plays a soft "denied" tick; the build button shows the shortfall in its tooltip (`errors.notEnoughIron`).

### 6.6 Economy logic (authoritative rules)

- All resource generation is driven by per-source **timers** advanced by the simulation tick (not wall-clock), so pausing the sim pauses income and network clients agree.
- Spending is **atomic**: a build/train order first checks affordability against the player's stockpile; if affordable, it deducts immediately and enqueues; if not, it is rejected with an error event.
- Refunds: cancelling a queued (not-yet-started) item refunds **100%**; cancelling an in-progress build refunds **50%** and removes the half-built structure.
- Sell: a completed building can be **sold** for **50%** of its resource cost; it plays the destruction animation (friendly variant) and frees the footprint.

---

## 7. Buildings (Full Catalog)

Buildings are placed by a Miner on valid terrain inside or near owned territory. Construction is animated (§16.5). Every building has: **HP**, **Armor type** = `Structure`, **Power draw** (or generation), **Cost**, **Build time**, **Footprint** (tiles), **Function**, and **damage-state thresholds** (smoke at 66% HP, fire at 33% HP, heavy fire near death).

### 7.1 Economy & tech buildings

| Building | Cost | Build | HP | Power | Footprint | Function |
|---|---|---|---|---|---|---|
| **Command Center** | (pre-placed) | — | 3000 | **+5** | 4×4 | Trains Miners; player's "life" — losing it (destroyed or captured) eliminates the player. Can self-repair slowly when not under attack. Provides base vision. |
| **Silver Mine** | (pre-placed; extras 15 silver) | 10 s | 600 | −1 | 3×3 | Houses up to 3 miners; +1 silver/10 s per miner. |
| **Iron Mine** | 20 silver | 12 s | 700 | −2 | 3×3 | +1 iron / 15 s (auto). Must be built on an iron deposit. |
| **Gold Mine** | 5 iron + 25 silver | 15 s | 800 | −2 | 3×3 | +1 gold / 30 s (auto). Must be built on a gold deposit. |
| **Power Plant** | 30 silver | 12 s | 700 | **+10** | 3×3 | Supplies power. "Overcharge" upgrade `[OPT]`. |
| **Barracks** | 1 gold + 10 iron + 30 silver | 20 s | 1000 | −2 | 3×3 | Trains infantry (Infantry, Rocket Soldier, Robot, Engineer). |
| **War Factory** | 3 gold + 15 iron + 70 silver | 35 s | 1600 | −4 | 4×4 | Trains vehicles (Light/Heavy Tank, Artillery, Rocket Launcher, Anti-Air, extra Miners). |
| **Research Center** | 2 gold + 20 iron + 60 silver | 30 s | 1200 | −3 | 3×3 | Unlocks/queues upgrades (§10). One research at a time. |
| **Airfield** `[OPT tier]` | 4 gold + 25 iron + 90 silver | 40 s | 1400 | −5 | 4×3 | Trains and rearms aircraft (Attack Helicopter, Jet). Houses N air pads. |
| **Super Weapon Silo** `[endgame]` | 8 gold + 40 iron + 150 silver | 60 s | 1800 | −6 | 4×4 | Charges a one-shot Super Weapon (§14). Only 1 per player. |

### 7.2 Defensive buildings (summary; full detail in §11)

| Building | Cost | Build | HP | Power | Targets | Function |
|---|---|---|---|---|---|---|
| **Guard Tower** | 8 iron + 25 silver | 15 s | 900 | −2 | Ground (esp. infantry) | Basic auto-firing machine-gun tower. |
| **Cannon Tower** | 14 iron + 40 silver | 18 s | 1100 | −3 | Ground (esp. vehicles) | Slow, high-damage anti-armor shells. |
| **Rocket Tower (SAM)** | 18 iron + 1 gold + 55 silver | 20 s | 1000 | −3 | Air + Ground | Anti-air priority; rockets (the "raketa" animation). |
| **Bunker** | 10 iron + 30 silver | 15 s | 1300 | −1 | — | Garrison up to 4 infantry; occupants fire out with +25% range and protection. |
| **Wall segment** | 2 iron + 4 silver | 3 s | 1500 | 0 | — | Blocks movement; channels enemies. |
| **Gate** | 6 iron + 12 silver | 6 s | 1400 | −1 | — | Wall that opens for allied units, closes vs enemies. |

### 7.3 Construction & placement rules

- **Placement preview:** while placing, a translucent footprint follows the cursor — **green** where valid, **red** where blocked (overlap, impassable terrain, outside build radius). Grid cells highlight.
- **Build radius:** new buildings must be placed within a radius of an existing owned building (default 8 tiles), so bases grow organically; defensive towers can extend the radius outward. Capturing neutral structures or building forward establishes new radius anchors.
- **Construction sequence:** Miner walks to the site → a **scaffold** rises with a build-progress bar → dust particles + a small crane animation → at 100% the scaffold drops and the finished building "pops" (1.05× scale bounce). The Miner is freed.
- **Build queue:** each production building has its own queue (max 8). Queue items show as icons with a radial cooldown fill; the active item also shows a progress bar on the building.
- **Rally point:** production buildings have a settable rally point (right-click); trained units auto-move there, with an animated flag marker and a dashed line shown while the building is selected.
- **Repair:** a Miner can repair a damaged friendly building (sparks + wrench icon, HP bar fills) for a trickle of silver; the Command Center auto-repairs slowly out of combat.
- **Damage states:** at ≤66% HP light smoke wisps; at ≤33% HP active flames + faster smoke; near death, heavy black smoke + occasional spark bursts. On destruction → §16.5 collapse.

---

## 8. Units (Full Catalog)

Every unit has: **HP**, **Armor type**, **Damage**, **Damage type**, **Range**, **Attack cooldown**, **Move speed** (tiles/s), **Vision**, **Cost**, **Build time**, **Built at**, and **special abilities**. Damage interacts with armor via the matrix in §13.

Armor types: `InfantryLight`, `VehicleHeavy`, `StructureArmored`, `AirLight`.
Damage types: `Bullet`, `Cannon` (AP), `Explosive` (siege/splash), `Rocket` (splash, hits air), `Energy`, `Flame` (splash).

### 8.1 Workers & support

| Unit | HP | Armor | Dmg | Type | Rng | CD | Spd | Cost | Build | Built at | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Miner / Worker** | 90 | InfantryLight | — | — | — | — | 2.6 | 5 silver | 12 s | Command Center / War Factory | Gathers silver; builds & repairs structures. Unarmed; flees or is escorted. |
| **Engineer** | 80 | InfantryLight | — | — | — | — | 2.4 | 1 gold + 20 silver | 18 s | Barracks | **Captures** neutral and damaged enemy buildings; can repair; one-use capture on enemy structures (consumed). |

### 8.2 Infantry (Barracks)

| Unit | HP | Armor | Dmg | Type | Rng | CD | Spd | Cost | Build | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Infantry (Rifleman)** | 120 | InfantryLight | 12 | Bullet | 4 | 0.8 s | 2.8 | **5 silver** | **20 s** | Cheap anti-infantry backbone; can garrison Bunkers. |
| **Rocket Soldier ("gunner")** | 110 | InfantryLight | 40 | Rocket | 6 | 2.0 s | 2.4 | **10 silver** | **30 s** | Anti-vehicle & anti-air; fires a small homing rocket (smoke trail). Weak vs massed infantry. |
| **Robot** | 320 | VehicleHeavy | 28 | Energy | 5 | 1.0 s | 2.5 | **25 silver** | **25 s** | Durable energy-weapon walker; balanced vs all armor; treated as a vehicle for armor. Mini-EMP on death `[OPT]`. |

Infantry behaviors: can enter/garrison Bunkers; gain **veterancy** from kills (§10.5); play crouch-fire pose when stationary, run animation when moving; ragdoll/fade death for riflemen, small explosion for Robot.

### 8.3 Vehicles (War Factory)

| Unit | HP | Armor | Dmg | Type | Rng | CD | Spd | Cost | Build | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light Tank** | 520 | VehicleHeavy | 45 | Cannon | 5 | 1.4 s | 2.4 | 6 iron + 35 silver | 22 s | Fast armor; good vs vehicles, weak vs structures. |
| **Heavy Tank** | 950 | VehicleHeavy | 80 | Cannon | 6 | 1.8 s | 1.8 | 2 gold + 14 iron + 60 silver | 34 s | Frontline brawler; big turret recoil & dust. |
| **Artillery** | 380 | VehicleHeavy | 110 (splash 2.0) | Explosive | **11** (min range 4) | 3.2 s | 1.6 | 1 gold + 12 iron + 55 silver | 30 s | Long-range siege; arcing shell with ground shadow; deadly vs bases, helpless up close. |
| **Rocket Launcher Vehicle** | 360 | VehicleHeavy | 30 ×4 rockets (splash 1.2) | Rocket | 8 | 4.0 s (volley) | 1.9 | 2 gold + 16 iron + 65 silver | 32 s | Fires a **4-rocket salvo** (signature "raketalar uchishi"); hits air & structures; reload telegraph. |
| **Anti-Air Vehicle** | 420 | VehicleHeavy | 22 ×2 | Rocket | 7 | 1.2 s | 2.3 | 10 iron + 45 silver | 24 s | Mobile SAM; shreds aircraft, weak vs ground armor. |

### 8.4 Aircraft (Airfield) `[OPTIONAL tier]`

| Unit | HP | Armor | Dmg | Type | Rng | CD | Spd | Cost | Build | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **Attack Helicopter** | 300 | AirLight | 26 ×2 | Rocket | 6 | 1.0 s | 3.2 | 2 gold + 18 iron + 70 silver | 30 s | Hovers, strafes; fires twin rockets; must return to Airfield to rearm. |
| **Jet Fighter** | 240 | AirLight | 120 (bomb, splash 2.0) | Explosive | bomb run | per-pass | 5.0 | 3 gold + 22 iron + 85 silver | 34 s | Fast bombing pass then returns to rearm; brief but devastating vs clustered targets. |

### 8.5 Unit logic (shared)

- **Selection:** single click; **drag-box** to multi-select; **double-click a unit** selects all same-type units on screen; **Ctrl+1..9** to bind control groups.
- **Commands:** move (right-click ground), attack (right-click enemy), **attack-move** (A then click — engages anything en route), stop (S), hold position (H), patrol (P then point), guard (G then target).
- **Target acquisition:** idle armed units auto-acquire the nearest valid enemy within *aggro range* (= vision) and engage; "Hold position" disables chasing.
- **Pathfinding:** A* on the tile grid; large groups use a shared flow field to the destination to avoid clumping/jitter; units have soft-body separation so they don't stack on one pixel.
- **Formations:** multi-unit moves preserve a loose formation; slower units don't get left behind if "formation move" is on (default).
- **Facing & turrets:** vehicles rotate body to move, turret independently to aim; firing requires the turret roughly on target (small turn time).
- **Veterancy:** kills grant XP; at thresholds a unit becomes Veteran → Elite → Heroic, each adding a chevron icon, +HP, +damage, and (Heroic) self-healing (§10.5).
- **Death:** infantry fade/ragdoll; vehicles explode (fireball + turret pops off + scorch decal); aircraft spiral down with smoke trail and crash explosion.

---

## 9. Hero System (DOTA-style "Super Hero")

Each player controls exactly **one Hero**. The hero is a high-impact unit with abilities, levels, mana, a respawn timer, and an optional artifact shop. It is selected/commanded like any unit but has a dedicated **ability bar** in the HUD.

### 9.1 Core hero rules

- **Spawn:** at the Command Center at match start, level 1.
- **Experience:** the hero gains XP for nearby enemy unit/building kills (shared "assist" XP if the hero contributed) and a small passive XP trickle over time. Reaching XP thresholds grants a **level** (max 10).
- **Per level:** +HP, +HP regen, +base attack, and **1 ability point** to put into one of the four abilities (each ability has 4 ranks; the ultimate unlocks at hero level 6 and has 3 ranks).
- **Mana:** abilities cost mana; mana regenerates over time. Some artifacts boost mana/regen.
- **Death & respawn:** when killed, the hero respawns at the Command Center after a timer = `8 s + 4 s × heroLevel` (capped). A respawn countdown shows on the hero portrait; the enemy who landed the kill gets bonus resources (a small "bounty," Generals/DOTA-flavored).
- **Stats panel:** portrait, HP/mana bars, level + XP bar, the four ability icons with rank pips, cooldown radial fills, and (if enabled) item slots.

### 9.2 Hero abilities — design template

Every ability defines: **name key**, **type** (target-point / target-unit / no-target / passive), **mana cost**, **cooldown**, **cast range**, **effect**, **per-rank scaling**, and a **full VFX** (§16.7) — cast pose, projectile/area visual, and impact.

The base roster ships **one fully-specified hero** (below) plus a **second and third** sharing the template `[STRETCH for launch, but specified]`. Each hero is themed and visually distinct.

### 9.3 Hero #1 — "Commander" (balanced, Generals-flavored)

A frontline officer who calls in firepower.

| Slot | Ability | Type | Mana | CD | Effect (rank 1 → 4) |
|---|---|---|---|---|---|
| **Q** | **Battle Rifle Burst** | no-target (next attacks) | 40 | 8 s | Next 3 attacks fire a rapid burst dealing +30→+90 bonus Bullet damage and a short slow. VFX: muzzle strobe + tracer fan. |
| **W** | **Rally Banner** | target-point | 60 | 16 s | Plants a banner for 8 s; allied units in radius gain +20%→+50% attack speed and +1 armor. VFX: banner rises, golden ground ring pulses. |
| **E** | **Combat Roll** | target-point (dash) | 35 | 10 s | Hero dashes to a point, becoming briefly unhittable; on arrival a small shockwave knocks back and deals 40→130 damage. VFX: motion-blur trail + dust shock ring. |
| **R** | **Orbital Strike** (ultimate, lvl 6) | target-point | 120 | 70 s | Designates a target; after a 1.5 s laser-sight delay, a massive beam descends dealing 250→500 Explosive splash (radius 3) + screen shake. VFX: reticle → sky beam → fireball + shockwave (§16.7). |

### 9.4 Hero #2 — "Saboteur" (mobility/disruption, DOTA-flavored) `[SPEC]`

| Slot | Ability | Type | Effect summary |
|---|---|---|---|
| **Q** | **EMP Dart** | target-unit | Disables a vehicle/building's weapon & slows it; bonus vs Robots. |
| **W** | **Smoke Screen** | target-point | Area smoke: units inside gain evasion and break enemy targeting. |
| **E** | **Blink** | target-point | Short-range teleport (DOTA blink). |
| **R** | **Sabotage Charge** | target-building | Plants a charge that detonates after a delay for heavy structure damage; defenders can destroy the charge in time. |

### 9.5 Hero #3 — "Warden" (tank/area-control) `[SPEC]`

| Slot | Ability | Type | Effect summary |
|---|---|---|---|
| **Q** | **Shield Bash** | target-unit | Stun + damage; gains temporary armor. |
| **W** | **Bulwark** | no-target | Toggling damage-reduction aura for nearby allies; drains mana. |
| **E** | **Taunt** | target-point | Forces nearby enemies to attack the Warden briefly. |
| **R** | **Fortress Mode** | no-target | Roots in place, becomes a turret with huge HP & splash for a duration. |

### 9.6 Artifact shop (DOTA-style) `[OPTIONAL but specified]`

- Accessible when the hero is near the **Command Center** (or a built "Armory" `[OPT]`), via a shop panel.
- Items cost **gold** (the scarce resource), tying hero power to high-tech economy.
- Example tiers: **Boots of Speed** (+move speed), **Vitality Core** (+HP/regen), **Mana Cell** (+mana/regen), **Targeting Optics** (+attack range/damage), **Reactive Plating** (+armor, reflect), **Warlord's Crest** (combine: aura buff to nearby army). Items occupy 6 slots; some combine into upgrades.
- Selling returns 50%. Items persist through death.

### 9.7 Hero logic (authoritative)

- XP, cooldowns, mana, and respawn timers advance on the sim tick.
- Abilities validate range/mana/cooldown server-side; rejected casts return an error event (UI plays a denied tick and shows why).
- Damage from abilities uses the same damage-type/armor matrix; ability damage types are defined per ability (e.g. Orbital Strike = Explosive).
- The hero is immune to instant-death edge cases (always respawns); only Command Center loss ends the player.

---

## 10. Upgrades, Tech Tree & Veterancy (Generals-style)

Upgrades are researched at the **Research Center** (global upgrades) or purchased at specific buildings (building-local upgrades). Each upgrade is one-time, permanent for the rest of the match, and applies to all current and future relevant units/buildings.

### 10.1 Tech dependency overview

```
Command Center
   ├─ Power Plant ─────────────► (enables heavy buildings via power)
   ├─ Iron Mine ──► Gold Mine ──► War Factory ──► Heavy units
   │                          └─► Research Center ──► Upgrades (below)
   ├─ Barracks ──► Infantry, Rocket Soldier, Robot, Engineer
   ├─ War Factory ──► Tanks, Artillery, Rocket Launcher, Anti-Air
   ├─ Airfield [OPT] ──► Helicopter, Jet
   └─ Research Center + Gold ──► Super Weapon Silo ──► Super Weapon
```

### 10.2 Weapon & armor upgrades (Research Center)

| Upgrade | Cost | Effect |
|---|---|---|
| **Uranium Shells** | 2 gold + 15 iron | +25% damage for all Cannon-type (tanks). |
| **Composite Armor** | 2 gold + 18 iron | +20% HP for all vehicles. |
| **Advanced Optics** | 12 iron + 30 silver | +1 range & +10% accuracy for all ranged units. |
| **Napalm Rounds** | 1 gold + 14 iron | Adds a burning DoT to Explosive impacts (Artillery, Jet). |
| **Hardened Rockets** | 1 gold + 16 iron | +20% rocket damage & +15% projectile speed (Rocket Soldier, Rocket Launcher, SAM). |
| **Infantry Combat Training** | 10 iron + 40 silver | Infantry start at Veteran rank when trained. |
| **Reactive Plating (towers)** | 2 gold + 20 iron | +25% HP & +1 range for all defensive towers. |

### 10.3 Economy upgrades (Research Center)

| Upgrade | Cost | Effect |
|---|---|---|
| **Deep Drilling** | 1 gold + 12 iron | +1 work slot per Silver Mine (3 → 4) and +20% iron/gold mine rate. |
| **Cargo Logistics** | 10 iron + 35 silver | Miners move +25% faster; Command Center trains miners 30% faster. |
| **Grid Optimization** | 14 iron + 30 silver | All Power Plants +25% output. |

### 10.4 Building-local upgrades

- **Power Plant → Overcharge** (§6.4). 
- **Bunker → Reinforced Walls** (+30% bunker HP). 
- **Barracks → Field Medic** (garrisoned/idle nearby infantry slowly heal). 
- **War Factory → Drone Repair Bay** (idle nearby vehicles slowly self-repair). 
- **Airfield → Countermeasures** (aircraft gain evasion vs SAMs). `[OPT]`

### 10.5 Veterancy (unit ranks)

Units earn XP per kill (XP scaled by victim value). Ranks (Generals-style):

| Rank | XP needed | Bonuses | Badge |
|---|---|---|---|
| Rookie | — | base | none |
| **Veteran** | 100 | +10% damage, +10% HP | 1 chevron |
| **Elite** | 300 | +20% damage, +20% HP, +1 range | 2 chevrons |
| **Heroic** | 700 | +30% damage, +30% HP, slow self-heal | gold chevron + glow |

Veterancy is **per unit** and persists for that unit's lifetime. A rank-up plays a brief flash + chevron pop (§16). The hero uses its own leveling (§9), not veterancy.

### 10.6 Research logic

- One active research per Research Center (build a second center to parallelize).
- Research progress advances on the sim tick; completion broadcasts an upgrade-applied event so clients update stat displays and icons.
- Upgrades stack multiplicatively where rates, additively where flat (documented per upgrade in `constants.ts`).

---

## 11. Defensive Structures & Walls

Defenses are static buildings that auto-engage enemies. They are power-dependent (brown-out reduces their fire rate/range, §6.4).

### 11.1 Towers

| Tower | Targets | Damage / type | Range | Reload | Projectile/VFX |
|---|---|---|---|---|---|
| **Guard Tower** | Ground (best vs infantry) | 16 Bullet | 7 | 0.6 s | Rapid tracer stream + muzzle flash; rotating top. |
| **Cannon Tower** | Ground (best vs vehicles) | 90 Cannon | 8 | 2.2 s | Heavy shell + big muzzle flash + recoil; impact burst. |
| **Rocket Tower (SAM)** | **Air priority** + ground | 35 Rocket ×2 (splash 1.0) | 9 | 1.6 s | Twin homing rockets with smoke trails (signature "raketa") + airburst. |

Towers rotate their head to track targets, show a faint range ring when selected, and prioritize: SAMs prefer aircraft, Cannons prefer vehicles, Guard Towers prefer infantry; all fall back to nearest enemy if no preferred target.

### 11.2 Bunker (garrison)

- Holds up to **4 infantry**. Occupants fire out of slits with **+25% range** and take **reduced damage** while inside.
- Firing infantry show muzzle flashes at the bunker's firing ports; occupant count shown as pips.
- If the bunker is destroyed while occupied, occupants take damage and are ejected (survivors stumble out). 
- An Engineer can **capture** an enemy/neutral bunker (and any structure) — see §12.

### 11.3 Walls & gates

- **Wall segments** snap to a grid and auto-connect into continuous walls (corner/T/cross sprites chosen automatically). They block ground movement (not aircraft, not artillery shots arcing over).
- **Gates** are wall pieces that animate open for allied units approaching and shut otherwise; enemies must destroy them or path around.
- Walls funnel attackers into kill-zones covered by towers — the core *Generals* defensive pattern.

### 11.4 Defense logic

- Defenses use the same target-acquisition and combat resolution as units.
- Range rings, target prioritization, and brown-out penalties are all authoritative.
- Walls participate in pathfinding as impassable tiles; gates toggle passability per faction relation.

---

## 12. Neutral Capture Points

The map contains structures owned by no one. Capturing them grants rewards and territory. This is the DOTA-style "objective" layer layered onto the RTS.

### 12.1 Types of neutral points

| Neutral | Capture reward | Ongoing benefit |
|---|---|---|
| **Oil Derrick** | One-time **+50 silver** bounty | **+1 silver / 5 s** passive income while held (Generals oil derrick). |
| **Neutral Tech Lab** | One-time **+1 gold** | Unlocks a powerful exclusive upgrade (e.g. "Prototype Shells") while held. |
| **Watch Outpost** | One-time **+25 silver** | Grants a wide **vision** circle (map control / scouting). |
| **Abandoned Mine** | — | Becomes a functioning Silver/Iron deposit you can mine when held. |
| **Derelict Turret** | One-time **+30 silver** | Reactivates as an **auto-firing defensive tower** fighting for the holder. |

### 12.2 Capture mechanic

- Two capture methods:
  1. **Engineer capture (instant-ish):** send an Engineer into the neutral structure; after a short channel (3 s) it flips to your ownership. The Engineer is **consumed** when capturing enemy-owned structures; for neutral structures it survives.
  2. **Presence capture (contested):** for *control-point* neutrals (Oil Derrick, Watch Outpost), simply having your units in the radius with no enemy present fills a **capture ring** over ~6 s. Enemy presence pauses/reverses it. (DOTA-style point capture.)
- Capturing is shown by a **filling ring** around the point, a **flag changing to the capturer's color** (flag-raise animation), and a **"+reward" popup** (§16.8).
- A captured point can be **re-captured** by the enemy the same way; reward bounties are only paid on a fresh flip (anti-farm: a short cooldown before the same point pays a bounty again).

### 12.3 Capture logic

- Ownership, capture progress, and contest state are authoritative and broadcast.
- Captured defensive neutrals (Derelict Turret) use standard tower combat for the new owner.
- Holding-income ticks are driven by the sim tick and credited to the owner.

---

## 13. Combat System (Damage, Armor, Targeting)

Combat is a damage-type vs armor-type system with ranges, projectiles, splash, and accuracy — the heart of RTS balance.

### 13.1 Damage-type × armor-type matrix (multipliers, %)

| Damage ↓ \ Armor → | InfantryLight | VehicleHeavy | StructureArmored | AirLight |
|---|---|---|---|---|
| **Bullet** | 100 | 25 | 25 | 50 |
| **Cannon (AP)** | 50 | 100 | 75 | 0 |
| **Explosive (siege)** | 75 | 75 | 150 | 0 |
| **Rocket** | 60 | 120 | 100 | 120 |
| **Energy** | 100 | 100 | 100 | 100 |
| **Flame** | 130 | 40 | 90 | 0 |

`0` means cannot damage (e.g. Cannon shells can't hit aircraft; only Rocket/Energy/AA do). Final damage = `baseDamage × matrix[type][armor] × veterancyMult × upgradeMult × accuracyRoll`.

### 13.2 Combat parameters per attack

- **Range:** max distance to fire; some units have a **minimum range** (Artillery) creating a dead zone.
- **Attack cooldown / reload:** time between shots or volleys.
- **Projectile speed:** bullets are near-instant tracers; shells, rockets, and artillery shells travel and can miss moving targets if slow.
- **Splash radius:** Explosive/Rocket/Flame damage falls off from center to edge (100% center → ~40% edge).
- **Accuracy:** base hit chance modified by movement (moving targets harder), Advanced Optics upgrade, and veterancy. A miss still plays a near-miss impact.
- **Friendly fire:** `[DESIGN CHOICE]` splash damages **enemies only** by default (RTS-friendly); a hardcore toggle enabling friendly splash is `[OPTIONAL]`.

### 13.3 Targeting & threat

- Auto-acquire nearest valid target in aggro range; prefer the unit's "preferred armor" target if the upgrade/role specifies (e.g. SAM → air).
- **Focus fire:** ordering attack on a specific target overrides auto-acquire.
- **Leash:** units chasing a fleeing enemy give up after a leash distance and return (prevents being pulled out of position), unless on attack-move.
- Death triggers XP award to the killer (veterancy/hero XP) and the death VFX for that unit class.

### 13.4 Status effects (from abilities/upgrades)

`Slow`, `Stun/Disable` (can't move/fire), `Burn` (DoT), `EMP` (vehicles/buildings disabled), `ArmorBuff`, `AttackSpeedBuff`, `Evasion`. Each has an on-unit visual indicator (icon/tint) and a duration handled on the sim tick.

---

## 14. Super Weapons (endgame)

A single, match-defining weapon per player, built in the **Super Weapon Silo** (§7.1). It charges over time and fires once per charge.

### 14.1 The Super Weapon — "Particle Strike" (default)

- **Charge time:** 180 s from build (and after each use, recharges in 180 s).
- **Activation:** when charged, the Silo glows and a "READY" indicator appears; the owner targets any visible point.
- **Effect:** after a 3 s telegraph (a growing targeting reticle visible to **all** players, so victims can react), a devastating particle beam sweeps the target area dealing massive Explosive damage (e.g. 800 center, radius 5, falloff), obliterating clustered armies or cracking a base wall/tower line.
- **Counterplay:** the telegraph + the audible "incoming" warning let the enemy scatter units and brace; destroying the Silo before it fires resets the threat.

### 14.2 Super Weapon VFX (must be maximal)

- **Charge:** Silo dome glows brighter as it nears ready; energy arcs crackle around it.
- **Launch/strike:** sky darkens slightly over the target; a vertical beam/column descends with a blinding flash; on impact: a huge expanding shockwave ring, a fireball, lingering smoke and ground scorch, **strong screen shake**, chromatic flash, and a low boom.
- **Warning UI:** a red pulsing border + a minimap ping + a localized "INCOMING" banner for the targeted player.

### 14.3 Super Weapon logic

- Charge timer, ready state, and cooldown are authoritative.
- The 3 s telegraph spawns a world-space reticle entity visible to all; damage applies at telegraph end.
- Only one Silo per player; only one charge stored (no stockpiling shots).

---

## 15. Fog of War & Vision

- The map is covered by **fog**: unexplored areas are black; explored-but-not-currently-visible areas are dimmed (you see terrain/last-known buildings but not live enemy units); currently-visible areas (within unit/building vision) are fully lit and show live enemies.
- Each unit and building has a **vision radius**; vision is the union of all owned sources.
- **Capturing** Watch Outposts and building forward towers extends vision — scouting is a real activity.
- Aircraft and some abilities grant temporary vision; "Smoke Screen" denies enemy vision locally.
- Fog updates each tick; the reveal/conceal transitions are soft (fade), not hard pops (§16.9).
- **Implementation:** a per-player visibility grid; the renderer draws a fog layer (a render texture) masked by visible cells; the minimap reflects the same fog. Enemy units outside vision are simply not rendered (and not in the client snapshot beyond last-known building stubs) to prevent maphacks.

---

## 16. Animation & VFX Master Catalog

This is the most detail-critical section. **Every** item here is in scope (Task T6 + integrated into feature tasks). The bar: every action has visible, satisfying feedback. Implementation uses Phaser sprite animations, **tween chains**, and **particle emitters**; UI animations use CSS transitions/keyframes in React; screen effects use Phaser camera shake/flash. A central **`FxRenderer`** spawns pooled effects by id so nothing is allocated per-shot in the hot path.

Notation per effect: **trigger → visual → timing/easing → particles/extras**.

### 16.1 Unit animations (per class)

- **Idle.** Trigger: unit not moving/firing. Infantry: subtle 2-frame breathing bob (loop, ~1.2 s). Vehicles: idle engine shudder (1–2 px vertical jitter) + faint exhaust puff every ~2 s. Aircraft: hover bob + rotor blur (continuous).
- **Move.** Infantry: 6–8 frame run cycle; small dust kick at feet on each "step." Vehicles: tracks/wheels scroll (texture offset), continuous **dust trail** particles behind (more on dirt, less on road), slight body lean on turns. Aircraft: banking tilt into turns + downwash dust if low.
- **Turn.** Vehicles rotate body over `turnRate` (ease-in-out); turret rotates independently toward target.
- **Attack windup → fire → recoil.** Trigger: shot. (a) brief windup pose/turret settle (~80–150 ms), (b) **muzzle flash** sprite at barrel tip (2–3 frames, 60 ms) + light bloom, (c) **recoil**: turret/barrel kicks back then eases forward (120 ms), vehicle body nudges back a couple px on heavy guns. Spawn the projectile at the muzzle on the fire frame.
- **Reload telegraph.** Volley units (Rocket Launcher, Artillery) show a reload indicator (small bar or barrel re-racking animation) during cooldown so enemies can time pushes.
- **Hit reaction.** On taking damage: a quick white/red **flash tint** (80 ms) over the sprite; small spark/impact at the hit point; HP bar shakes briefly.
- **Death.**
  - Infantry: ragdoll fall + fade (600 ms) or a small puff; leaves a brief decal.
  - Robot: collapse + **small explosion** (sparks + smoke) + optional EMP ring `[OPT]`.
  - Vehicle: **explosion** (fireball, 5–7 frame), turret **pops off** and tumbles, hull blackens, leaves a **scorch + wreck decal** that lingers ~10 s then fades.
  - Aircraft: smoke trail + spiral descent + ground crash explosion.
- **Selection.** A colored **selection circle/bracket** under the unit (team color), gentle pulse; group selection draws all circles. Health bar appears above selected/damaged units.
- **Veterancy rank-up.** A quick golden flash + the chevron badge **pops** in (scale bounce) above the unit; tiny sparkle.
- **Garrison enter/exit.** Infantry play a "hop-in" then vanish into a Bunker (occupant pip appears); exit reverses.

### 16.2 Projectile animations (every weapon)

This is the "raketalar uchishi" focus — projectiles must look and feel distinct.

- **Bullet / tracer (Bullet type).** Near-instant bright **tracer line** from muzzle to target (a short stretched streak, 1–2 frames) + faint smoke at muzzle. High rate-of-fire reads as a stream.
- **Tank shell (Cannon).** A fast small shell sprite traveling in a slight arc (or straight for flat trajectories) with a thin smoke wisp; **muzzle smoke ring** at fire; on travel it spins.
- **Rocket / missile (Rocket type) — signature.** A rocket sprite that:
  - launches with an **exhaust flame flicker** at its tail (2–3 alternating frames),
  - leaves a **continuous smoke trail** (particle emitter spawning fading smoke puffs along its path),
  - **slightly homes** toward a moving target (gentle steering, capped turn rate) so it curves believably,
  - wobbles minutely for life. On the **4-rocket salvo** (Rocket Launcher), the four rockets launch in a quick ripple (50 ms apart), fan out slightly, then converge — a dramatic volley.
- **Artillery shell (Explosive).** High **arcing** trajectory; a **shadow** travels on the ground beneath it (so players read where it lands); a whistle SFX; lands for a big explosion.
- **Energy bolt (Energy).** A glowing pulsing orb/bolt with a soft light and a short fading energy trail; slight color cycling.
- **Flame stream (Flame).** A short-range **particle cone** of fire (overlapping flame particles fading from yellow→orange→smoke) rather than a discrete projectile; leaves brief burning ground patches if Napalm.
- **AA fire.** Twin small rockets/flak puffs racing upward to aircraft; airbursts as little smoke pops near the target.

Projectiles are **pooled**; trails are emitters attached to the projectile and stopped/recycled on impact.

### 16.3 Impact & explosion animations

- **Bullet impact.** Tiny **spark** + a small dust/dirt puff (on ground) or metal spark (on armor); a micro decal that fades fast.
- **Shell explosion (Cannon/Explosive).** Bright **flash** → **fireball** sprite sequence (5–7 frames) → expanding **smoke ring** → flung **debris** particles → **scorch decal** on ground (lingers). Larger for Artillery (radius matches splash).
- **Rocket explosion.** Similar but with a punchier **shockwave ring** (a quick expanding translucent ring) and more smoke; multiple from a salvo overlap into a satisfying carpet.
- **Building hit (non-fatal).** Sparks + a puff of smoke at the impact point on the structure; brief flash on the building sprite.
- **Splash visualization.** For AoE hits, a faint ring shows the splash radius at the moment of impact so the area damaged is legible.
- **Near-miss.** A muted version of the impact (dust only) where a missed shot lands, so misses still feel physical.

### 16.4 Camera / screen effects

- **Screen shake.** Scaled by event: small for a tank shot nearby (if camera close), medium for big explosions, **strong** for Super Weapon impact and Command Center destruction. Uses Phaser camera shake with falloff; intensity respects a "reduce screen shake" accessibility toggle.
- **Screen flash.** A brief white/colored full-screen flash on Super Weapon strike and other massive events (subtle, respects reduced-motion).
- **Damage vignette.** A soft red edge pulse when **your** Command Center or key building is under attack, plus an "under attack" alert + minimap ping.
- **Hit-stop** `[OPT]`. A 1–2 frame freeze on the heaviest impacts for punch.
- **Camera feel.** Pan has slight inertia/ease; zoom (mouse wheel / pinch) eases between levels; edge-scroll and drag-pan supported.

### 16.5 Building animations

- **Construction.** Translucent footprint → **scaffold** rises with a build bar → dust particles around the base + a small animated **crane** arm → at 100% the scaffold drops and the building does a 1.05× **scale-bounce** "pop." Miner animates "working" beside it.
- **Idle/operational ambience.** Smoke from chimneys (Power Plant, War Factory), a **rotating radar dish** (Command Center/Research), glowing/blinking windows, occasional sparks at the War Factory; production buildings open a **door/bay** animation when a unit exits.
- **Production feedback.** The active build shows a progress bar on the building; on completion a unit "drives/walks out" of the bay and heads to the rally point; a small "ready" chime.
- **Resource buildings.** Silver Mine: miners animate walking in/out; a **mine cart** trundles in and out on a tick. Iron/Gold Mine: a pump/drill animates; a periodic "+1" floats up (§16.6).
- **Power states.** When in brown-out, building lights **flicker/dim** and a small unplugged/low-power icon appears.
- **Repair.** Wrench icon + **sparks** at the repair point + HP bar visibly filling; Miner plays repair pose.
- **Damage states.** ≤66% HP: light smoke wisps from the roof. ≤33% HP: active **flames** + thicker dark smoke + occasional spark bursts. The building sprite may swap to a damaged variant.
- **Destruction.** Multi-stage: cracks/flash → internal fire flares → the structure **collapses** (sink + topple frames) → a big **dust cloud** + flying debris → leaves a **rubble decal**. Screen shake scaled to building size; the Command Center destruction is the biggest (with a brief slow-mo + flash).
- **Sell.** Friendly destruction variant (cleaner, with a refund "+N" popup); footprint cleared.

### 16.6 Resource & economy animations

- **"+1" pickups.** On each resource tick, a small colored **"+1"** (silver/iron/gold) floats up from the producing building and fades (~700 ms, ease-out).
- **Resource counter roll.** The top-bar number **tweens** to the new value (rolling digits, 200 ms) instead of snapping; a brief highlight pulse on increase.
- **Coin sparkle.** A tiny sparkle at the Silver Mine when a miner deposits.
- **Insufficient funds.** The lacking resource flashes red + a soft denied tick; the build button shakes slightly.
- **Power gauge.** The power bar animates between green (surplus) and red (deficit); entering deficit pulses the gauge and shows the LOW POWER banner.

### 16.7 Hero ability VFX (per ability)

Each ability has a distinct, readable cast → travel/area → impact. Examples (Hero #1):

- **Battle Rifle Burst (Q).** Hero flashes a charged aura; next attacks emit a rapid **muzzle strobe** + a fan of tracers; hit targets flash with the slow indicator.
- **Rally Banner (W).** A banner **rises** at the point; a **golden ground ring** pulses outward and lingers; buffed allies gain a subtle golden outline + small upward arrows.
- **Combat Roll (E).** Hero leaves a **motion-blur trail** along the dash; on arrival a **dust shock ring** expands and knocked-back enemies stumble.
- **Orbital Strike (R) — maximal.** (1) A **targeting reticle** appears and locks for 1.5 s (visible to all). (2) A column of light / **beam descends** from the top of the screen with a rising hum. (3) Impact: blinding **flash**, large **fireball**, expanding **shockwave ring**, lingering smoke + scorch, **strong screen shake**. 
- Generic ability rules: cast bar/flash on the hero, mana-spend number floats from the hero, cooldown radial fills on the ability icon, denied casts shake the icon.

### 16.8 Capture animations

- **Capture ring.** A radial **progress ring** fills around the neutral point as it's captured; contested state makes it pulse/stall and tints toward the contesting color.
- **Flag raise.** On flip, the old flag lowers and the **new team-colored flag rises** with a little wave; a burst of particles in team color.
- **Reward popup.** A **"+50 Silver"** style popup floats up at the point; the resource bar pulses; a captured turret powers on (lights + rotate).

### 16.9 UI animations (React/CSS)

- **Buttons.** Hover: subtle scale (1.03) + glow/brightness; press: scale down (0.97) + quick ripple. Disabled: greyed, no hover.
- **Menus & panels.** Screen transitions fade/slide (200–300 ms ease); panels open with a slight slide+fade; modal dialogs scale-in from 0.95.
- **Build menu.** Icons have hover tooltips (fade-in, 120 ms) showing name/cost/desc (localized); affordable items are full color, unaffordable are dimmed with the missing resource highlighted; the queued item shows a **radial cooldown** sweep + queue count badge.
- **Notifications/toasts.** Slide in from a corner, auto-dismiss; "unit ready," "under attack," "research complete," "not enough resources."
- **Minimap pings.** Combat/events create a **ripple ping** at the location on the minimap (red for attacks, blue for ally, yellow for events); clicking a ping/minimap snaps the camera.
- **Health/mana bars.** Damage shrinks the bar with a short ease + a trailing "ghost" segment that catches up (so you see how much was lost); low-HP bars pulse red.
- **Selection box.** Dragging draws a dashed animated rectangle; releasing selects and briefly highlights chosen units.
- **Fog reveal.** Newly revealed areas fade in (soft mask), not hard pop; concealed areas dim smoothly.
- **End screen.** Victory/Defeat banner animates in (scale + glow), stats count up.

### 16.10 Environmental / ambient animations

- Water tiles shimmer (animated tile or shader-ish offset); trees/foliage gently sway; tall grass ripples; flags on buildings wave.
- Ambient particles: occasional drifting dust, birds crossing `[OPT]`, heat shimmer on desert maps `[OPT]`.
- **Day/night or weather** are `[STRETCH]`; if added, transitions are slow and never reduce readability.

### 16.11 Performance rules for VFX

- All projectiles, particles, floating texts, and decals are **pooled and recycled** (no per-shot allocation).
- Hard caps: max simultaneous particles and decals are bounded; oldest decals fade first when the cap is hit.
- A **graphics quality** setting (Low/Medium/High) scales particle density, decal lifetime, and optional effects (hit-stop, screen flash) so low-end laptops and phones stay smooth.

---

## 17. Audio Design

Audio is managed by **Howler.js** with volume buses: **Master / Music / SFX / UI / Voice**. Every gameplay action in §16 has a paired sound. Sounds are pooled and rate-limited (e.g. many simultaneous rifle shots collapse to a capped layered sound to avoid clipping).

### 17.1 Sound categories

- **Combat:** per-weapon fire (rifle burst, tank boom, rocket whoosh, artillery whistle+boom, energy zap, flame roar), impacts/explosions (scaled by size), bullet pings, building-hit thuds.
- **Units:** selection/acknowledgment "barks" (move/attack confirms) — **localized voice** `[OPT]` or neutral SFX; production-ready chime; veterancy promote sting; death sounds per class.
- **Buildings:** construction loop, building complete, power-up/down hum, brown-out warning, repair sparks, destruction collapse.
- **Economy:** soft "ka-ching" per resource tick `[subtle]`, denied/insufficient tick.
- **Hero:** distinct ability cast/impact sounds; ultimate has a big signature sound; level-up sting; respawn cue.
- **Super Weapon:** charging hum, launch, the big "incoming" warning, and the devastating impact.
- **UI:** hover, click, toggle, error, notification pop, minimap ping.
- **Ambience & music:** map ambient bed (wind, distant battle); dynamic music that shifts from calm (economy) to tense (combat) based on nearby combat intensity `[OPT]`.

### 17.2 Audio logic

- 2.5D **spatial-ish panning/volume** by distance from camera so off-screen actions are quieter and panned.
- All volumes persist in settings; the Voice bus has a language tie-in if localized barks are added (else neutral SFX, locale-independent).
- A global SFX cooldown per sound id prevents machine-gun audio spam.

---

## 18. User Interface — Main Menu & In-Game HUD

All text is localized (§5). Visual style: clean, readable RTS UI with team-color accents; an optional dark "command terminal" aesthetic for menus. Layout adapts between desktop (mouse) and touch (phone) — bigger hit targets and a touch command wheel on phones.

### 18.1 Boot & title screen

- **Boot scene:** logo + a loading bar while atlases, audio, maps, and locales load (each asset group reported). Engine/version in a corner.
- **Title screen:** game logo (`MYS Generals`), an **animated background** (a looping skirmish vignette — distant units firing, a tank rolling, smoke) behind the menu; the current language flag/name in a corner; a subtle music bed.

### 18.2 Main menu

Buttons (localized): **Play**, **Settings**, **How to Play / Tips**, **Credits**, **Quit** (Quit hidden in browser, shown in Electron).

**Play** opens a submenu:
- **Single Player (vs AI):** choose map, number/difficulty of AI opponents, your hero, your color, then Start. Runs the host loopback locally.
- **Host Local Game:** creates a lobby; the screen shows the **LAN join address** (e.g. `http://192.168.43.5:3000`) **and a scannable QR code**, plus a short human-friendly **room code**. Other devices on the same Wi-Fi open the address (or scan) to join.
- **Join Local Game:** enter the host's address or room code (or scan QR via the phone camera flow) to connect as a client.

### 18.3 Lobby screen

- **Player slots** (up to 4): each shows player name, chosen **color**, chosen **hero** (with portrait), AI/human/open/closed state, and a **ready** checkmark. The host can add/remove AI, open/close slots, and kick.
- **Map selector:** thumbnail + name + recommended players + a brief description (all localized); only the host changes it.
- **Team setup** `[OPT]`: free-for-all by default; 2v2 team mode toggle.
- **Connection panel** (host view): the join URL, QR, room code, and a live list of connected devices with ping.
- **Start** is enabled when all slots are ready; a countdown then loads the match for everyone.
- **Split-screen toggle** (host): if the host wants two local players on one machine, enable "2 local players" — assigns Player A to mouse, Player B to the laptop touchscreen; the match then renders split-screen (§21).

### 18.4 In-game HUD (desktop)

Regions:
- **Top resource bar:** Silver / Iron / Gold with icons + current values + small `+rate`; a **Power gauge** (green/red). Match timer. Menu (pause) button. Current research (if any) with progress.
- **Minimap** (a corner): terrain + fog + owned (team color) and visible enemy blips + neutral points + pings; click to move camera, drag to pan, right-click to issue a move/attack to the world location.
- **Command / build panel** (bottom or side): context-sensitive. With a production building selected → its build menu (unit/upgrade icons with cost/queue). With units selected → command buttons (stop, hold, patrol, attack-move, special abilities). With a Miner → build categories (Economy / Military / Defense / Tech) each expanding to placeable buildings.
- **Selection info panel:** portrait(s) + HP/mana, veterancy chevrons, count, and stats of the selected unit/group; multi-select shows a grid of unit icons.
- **Hero ability bar:** the hero's 4 abilities with icons, hotkeys (Q/W/E/R), rank pips, cooldown radials, and mana cost; a hero portrait with level/XP and respawn timer when dead.
- **Notifications:** toasts for "unit ready," "under attack" (+ minimap ping + camera jump on click), "research complete," "not enough resources," "ally captured X."
- **Alerts:** under-attack damage vignette + sound; low-power banner; super-weapon incoming warning.

### 18.5 In-game HUD (touch / phone)

- Larger buttons; **tap** to select, **drag** to box-select, **tap-and-hold** on ground for a **command radial** (move/attack/patrol); pinch to zoom; two-finger drag to pan; a docked minimap; the build/command panel becomes a swipeable bottom sheet. Hero abilities are big tap buttons; cast-targeting uses tap-to-place.

### 18.6 Pause / in-game menu

- **Resume**, **Settings** (audio, graphics quality, language, controls, accessibility toggles: reduce screen shake, reduce particles, colorblind-friendly team colors), **Surrender** (eliminates you / leaves match), **Quit to Menu**. In local single-player, pause halts the sim; in multiplayer, pause does **not** halt others (a personal menu overlay) — surrender or a host-pause `[OPT]` instead.

### 18.7 Controls reference (default)

| Action | Mouse/keyboard | Touch |
|---|---|---|
| Select unit | Left-click | Tap |
| Box select | Left-drag | Drag |
| Select same type on screen | Double-click unit | Double-tap |
| Move / attack / capture | Right-click target | Tap-hold → radial |
| Attack-move | A + click | Radial → attack-move |
| Stop / Hold / Patrol / Guard | S / H / P / G | Command buttons |
| Control groups | Ctrl+1..9 set, 1..9 recall | Group bar |
| Hero abilities | Q / W / E / R | Ability buttons |
| Camera pan | Edge-scroll / WASD / drag | Two-finger drag |
| Camera zoom | Mouse wheel | Pinch |
| Build menu | Select Miner → categories | Same |
| Place building | Click footprint (green) | Tap to place |
| Rally point | Right-click with building selected | Tap with building selected |
| Minimap jump | Click minimap | Tap minimap |
| Pause/menu | Esc | Menu button |

### 18.8 UI logic

- React HUD reads game state from the Zustand store, which is updated from the authoritative snapshots; commands flow back through the net layer (socket or loopback). The HUD never mutates sim state directly.
- All numbers/labels localize live; switching language updates the HUD and any Phaser-rendered world text (unit names on hover, floating combat text labels) immediately.

---

## 19. Maps (Full Specs)

Maps are authored in **Tiled** (tile grid + object layers for spawns, deposits, neutral points, decorations) and exported as JSON. Each map defines: dimensions (tiles), terrain (passable/impassable/water/road), player **start positions** (each with a pre-placed Command Center + adjacent Silver Mine), resource **deposits** (silver/iron/gold), **neutral points**, **choke points**, and theme/aesthetic. All map names/descriptions are localized.

Common terrain types: `grass`, `dirt/road` (faster), `sand`, `rock/cliff` (impassable), `water` (impassable to ground, passable to air, artillery arcs over), `bridge` (crossable water), `forest` (blocks vision/slows infantry, blocks vehicles) `[OPT]`.

### 19.1 Map A — "Twin Rivers" (2 players, symmetric duel)

- **Size:** 96×96 tiles.
- **Layout:** two mirrored bases on opposite sides; a **river** down the middle with **two bridges** as the main crossings (chokes). 
- **Resources:** each base has its starting Silver Mine + a nearby second silver deposit and one iron deposit; a gold deposit sits a bit forward (contestable).
- **Neutral points:** two **Oil Derricks** (one near each bridge, central-contested), a central **Watch Outpost** on a small hill for map vision, and two **Abandoned Mines** mid-field.
- **Theme:** green riverlands; shimmering water; swaying reeds; stone bridges.
- **Strategy:** bridges create clean defensive lines; the central derricks and outpost are the early fight.

### 19.2 Map B — "Crossfire" (4 players, free-for-all)

- **Size:** 128×128 tiles.
- **Layout:** four bases in the four **corners**; an open central plateau (**high ground**) ringed by choke entrances.
- **Resources:** each corner is resource-comfortable (silver + iron close, gold a step out); the **center plateau** holds rich gold + a **Neutral Tech Lab** (exclusive upgrade) — the prize everyone wants.
- **Neutral points:** four **Oil Derricks** (one per edge), the central **Tech Lab**, two **Derelict Turrets** guarding plateau ramps (capture to flip them to your defense).
- **Theme:** arid plateau/canyon; dust devils; rocky cliffs as natural walls.
- **Strategy:** four-way tension; whoever controls center tech snowballs but gets focus-fired.

### 19.3 Map C — "Iron Valley" (3 players, resource-rich, mountainous)

- **Size:** 112×112 tiles.
- **Layout:** three bases around a central valley separated by **mountain ranges** (impassable cliffs) with **narrow passes** connecting territories.
- **Resources:** abundant **iron** in the valley (the theme), moderate silver at bases, scarce gold (forces fighting over a few gold deposits in the passes).
- **Neutral points:** three **Watch Outposts** on ridgelines (vision over passes), two **Oil Derricks** in the valley, one **Derelict Turret** at the central crossroads.
- **Theme:** grey mountains, ore veins, snow-dusted peaks `[OPT]`; narrow tactical passes.
- **Strategy:** holding passes with walls+towers is strong; artillery and rockets shine lobbing over cliffs into passes.

### 19.4 Map D — "Desert Standoff" (2–3 players, open) `[OPT/4th map]`

- **Size:** 104×104 tiles.
- **Layout:** wide-open desert with few natural barriers; scattered rock formations as partial cover; long sightlines favor ranged/armor play.
- **Resources:** deposits spread thin and far apart → expansion and map control matter; one central oasis with a cluster of resources + neutrals.
- **Neutral points:** central **Oil Derricks** + **Tech Lab** at the oasis; scattered **Abandoned Mines**.
- **Theme:** sand dunes, heat shimmer, sparse cacti; sandstorm ambience `[OPT]`.
- **Strategy:** mobility and vision; few chokes means flanking and raids dominate.

### 19.5 Map logic & requirements

- Each map guarantees **fair, symmetric-or-balanced** starts (mirrored where possible; balanced resource distance otherwise).
- Spawns auto-assign by player count; unused spawns become neutral/AI or are sealed.
- Pathfinding grid, vision blockers, and water/bridge rules derive from the Tiled layers automatically.
- A map JSON schema is validated on load (Task T14) so a malformed map fails loudly, not silently.

---

## 20. Networking & Multiplayer

Local-network only (no internet). One machine is the **host** (authoritative). Everyone else connects over the same Wi-Fi via **Socket.IO**. The host's own player(s) use an **in-process loopback** transport implementing the same interface as the socket transport, so the simulation has one code path.

### 20.1 Connection flow (the phone/laptop question, answered)

1. A Wi-Fi network exists — either the **host laptop's hotspot**, or a **phone's hotspot that the host laptop joins**. Either way, all devices end up on the same LAN.
2. The host starts the game and the embedded server; it detects its **LAN IP** and **port** and shows them on screen as a **URL + QR code + room code**.
3. A joining device (phone or laptop) opens that URL in a browser (or scans the QR). The page is served by the host; it loads the same client, opens a WebSocket to the host, and enters the lobby as the next player.
4. Regardless of who provides the hotspot, there is exactly **one host** running the authoritative server; all others are clients of it. No client installs anything — **browser only**.

### 20.2 Transport abstraction

```ts
interface Transport {
  sendCommand(cmd: Command): void;        // client → host
  onSnapshot(cb: (s: Snapshot) => void): void;  // host → client
  onEvent(cb: (e: GameEvent) => void): void;     // host → client (one-shot events)
}
```
- `SocketTransport` (remote clients) and `LoopbackTransport` (host's local players) both implement it.
- The host's `MatchHost` owns the `World` (sim), applies incoming commands at tick boundaries, steps the sim, and broadcasts snapshots/events.

### 20.3 Message protocol (`shared/protocol.ts`)

- **Command (client → host):** `{ playerId, type, payload, clientTick }`. Types: `Move`, `AttackMove`, `Attack`, `Stop/Hold/Patrol/Guard`, `BuildPlace`, `TrainQueue`, `CancelQueue`, `SetRally`, `Research`, `CaptureOrder`, `HeroAbility`, `BuySell`, `Surrender`. Commands are **requests**; the host validates (ownership, affordability, range, cooldown) and either applies or returns an error event.
- **Snapshot (host → all):** a compact, **per-player fog-filtered** view: visible entities (id, type, pos, facing, HP%, state flags, veterancy), resource totals & power, building queues/progress, capture states, hero state (level/XP/mana/cooldowns/respawn), match timer. Sent 15–20 Hz. Snapshots are **delta-compressed** where practical (only changed fields) to keep phones smooth.
- **Event (host → relevant):** one-shot things that drive VFX/SFX/notifications: `Fired` (weapon→spawn projectile VFX), `Impact/Explosion`, `UnitDied`, `BuildingDestroyed`, `RankUp`, `UpgradeDone`, `CaptureFlipped`, `SuperWeaponTelegraph/Strike`, `Error` (denied action + reason key). Events let clients play the right animation without the snapshot carrying transient data.

### 20.4 Client-side smoothing

- Clients **interpolate** entity positions between the last two snapshots (render slightly in the past, ~100 ms) for smooth motion despite 15–20 Hz updates.
- Local **input prediction** is limited to **cosmetic** responsiveness (selection highlight, command-issued feedback, rally flag) — never to authoritative results; if the host rejects a command, the client reconciles to truth.
- Projectiles/VFX are spawned from **events** and are purely cosmetic (the host has already resolved damage), so they can't desync gameplay.

### 20.5 Resilience

- **Reconnection:** if a client drops, it can rejoin the same player slot (by token) within a grace window and resync from a full snapshot; meanwhile its units idle or follow a "hold" stance.
- **Host migration is out of scope** — if the host quits, the match ends (clearly communicated). 
- **Lag handling:** local Wi-Fi is fast; the host caps per-client command rate and ignores out-of-order/duplicate commands by `clientTick`. A small jitter buffer smooths snapshot arrival.
- **Anti-maphack:** because snapshots are fog-filtered per player, clients literally don't receive enemy units they shouldn't see.

### 20.6 Networking logic summary

- The host is the **single source of truth**; clients render and request.
- Same `World` runs in single-player (loopback) and multiplayer (socket) — only the transport differs.
- All timers/cooldowns/economy run on the host's fixed tick, so every client agrees.

---

## 21. Split-Screen Local Co-op (two players, one laptop)

Two people play on the **host machine**: **Player A** uses the **mouse + keyboard**, **Player B** uses the **laptop touchscreen**. Both are full players (own base, own hero, own everything) — this is split-screen, not a shared view.

### 21.1 Rendering

- The match scene uses **two Phaser cameras** side-by-side (vertical split by default; horizontal optional), each following its own player's selection/scroll. The world is simulated once (host sim); each camera renders its own viewport with its own fog-of-war view.
- Each half has its **own React HUD instance** (two HUD roots, each bound to its player's state via the store), positioned over its viewport.

### 21.2 Input routing

- **Pointer-type routing:** `pointerType === 'mouse'` → Player A; `pointerType === 'touch'` → Player B. Each input stream is scoped to its viewport (a pointer in the left half acts on Player A's camera/selection; the touchscreen acts on Player B's). 
- Player A uses keyboard hotkeys (control groups, ability keys); Player B uses on-screen touch buttons and the command radial.
- Selections, control groups, camera positions, and command targets are **kept separate per player** so they never collide.

> **Refined by T23:** the corrected/target design assigns **Player 1 (left) → laptop touchscreen** and **Player 2 (right) → mouse**, runs **two concurrent independent pointers** (no single shared cursor), and gives each player a **side-anchored, user-customizable HUD**. The device→player mapping is configurable/swappable. See §24 → T23 for the full scope and DoD.
>
> **Active scheme — see T24 (no touchscreen/gamepad):** on a standard laptop with only **one keyboard + one mouse**, the touchpad and mouse share a single OS cursor and cannot be split. The default local-2-player scheme is therefore **Player 1 = keyboard** (on-screen virtual cursor via `W/A/S/D`, select `E`, click `Q`, hero abilities `Z/X/C/V`) and **Player 2 = mouse** (hero abilities on the arrow keys), with **two visible cursors** and a **Settings → Keyboard** screen to remap every binding. See §24 → T24.

### 21.3 Logic

- Both local players connect via **loopback transport** to the same in-process host as distinct `playerId`s; their commands are validated and applied identically to network players.
- A third/fourth player joining over Wi-Fi (phone/laptop) is fully compatible: the host runs 2 local + N remote players seamlessly.
- Performance: split-screen renders the scene twice; the graphics-quality setting and viewport culling keep it smooth on a gaming laptop (e.g. Acer Nitro-class).

---

## 22. AI Opponent (Skirmish Bot)

Single-player needs a competent AI so the game is fun solo. The AI runs **on the host as just another player** issuing the same commands a human would (no cheating beyond optional difficulty handicaps).

### 22.1 AI behavior model

- A lightweight **behavior/utility system** with phases: **Boot economy → Expand → Build military → Defend/Attack → Tech & escalate**.
- **Build order:** miners → iron mine → power → barracks → gold → war factory → research; adapts to its resources and to scouting.
- **Economy management:** keeps miners saturated, builds power before brown-out, expands to neutral deposits/derricks (sends Engineers to capture).
- **Military:** trains a mixed army respecting counters (adds Rocket Soldiers/AA when it sees enemy armor/air), masses to an **attack threshold**, then attack-moves toward the player's base or a captured objective; retreats damaged units; defends when its base is attacked (rallies army + uses towers).
- **Hero usage:** levels the hero, keeps it with the army, casts abilities on good clusters, retreats it when low; respects respawn.
- **Defense:** builds towers/walls at chokes; reacts to raids with a defense response.

### 22.2 Difficulty levels

| Difficulty | Handicaps |
|---|---|
| **Easy** | Slower decisions, smaller armies, no resource bonus, doesn't micro the hero much. |
| **Normal** | Balanced; reasonable build order, basic counters, occasional hero plays. |
| **Hard** | Faster decisions, better counters, active hero/ability use, raids and expands aggressively; small resource/build-speed bonus `[tunable]`. |

### 22.3 AI logic

- The AI is **deterministic-friendly** but uses the same authoritative pipeline (it has no maphack beyond fog it has earned via scouting; on Hard it may get a modest economy handicap, clearly a difficulty knob).
- Runs on the host tick at a throttled cadence (decisions every ~0.5–1 s, not every tick) for performance.

---

## 23. Win / Lose Conditions & Match Flow

### 23.1 Conditions

- A player is **eliminated** when their **Command Center is destroyed or captured** (and, by default, they have no Engineer/builder to rebuild one — `[DESIGN]`: losing the Command Center is terminal; no rebuild, to keep matches finite).
- **Free-for-all:** last surviving player wins. **Teams** `[OPT]`: last surviving team wins (allies' deaths don't end the team until all are out).
- **Surrender** eliminates the surrendering player immediately.
- Optional **time/score** fallback `[OPT]` if a match needs a cap (e.g. most territory/economy after N minutes).

### 23.2 Match flow

1. **Lobby** → ready → countdown → **load** (all clients load the map/assets) → **start** (sim begins on the host).
2. **In-match:** the core loop (§2.2) runs until elimination conditions resolve.
3. **End:** when one player/team remains, an **end event** fires; all clients show the **Victory/Defeat** screen with stats (units built/lost, resources gathered, buildings destroyed, hero kills, match time). Options: **Rematch** (back to lobby, same players) or **Quit to Menu**.

### 23.3 Match-flow logic

- The host detects elimination/win each tick and broadcasts the end event; clients freeze the sim view and display results.
- Eliminated-but-still-watching players enter **spectate** of remaining players until match end `[OPT]` or return to lobby.

---

## 24. BUILD TASK PLAN (T0 – T29)

Tasks are **ordered**. Each has a **Goal**, a **Scope checklist** (every box must be checked), and a **Definition of Done (DoD)**. A task ships only when all boxes are checked and all DoD lines pass. Tasks reference the design sections above for exact numbers and behaviors. Every animation/VFX listed in §16 for a feature is part of that feature's task — "functional but no animation" is **not** done.

Legend: `[ ]` to do · `[OPT]` optional/stretch · "DoD" = acceptance criteria.

---

### T0 — Project setup & tooling
**Goal:** a runnable monorepo skeleton with all tech wired and an empty scene rendering.

Scope:
- [ ] Monorepo with workspaces: `shared`, `sim`, `client`, `server`, `desktop` (§3.3, §4).
- [ ] TypeScript strict everywhere; shared `tsconfig.base.json`; ESLint + Prettier; the `no-literal-string` lint rule on the React/UI layer (§5.1).
- [ ] Vite client app boots; a Phaser `BootScene` renders a blank canvas; a React shell overlays it.
- [ ] i18next initialized with `en/ru/uz` namespaces loading from `public/locales`; a temporary language switcher proves runtime switching (§5).
- [ ] `shared/constants.ts`, `ids.ts`, `protocol.ts`, `damageTable.ts`, `i18nKeys.ts` stubs exist.
- [ ] Asset pipeline script stub (`scripts/pack-assets.ts`) and folders for atlases/audio/fonts/maps/locales.
- [ ] Bundled fonts (Noto Sans + Cyrillic coverage) via `@font-face`; `<meta charset="utf-8">` set.
- [ ] Vitest configured; one trivial sim unit test passes in CI.

DoD: `npm run dev` shows a blank game canvas + a working language toggle; CI runs lint + tests green; switching language changes a sample label and renders Cyrillic + Uzbek letters correctly.

---

### T1 — Core rendering, camera & game loop
**Goal:** a tilemap renders; the camera pans/zooms; a fixed-timestep sim loop drives a debug entity.

Scope:
- [ ] `sim/World.ts` with a **fixed 20 Hz** `tick(dt)` loop decoupled from render (accumulator pattern) (§3.2).
- [ ] Entity model (component-based: `Transform`, `Health`, `Owner`, `Renderable`, …) (§4).
- [ ] Tiled map JSON loader → Phaser tilemap; terrain passability grid derived (§19.5).
- [ ] Camera: edge-scroll + WASD + drag-pan with inertia; mouse-wheel zoom with easing; clamped to map bounds (§16.4, §18.7).
- [ ] `EntityRenderer` interpolates entity transforms between sim states; a debug unit moves smoothly.
- [ ] Debug overlay (FPS, tick rate, entity count, cursor tile).

DoD: a test map loads; a debug unit ticks at 20 Hz and renders interpolated/smooth; camera pan/zoom feel good and stay in-bounds.

---

### T2 — Resource & economy system
**Goal:** the full Silver/Iron/Gold/Power economy with the canonical numbers and HUD feedback.

Scope:
- [ ] Resource model + stockpiles (Silver/Iron/Gold) and Power balance (gen − consumption) (§6.1, §6.4).
- [ ] Starting state: Command Center +5 power, adjacent Silver Mine with 1 working miner, **15 silver** (§6.2).
- [ ] Miner gathering: work slots (3), **+1 silver/10 s per miner**; deposits with reserves & exhaustion (§6.3).
- [ ] Iron Mine (**20 silver → +1 iron/15 s**), Gold Mine (**5 iron + 25 silver → +1 gold/30 s**) auto-production (§6.1, §7.1).
- [ ] Power Plant (+10), per-building draw, **brown-out penalties** (50% production, 60% tower fire, −20% range) + LOW POWER banner (§6.4).
- [ ] Atomic spend/affordability, refunds (100% queued / 50% in-progress), sell (50%) (§6.6).
- [ ] Economy HUD: resource bar with rolling counters, `+rate`, power gauge; **"+1" float** on tick; coin sparkle; insufficient-funds flash + denied tick (§6.5, §16.6).

DoD: silver ticks from second 0; building an Iron then Gold mine produces those resources at the exact rates; over-expanding triggers brown-out and visibly slows production; all economy VFX play; unit tests cover income/spend/refund math.

---

### T3 — Buildings & construction
**Goal:** place, construct, operate, damage, repair, and destroy all economy/tech buildings with full animation.

Scope:
- [ ] Building placement: green/red footprint preview, build-radius rule, grid snap, blocked-tile checks (§7.3).
- [ ] Construction sequence with scaffold + build bar + dust + crane + pop bounce; Miner build/repair behavior (§16.5).
- [ ] All economy/tech buildings from §7.1 with correct cost/HP/power/footprint/function (Command Center, Silver/Iron/Gold Mine, Power Plant, Barracks, War Factory, Research Center, Airfield [OPT], Super Weapon Silo).
- [ ] Per-building queues (max 8) with radial cooldowns; rally points with flag + dashed line (§7.3).
- [ ] Operational ambience: chimney smoke, rotating dish, glowing windows, bay door on unit exit; power-state flicker (§16.5).
- [ ] Damage states (smoke ≤66%, fire ≤33%, heavy near death) + destruction collapse (dust, debris, rubble decal, scaled screen shake); sell variant (§16.5).
- [ ] Repair (sparks, wrench, HP fill); Command Center slow auto-repair out of combat.

DoD: a full economy can be built from the starting base; every building shows construction, operation, damage, repair, and destruction animations; queues/rally work; selling refunds 50% and clears the footprint.

---

### T4 — Units & production
**Goal:** train, select, command, and move all units (workers, infantry, vehicles) with pathfinding and formations.

Scope:
- [ ] Production from Barracks/War Factory/Command Center with queues; trained units exit the bay and move to rally (§7.3, §16.5).
- [ ] All workers/infantry/vehicles from §8 with exact stats (Miner, Engineer, Infantry, Rocket Soldier, Robot, Light/Heavy Tank, Artillery, Rocket Launcher, Anti-Air; Aircraft [OPT]).
- [ ] Selection: single, drag-box, double-click type-select, Ctrl+1..9 control groups (§8.5, §18.7).
- [ ] Commands: move, attack, attack-move, stop, hold, patrol, guard (§8.5).
- [ ] Pathfinding: A* (easystarjs) + shared **flow field** for large groups; soft separation (no stacking); formation move (§8.5).
- [ ] Unit animations: idle, move (with dust/track scroll), turn, facing, turret rotation; selection circles + HP bars (§16.1).

DoD: you can train a mixed army and move 20+ units across the map without clumping/jitter; all command modes work; vehicles rotate body/turret correctly; idle/move animations and selection visuals are present.

---

### T5 — Combat system
**Goal:** units and structures fight using the damage/armor matrix, projectiles, splash, accuracy, veterancy, and death.

Scope:
- [ ] Damage-type × armor-type matrix (§13.1) in `damageTable.ts`; final-damage formula (matrix × veterancy × upgrades × accuracy) (§13.1).
- [ ] Attack params: range (+min range for Artillery), reload, projectile speed, splash falloff, accuracy/miss (§13.2).
- [ ] Target acquisition, focus-fire override, leash, attack-move engagement (§13.3).
- [ ] **Projectiles (all types)**: tracer, tank shell, **homing rocket w/ smoke trail**, **4-rocket salvo ripple**, **arcing artillery shell w/ ground shadow**, energy bolt, flame cone, AA flak — pooled (§16.2).
- [ ] Impacts/explosions: bullet spark, shell explosion, rocket shockwave, building-hit, splash ring, near-miss; scorch/wreck decals (§16.3).
- [ ] Veterancy: XP per kill, Rookie→Veteran→Elite→Heroic with bonuses + chevron badges + rank-up flash (§10.5, §16.1).
- [ ] Death VFX per class (infantry ragdoll, robot small explosion, vehicle fireball + turret pop + decal, aircraft crash) (§16.1).

DoD: rock-paper-scissors counters work (rockets beat tanks, bullets beat infantry, siege beats buildings, AA beats air, AA can't hit ground armor well, cannons can't hit air); the 4-rocket salvo and arcing artillery read clearly with their signature visuals; units gain ranks and show chevrons; all impacts/deaths animate. Unit tests cover the damage matrix and veterancy thresholds.

---

### T6 — Animation & VFX master pass
**Goal:** the central FX system and every effect in §16 implemented, pooled, and quality-scalable.

Scope:
- [ ] `FxRenderer` with **pooled** emitters/sprites/floating-text/decals spawned by id; hard caps + oldest-first recycling (§16.11).
- [ ] Camera effects: scaled screen shake, screen flash, damage vignette, [OPT] hit-stop; reduced-motion/shake toggle (§16.4).
- [ ] Floating combat text + "+1"/"+reward" popups; minimap pings (ripple) (§16.6, §16.8, §16.9).
- [ ] Verify every projectile/impact/building/economy/capture animation from §16 is wired through `FxRenderer`.
- [ ] Graphics-quality setting (Low/Med/High) scales particle density, decal lifetime, optional effects (§16.11).

DoD: a heavy battle (50+ units, many explosions) maintains target FPS on a mid laptop at Medium and on a phone at Low; no per-shot allocations (verified via a quick profile); toggling quality visibly scales effects; reduced-motion disables shake/flash.

---

### T7 — Defensive structures & walls
**Goal:** all towers, the garrison Bunker, and walls/gates, with targeting and brown-out behavior.

Scope:
- [ ] Guard Tower, Cannon Tower, Rocket Tower (SAM) with stats, head rotation, range rings, target priority (§11.1).
- [ ] Tower VFX: tracer/muzzle, heavy shell + recoil, **twin homing rockets** (§16.2/§16.3).
- [ ] Bunker garrison: hold 4 infantry, +25% range, reduced damage, firing-port muzzle flashes, occupant pips, eject-on-destroy (§11.2).
- [ ] Walls (auto-connecting corner/T/cross sprites, block ground) + Gates (open for allies, shut vs enemies) with pathfinding integration (§11.3).
- [ ] Brown-out penalties applied to defenses (§6.4).

DoD: a walled base with mixed towers repels an attack wave; SAMs prioritize aircraft, cannons prioritize vehicles, guard towers prioritize infantry; gates open/close correctly; garrisoned infantry fire out with bonus range; low power visibly weakens defenses.

---

### T8 — Hero system
**Goal:** the controllable hero with leveling, mana, abilities (Hero #1 fully), respawn, shop, and HUD.

Scope:
- [ ] Hero entity: spawn at Command Center, level 1, HP/mana/regen, XP from nearby kills + passive trickle, levels (max 10), per-level stats + 1 ability point (§9.1).
- [ ] Hero #1 "Commander" abilities Q/W/E/R fully (effects, mana, cooldown, ranks) with full VFX incl. **Orbital Strike** (reticle → beam → fireball + shake) (§9.3, §16.7).
- [ ] Heroes #2/#3 specified and stubbed for selection [SPEC; full impl OPT for launch] (§9.4–§9.5).
- [ ] Death/respawn timer (`8 + 4×level`), respawn countdown on portrait, killer bounty (§9.1).
- [ ] Artifact shop [OPT but build the panel]: gold-cost items, 6 slots, combine, 50% sell, persist through death (§9.6).
- [ ] Hero HUD: portrait, HP/mana, level/XP, 4 ability icons with rank pips + cooldown radials + mana cost + denied-cast shake (§18.4).
- [ ] Server-side validation of casts (range/mana/cooldown) with error events (§9.7).

DoD: the hero levels up, learns abilities, casts all four with correct effects/VFX/costs, dies and respawns on timer; the ability bar and portrait reflect live state; invalid casts are rejected with feedback.

---

### T9 — Upgrades, tech tree & veterancy integration
**Goal:** the Research Center, all upgrades, building-local upgrades, and veterancy upgrades fully applied.

Scope:
- [ ] Research Center: one active research, progress on tick, completion event updates stats/icons (§10.6).
- [ ] Weapon/armor upgrades (§10.2), economy upgrades (§10.3), building-local upgrades (§10.4) with correct effects and stacking rules.
- [ ] "Infantry Combat Training" (train at Veteran) and other veterancy interactions (§10.2, §10.5).
- [ ] Stat-display updates so the player sees upgraded numbers; tech dependencies enforced (§10.1).

DoD: researching Uranium Shells visibly increases tank damage; economy upgrades change rates; building-local upgrades work; tech prerequisites gate buildings/units correctly; CI tests verify stacking math.

---

### T10 — Neutral capture points
**Goal:** all neutral types, both capture mechanics, rewards/income, and capture VFX.

Scope:
- [ ] Neutral types: Oil Derrick, Neutral Tech Lab, Watch Outpost, Abandoned Mine, Derelict Turret with their rewards/benefits (§12.1).
- [ ] Engineer capture (channel; consumed on enemy structures) + presence/contested capture for control points (ring fill, enemy pauses/reverses) (§12.2).
- [ ] Captured benefits live: passive income, exclusive upgrade, vision, mineable deposit, reactivated turret fighting for owner (§12.1).
- [ ] Capture VFX: filling ring, flag-raise, "+reward" popup, turret power-on; re-capture + anti-farm bounty cooldown (§16.8, §12.2).

DoD: an Engineer captures an Oil Derrick for the bounty + income; a contested control point stalls while an enemy is present; a captured Derelict Turret fires for its new owner; all capture visuals play; re-capturing flips ownership correctly.

---

### T11 — Fog of war & minimap
**Goal:** per-player vision, fog rendering, and a fully functional minimap.

Scope:
- [ ] Per-player visibility grid from unit/building vision radii; explored-but-dim vs visible-live vs unexplored-black (§15).
- [ ] Fog render layer with **soft** reveal/conceal fades; enemy units outside vision not rendered (anti-maphack) (§15, §16.9).
- [ ] Minimap: terrain + fog + owned/visible-enemy/neutral blips + pings; click-to-jump, drag-pan, right-click world command (§18.4).
- [ ] Vision from captured Watch Outposts, forward towers, aircraft, and abilities (Smoke Screen denies) (§15).

DoD: you only see enemies your vision reveals; the minimap matches the main fog; capturing an outpost expands vision; reveal/conceal transitions are smooth; right-clicking the minimap issues a correct world order.

---

### T12 — AI opponent (skirmish bot)
**Goal:** a competent AI that plays via the same command pipeline, with difficulty levels.

Scope:
- [ ] Phase/utility AI: boot economy → expand → military → defend/attack → tech (§22.1).
- [ ] Economy mgmt (miner saturation, power-before-brownout, expand & Engineer-capture); counter-aware army composition; attack thresholds + retreat; base defense (§22.1).
- [ ] Hero usage (level, fight with army, cast on clusters, retreat low, respect respawn) (§22.1).
- [ ] Difficulty levels Easy/Normal/Hard with the specified handicaps; throttled decision cadence (§22.2–§22.3).

DoD: Normal AI builds a real economy and army, captures objectives, attacks and defends sensibly, and uses its hero; Easy is beatable by a new player; Hard pressures an experienced player; AI uses only the standard command pipeline (no maphack beyond difficulty handicaps).

---

### T13 — Main menu & UI flow
**Goal:** the complete front-end flow and polished in-game HUD (desktop + touch).

Scope:
- [ ] Boot/loading scene with grouped asset progress; title screen with animated skirmish background + music (§18.1).
- [ ] Main menu (Play/Settings/How to Play/Credits/Quit) with localized text and UI animations (§18.2, §16.9).
- [ ] Settings: audio buses, graphics quality, language, controls, accessibility toggles (reduce shake/particles, colorblind colors) (§18.6).
- [ ] In-game HUD desktop: resource bar, minimap, command/build panel (context-sensitive), selection info, hero ability bar, notifications/alerts (§18.4).
- [ ] Touch HUD: tap/drag select, tap-hold command radial, pinch/two-finger camera, bottom-sheet panel, big hero buttons (§18.5).
- [ ] Pause/in-game menu (resume/settings/surrender/quit) with correct single- vs multiplayer pause behavior (§18.6).

DoD: a player can navigate menus, change language/settings, and play a full match using only the HUD on both mouse and touch; all UI animates per §16.9; no hardcoded strings (lint passes).

---

### T14 — Maps
**Goal:** implement and validate all designed maps with spawns, deposits, neutrals, terrain, and theme.

Scope:
- [ ] Map JSON schema + loader validation (fail loudly on malformed maps) (§19.5).
- [ ] Map A "Twin Rivers" (2p), Map B "Crossfire" (4p), Map C "Iron Valley" (3p); Map D "Desert Standoff" [OPT] — each with exact spawns, deposits, neutral points, chokes, terrain rules, theme/ambience (§19.1–§19.4).
- [ ] Auto spawn-assignment by player count; unused spawns neutral/AI/sealed; balanced/symmetric starts (§19.5).
- [ ] Terrain-driven pathfinding, water/bridge rules, vision blockers, ambient/environment animations per map (§16.10, §19.5).

DoD: each map loads, validates, plays end-to-end with correct resource layout and neutral points, supports its intended player counts, and shows its theme + ambient animations; a malformed map is rejected with a clear error.

---

### T15 — Networking (local multiplayer)
**Goal:** host server + real clients over LAN with the command/snapshot/event protocol and smoothing.

Scope:
- [ ] Node + Express + Socket.IO host; serves the client; detects LAN IP/port; lobby rooms + slots (§3.1, §18.3, §20.1).
- [ ] `Transport` abstraction with `SocketTransport` (remote) + `LoopbackTransport` (host-local), one sim path (§20.2).
- [ ] Protocol: Commands (validated server-side), per-player **fog-filtered snapshots** (15–20 Hz, delta where practical), one-shot Events for VFX/SFX (§20.3).
- [ ] Client smoothing: interpolation (~100 ms), cosmetic-only prediction + reconciliation; VFX from events (§20.4).
- [ ] Join flow UI: host shows **URL + QR + room code**; join by URL/code/scan; lobby shows connected devices + ping (§18.2–§18.3, §20.1).
- [ ] Resilience: reconnection by token within grace; command rate cap; out-of-order/dup rejection; host-quit ends match cleanly (§20.5).

DoD: a phone and a second laptop on the same Wi-Fi join the host by scanning the QR / entering the code, see the lobby, and play a smooth 3–4 player match with no maphack; dropping and rejoining a client within the grace window resyncs; every client's economy/combat stays in agreement (host is authoritative).

---

### T16 — Split-screen local co-op
**Goal:** two full players on the host machine — mouse player + touchscreen player — side-by-side.

Scope:
- [ ] Two Phaser cameras (split viewports), each following its player with its own fog view; two React HUD roots (§21.1).
- [ ] Pointer-type input routing (mouse → Player A, touch → Player B), scoped per viewport; separate selections/groups/camera/targets (§21.2).
- [ ] Both local players via loopback as distinct `playerId`s; fully compatible with remote players joining (2 local + N remote) (§21.3).
- [ ] Performance: viewport culling + quality scaling keep split-screen smooth on a gaming laptop (§21.3).

DoD: two people play their own bases/heroes on one laptop (one mouse, one touchscreen) without input bleed; a phone can still join as Player 3; the split renders smoothly.

---

### T17 — Audio
**Goal:** every action has sound, with buses, spatial-ish panning, and rate limiting.

Scope:
- [ ] Howler manager with Master/Music/SFX/UI/Voice buses + persisted volumes (§17).
- [ ] All combat/unit/building/economy/hero/super-weapon/UI sounds paired to their §16 events (§17.1).
- [ ] Distance-based panning/volume from camera; per-sound cooldown to prevent spam (§17.2).
- [ ] Ambient bed per map; [OPT] dynamic music intensity by combat.

DoD: firing, explosions, construction, economy ticks, hero abilities, super weapon, and UI all sound correct and positioned; mass fire doesn't clip; volume buses work and persist.

---

### T18 — i18n full integration & font pass
**Goal:** every string wired through i18next with correct fonts and live switching.

Scope:
- [ ] Replace all temporary text with `t('key')`; populate `en/ru/uz` namespaces for every menu/HUD/unit/building/ability/upgrade/tip/error key (§5.2).
- [ ] Bundled fonts cover Latin Extended + Cyrillic + Uzbek letters; fallback stack set; no tofu on any covered glyph (§5.1).
- [ ] Live language switch updates 100% of React + Phaser-rendered text; interpolation + per-locale plurals + number/time formatting (§5.1).
- [ ] CI check: key parity across locales; lint `no-literal-string` passes (§5.4).

DoD: playing the entire game in each of the three languages shows no English leakage and no broken characters anywhere; switching mid-game updates everything instantly; CI fails on any missing/extra key. (Final wording quality is verified in T20.)

---

### T19 — Desktop packaging (Electron host)
**Goal:** a one-click `.exe` that hosts a game; clients still need only a browser.

Scope:
- [ ] Electron wrapper bundling the Node + Socket.IO server + client; launching the `.exe` starts the server and opens the host window (§3.1, §4).
- [ ] On launch, the host window shows the **LAN URL + QR + room code** for joiners (§18.2, §20.1).
- [ ] Build config produces a Windows `.exe` (and [OPT] other OS); Quit button visible in Electron (§18.2).
- [ ] Clients (phone/laptop) join the running host purely via browser — verified no install needed (§20.1).

DoD: double-clicking the `.exe` on a Windows laptop starts a host; a phone scans the QR and joins; a full match runs; closing the app stops the server cleanly.

---

### T20 — Localization finalization & QA  *(the dedicated trilingual pass)*
**Goal:** native-quality, context-correct Uzbek/Russian/English for **every** in-game term, re-checked against meaning and game logic. (Detailed in §25.)

Scope:
- [ ] Build the **master glossary** (§26.7) — every unit, building, ability, upgrade, resource, status, menu item, tip, and error — in all three languages, terminologically consistent (the same concept always uses the same word).
- [ ] **In-context review:** read every string where it appears in the UI; fix length overflow, awkward machine-translation phrasing, wrong register, and terms that don't match the game's meaning/logic (§25).
- [ ] **Uzbek orthography pass:** correct `ʻ`/`ʼ` (U+02BB/U+02BC), proper Latin spelling; **Russian pass:** correct cases, plurals (1/2/5 forms), and gendered agreement (§5.1).
- [ ] Pluralization/interpolation strings verified per locale (counts, timers).
- [ ] Visual proof on Windows Chrome, Android Chrome, and the Electron host — no clipping, no tofu, correct glyphs.

DoD: a fluent Uzbek and a fluent Russian speaker can play entirely in their language and every term reads correctly, consistently, and in-context; no string is a literal/garbled/placeholder; the glossary is the single source of truth and the locale files match it.

---

### T21 — Balancing & playtest pass
**Goal:** tune numbers for fair, fun matches (the only phase allowed to change balance constants).

Scope:
- [ ] Playtest 1v1, FFA, and team [OPT] across all maps; record win rates, match lengths, and dominant strategies.
- [ ] Tune unit/building/upgrade/hero/super-weapon numbers in `constants.ts` (economy canon §0 stays fixed unless explicitly revisited).
- [ ] Fix exploits (turtle stalemates, unkillable hero loops, resource runaway, splash/garrison abuse).
- [ ] Verify counters feel right and no single unit/strategy is auto-win.

DoD: matches resolve in a reasonable time, no degenerate dominant strategy, hero feels strong-but-not-game-breaking, the super weapon is impactful but counterable; balance changes are isolated to constants.

---

### T22 — Optimization & release
**Goal:** smooth on target hardware (gaming laptop + mid phone) and shippable.

Scope:
- [ ] Profiling: confirm pooling for projectiles/particles/text/decals; cap simultaneous effects; viewport culling; sprite-atlas batching (§16.11).
- [ ] Snapshot bandwidth check on a phone (delta-compression, fog filtering) at 3–4 players (§20.3).
- [ ] Split-screen + heavy-battle stress test holds target FPS at appropriate quality; graphics-quality presets validated (§16.11, §21.3).
- [ ] Production build (web + Electron `.exe`); README with run/host instructions in uz/ru/en [OPT].

DoD: a full 4-player match (one host laptop split-screen + phones) runs smoothly through a late-game battle and a super-weapon strike without frame collapse; the web build and `.exe` are produced and documented.

---

### T23 — Split-screen dual-device input & per-player customizable HUD  *(fix + enhancement)*
**Goal:** make two-player split-screen on one laptop genuinely playable by giving each local player their **own independent input device** and their **own conveniently placed, customizable HUD** — Player 1 drives their half with the laptop's built-in **touchscreen**, Player 2 drives their half with the **mouse**, both at the same time with no input bleed.

**Problem being fixed (observed bug):**
- In the current split-screen build only **one mouse cursor** exists on screen and only **Player 1 (left half)** is actually controllable; **Player 2 has no working input** on a normal laptop. The two players cannot command their bases/heroes simultaneously.
- Root cause: the prior input routing effectively funnels all real pointer activity into a single stream/cursor, and Player B's stream was bound to a pointer type that does not fire on the tester's hardware, so the right half is dead. Command buttons are also not split or positioned per player, so each player cannot reach their own controls comfortably.

**Required behavior (refines §21.2 / supersedes the device-assignment detail in T16):**
- **Two simultaneous, independent pointer streams** sharing one canvas:
  - **Player 1 (left viewport) ← laptop touchscreen** (`pointerType === 'touch'`), using on-screen buttons + command radial; the touch stream only ever affects Player 1's camera/selection/commands.
  - **Player 2 (right viewport) ← mouse** (`pointerType === 'mouse'`); the **mouse cursor is confined to / only acts on Player 2's half**, and never moves or commands Player 1.
  - Multi-touch must be supported so the touchscreen player can pan/select/issue commands independently while the mouse player is also acting (no "one cursor wins" behavior, no input bleed across the divider).
- The **device→player assignment is configurable** in the lobby/settings (default: P1 = touchscreen, P2 = mouse) and can be **swapped**, so a tester without a touchscreen can still control both halves (e.g. fall back to mouse-only by half, or assign a second pointer device).
- Keyboard hotkeys (control groups, ability keys) bind to the configured keyboard-owning player; the other player relies on their on-screen HUD.

**Per-player HUD placement & customization:**
- Each viewport gets its **own HUD root** with its command buttons (build/train/abilities/super-weapon, control groups, minimap) anchored **near that player's own side** — i.e. controls for the left player hug the left/bottom-left edge, controls for the right player hug the right/bottom-right edge — so each player's buttons are within easy reach of their own input device.
- HUD layout is **user-customizable per player**: a player can **reposition/resize/show-hide** their button groups (e.g. drag the command panel, move the ability bar, choose left/right/bottom anchor), and the layout **persists** (saved to local settings) and can be **reset to default**. Customization must work via touch (for the touchscreen player) and via mouse (for the mouse player).

Scope:
- [ ] Per-viewport pointer routing that supports **two concurrent active pointers** (one touch, one mouse) with the mouse cursor clamped to Player 2's half and touch scoped to Player 1's half; verified no cross-half input bleed (§21.1–§21.2).
- [ ] Lobby/settings control to assign each local player's input device (touchscreen / mouse / keyboard), defaulting to P1=touchscreen, P2=mouse, with a swap option and a sensible fallback when no touchscreen is present.
- [ ] Two independent HUD roots, each anchored to its player's side with conveniently-reachable command buttons; separate selections/control groups/camera/targets per player (§21.1).
- [ ] HUD customization: drag-to-reposition / resize / show-hide button groups per player, persisted to local settings, with a reset-to-default action; works under both touch and mouse.
- [ ] Trilingual labels/tooltips for any new settings and the customization UI (uz/ru/en) (§5, §25).
- [ ] Regression: single-player and remote-join (2 local + N remote) paths still work; existing automated tests still pass.

DoD: on one laptop, two people play their **own** bases/heroes at the **same time** — Player 1 commanding the left half via the touchscreen and Player 2 commanding the right half via the mouse — with two distinct, non-colliding pointers and no shared single cursor; each player's command buttons sit comfortably on their own side and can be repositioned/customized and the layout survives a restart; a phone can still join as Player 3; the split renders smoothly.

---

### T24 — Keyboard + mouse split-screen controls & remappable key-bindings settings  *(active local-2P input scheme)*
**Goal:** make local two-player split-screen genuinely playable on an ordinary laptop that has **no touchscreen and no gamepad** — only **one keyboard and one mouse**. Player 1 plays the left half with a **keyboard-driven on-screen cursor**, Player 2 plays the right half with the **mouse**, both at the same time. Hero abilities must be on **separate, non-conflicting keys per player** (not the same default `Q/W/E/R` for both). Add a **Settings → Keyboard** screen where players can **remap every binding**.

**Why this task (hardware reality):**
- The host laptop has **one OS mouse cursor**. The touchpad and any external mouse both report `pointerType === 'mouse'` and drive that **same single cursor**, so they cannot be split into two independent pointers. There is no touchscreen (so T23's touch path does not apply here) and no gamepad.
- Therefore the only way to get **two independent, simultaneous controls on one screen** with the available hardware is **keyboard (Player 1) + mouse (Player 2)**, with the game drawing a **second, visible virtual cursor** for the keyboard player so the screen genuinely shows **two cursors**.
- The current build also binds hero abilities to `Q/W/E/R` for *every* controller, so in split-screen both players would trigger each other's abilities. Abilities must be **per-player keys**.

> **Supersedes the input device assignment in §21.2 and T23 for no-touchscreen hardware.** T23's per-player **customizable HUD** remains valid; only the *input device* changes here (keyboard+mouse instead of touch+mouse). On machines that *do* have a touchscreen, the T23 touch scheme may still be offered as an alternative; the default for a standard laptop is this T24 scheme.

**Default control scheme — local 2-player split (one keyboard + one mouse):**

- **Player 1 — left viewport, keyboard-driven virtual cursor:**
  - Move cursor: **`W` `A` `S` `D`** (up / left / down / right). The cursor is clamped to Player 1's (left) viewport; when it reaches the viewport edge, Player 1's camera pans.
  - **Select** (click-select / start box-select): **`E`**
  - **Click / issue command** (move, attack, capture, place building, confirm ability target): **`Q`**
  - **Hero abilities** (ability slots 0–3): **`Z` `X` `C` `V`**
- **Player 2 — right viewport, mouse:**
  - Cursor + select + commands: the existing mouse scheme (left-click select / drag box-select, right-click move/attack/capture, wheel-zoom, middle-drag or edge-scroll pan). Confined to the right viewport.
  - **Hero abilities** (ability slots 0–3): **Arrow keys** — **`↑` `→` `←` `↓`** (default map: Up→slot 0, Right→slot 1, Left→slot 2, Down→slot 3).
- **No key conflicts:** Player 1's keys (`W A S D E Q Z X C V`) and Player 2's keys (the four arrows) are disjoint, and Player 2's pointer is the mouse — so the two players never trigger each other's actions.
- **Single-player (one player) is unchanged:** mouse + the existing `Q/W/E/R` ability defaults still apply; the keyboard-cursor scheme only activates for Player 1 in local split-screen (or when a player chooses keyboard control).

**Settings → Keyboard (remappable bindings):**
- Add a **"Settings"** button to the main menu (title/play screen).
- Inside Settings, a **"Keyboard" / "Controls"** section listing every bindable action, grouped by **Player 1** and **Player 2**:
  - Player 1: cursor up/down/left/right, select, click/command, ability 1, ability 2, ability 3, ability 4 (and camera-pan if separated from cursor).
  - Player 2: ability 1–4 (and optionally remappable mouse buttons / modifier keys).
  - Single-player / shared: ability 1–4, stop, hold, attack-move, control-group keys, camera keys.
- **Rebind UI:** click a binding field → "press a key" → the pressed key is captured and assigned. Show the current key for each action.
- **Conflict handling:** detect and warn (or block) when the same key is assigned to two actions of the *same* player; allow the same physical key across *different* players only if it cannot cause cross-control (generally disallow duplicates).
- **Persistence:** save all bindings to local settings (localStorage) so they survive a restart; provide a **"Reset to defaults"** action (per player and/or global).
- The active in-game input (T24 scheme + HUD hotkey hints) must **read from these bindings**, not from hardcoded keys.
- All Settings/Keyboard labels, action names, and prompts are **trilingual** (uz/ru/en) per §5/§25.

Scope:
- [ ] Local split-screen uses **keyboard for Player 1 + mouse for Player 2**; Player 1 gets a **visible on-screen virtual cursor** in the left viewport moved by `W/A/S/D`, with `E`=select and `Q`=click/command (§21.1–§21.2).
- [ ] Hero abilities are **per-player and non-conflicting**: Player 1 = `Z X C V`, Player 2 = arrow keys; remove the shared `Q/W/E/R`-for-both behavior in split-screen (single-player keeps `Q/W/E/R`).
- [ ] Player 1 camera pans when the keyboard cursor hits the left-viewport edge; Player 2 keeps mouse wheel-zoom + edge/middle-drag pan; neither player's keys affect the other's viewport (no input bleed).
- [ ] **Settings** button added to the main menu, opening a **Keyboard/Controls** screen.
- [ ] Every action above is **remappable** via a press-a-key rebind UI, with conflict detection, **persisted** to local settings, and a **reset-to-defaults** action.
- [ ] All in-game input and HUD hotkey labels read from the configured bindings (no hardcoded keys); HUD ability tooltips show each player's *current* keys.
- [ ] Trilingual labels/tooltips for the Settings and Keyboard UI and all action names (uz/ru/en) (§5, §25).
- [ ] Regression: single-player (mouse + `Q/W/E/R`) and remote-join (2 local + N remote) paths still work; existing automated tests still pass.

DoD: on one laptop with only a keyboard and a mouse, two people play at the **same time** — Player 1 moving an on-screen cursor with `W/A/S/D`, selecting with `E`, commanding with `Q`, and casting hero abilities with `Z/X/C/V` on the left half; Player 2 using the mouse and casting hero abilities with the arrow keys on the right half — with **two visible cursors** and **no cross-control**. The main menu has a **Settings** button; in **Keyboard** a player can rebind any of these keys, the change takes effect in-game immediately, persists across a restart, and can be reset to defaults; all of it reads correctly in uz/ru/en.

---

### T25 — LAN multiplayer connectivity fix  *(host web-root, one-click launchers, auto-join, LAN URL/QR)*
**Goal:** make **LAN multiplayer actually connect** end-to-end. **Hosting must run the real Node host server** — the one that both **serves the game** and **runs the 20 Hz authoritative simulation** (§3.2) — and **other devices on the same Wi-Fi must be able to join by opening a link or scanning a QR code**, with **no `localhost`, no hand-typed addresses, and no broken asset paths**. The host plays in its own browser as **slot 0** (a thin client of its own server). Single-player and the T24 split-screen scheme are untouched.

**Why this task (what was broken):**
- **Broken host web root.** The Node host (`server/host.ts`) rooted static serving one level above the compiled server (`dist/server/..` = `dist`), but `index.html` / `styles.css` live in the game root and the bundle at `dist/main.js`. The host therefore served **404s** for the page and its assets, so a joiner's browser loaded nothing. The web root must point at the **game root** (two levels up from `dist/server`).
- **No one-action way to host the real server.** Double-clicking a launcher only ran the **static** server (local-only play) or required a hand-typed `node dist/server/host.js`. There must be a **one-click host launcher** per OS that starts the real server.
- **`localhost` / port confusion.** Other devices need the host's **LAN IP**, never `localhost`. The lobby surfaced a hardcoded `http://localhost:8000` fallback that joiners could never reach; the **real LAN URL** must be surfaced everywhere (terminal, in-game lobby, QR), and `localhost` used only by the host's own browser.
- **First-run friction not surfaced.** The **same-Wi-Fi** requirement and the **first-run firewall** prompt were never explained, so hosts hit a silent failure.

**Required behaviour:**
- **Host:** running the one-click launcher (`host.bat` / `host.sh` / `host.command`) starts `dist/server/host.js`, opens the host's own browser (on `localhost`, which is correct for the host machine), and the host connects to its own server as **slot 0** and plays like any other client.
- **Joiner:** on a device on the **same Wi-Fi**, opening the **LAN URL** (`http://<lan-ip>:<port>`) **or scanning the QR** auto-connects a `SocketTransport` straight into the lobby — no manual "Join" step (the shared link carries `?room=…` and the host injects a marker that triggers auto-join). A **manual Join → enter address** path remains as a fallback.
- **Lobby:** shows the **LAN URL**, **room code**, and a **QR** of the join link (never `localhost`), plus clear **same-Wi-Fi / use-the-LAN-link / first-run-firewall** guidance. Join failures distinguish **couldn't reach the host** from **lobby full** and **already started**.
- **Architecture unchanged:** clients remain `SocketTransport`s and the host the `MatchHost`; the per-player fog-filtered snapshots and loopback local play are untouched. Per-slot reconnection tokens are **not** broadcast to other clients (§20.3).

Scope:
- [ ] **Host web-root fixed** so the host serves the game: `GET /` → the game `index.html`, `GET /dist/main.js` and `GET /styles.css` all return **200** (were 404); unknown paths still **404** (traversal/missing guard intact).
- [ ] **One-click LAN host launchers** — `host.bat` (Windows), `host.command` (macOS, double-clickable), `host.sh` (Linux) — start the **real** Node host; the host's own browser takes **slot 0**.
- [ ] **Auto-join** when a page is opened with `?room=…` **or** is served by the Node host (auto-connect to its own origin → straight to the lobby); keep a **manual Join address** fallback.
- [ ] **Correct LAN address everywhere** — lobby shows the LAN URL + room code + QR (never `localhost`); the host prints the same join URL/QR to its terminal on boot.
- [ ] **Guidance + clearer errors** — trilingual same-Wi-Fi / use-the-LAN-link / first-run-firewall notes; join errors separate **couldn't-reach-host** from **lobby-full** and **already-started**.
- [ ] **Authoritative-sim architecture unchanged** (clients = `SocketTransport`, host = `MatchHost`); per-slot reconnection tokens are not leaked to other clients (§20.3).
- [ ] **Trilingual** (uz/ru/en) for every new user-facing string, with correct Uzbek orthography (U+02BB `ʻ`, U+02BC `ʼ`) (§5, §25).
- [ ] Regression: single-player, T24 split-screen, and the existing automated tests still pass.

DoD: a host runs **one launcher** (`host.bat` / `host.command` / `host.sh`); the game opens in the host's browser (host = slot 0) and the terminal **and** lobby show a **LAN join URL + room code + QR**. A second device on the **same Wi-Fi** opens that LAN link (or scans the QR) and lands **directly in the lobby**, then both play a match together on the authoritative host. Verifiable headlessly: with the host running, `GET /` returns **200** serving `index.html`, `GET /dist/main.js` and `GET /styles.css` return **200**, an unknown path returns **404**, the served page injects the host marker, the host's loopback browser is assigned **slot 0** and the next device **slot 1**, and the broadcast lobby leaks **no** reconnection tokens; all user-facing strings read correctly in uz/ru/en. `bash build.sh` is clean and all test suites pass.

---

### T26 — Production UX, factory upgrades, Research Center tech, distinct unit visuals & keyboard build control  *(Generals-style command & production overhaul)*

**Goal:** make selecting and operating buildings feel like **C&C Generals**. Specifically: (1) selecting a production building shows its **live build queue** in order with progress; (2) factories can be **upgraded** to build **more units in parallel** and **faster**; (3) the **Research Center** does real work — it researches **global upgrades** and **unlocks** the factory upgrades (today it only offers a Sell button); (4) every battlefield unit is **visually distinct** (today all infantry are identical circles and all vehicles identical boxes); (5) **Player 1 on keyboard** can fully drive the command panel — **place buildings, queue units, buy upgrades** — using the **number keys `1 2 3 4 5 6 7 8 9 0`**, fixing the "after selecting the builder nothing can be done" dead-end.

**Why this task (current defects, with file references):**
- **Queue is invisible.** `ui/hud.ts` shows only a count badge (`hud.ts` ~L161 `qbadge` = `prod.queue.length`); the radial progress it tries to update (`hud.ts` ~L146 `data-id="queueprog"`) and the `.cmd .radial` CSS in `styles.css` are **orphans — never rendered**. The player sees "3" but not *which* units, *what order*, or *how far along*. Production order is already correct FIFO in `sim/world.ts` `productionSystem()` (processes `queue[0]`, `shift()` on complete) — only the **display** is missing.
- **No upgrades at all.** There is **no** building-upgrade or parallel-production system anywhere (`grep upgrade` → comments only). `MAX_QUEUE = 8` (`constants.ts`) but only one unit builds at a time, always at ×1 speed (×0.5 only during brownout).
- **Research Center is dead.** `data.ts` `research_center` has **no `produces`, no effect, no upgrades**; selecting it falls through to the generic building panel that shows only **Sell** (`hud.ts` ~L178-180). It costs resources and power for nothing.
- **Units look identical.** `render/renderer.ts` `drawUnit()` draws only **3 shapes**: hero = star; any `isVehicle` = identical rectangle + turret line; everything else = identical filled circle. The per-unit emojis in `data.ts` are used **only on HUD buttons**, never on the map. So light/heavy tanks, artillery, rocket launcher and anti-air are indistinguishable, as are infantry/rocket-soldier/robot/engineer/miner.
- **Keyboard player can't build.** `input.ts` `onKeyP1()` binds only command (`Q`), select (`E`) and abilities (`Z/X/C/V`). There is **no key** to operate the build/train panel, so once Player 1 selects a miner the build menu appears but is **unreachable from the keyboard** — the reported "select the builder, then nothing can be selected/done" dead-end. (Selection itself works; the panel is simply keyboard-inaccessible.)

> Scope note: this task **builds on** the authoritative-sim model (§3.2) and the T24 keyboard/mouse split — it does **not** change the netcode or the split-screen input routing. All new commands flow through the existing `Command` union → host → `MatchHost`, so they work identically in single-player, split-screen, and LAN.

---

#### Part A — Live production queue in the panel (Generals-style)

**A1. Queue strip.** When a building whose def has `produces` is selected, the command panel renders, below the train buttons, a **horizontal queue strip** of up to `MAX_QUEUE` (8) slots in **FIFO order** (`queue[0]` leftmost = building now). Each slot shows the queued unit's **icon** (`UNIT_DEFS[unit].icon`). The **active** slot(s) (see Part B for parallel bays — by default just the first) overlay a **radial progress ring** driven by `item.progress` plus the **remaining seconds** (`Math.ceil((1-progress)*item.time)`), updated every frame in `updatePanel()`. **Wire the existing dead code**: create real `qslot` elements each containing a `.radial` child and set `--p` on them (delete or repurpose the orphan `queueprog` lookup).

**A2. Cancel from the strip.** Clicking a queue slot **cancels that item** by sending the already-implemented `{ t: "cancel", building, index }` (`world.ts` `cancelQueue` refunds 100% for a not-yet-started item, 50% for the in-progress head — keep). A small ✕ appears on hover; for keyboard players the number keys can also target slots (Part E, optional sub-mode). Cancelling re-indexes the strip.

**A3. Per-button queued counts.** Each **train button** shows a small count badge of how many of that unit are currently queued in the selected building (helps planning). Fix the `qbadge` CSS so it renders correctly on the button (it is currently styled for an absolutely-positioned badge on `.cmd` but applied to a static element in a row).

**A4. On-map production indicator.** Above each of the **local player's** producing buildings that has a non-empty queue, draw a thin **progress bar of the head item** (reuse the construction-bar renderer in `renderer.ts`), so production is visible on the battlefield without selecting — as in Generals. Dim/skip for fogged or enemy buildings (already fog-filtered by host).

**A5. Feedback.** Add toast **`toast.queueFull`** when a train is rejected because `queue.length >= MAX_QUEUE` (today it silently `return`s in `tryTrain`). Change the unit-ready toast to **name the unit** (new key `toast.unitReadyNamed` with `{unit}` param, e.g. "Light Tank ready") instead of the generic "Unit ready".

---

#### Part B — Factory upgrades: parallel bays + assembly speed

**B1. New per-building state.** Add to the building `Entity` (only meaningful for `produces` buildings): `bays: number` (default **1**, max **3**) and `speedLevel: number` (default **0**, max **2**). Persist through the existing entity serialization to clients (extend `protocol.ts` view of buildings so the panel can read them).

**B2. New command.** `{ t: "upgradeBuilding"; building: number; kind: "bay" | "speed" }`. Validated host-side in a new `tryUpgradeBuilding()`: building exists, owned by sender, is a producer, not at max level, **tech prerequisite met** (Part C: a built Research Center + the relevant Factory Tech), and the player can afford it; then pay and increment the level. Upgrades are **instant on purchase** (they are mechanical caps, not timed — timed work lives on the Research Center, Part C).

**B3. Costs (defaults — tunable in `constants.ts`).**
- Bay → 2 (`bays` 1→2): `{ gold: 1, iron: 15, silver: 60 }`, requires **Factory Tech I**.
- Bay → 3 (`bays` 2→3): `{ gold: 2, iron: 30, silver: 120 }`, requires **Factory Tech II**.
- Assembly Speed +1 (`speedLevel` 0→1, +25%): `{ iron: 10, silver: 50 }`, requires **Factory Tech I**.
- Assembly Speed +2 (`speedLevel` 1→2, +50% total): `{ gold: 1, iron: 20, silver: 100 }`, requires **Factory Tech II**.

**B4. Parallel production.** In `productionSystem()`, for a producing building advance the **first `bays` items** of the queue **simultaneously**, each with its own `progress`; when any reaches `1`, spawn it (`spawnTrained`) and remove it, then the next queued item starts in the freed bay on the following ticks. With `bays = 1` behaviour is identical to today. The queue strip (A1) highlights the **first `bays` slots** as in-progress, each with its own ring.

**B5. Assembly speed.** Multiply each in-progress item's per-tick progress by `(1 + 0.25 * speedLevel)` (so ×1.0 / ×1.25 / ×1.5), composed with the existing brownout ×0.5. Define `ASSEMBLY_SPEED_PER_LEVEL = 0.25` and `MAX_BAYS = 3`, `MAX_SPEED_LEVEL = 2` in `constants.ts`.

**B6. Panel.** A producing building's panel adds two **upgrade buttons**: "Production Bay (`bays`/3)" and "Assembly Speed (+`25*speedLevel`%)", each showing **cost** and **current level**, **disabled** (greyed, with reason tooltip) when maxed, unaffordable, or the required Factory Tech is missing. Keyboard players trigger them with the number keys (Part E).

---

#### Part C — Research Center: global tech that powers everything

**C1. Purpose.** The Research Center becomes the **tech building**: it runs **timed research** of **one-time global upgrades**, and it **unlocks** the factory upgrades in Part B. This gives it a real role and a reason to defend it.

**C2. New player state.** Add `research: { weapons: number; armor: number; factoryTech: number; logistics: boolean }` to `PlayerState` (levels start at 0 / false). Add to the Research Center `Entity` an active slot `researching: { id: string; progress: number; time: number } | null`.

**C3. Research catalog (defaults — tunable).** Each is **one-time**, has a **cost** (paid on start) and a **research time** (progress shown as a bar on the building, like construction). Only **one** research runs per Research Center at a time; **multiple** Research Centers run in parallel; a research already owned/in-progress for the player is hidden/disabled.
- **Weapons I** — +15% damage for all of the player's units. Cost `{ gold: 1, iron: 10, silver: 40 }`, time **25 s**.
- **Weapons II** — +15% more (×1.30 total). Requires Weapons I. Cost `{ gold: 2, iron: 20, silver: 80 }`, time **35 s**.
- **Armor I** — +15% effective HP for all of the player's units (apply as incoming-damage ×1/1.15). Cost `{ gold: 1, iron: 12, silver: 40 }`, time **25 s**.
- **Armor II** — +15% more. Requires Armor I. Cost `{ gold: 2, iron: 24, silver: 80 }`, time **35 s**.
- **Factory Tech I** — unlocks Bay→2 and Speed+1 (Part B). Cost `{ gold: 1, iron: 15, silver: 50 }`, time **30 s**.
- **Factory Tech II** — unlocks Bay→3 and Speed+2. Requires Factory Tech I. Cost `{ gold: 3, iron: 30, silver: 100 }`, time **45 s**.
- **Logistics** — −20% unit build time for all production. Cost `{ gold: 1, iron: 10, silver: 60 }`, time **30 s**.

**C4. New commands.** `{ t: "research"; building: number; id: string }` (start) and `{ t: "cancelResearch"; building: number }` (abort, refund 50% of remaining like in-progress cancel). Host validates prerequisite, affordability, and that the slot is free.

**C5. Apply effects.**
- **Damage:** in the damage calculation (`combatSystem` / `applyDamage`), multiply the attacker's outgoing damage by `1 + 0.15 * attackerOwner.research.weapons`.
- **Armor:** divide incoming damage by `1 + 0.15 * defenderOwner.research.armor`. (Applies to **all** of the player's units retroactively, not only new ones — it is computed at hit time.)
- **Logistics:** when queuing a unit (`tryTrain`), set `time = ud.buildTime * (research.logistics ? 0.8 : 1)`.
- **Factory Tech:** gate the Part B upgrades on `research.factoryTech >= 1` (Bay→2 / Speed+1) and `>= 2` (Bay→3 / Speed+2).

**C6. Panel.** Selecting a Research Center shows a **Research panel** (replacing the bare Sell view): the catalog as buttons with cost, time, level/owned state, prerequisite-locked state, plus a Sell button. While researching, show the **active research name + progress bar + remaining seconds** and a **Cancel** button. The building also draws a research progress bar on the map (like construction).

---

#### Part D — Distinct unit visuals

**D1. Per-type silhouettes.** Rework `renderer.ts` `drawUnit()` into a **per-unit-type** draw with a distinct, readable vector silhouette (team-coloured fill, dark outline, rank pip kept). Each unit must be recognisable at default zoom and stay crisp when zoomed. Required distinctions:
- **miner** — rounded square body with a small **pick/▲ hopper** glyph; muted tint (non-combat).
- **engineer** — circle with a **wrench/✚** emblem; lighter accent ring.
- **infantry** — small circle + single **rifle line** (current infantry look becomes infantry-specific).
- **rocket_soldier** — circle + **angled launcher tube** (thicker, offset) distinct from the rifle line.
- **robot** — bulkier circle with a **square core + two antennae/eyes**; visibly heavier than infantry.
- **light_tank** — small box + **thin single barrel**.
- **heavy_tank** — larger box + **thick/double barrel** and a hull skirt.
- **artillery** — box + **long thin barrel** with a recoil notch; slightly longer chassis.
- **rocket_launcher** — box + **boxy pod rack** (several short tubes) instead of a barrel.
- **anti_air** — box + **twin short barrels angled up** / small radar dish.
- **hero** — keep the star + aura.
Armed units keep the turret/barrel pointing at `turret`; vehicles rotate the chassis by `facing` (as today).

**D2. Optional type glyph.** Optionally overlay the unit's emoji (`UNIT_DEFS[type].icon`) at small scale above the silhouette for instant identification, matching how buildings draw their icon. If used, gate behind a zoom threshold to avoid clutter when far out.

**D3. Performance & correctness.** No per-frame allocations; reuse the existing `ctx.save/translate/rotate` pattern. Factor the shape selection into a pure helper (e.g. `unitShape(type)` returning a small descriptor) so it is **unit-testable** (each of the 11 types maps to a **distinct** descriptor) and so colour-blind-safe shape cues do not rely on colour alone.

---

#### Part E — Keyboard command-panel control (Player 1) + builder fix

**E1. Number keys drive the panel.** For the **keyboard control scheme** (`p1-keyboard`), bind the digit keys **`1 2 3 4 5 6 7 8 9 0`** to **activate command-panel grid buttons #1..#10** (`0` = the 10th), in the panel's visible order. Activating a button does exactly what a mouse click does:
- a **build** button → enter placing mode for that building (Player 1 then positions with the **virtual cursor** and confirms with the **command key `Q`** at the cursor — already implemented in `commandAtCursor`/`placeBuilding`);
- a **train** button → queue that unit in the selected building;
- an **upgrade / research** button → purchase / start it.
This makes the build menu fully operable from the keyboard and **resolves the "builder selected → nothing happens" dead-end**.

**E2. Category switching.** Because the miner build menu has tabs (economy / military / defense / tech) and more than 10 actions can exist across them, add **`nextTab` / `prevTab`** bindings for the keyboard scheme (defaults **`Tab`** / **`Shift+Tab`**, or `]` / `[`) that cycle the build categories; the number keys then map to the **currently shown** grid. The panel shows small **number badges (1–0)** on each button **when a keyboard player is active**.

**E3. No conflicts with control groups.** In **single-player** the digits `0–9` remain **control-group recall** and **Ctrl+0–9** set groups (unchanged, `input.ts onKeySingle`). The number→panel mapping is active **only** in `p1-keyboard` (which does not use control groups), so there is no clash. Document this in the Settings → Keyboard help text.

**E4. Bindings, persistence, i18n.** Add the new keys to the key-binding store (`ui/keyBindings.ts`) under the **p1** group: `panel1`..`panel0` (or a single digit→index handler) plus `nextTab` / `prevTab`, each with defaults, **conflict detection**, **localStorage persistence**, **reset-to-defaults**, and **trilingual** action names in the Settings → Keyboard screen (per T24's system).

**E5. Builder robustness.** Verify (and add a test) that selecting a builder via the keyboard cursor keeps the selection, opens the correct build panel, and that a subsequent number-key press enters placing mode; pressing **Esc** cancels placing (already in `onKey`). Ensure the same flow works in single-player with the mouse (clicking the build button) — no regression.

---

#### Cross-cutting

**i18n.** Add every new user-facing string in **uz/ru/en** with correct Uzbek orthography (U+02BB `ʻ`, U+02BC `ʼ`): upgrade button labels ("Production Bay", "Assembly Speed"), research names + descriptions, `toast.queueFull`, `toast.unitReadyNamed`, "Research", "Cancel", "Researching…", number-key action names, and any tooltips. `localeParity()` must stay green.

**Tests (headless, dependency-free, in `test/`).** Add/extend suites and keep all existing ones green:
- **production**: with `bays = 2`, two queued units progress in parallel and both spawn ~together; `speedLevel = 2` completes a unit in ~⅔ the ticks; cancel from index 1 refunds 100% and re-indexes; queuing past `MAX_QUEUE` emits `toast.queueFull`.
- **research**: starting Weapons I deducts cost and, after its research time, raises `research.weapons`; an attack then deals +15% damage; Armor I reduces incoming damage; Logistics shortens `tryTrain` time; Factory Tech gates `upgradeBuilding`.
- **visuals**: `unitShape(type)` returns a **distinct** descriptor for each of the 11 unit types (no two equal).
- **keyboard**: simulate `p1-keyboard`, select a miner, press `2` → placing mode for the 2nd build button; press the command key at the cursor → a `build` command is sent; in single-player the same digit still recalls a control group (no panel activation).

**Docs.** On implementation, add a **T26 section to `PROGRESS.md`** in the T24/T25 style (Scope checklist, "How each DoD line was verified", "[OPT] deferred"), and update `README.md` (factory upgrades, Research Center tech tree, keyboard build keys).

### Scope checklist (T26)
- [ ] Selecting a producing building shows a **live FIFO queue strip** with per-slot icons, a **progress ring + remaining seconds** on the active slot(s), and **click-to-cancel**; the orphan `queueprog`/`.radial` code is wired (or replaced). Per-button queued counts render correctly.
- [ ] An **on-map progress bar** shows over the local player's producing buildings; **`toast.queueFull`** fires at the cap and the ready toast **names the unit**.
- [ ] Factories can buy **Production Bay** (1→2→3 parallel) and **Assembly Speed** (+25% / +50%); parallel bays build multiple units at once and speed scales the rate (composing with brownout).
- [ ] The **Research Center** has a working **Research panel** that runs **timed** global upgrades (Weapons I/II, Armor I/II, Factory Tech I/II, Logistics) with progress + cancel; effects apply (damage, armor, build-time) and **Factory Tech gates** the Part B upgrades.
- [ ] Every **unit type is visually distinct** on the map (11 silhouettes), via a unit-testable `unitShape()` helper; rank pips and turrets preserved; no per-frame allocations.
- [ ] **Player 1 (keyboard)** can **place buildings, queue units, and buy upgrades** using **`1`–`0`**, with **`Tab`/`Shift+Tab`** (or `]`/`[`) to switch build categories and **number badges** shown on panel buttons; this **fixes the builder dead-end**.
- [ ] Digit keys do **not** clash with single-player control groups; all new bindings are **remappable, persisted, conflict-checked, trilingual** (T24 system).
- [ ] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography); `localeParity()` passes.
- [ ] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen (T24), and LAN (T25) regress cleanly.

DoD: in a match, clicking a **Barracks** or **War Factory** shows the units it is building **in order**, each with a **progress ring and countdown**, and clicking a slot **cancels** it (with refund). The factory can be **upgraded** to build **2 then 3 units at once** and to build **faster**, with the **Research Center** running **timed researches** that **unlock those upgrades** and **buff the army** (more damage, more armor, faster builds) — selecting the Research Center shows these options instead of only a Sell button. On the battlefield **each unit type looks different** (tanks vs artillery vs rocket launcher vs anti-air; infantry vs rocket-soldier vs robot vs engineer vs miner). **Player 1 using only the keyboard** can build a factory and queue units by pressing **`1`–`0`** (with `Tab` to change build categories), so selecting the builder is no longer a dead-end. Verifiable headlessly: parallel-bay and speed math, research effects on damage/armor/build-time, `unitShape()` uniqueness, and the keyboard-number → panel-activation path all pass; `bash build.sh` is clean and every test suite is green; all UI reads correctly in uz/ru/en.

---

### T27 — Keyboard build-category navigation (Space+select) & tidy on-screen status indicators  *(Player-1 keyboard UX + clutter-free HUD overlays)*

**Goal:** finish making **Player 1 fully playable on the keyboard** and make the battlefield **read cleanly like C&C Generals / Dota**. Two concrete fixes: (1) when Player 1 has a **builder selected** and the build menu is open, they can **switch between the category sections** (economy / military / defense / tech) entirely from the keyboard — **press the switch key (default `Space`) to move across the categories, then press the select key (`E`) to open the highlighted category** — and that switch key is **remappable in Settings**; (2) the **world-space status indicators** that currently float over units and buildings — **rank/level pips, hero & tower HP bars, and super-ability / super-weapon timers** — are **overlapping each other in a disorderly way and clutter the main view**, so they must be **arranged into a fixed, non-overlapping layout** (and persistent status moved into dedicated HUD zones) that **does not obstruct the battlefield**, as in Generals/Dota.

**Why this task (current defects, with file references):**
- **Keyboard category switching is undiscoverable / not working for the player.** T26 added `nextTab` / `prevTab` (defaults `]` / `[`) in `ui/keyBindings.ts` (p1 group) → `input.ts onKeyP1()` → `hud.ts cycleBuildTab()`. In practice a keyboard player who selects a miner sees the tabbed build menu but cannot intuitively change tabs — the reported bug: *"select the builder, then try to go to the **military** section and it will not switch."* So every building outside the default **economy** tab (barracks, war factory, defenses, tech) is effectively unreachable from the keyboard. The intended, discoverable flow is **`Space` to move a focus highlight across the category tabs, then `E` (the existing p1 `select`) to open the focused tab** — and the switch key must be **user-remappable**.
- **On-screen indicators overlap and clutter the view.** In `render/renderer.ts` the world-space overlays are drawn at hard-coded, **colliding** offsets: `drawHpBar()` sits just above the entity, while the construction bar, the brownout marker, the T26 **production head-item bar** and the **research bar** are all drawn at `y - 7`, and the rank pip text at `y - r - 2`. When an entity is in several states at once (a low-HP factory that is also producing; a **hero** with HP **+ level + ability cooldowns + buff aura**; a **tower/defensive building** firing while damaged), these stack on top of one another and smear across the screen. Persistent status (hero HP/level/ability cooldowns, banner / super-ability timers) **floats over the battlefield** instead of living in a tidy HUD zone. The result is the "disordered indicators piling on top of each other" the player describes.

> Scope note: this task is **UI/UX only**. It does **not** change the authoritative simulation (§3.2), the `Command` union, the netcode, or the T23/T24 split-screen input routing / per-side customizable HUD — it refines **input handling** (`input.ts`, `keyBindings.ts`, `hud.ts`) and **rendering/HUD layout** (`renderer.ts`, `ui/hud.ts`, `ui/hudLayout.ts`). It must regress cleanly in single-player, split-screen (T24) and LAN (T25).

---

#### Part A — Keyboard build-category navigation: `Space` to move, `E` to open (remappable)

**A1. Category-focus mode.** While a **tabbed build panel** is open for a keyboard player (`p1-keyboard`, miner/engineer selected so the economy/military/defense/tech tabs show), pressing the new **`cycleCategory`** key (**default `Space`**) enters/advances **category-focus**: a focus highlight moves to the **next** tab each press, wrapping around. Focus only **previews** the tab (moves the highlight) — it does **not** yet change the buttons shown in the grid.

**A2. Confirm with the select key.** Pressing the existing p1 **`select`** key (**`E`**) while a tab is focused **opens** that category — it becomes the **active build category**, its buildings populate the grid, and category-focus mode exits. The number keys `1`–`0` (T26 Part E) then build from the now-active category. `Esc` exits category-focus without changing the active tab. With **no** active focus, `E` keeps its current meaning (select the unit/building under the virtual cursor) — define the precedence explicitly so there is no ambiguity.

**A3. Remappable switch key.** Add **`cycleCategory`** to the **p1** group of `ui/keyBindings.ts` with **default `Space`**, full **conflict detection** (within the p1 context), **localStorage persistence**, **reset-to-defaults**, and a **trilingual** action label in the **Settings → Keyboard** screen (per the T24 binding system). Keep the T26 `nextTab` / `prevTab` (`]` / `[`) as an optional **direct-cycle** shortcut, but the `Space`-focus-then-`E`-confirm flow is the **primary, documented** path.

**A4. Visible focus cue.** The **focused** (not-yet-opened) tab shows a distinct **focus outline/glow** that is clearly different from the **active** tab style, so the player can see where the focus is before confirming. The existing T26 number badges (1–0) on the grid buttons remain when a keyboard player is active. Update the **Settings → Keyboard help text** to describe: *"Builder selected → `Space` moves across build categories, `E` opens the highlighted one."*

**A5. Robustness / no regression.** Selecting a builder with the keyboard keeps the selection and opens the correct panel; the `Space`→`E` flow reaches **every** category and is followed by a working `1`–`0` build. In **single-player / mouse**, clicking a category tab still switches it (unchanged), and `Space`/`E` cause no control-group or selection regressions. Add a headless test for the focus→confirm→build path (Part Cross-cutting).

---

#### Part B — Tidy, non-overlapping on-screen status indicators (Generals/Dota-style)

**B1. One ordered overlay stack per entity.** Replace the scattered hard-coded offsets in `renderer.ts` with a **single layout helper** (e.g. `entityOverlayLayout(entity, radius)`) that returns **fixed, non-overlapping vertical slots** so overlays never collide. Canonical order (top → bottom), each with consistent spacing:
1. **rank / level pip** (veterancy chevrons / hero level) — a small fixed badge in a consistent corner;
2. **HP bar** (unit / hero / tower) — one row;
3. **one secondary bar slot** for the current state — **construction *or* production head-item *or* research** (these are mutually exclusive per entity) drawn in the **same** reserved row, never stacked on the HP bar;
4. **status icons** (brownout, buff, etc.) — a small icon row.
Centralize all offset math here; remove the colliding `y - 7` literals so a producing **and** low-HP **and** ranked building shows a clean, ordered stack.

**B2. Show-only-when-relevant (declutter).** Adopt a single visibility rule like Generals/Dota: per-entity HP bars are shown for entities that are **selected, hovered, recently damaged, or below a HP threshold**, plus always for the **local player's hero** and key buildings — **not** permanently for every unit on the map. This keeps the battlefield clean while keeping important info available.

**B3. Hero status → fixed HUD cluster.** Move the **hero's** persistent status (HP, **level / XP**, and **ability cooldowns**) out of the floating world-space overlays into a **dedicated HUD cluster** (hero portrait/status block with ability icons showing **cooldown sweeps** and remaining seconds), anchored per the **T23/T24 per-side customizable HUD** (so each split-screen player's hero status sits on their own side and never bleeds across the divider). Only a minimal HP bar + level pip remains over the hero on the map.

**B4. Super-ability / super-weapon timers → dedicated corner.** Any **super abilities / super-weapon / global power timers** (hero ultimate, banner/global powers) render as a compact **corner indicator row** with countdowns and ready-flash — **not** floating over the casting unit — matching the Generals/Dota "global powers" strip.

**B5. Split-screen & performance correctness.** All overlays clip to their **own viewport half** and use that player's HUD anchors (no cross-divider bleed); respect `reduceMotion` / quality settings; **no per-frame allocations** (reuse the existing `ctx.save/translate/rotate` pattern and the layout helper's returned values). Towers/defensive buildings use the same ordered overlay (HP + consistent level pip) as everything else.

---

#### Cross-cutting

**i18n.** Add every new user-facing string in **uz/ru/en** with correct Uzbek orthography (U+02BB `ʻ`, U+02BC `ʼ`): the `cycleCategory` action label, the Settings keyboard help line for the `Space`→`E` flow, and any new ability / super-timer labels. `localeParity()` must stay green; no hard-coded strings.

**Tests (headless, dependency-free, in `test/`).** Add/extend suites and keep all existing ones green:
- **keyboard category nav**: in `p1-keyboard` with a miner selected, pressing `cycleCategory` (Space) advances the focused tab (wrapping) without changing the active tab; pressing `select` (E) opens the focused tab (active category changes) and exits focus; a subsequent `1`–`0` builds from the new category; `Esc` cancels focus; the binding is remappable + conflict-checked (extend `keybindings`/`kbinput`).
- **overlay layout**: `entityOverlayLayout()` returns **non-overlapping** slots (HP bar, secondary bar, and pip occupy distinct, ordered offsets) for an entity in multiple simultaneous states; the secondary-bar slot is shared by construction/production/research (never doubled).

**Docs.** On implementation, add a **T27 section to `PROGRESS.md`** in the T24/T25/T26 style (Scope checklist, "How each DoD line was verified", "[OPT] deferred"), and update `README.md` (keyboard build-category navigation: `Space` to move, `E` to open, remappable; and the tidied HUD/indicator layout).

### Scope checklist (T27)
- [ ] With a builder selected, a **keyboard** Player 1 can press the **switch key (default `Space`)** to move a **focus highlight** across the build categories and the **select key (`E`)** to **open** the highlighted category; `1`–`0` then build from it. The military/defense/tech sections are reachable — the "won't switch" dead-end is fixed.
- [ ] The category **switch key is remappable** in Settings → Keyboard (default `Space`), with conflict detection, persistence, reset, and a **trilingual** label; the help text documents the `Space`→`E` flow.
- [ ] World-space overlays (**rank/level pip, HP bar, construction/production/research bar, status icons**) are laid out by a **single ordered helper** with **fixed, non-overlapping** slots — no more colliding `y - 7` draws.
- [ ] HP bars follow a **show-when-relevant** rule (selected/hovered/damaged/low-HP + local hero/key buildings), keeping the map uncluttered.
- [ ] **Hero status** (HP, level/XP, ability cooldowns) and **super-ability / super-weapon timers** live in **dedicated, fixed HUD zones** (per-side, T23/T24-compatible), not floating over the battlefield.
- [ ] Overlays clip to each split-screen half (no bleed), respect reduce-motion/quality, and add **no per-frame allocations**.
- [ ] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography); `localeParity()` passes.
- [ ] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen (T24) and LAN (T25) regress cleanly.

DoD: in a match, **Player 1 using only the keyboard** selects a miner, presses **`Space`** to move across the **economy → military → defense → tech** categories, presses **`E`** to open the one they want, and presses **`1`–`0`** to build from it — selecting the builder is no longer a dead-end, and the switch key can be changed in **Settings → Keyboard**. On the battlefield the **status indicators are tidy**: each unit/building shows a clean, ordered stack (level pip, HP bar, and a single construction/production/research bar) with **nothing overlapping**, HP bars appear only when relevant, and the **hero status and super-ability/super-weapon timers** sit in their own **fixed HUD zones** that **do not obstruct the main view** — the Generals/Dota-style clean readout. Verifiable headlessly: the `Space`-focus → `E`-confirm → `1`–`0` build path and the non-overlapping `entityOverlayLayout()` slots both pass; `bash build.sh` is clean and every test suite is green; all UI reads correctly in uz/ru/en.

---

### T28 — Hero panel on-select, power gating & low-power warning, keyboard zoom, and a tidy hero/level HUD cluster  *(HUD + economy fixes)*

**Goal:** four concrete fixes reported in play: (1) the **hero's "super" abilities** must appear **only when the hero is selected** — right now the hero ability bar is shown by **default** all the time; (2) fix the **power/energy** bug — buildings get constructed even with **no spare power**; instead, once power usage passes **90%** of generation a **"LOW POWER" warning** must show, and trying to place a **power-consuming** building that there isn't enough power for must be **rejected** ("not enough power") rather than built; (3) give **Player 1 (keyboard)** **zoom in / zoom out** so they can see the map closer or farther — **default `Shift` = zoom in, `Ctrl` = zoom out**, both **remappable in Settings**; (4) **reposition the level indicator** — today the `★ Lvl` badge **overlaps the command-panel buttons** (see the reported screenshot: `★ Lvl 1` sitting on top of the Stop / Hold / Attack-Move buttons). The on-map level pip over the hero stays as-is (good); the **HUD** must **not** show the floating/overlapping level badge by default — instead, when the **hero is selected**, the hero's **level + abilities** appear **neatly inside the command-panel area**, slightly nicer, with the super abilities arranged tidily in the same place. **This applies to all players** (single-player, split-screen P1 & P2, and LAN).

**Why this task (current defects, with file references):**
- **Hero ability bar is always visible.** `ui/hud.ts` creates the `herobar` widget (`<div class="herobar hud-widget" data-widget="hero">`) in `build()` and `updateHeroBar()` populates it **every frame regardless of selection**, so the hero portrait + ability icons (`ABILITY_ICONS`) are on screen even when the hero isn't selected. It should be shown **only when the hero is in the current selection**.
- **No power gate on construction.** `sim/world.ts tryBuild()` validates **cost** (`canAfford`), **prerequisite** (`def.requires`) and **placement** (`placementValid`), but **never checks power**. A power-consuming building can be started with zero headroom. The "LOW POWER" banner (`hud.lowPower`, toggled in `ui/hud.ts updateHud()` from `p.brownout`) only lights up once usage **already exceeds** generation (full brownout), not at the **90%** threshold the player expects. There is no per-build "not enough power" rejection.
- **Keyboard player can't zoom.** `input.ts acceptsWheel()` returns false for `control === "p1-keyboard"`, so only the mouse wheel zooms `renderer.cam.zoom`. The keyboard player has **no** way to zoom the map.
- **Level badge overlaps the command panel.** `ui/hud.ts updateHeroBar()` and `updateSelInfo()` render a `★ Lvl {n}` badge (`.lvl` / the `extra` block); positioned with the HUD widgets it **overlaps** the command-panel buttons (the reported screenshot shows `★ Lvl 1` over the Stop/Hold/Attack-Move row). The on-map hero level pip (`render/renderer.ts drawUnit`, the `★level` drawn at the pip slot from T27) is correct and should stay.

> Scope note: like T27 this is **UI/UX + a small economy rule**. The power **gate** is an authoritative-sim check inside `tryBuild` (so it holds in single-player, split-screen and LAN identically); everything else is client HUD/input. Do **not** change the netcode or the T23/T24 split-screen input routing beyond adding the new keyboard bindings and the build-time power check. Regress cleanly in single-player, split-screen (T24) and LAN (T25).

---

#### Part A — Hero "super" abilities panel only when the hero is selected

**A1.** The hero ability bar (the `herobar` widget driven by `updateHeroBar()`) is **hidden** whenever the hero is **not** in the current selection, and shown only when the selection includes the player's hero. When hidden it must not occupy/overlap layout space (`display:none`, not just empty).
**A2.** It still updates live (HP, mana, ability cooldowns, level) while shown. Selecting the hero (by click, double-click, control-group, or the keyboard cursor) reveals it; deselecting hides it again.
**A3.** The on-map hero (HP bar, mana, `★level` pip from T27) is **unchanged** — only the always-on HUD ability panel is gated by selection.

#### Part B — Power gating on construction + 90% low-power warning

**B1. Low-power warning at 90%.** Show the **"LOW POWER"** banner (`hud.lowPower`) and the deficit styling once **power usage ≥ 90% of generation** (i.e. `powerUse >= 0.9 * powerGen`), not only at full brownout. Keep a distinct, stronger state for an actual deficit/brownout (`powerUse > powerGen`) — the existing production slow-down (`BROWNOUT_PRODUCTION_MULT`) is unchanged.
**B2. Reject under-powered builds.** In `world.ts tryBuild()`, after the cost/prereq/placement checks, if the building **consumes** power and starting it would push **total usage above generation** (no spare headroom — e.g. gen 10, used 9, new build needs 2 → would be 11 > 10), **reject** the build with a new `errors.needPower` danger toast and **do not** construct or charge for it. Power-**producing** buildings (power plant, etc.) are never blocked by this. (Power-neutral buildings are unaffected.)
**B3.** The check must be authoritative (in the sim, host-side) so it behaves identically in single-player, split-screen and LAN; the client may additionally grey/annotate the build button, but the sim is the source of truth.

#### Part C — Player-1 keyboard zoom in / out (remappable)

**C1.** Add two **remappable** bindings to the **p1** group of `ui/keyBindings.ts`: **`zoomIn` (default `Shift`)** and **`zoomOut` (default `Ctrl`)**, each with `ACTION_DEFS` entries, conflict detection, persistence, reset, and **trilingual** labels in **Settings → Keyboard**.
**C2.** In `input.ts`, the keyboard player zooms `renderer.cam.zoom` in/out (held-to-zoom or per-press step) within sensible **min/max** bounds, re-clamping the camera (`clampCam`) and keeping the view centred sensibly. This works for the `p1-keyboard` control scheme (which the mouse wheel ignores).
**C3.** No clash: `p1-keyboard` has no control groups, so `Shift`/`Ctrl` are free there; the mouse player's wheel-zoom and Player 2's input are unaffected. Update the in-game help / Settings text to mention keyboard zoom.

#### Part D — Tidy hero/level HUD cluster in the command-panel area (all players)

**D1.** Remove the **floating/overlapping** `★ Lvl` badge from the default HUD so it never sits on top of the command-panel buttons (the reported screenshot bug). The on-map hero level pip stays.
**D2.** When the **hero is selected**, present the hero's **level + abilities** **inside the command-panel area** (the same zone as the Stop/Hold/Attack-Move and build/train controls), **neatly laid out** (a small hero header with `★ Lvl n`, HP/mana, and the ability icons with cooldowns) — no overlap with other panel content, slightly nicer styling than today.
**D3.** This hero cluster is shown **only on hero selection** (consistent with Part A) and works the **same for all players**: single-player, both split-screen sides (using each side's HUD anchors, no cross-divider bleed — T23/T24), and LAN.
**D4.** Selection-info for non-hero units keeps its own tidy level/rank display without overlapping the command buttons.

---

#### Cross-cutting

**i18n.** Add every new user-facing string in **uz/ru/en** with correct Uzbek orthography (U+02BB `ʻ`, U+02BC `ʼ`): `errors.needPower`, the `zoomIn` / `zoomOut` action labels, and any updated low-power / help text. `localeParity()` must stay green; no hard-coded strings.

**Tests (headless, dependency-free, in `test/`).** Add/extend suites and keep all existing green:
- **power gate**: a power-consuming build is **rejected** (no spawn, no charge, `errors.needPower` emitted) when usage would exceed generation, and **allowed** when there is headroom; a power-**producing** building is never blocked; the 90%-usage state is reported (low-power) distinctly from a full deficit.
- **keyboard zoom**: `zoomIn` / `zoomOut` defaults are `shift` / `ctrl`, are conflict-checked/persisted, and pressing them changes `cam.zoom` within bounds for the keyboard player (extend `keybindings` / `kbinput`).
- **hero panel visibility**: the hero ability cluster is hidden with no hero selected and shown when the hero is selected (logic-level test of the visibility predicate).

**Docs.** On implementation, add a **T28 section to `PROGRESS.md`** in the T24–T27 style (Scope checklist, "How each DoD line was verified", "[OPT] deferred"), and update `README.md` (hero panel appears on selection; power rule + low-power warning; keyboard zoom keys `Shift`/`Ctrl`, remappable).

### Scope checklist (T28)
- [ ] The hero's ability ("super") panel is shown **only when the hero is selected**, hidden (no layout footprint) otherwise; it still updates live while shown.
- [ ] A **"LOW POWER"** warning appears once power usage **≥ 90%** of generation; a full deficit remains a distinct (stronger) state with the existing brownout slow-down.
- [ ] Building a **power-consuming** structure with **insufficient power** is **rejected** with an `errors.needPower` toast (authoritative, in `tryBuild`) — not constructed and not charged; power producers are never blocked.
- [ ] **Player 1 (keyboard)** can **zoom in/out** the map; defaults **`Shift`** (in) / **`Ctrl`** (out), **remappable** in Settings (conflict-checked, persisted, trilingual), within clamped bounds.
- [ ] The **`★ Lvl` badge no longer overlaps** the command panel; the on-map hero level pip is unchanged; when the hero is selected its **level + abilities** appear **neatly in the command-panel area** for **all players** (single, split P1/P2, LAN), split-screen-safe.
- [ ] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography); `localeParity()` passes.
- [ ] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen (T24) and LAN (T25) regress cleanly.

DoD: in a match, the **hero ability panel is hidden** until the hero is selected, then appears **tidily in the command-panel area** (with `★ Lvl`, HP/mana and abilities) with **no overlap** on the Stop/Hold/Attack-Move / build controls — for **every** player; the **on-map** hero level pip is unchanged. The **power economy is honest**: at **≥ 90%** usage a **LOW POWER** warning shows, and a power-hungry building that there isn't enough power for is **refused** ("not enough power") instead of silently building, while power plants always build. **Player 1 on the keyboard** can **zoom in with `Shift` and out with `Ctrl`** (remappable). Verifiable headlessly: the `tryBuild` power gate (reject/allow + toast), the `zoomIn`/`zoomOut` bindings + `cam.zoom` change, and the hero-panel visibility predicate all pass; `bash build.sh` is clean and every suite is green; all UI reads correctly in uz/ru/en.

---

### T29 — Unobstructed placement, cancel-build, mine extraction countdown & resource mine emblems  *(build-flow & economy readability)*

**Goal:** three readability fixes reported in play (see the reported screenshot: the **MINER — BUILD** panel, the selection panel and the minimap cover a large part of the battlefield while placing a building): (1) when the player has **picked something to build** and is choosing where to put it, the **HUD panels that cover the map must hide** so the placement is unobstructed — and there must be a clear **Cancel-build** control to back out of placement (today you can only press Esc / right-click, which a touch or keyboard player can't discover); (2) when a **resource mine is selected**, show **how long until the next unit of metal is extracted** (a countdown / progress to the next `+1`), so the player can see their income cadence; (3) give each resource mine a **distinct resource-coloured emblem** — **gold** on the Gold Mine, **silver** on the Silver Mine (and **iron** on the Iron Mine) — both **on the map** and on the **build-menu button**, so the three mines are instantly tellable apart (today they are near-identical grey icons).

**Why this task (current defects, with file references):**
- **Build panels cover the map.** `ui/hud.ts` keeps the `cmdpanel`, `selinfo`, `herobar` and `minimap-wrap` widgets visible at all times; while `render/renderer.ts drawPlacement()` shows the placement ghost (driven by `r.placing`), those panels still occupy the lower third of the screen, so the player can't see where they're dropping the building (the reported screenshot).
- **Cancelling placement is hidden.** Placement is only cancelled via Esc or right-click (`input.ts` — `this.r.placing = null` in `onKey`/`onRightClick`). There is **no on-screen Cancel button**, so a touch player (T23) or a keyboard player (T24) has no discoverable way to abort a build they started.
- **No income cadence feedback.** `sim/world.ts economySystem()` accumulates `resAccum` per mine and emits `+1` every `MINER_OUTPUT_INTERVAL` (silver, scaled by `minerSlots`), `IRON_INTERVAL` (iron) or `GOLD_INTERVAL` (gold); selecting a mine shows only its HP — the player can't see **time-to-next-extraction**.
- **Mines look alike.** `render/renderer.ts drawBuilding()` draws each building's generic `def.icon`; the Silver / Iron / Gold mines read as similar grey tiles on the map (and similar buttons in `ui/hud.ts buildBtn()`), so it's hard to tell which mine is which at a glance.

> Scope note: **UI/UX + a read-only economy readout**. Exposing the mine countdown is a snapshot-only addition (host computes ETA for the owner's own mines, like the existing per-building queue data); it does **not** change the simulation, the `Command` union, the netcode, or the T23/T24 split-screen routing. Regress cleanly in single-player, split-screen (T24) and LAN (T25).

---

#### Part A — Unobstructed placement + a Cancel-build control

**A1. Hide map-covering panels while placing.** Whenever placement mode is active (`r.placing` set — the player picked a building to position), **hide** the HUD widgets that cover the battlefield (`cmdpanel`, `selinfo`, `herobar`; keep the small top resource bar). Restore them the instant placement ends (placed, cancelled, or Esc). This must work for every control scheme (mouse, touch P1/P2, keyboard P1).
**A2. Cancel-build control.** Show a clearly-labelled **Cancel** button (`cmd.cancelBuild`) during placement that aborts it (calls `input.setPlacing(null)`), in addition to the existing Esc / right-click. It must be reachable by **touch and keyboard** players (e.g. a small floating "Cancel build" button near the placement ghost or a fixed corner button), and the keyboard player can also cancel with their existing cancel key. After cancelling, the panels from A1 reappear.
**A3. No bleed / split-safe.** Hiding/showing applies per-HUD-instance (each split-screen side independently), so Player 1 entering placement does not blank Player 2's panels.

#### Part B — Mine extraction countdown

**B1. Expose ETA.** For the **local player's own** resource mines (`silver_mine`, `iron_mine`, `gold_mine`, and the captured `oil_derrick`), the host adds the **seconds-to-next-output** to the entity snapshot (computed from `resAccum` and the relevant interval — for silver, accounting for `minerSlots`; a mine with no active miners reports "idle"). Enemy mines are fog-filtered as today.
**B2. Show it on select.** When such a mine is selected, the selection panel shows a **countdown to the next `+1`** (a small "next in {n}s" line and/or a progress ring), plus which resource it yields. An idle silver mine (no miners assigned) shows an "idle / assign miners" hint instead of a countdown.
**B3.** Optional on-map cue: a thin progress ring over the selected own mine showing fill toward the next unit (consistent with the T26/T27 overlay layout, no overlap).

#### Part C — Resource-coloured mine emblems

**C1. On the map.** `render/renderer.ts drawBuilding()` draws a **resource-coloured emblem** for each mine type so they're unmistakable: **silver** (bright silver/white) for the Silver Mine, **gold** (yellow) for the Gold Mine, **iron** (dark steel) for the Iron Mine — e.g. a coloured gem/ingot badge on the building tile, keeping the team-colour outline.
**C2. In the build menu.** The Silver / Iron / Gold Mine **buttons** in `ui/hud.ts buildBtn()` carry the same resource-coloured emblem so the menu options are equally distinct (the reported screenshot shows them as similar grey icons).
**C3.** Colours match the existing resource palette already used for the floating `+1` text and the top resource bar (silver `#c9d1d9`, iron `#8c98a4`, gold `#ffd23f`) for consistency.

---

#### Cross-cutting

**i18n.** Add every new user-facing string in **uz/ru/en** with correct Uzbek orthography (U+02BB `ʻ`, U+02BC `ʼ`): the Cancel-build label (`cmd.cancelBuild`), the mine "next in {n}s" / "idle" lines. `localeParity()` must stay green; no hard-coded strings.

**Tests (headless, dependency-free, in `test/`).** Add/extend suites and keep all existing green:
- **mine ETA**: a pure helper computes seconds-to-next-output from `resAccum` + interval (and `minerSlots` for silver), reports "idle" for a silver mine with no miners, and counts down as `resAccum` rises; verified across silver/iron/gold.
- **placement HUD visibility**: a pure predicate (e.g. `panelsHiddenDuringPlacement(placing)`) returns true while `r.placing` is set and false otherwise, and the Cancel action clears `r.placing`.
- (extend existing input tests if a binding is added for keyboard cancel-build.)

**Docs.** On implementation, add a **T29 section to `PROGRESS.md`** in the T24–T28 style (Scope checklist, "How each DoD line was verified", "[OPT] deferred"), and update `README.md` (placement hides panels + Cancel-build; mine extraction countdown; resource-coloured mine emblems).

### Scope checklist (T29)
- [ ] Entering build-placement **hides** the map-covering HUD panels (command, selection, hero) and restores them when placement ends; works for mouse, touch and keyboard, per split-screen side.
- [ ] A discoverable **Cancel-build** control aborts placement (touch/keyboard reachable), alongside Esc / right-click; panels reappear afterward.
- [ ] Selecting an **own resource mine** shows the **time until the next metal is extracted** (countdown / progress), and an idle silver mine shows an "assign miners" hint; enemy mines stay fog-filtered.
- [ ] The **Silver / Iron / Gold mines** show **distinct resource-coloured emblems** on the **map** and in the **build menu** (silver/iron/gold palette).
- [ ] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography); `localeParity()` passes.
- [ ] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen (T24) and LAN (T25) regress cleanly.

DoD: when the player picks a building to place, the **command / selection / hero panels disappear** so the **battlefield is fully visible** for positioning, with a clear **Cancel-build** button (plus Esc / right-click) to back out — and the panels return the moment placement ends. Selecting one of the player's **mines** shows a **countdown to the next `+1`** of its resource (idle silver mines prompt to assign miners). On the map and in the build menu, the **Gold Mine reads gold, the Silver Mine silver, the Iron Mine iron** at a glance. Verifiable headlessly: the mine-ETA helper, the placement-visibility predicate + cancel-clears-placing, all pass; `bash build.sh` is clean and every suite is green; all UI reads correctly in uz/ru/en.

---

## 25. Localization Finalization Task (T20 — detailed)

This is the **separate, dedicated localization task** to run **after** the game is functionally complete (after T18). The goal is that the game reads naturally and correctly in **Uzbek, Russian, and English**, with every in-game term re-checked against the game's actual meaning and logic — not just literally translated.

### 25.1 Why a separate task

During the build, strings are added quickly and may be machine-translated, inconsistent, or fitted to English UI widths. A focused pass fixes terminology drift, register, orthography, plural rules, and layout — the difference between "technically translated" and "feels native."

### 25.2 Step-by-step process

1. **Extract every string.** Generate a single working sheet of all keys with the English source + current Uzbek + current Russian side by side (one row per key, grouped by namespace: menu, hud, units, buildings, abilities, upgrades, tips, errors).
2. **Build the master glossary first** (§26.7). Lock the canonical translation for every **core concept** (each resource, unit, building, ability, upgrade, status, resource action). Every other string must use these exact terms. This guarantees the same concept is never translated two different ways (e.g. "Barracks" is always `Kazarma` / `Казарма`, never alternated).
3. **Translate/repair against meaning, not words.** For each string, ask "what does this *do* in the game?" and phrase it the way a native player expects. Fix:
   - **Wrong sense** (a word that's a dictionary match but wrong in-context),
   - **Register** (UI should be concise and imperative: "Build", "Train", "Research"),
   - **Awkward machine phrasing**, and
   - **Terminology consistency** against the glossary.
4. **Uzbek orthography pass.** Use the modifier-letter apostrophes **U+02BB `ʻ`** (in `oʻ`, `gʻ`) and **U+02BC `ʼ`** (glottal stop) — never ASCII `'`. Verify Latin spelling of every term. Check that compound/borrowed military terms read naturally in Uzbek.
5. **Russian grammar pass.** Verify **case** (e.g. button labels vs. sentences), **gender agreement**, and especially **plural forms** for counts: Russian needs the 1 / 2–4 / 5+ forms (`1 юнит`, `2 юнита`, `5 юнитов`) — confirm every `count` string has all forms via i18next plurals.
6. **Pluralization & interpolation audit.** For every string with a number/timer/name placeholder, verify each locale's plural category and interpolation produce correct output (test count = 0, 1, 2, 5, 21, 100).
7. **In-context visual review.** Run the game in each language and look at **every screen and tooltip**: main menu, lobby, all HUD panels, build menu tooltips (name/cost/desc), ability tooltips, notifications, errors, end screen. Fix **text overflow/clipping** (longer Russian/Uzbek strings) by shortening wording or allowing the UI to wrap/scale.
8. **Glyph/encoding proof.** Confirm on **Windows Chrome**, **Android Chrome**, and the **Electron host** that all Cyrillic and Uzbek special letters render correctly (no `�`, no tofu boxes, correct apostrophes).
9. **Consistency sweep.** Re-scan that the final locale files exactly match the glossary; no concept uses an off-glossary synonym anywhere.
10. **Sign-off.** A fluent Uzbek speaker and a fluent Russian speaker each play a full match in their language and confirm correctness, consistency, and naturalness.

### 25.3 Definition of done (localization)

- The master glossary (§26.7) is complete and is the single source of truth; every locale string conforms to it.
- Playing a full match in **Uzbek**, then **Russian**, then **English** shows: no English leakage in non-English locales, no placeholder/garbled text, no clipped strings, correct apostrophes/glyphs, correct plurals for counts, and natural, consistent terminology throughout.
- Native-speaker sign-off recorded for Uzbek and Russian.

---

## 26. Appendix: Data Tables, Glossary & Constants

### 26.1 Master economy constants (canonical — §0)

| Constant | Value |
|---|---|
| Start silver | 15 |
| Miner output | +1 silver / 10 s |
| Silver Mine work slots | 3 (→4 with Deep Drilling) |
| Iron Mine | 20 silver → +1 iron / 15 s |
| Gold Mine | 5 iron + 25 silver → +1 gold / 30 s |
| Power Plant output | +10 power (Command Center +5) |
| Barracks | 1 gold + 10 iron + 30 silver |
| War Factory | 3 gold + 15 iron + 70 silver |
| Research Center | 2 gold + 20 iron + 60 silver |
| Super Weapon Silo | 8 gold + 40 iron + 150 silver |
| Sell refund | 50% |
| Cancel refund (queued / in-progress) | 100% / 50% |
| Sim tick rate | 20 Hz (50 ms) |
| Snapshot rate | 15–20 Hz |
| Hero max level | 10 |
| Hero respawn | 8 s + 4 s × level |
| Super Weapon charge | 180 s |

### 26.2 Unit cost/build quick reference

| Unit | Cost | Build | Built at |
|---|---|---|---|
| Miner | 5 silver | 12 s | Command Center / War Factory |
| Engineer | 1 gold + 20 silver | 18 s | Barracks |
| Infantry | 5 silver | 20 s | Barracks |
| Rocket Soldier | 10 silver | 30 s | Barracks |
| Robot | 25 silver | 25 s | Barracks |
| Light Tank | 6 iron + 35 silver | 22 s | War Factory |
| Heavy Tank | 2 gold + 14 iron + 60 silver | 34 s | War Factory |
| Artillery | 1 gold + 12 iron + 55 silver | 30 s | War Factory |
| Rocket Launcher | 2 gold + 16 iron + 65 silver | 32 s | War Factory |
| Anti-Air Vehicle | 10 iron + 45 silver | 24 s | War Factory |
| Attack Helicopter [OPT] | 2 gold + 18 iron + 70 silver | 30 s | Airfield |
| Jet Fighter [OPT] | 3 gold + 22 iron + 85 silver | 34 s | Airfield |

### 26.3 Combat matrix (repeat for implementation, §13.1)

| Damage ↓ \ Armor → | InfantryLight | VehicleHeavy | StructureArmored | AirLight |
|---|---|---|---|---|
| Bullet | 100 | 25 | 25 | 50 |
| Cannon (AP) | 50 | 100 | 75 | 0 |
| Explosive | 75 | 75 | 150 | 0 |
| Rocket | 60 | 120 | 100 | 120 |
| Energy | 100 | 100 | 100 | 100 |
| Flame | 130 | 40 | 90 | 0 |

### 26.4 Veterancy thresholds

| Rank | XP | Damage | HP | Extra |
|---|---|---|---|---|
| Rookie | 0 | +0% | +0% | — |
| Veteran | 100 | +10% | +10% | 1 chevron |
| Elite | 300 | +20% | +20% | +1 range, 2 chevrons |
| Heroic | 700 | +30% | +30% | self-heal, gold chevron + glow |

### 26.5 Building quick reference (HP / power)

| Building | HP | Power |
|---|---|---|
| Command Center | 3000 | +5 |
| Silver/Iron/Gold Mine | 600 / 700 / 800 | −1 / −2 / −2 |
| Power Plant | 700 | +10 |
| Barracks | 1000 | −2 |
| War Factory | 1600 | −4 |
| Research Center | 1200 | −3 |
| Airfield [OPT] | 1400 | −5 |
| Super Weapon Silo | 1800 | −6 |
| Guard / Cannon / Rocket Tower | 900 / 1100 / 1000 | −2 / −3 / −3 |
| Bunker | 1300 | −1 |
| Wall / Gate | 1500 / 1400 | 0 / −1 |

### 26.6 Status effects

`Slow`, `Stun/Disable`, `Burn` (DoT), `EMP` (disables vehicles/buildings), `ArmorBuff`, `AttackSpeedBuff`, `Evasion` — each with an on-unit indicator and a tick-driven duration (§13.4).

### 26.7 Trilingual glossary (master reference for T20)

Canonical terms. Uzbek uses Latin with correct `ʻ` (U+02BB) / `ʼ` (U+02BC). Russian uses Cyrillic with correct grammar. This table is the single source of truth; locale files must conform exactly. (Finalized & native-verified in T20.)

**Resources & economy**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Silver | Kumush | Серебро |
| Iron | Temir | Железо |
| Gold | Oltin | Золото |
| Power | Energiya | Энергия |
| Resources | Resurslar | Ресурсы |
| Miner | Konchi | Шахтёр |
| Deposit | Kon (qatlam) | Месторождение |
| Income | Daromad | Доход |
| Low Power | Quvvat yetishmovchiligi | Нехватка энергии |

**Buildings**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Command Center | Bosh shtab | Штаб |
| Silver Mine | Kumush koni | Серебряная шахта |
| Iron Mine | Temir koni | Железная шахта |
| Gold Mine | Oltin koni | Золотая шахта |
| Power Plant | Elektr stansiyasi | Электростанция |
| Barracks | Kazarma | Казарма |
| War Factory | Harbiy zavod | Военный завод |
| Research Center | Tadqiqot markazi | Исследовательский центр |
| Airfield | Aerodrom | Аэродром |
| Super Weapon Silo | Super qurol shaxtasi | Шахта супероружия |
| Guard Tower | Qoʻriqlash minorasi | Сторожевая башня |
| Cannon Tower | Toʻp minorasi | Пушечная башня |
| Rocket Tower | Raketa minorasi | Ракетная башня |
| Bunker | Bunker | Бункер |
| Wall | Devor | Стена |
| Gate | Darvoza | Ворота |

**Units**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Engineer | Muhandis | Инженер |
| Infantry (Rifleman) | Piyoda askar | Пехотинец |
| Rocket Soldier | Raketachi | Ракетчик |
| Robot | Robot | Робот |
| Light Tank | Yengil tank | Лёгкий танк |
| Heavy Tank | Ogʻir tank | Тяжёлый танк |
| Artillery | Artilleriya | Артиллерия |
| Rocket Launcher | Raketa qurilmasi | Ракетная установка |
| Anti-Air | Zenit qurilmasi | Зенитная установка |
| Helicopter | Vertolyot | Вертолёт |
| Jet Fighter | Qiruvchi samolyot | Истребитель |
| Hero | Qahramon | Герой |

**Combat & abilities**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Attack | Hujum | Атака |
| Defense | Himoya | Защита |
| Health | Jon (sogʻliq) | Здоровье |
| Mana | Mana | Мана |
| Damage | Zarar | Урон |
| Armor | Zirh | Броня |
| Range | Masofa | Дальность |
| Ability | Qobiliyat | Способность |
| Cooldown | Tiklanish vaqti | Перезарядка |
| Level | Daraja | Уровень |
| Experience | Tajriba | Опыт |
| Respawn | Qayta tirilish | Возрождение |
| Veteran / Elite / Heroic | Tajribali / Saralangan / Qahramonona | Ветеран / Элита / Героический |
| Super Weapon | Super qurol | Супероружие |

**Upgrades & tech**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Upgrade | Yangilash | Улучшение |
| Research | Tadqiqot | Исследование |
| Uranium Shells | Uran snaryadlari | Урановые снаряды |
| Composite Armor | Kompozit zirh | Композитная броня |
| Capture | Egallash | Захват |
| Build | Qurish | Построить |
| Train | Tayyorlash | Обучить |
| Sell | Sotish | Продать |
| Repair | Taʼmirlash | Ремонт |
| Rally Point | Yigʻilish nuqtasi | Точка сбора |

**UI / menus / system**

| English | Uzbek (Latin) | Russian (Cyrillic) |
|---|---|---|
| Play | Oʻynash | Играть |
| Single Player | Yakka oʻyin | Одиночная игра |
| Multiplayer | Koʻp kishilik oʻyin | Мультиплеер |
| Host Game | Oʻyin yaratish | Создать игру |
| Join Game | Oʻyinga qoʻshilish | Присоединиться |
| Lobby | Kutish xonasi | Лобби |
| Map | Xarita | Карта |
| Settings | Sozlamalar | Настройки |
| Language | Til | Язык |
| How to Play | Qanday oʻynash | Как играть |
| Credits | Mualliflar | Авторы |
| Quit | Chiqish | Выход |
| Resume | Davom etish | Продолжить |
| Surrender | Taslim boʻlish | Сдаться |
| Victory | Gʻalaba | Победа |
| Defeat | Magʻlubiyat | Поражение |
| Ready | Tayyor | Готов |
| Not enough resources | Resurslar yetarli emas | Недостаточно ресурсов |
| Under attack! | Hujumdamiz! | Нас атакуют! |

---

*End of specification. This document is the contract for the build: §1–§23 define behavior and every micro-detail/animation, §24 sequences the work as strict tasks T0–T22, §25 is the dedicated trilingual finalization, and §26 is the data/glossary reference. Nothing marked in scope is optional.*
