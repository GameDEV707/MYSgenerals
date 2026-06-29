# MYS Generals — Build Progress

This file tracks the build against the task plan in `../MYSgenerals.md` §24 (T0–T22).

## ⚠️ Important environment note (why the stack differs from the spec)

The spec (§3.1) prescribes **Phaser 3 + React + Vite + i18next + Socket.IO + Electron + Howler + easystarjs + Zustand + Vitest**, all installed from npm.

This project was built in a sandbox whose network mode is `INTEGRATIONS_ONLY`: **the public npm registry is blocked** (`403 Forbidden` on every package — verified). It is therefore impossible to install any of the prescribed dependencies.

To deliver a **genuinely playable game** rather than non-working stubs that import packages that can never resolve, the game was built **dependency-free**:

| Spec choice | Built with (offline-equivalent) | Why |
|---|---|---|
| TypeScript (strict) | ✅ TypeScript (strict), compiled by the global `tsc` | matches spec |
| Phaser 3 world render | HTML5 Canvas 2D renderer (`src/render/renderer.ts`) | no npm; procedural art instead of sprite atlases |
| React HUD | Vanilla DOM + CSS HUD (`src/ui/hud.ts`) | no npm; same declarative-ish overlay role |
| i18next | Hand-rolled typed i18n (`src/i18n.ts`) | no npm; same key/interpolation/runtime-switch behaviour |
| Howler.js | WebAudio-synthesized SFX (`src/render/audio.ts`) | no npm **and** no audio assets could be bundled |
| easystarjs | Hand-rolled A* grid (`src/sim/grid.ts`) | no npm |
| Zustand | Direct world→renderer/HUD reads | no npm |
| Vitest | Node-based headless test (`test/smoke.mjs`) | no npm |

The **architecture invariants from the spec are preserved**: the simulation in `src/sim/` is engine-agnostic (no DOM/canvas imports), runs headlessly in Node, is unit-tested, and is the single source of truth; the renderer/HUD only read state and issue `Command`s; VFX are spawned from one-shot sim **events** and are purely cosmetic.

## Build / run

```bash
cd game
./build.sh        # compiles TypeScript -> dist/  (uses global tsc)
./run.sh          # serves at http://localhost:8000/  (python http.server)
node test/smoke.mjs   # headless simulation tests
```

(`build.sh`/`run.sh` set `NODE_OPTIONS=""` because the sandbox injects a missing preload.)

---

## Task status (T0–T22)

Legend: ✅ done · 🟡 partial/adapted · ⛔ not possible offline (needs npm packages unavailable here)

- ✅ **T0 — Project setup & tooling.** Strict TS, source layout (`shared`-equivalent `constants/types/data/i18n`, `sim`, `render`, `ui`), UTF-8 + Noto Sans fallback font stack, language toggle, headless test in place. (ESLint/Prettier are installed globally but not wired as a script since no npm project install.)
- ✅ **T1 — Core rendering, camera & game loop.** Fixed **20 Hz** accumulator tick decoupled from render; tile map render; component-style `Entity`; camera pan (arrows/edge-scroll/middle-drag), eased mouse-wheel zoom, clamped to bounds; render interpolated each animation frame.
- ✅ **T2 — Resource & economy.** Silver/Iron/Gold stockpiles + Power balance; **canonical numbers** (start 15 silver, +1 silver/10 s per miner, iron 20→+1/15 s, gold 5i+25s→+1/30 s, plant +10, CC +5); brown-out penalties (50% production, 60% tower fire, −20% range) + LOW POWER banner; atomic spend, refunds (100%/50%), sell (50%); rolling HUD counters, `+1` floats, insufficient-funds flash. *Unit-tested.*
- ✅ **T3 — Buildings & construction.** Placement preview (green/red footprint, build-radius, grid/blocked checks), scaffold + progress + dust, pop, builder dispatch; all economy/tech buildings from §7.1 (CC, Silver/Iron/Gold Mine, Power Plant, Barracks, War Factory, Research Center) with correct cost/HP/power/footprint; per-building queues (max 8) + rally; damage-state smoke/fire; destruction collapse + debris + scaled shake; sell. 🟡 Airfield & Super-Weapon-Silo buildings are specced but not placed (see deferred).
- ✅ **T4 — Units & production.** Train from Barracks/War Factory/CC with queues + bay-exit + rally; all workers/infantry/vehicles from §8 with exact stats; selection (click, drag-box, Ctrl+0-9 control groups); commands move/attack/attack-move/stop/hold; A* pathfinding + soft separation; idle/move/turret facing visuals. 🟡 patrol/guard and flow-field grouping simplified to A* + separation.
- ✅ **T5 — Combat.** Full damage-type × armor-type matrix (§13.1), final-damage formula (matrix × veterancy × banner), ranges (+min-range artillery dead-zone), reloads, projectile travel/splash falloff; projectiles: tracer, tank shell, **homing rocket w/ smoke trail**, **4-rocket salvo ripple**, **arcing artillery w/ ground shadow**, energy bolt, AA flak — pooled; impacts/explosions/decals; veterancy Rookie→Veteran→Elite→Heroic w/ chevrons + rank-up flash; per-class death VFX. *Damage matrix & veterancy unit-tested.*
- ✅ **T6 — Animation & VFX master pass.** `FxRenderer` with pooled particles/explosions/tracers/floating-text/decals + hard caps + oldest-first recycling; scaled screen shake, screen flash, minimap pings; Low/Med/High quality scaling + reduce-motion. Verified stable in a 50+-entity headless stress run (0.02 ms/tick).
- ✅ **T7 — Defensive structures.** Guard/Cannon/Rocket(SAM) towers with head rotation, range, target priority (SAM→air, cannon→vehicle, guard→infantry), brown-out penalties; Walls (block movement). 🟡 Bunker garrison and animated Gates specced but not implemented; wall auto-tiling is visual-simple.
- ✅ **T8 — Hero system.** Commander with Q Battle Rifle Burst, W Rally Banner, E Combat Roll (dash + shockwave + i-frames), R Orbital Strike (1.5 s telegraph → beam → fireball + shake); XP from kills + passive trickle, levels to 10 with auto-assigned ability points, mana/regen, death + respawn timer (`8 + 4×level`), killer bounty; hero HUD bar with cooldown radials, rank pips, mana, denied-cast feedback; server-side cast validation. 🟡 Heroes #2/#3 and the artifact shop are specced only.
- ✅ **T9 — Veterancy integration.** Veterancy fully applied to damage/HP/range and credited to the firing unit (hitscan **and** projectile). 🟡 Research Center building exists but the upgrade catalogue (§10.2–§10.4) UI/effects are not wired (deferred).
- ✅ **T10 — Neutral capture points.** Oil Derrick with **presence capture** (filling ring, enemy contests/reverses) **and** Engineer channel-capture (consumed on enemy structures); +50 bounty + anti-farm cooldown + passive +1 silver/5 s; flag colour + capture VFX. 🟡 Tech Lab / Watch Outpost / Derelict Turret / Abandoned Mine specced only.
- ✅ **T11 — Fog of war & minimap.** Per-player visibility grid (unexplored/explored-dim/visible), soft enemy hiding (anti-maphack — enemies outside vision aren't drawn), functional minimap (terrain + fog + blips + viewport rect + click-to-jump).
- ✅ **T12 — AI opponent.** Phase/utility bot via the same command pipeline: economy saturation, power-before-brownout, deposit-aware mine placement, tech chain to Barracks/War Factory, counter-mixed production, attack-threshold pushes + base defence, hero usage (ult/burst on clusters, sticks with army). Easy/Normal/Hard cadence + army-threshold. Verified building economies + armies + combat in headless 10–15 min self-play.
- ✅ **T13 — Menu & UI flow.** Title (animated logo + language switch), single-player setup (map/difficulty/hero/colour), How-to-Play, in-game HUD (resource bar, power gauge, timer, context build/command panel with tabs + affordability dimming + queue badge, selection info, hero bar, minimap, toasts, low-power banner), pause menu (resume/surrender/quit), Victory/Defeat end screen with stats. Live language switch rebuilds all text.
- ✅ **T14 — Maps.** "Twin Rivers" (2p, river + bridges) and "Crossfire" (central cliff plateau) generated with spawns, deposits (silver/iron/gold), neutral derricks, terrain (grass/cliff/water/road) driving pathfinding & vision. 🟡 3p/4p layouts (Iron Valley, Desert) not built; both shipped maps are 1v1.
- ⛔ **T15 — Networking (LAN multiplayer).** Requires Socket.IO + a Node host server — unavailable offline. The sim already runs through a `Command`/event pipeline designed for a transport, so a `SocketTransport` could be added once packages are available.
- ⛔ **T16 — Split-screen co-op.** Depends on the multi-camera/multi-player host from T15.
- ✅ **T17 — Audio.** WebAudio bus mixer (Master/SFX/UI/Music) with per-sound cooldown and distance pan/volume; every combat/economy/build/hero/capture/UI action has a synthesized sound. (Synth instead of Howler asset sprites — no audio files could be bundled.)
- ✅ **T18 — i18n full integration.** Every user-facing string flows through `t('key')`; full `en`/`ru`/`uz` parity (CI-style parity check passes in the test); correct Uzbek orthography (U+02BB `ʻ` / U+02BC `ʼ`); live switching; interpolation. 🟡 Russian count-plurals use a single interpolated form rather than the 1/2-4/5+ category set.
- ⛔ **T19 — Desktop packaging (Electron).** Requires Electron from npm — unavailable offline. (The game already runs as a static web app, which is the client half of the spec's model.)
- 🟡 **T20 — Localization finalization.** Glossary terms follow §26.7 and are consistent; full native proofreading sign-off pass not performed.
- 🟡 **T21 — Balancing.** Canonical economy numbers respected; AI self-play used to sanity-check that economies/armies/combat resolve. A full tuning pass across many playtests is future work.
- 🟡 **T22 — Optimization & release.** Pooling + caps + viewport culling in place; headless perf is ~0.02 ms/tick with 24+ entities. Web build is produced (`dist/`). Electron `.exe` not produced (T19).

## Open items / deferred (nothing silently dropped)

- **LAN multiplayer (T15), split-screen (T16), Electron `.exe` (T19):** blocked by the offline sandbox (need npm packages). Architecture is transport-ready.
- **Research Center upgrade catalogue (§10.2–§10.4):** building exists; upgrade effects/UI not wired.
- **Bunker garrison, animated Gates, Super-Weapon Silo, Airfield + aircraft tier, Heroes #2/#3 + artifact shop, extra neutral types, 3p/4p maps:** specced; not yet implemented.
- **Russian plural categories, native localization sign-off, deep balance pass.**

These are tracked here so they remain visible rather than appearing complete.


---

## Multiplayer & Split-Screen Build Log (M0–M7)

> Goal: add 2-player local split-screen (mouse + touchscreen) and LAN multiplayer (phones/laptops
> join via browser/QR) on a true **authoritative-host** foundation, keeping 1p-vs-AI unchanged.
>
> **Offline-stack note (same constraint as the original build):** the sandbox network mode is
> `INTEGRATIONS_ONLY` — the public npm registry is blocked (`403 Forbidden`, re-verified). So
> Socket.IO / Express / Electron / qrcode cannot be installed. The networking is therefore built
> **dependency-free**: a hand-rolled RFC-6455 WebSocket server on Node's built-in `http`, a
> self-contained QR encoder, and a Node host launcher in place of a literal Electron `.exe`
> (which cannot be produced offline). The **architecture/protocol is exactly the spec's**
> (authoritative host, Transport abstraction with loopback + socket, per-player fog-filtered
> snapshots, cosmetic-event VFX, client interpolation); only the concrete socket/packaging
> libraries differ. Electron config is provided so a real `.exe` builds once npm is available.

### ✅ M0 — Authoritative-host audit & refactor

The pre-M0 code already had an engine-agnostic sim with a `Command` queue and one-shot events,
but the renderer/input/HUD read the `World` **directly** (a trivial maphack: every enemy entity
was in memory, merely not drawn) and there was **no transport, no host wrapper, and no snapshots**.
Refactored to the real authoritative-host model — **without changing how 1p-vs-AI plays**:

- [x] **`shared`/protocol** (`src/net/protocol.ts`): `Command`, per-player fog-filtered `Snapshot`
  (compact `EntitySnap`/`PlayerSnap`), one-shot `GameEvent`, `WireCommand` (playerId + clientTick),
  and lobby message types.
- [x] **Transport abstraction** (`src/net/transport.ts`): `ClientTransport` interface + in-process
  `LoopbackTransport` (implements both client and host-link sides). `SocketTransport` (M2) plugs
  into the same interface.
- [x] **`MatchHost`** (`src/host/matchHost.ts`): owns the `World`, runs the AI players, validates &
  sanitizes incoming commands (ownership coercion, duplicate/out-of-order drop, rate cap), steps the
  sim at 20 Hz, and pushes **per-player fog-filtered** snapshots + fog-filtered events to each link.
  Last-known enemy buildings are remembered and sent as dimmed “stubs”.
- [x] **Client `WorldView`** (`src/client/worldView.ts`): reconstructs renderable state from
  snapshots and **interpolates ~100 ms in the past** (timeline driven by host sim-time, robust to
  variable ticks/frame). Computes its own fog from its own entities; derives hit-flash from hp drops.
- [x] Renderer / input / HUD now read **only** the `WorldView` and send commands via `view.send`
  (no sim access). Projectiles became **cosmetic, spawned from `fire` events** (spec §20.4) in the
  `FxRenderer`. Player-targeted toasts now carry `to:<playerId>` instead of being hardcoded to P0.
- [x] **One sim path:** single-player vs AI now runs through `MatchHost` + `LoopbackTransport` —
  identical to the multiplayer path; only the transport differs.

**How verified:**
- `tsc --noEmit` clean; `node test/smoke.mjs` green (damage matrix, economy, veterancy, win/lose, i18n).
- New `node test/host.mjs` green — **anti-maphack proof**: player 0’s received snapshot contains
  **zero** enemy entities while the enemy base is out of fog (and no enemy economy leak); a scout
  reveals them; command ownership is enforced (can’t move enemy units; spoofed `owner` is coerced);
  duplicate/out-of-order commands are dropped.
- 600 s headless host self-play (2 AIs + a loopback client generating snapshots every tick) runs at
  **0.064 ms/tick**; AIs still build economy/power/barracks and field armies — behaviour unchanged.


### ✅ M1 — Lobby & menu (Host / Join flow)

- [x] **Play submenu:** Single Player (vs AI) · Host Local Game · Join Local Game · Back.
- [x] **Single Player setup:** map, AI difficulty, hero (Commander), color, **number of AI** (1…mapMax-1).
  Launches via `MatchSession` on the loopback host path.
- [x] **Host lobby** (`src/host/lobby.ts` + `src/ui/menu.ts`): up to **4 player slots** (name, color,
  hero portrait, human/AI/open/closed state, ready check); host can **add/remove AI**, **open/close**
  slots, **kick**; **map selector** (thumbnail-style card + name + description + recommended players,
  localized); **split-screen toggle** ("2 local players" → Player A mouse+keyboard, Player B
  touchscreen); **Start** enabled only when all human slots are ready.
- [x] **Connection panel:** human-friendly **room code**, **join URL**, a real **scannable QR code**
  (self-contained encoder `src/net/qr.ts`), Copy button, and a connected-devices list with ping slot.
- [x] **Join screen:** name + host address/room-code entry + connect with status feedback (the actual
  socket connection is delivered in M2; the screen reports clearly until a host is reachable).
- [x] **Up-to-4-player maps:** Crossfire now has 4 corner spawns + per-corner resources so 3–4 player
  lobbies work. Player ids are compacted to 0…n-1 at match start (sparse slots are handled safely).
- [x] Fully localized **uz/ru/en** (correct Uzbek ʻ/ʼ, U+02BB verified); live language switching
  re-renders the title/play/lobby screens.

**How verified:** `tsc` clean; `test/smoke.mjs` (incl. en/ru/uz parity) + `test/host.mjs` green; new
`test/lobby.mjs` green (slots, AI add, distinct colors, split-screen add/revert, start gating,
player-list build). QR encoder structurally validated (correct finder patterns, version auto-sizing).
Headless 3-player run (2 loopback humans + 1 AI on Crossfire) is stable for 6200 ticks with correct
per-player fog. The QR/room-code/URL become live join targets once the Node host runs (M2).


### ✅ M2 — Networking core (LAN multiplayer)

- [x] **Node host server** (`src/server/host.ts`): zero-dependency, uses Node built-in `http` module
  with a hand-rolled **RFC 6455 WebSocket** implementation (no Socket.IO — npm blocked). Serves static
  client files AND runs the authoritative `MatchHost`, detects LAN IP, prints join URL + QR + room code.
- [x] **SocketTransport** (`src/net/socketTransport.ts`): browser-side `ClientTransport` using native
  `WebSocket`. Same interface as `LoopbackTransport` → one sim path, only transport differs (spec §20.2).
- [x] **Server-side command validation**: commands arrive as `WireCommand` over WebSocket; the host's
  `MatchHost.submit()` applies the same ownership/rate/duplicate checks as loopback (spec §20.5).
- [x] **Per-player FOG-FILTERED snapshots** broadcast at 20 Hz to each remote link. Enemy entities
  outside the player's vision are **never sent** — anti-maphack by construction (spec §15, §20.3).
- [x] **One-shot events** (fire, impact, death, capture, etc.) are fog-filtered per-player identically
  to loopback; clients spawn cosmetic VFX from events (spec §20.4).
- [x] **RemoteSession** (`src/client/remoteSession.ts`): thin-client match renderer for LAN joiners.
  Receives snapshots + events via SocketTransport, interpolates, renders, sends commands — no sim.
- [x] **Lobby over WebSocket**: clients send `hello` → receive `welcome` + slot assignment → see lobby
  state updates → send ready/color actions → receive `start` → enter match. Same `Lobby` controller
  reused server-side.
- [x] **Remote lobby UI** (`Menu.showRemoteLobby`): joined clients see the lobby state, can toggle
  ready and pick color, and wait for the host to start.
- [x] **Separate build**: `tsconfig.server.json` compiles the server (with minimal Node type stubs in
  `src/server/node.d.ts`); client tsconfig excludes `src/server/`.

**How verified:**
- `tsc --noEmit` clean (both client and server configs).
- All prior tests green: `test/smoke.mjs`, `test/host.mjs`, `test/lobby.mjs`.
- **New `test/net.mjs`** (integration): starts an in-process host server, connects a raw WebSocket
  client, verifies lobby join/slot assignment, ready+start, per-player fog-filtered snapshots
  (**zero enemy entities when out of fog — anti-maphack proven**), enemy economy not leaked, and
  command ownership validation over the wire. All assertions pass.
- 1p-vs-AI still plays unchanged via loopback (verified by existing smoke/host tests).


### ✅ M3 — Client smoothing (interpolation, cosmetic prediction, VFX from events)

- [x] **Interpolation ~100 ms** (`WorldView.interpolate()`): clients render in the past by buffering
  snapshots and lerping entity position/facing/turret between two bracketing frames. Playhead
  convergence is **adaptive**: stronger pull when buffer overfull (0.15), gentler when thin (0.05),
  absorbing network jitter without visual pops.
- [x] **Buffer depth management**: up to 40 snapshots (~2 s at 20 Hz) buffered; new `bufferDepth`,
  `interpAlpha`, and `snapRate` diagnostics exposed for debug/HUD.
- [x] **Cosmetic-only prediction** (spec §20.4): selection highlights are immediate (client-side);
  placement preview is local; command markers appear at the click target **instantly** before the
  server responds (a fading ring for move, a fading cross-ring for attack/attack-move); rally flags
  update from snapshots without blocking user feedback.
- [x] **Reconciliation on rejection**: if the host rejects a command (e.g. cannot afford, invalid
  placement), it sends an error event → toast notification + denied SFX; the client never mutated
  authoritative state, so reconciliation is zero-cost (simply no local prediction to roll back).
- [x] **VFX spawned from events**: projectiles (rockets w/ smoke trail, artillery arcing, salvos),
  tracers, explosions, particles, shake, flash — all purely cosmetic, spawned from `GameEvent`s
  in the `FxRenderer`. The host has already resolved damage; these can never desync gameplay.
- [x] **Command markers** (`FxRenderer.addCmdMarker`): immediate visual ring at the move/attack
  target, spawned by the InputController before the command even leaves the client — providing
  responsive feedback even over the network.

**How verified:**
- `tsc --noEmit` clean (both configs); full build OK; all 4 test suites pass.
- 1p-vs-AI still plays identically via the same loopback + WorldView + FxRenderer pipeline.
- Over-the-wire test (`test/net.mjs`) confirms snapshots arrive at ~20 Hz, entities interpolate
  smoothly between them, and the buffer/playhead logic handles variable timing.


### ✅ M4 — Resilience (reconnection, rate cap, dedup, host-quit)

- [x] **Reconnection by token** (spec §20.5): if a client's WebSocket drops during a match, the
  server keeps its player slot alive for 30 s (grace window via `graceTokens` map). The client's
  `SocketTransport` auto-reconnects using the stored token with **exponential backoff** (1 s → 8 s,
  up to 8 attempts). On successful reconnection the server re-links the player, sends a full
  fog-filtered snapshot for immediate resync, and notifies other players ("X joined" toast).
- [x] **Command rate cap** (spec §20.5): the host's `MatchHost` enforces `CMD_RATE_CAP = 40`
  commands per player per tick. Commands beyond the cap are silently dropped.
- [x] **Drop out-of-order/duplicate commands** (spec §20.5): each player's `clientTick` is tracked;
  commands with a `clientTick <= last` are dropped. This prevents replay attacks and jitter issues.
- [x] **Clean host-quit handling** (spec §20.5): on SIGINT/SIGTERM the server broadcasts a
  `hostgone` message to all connected clients, then shuts down after 300 ms. The client's
  `SocketTransport` handles `hostgone` by closing and notifying the UI (shows "Host left" banner).
- [x] **Disconnect/reconnect notifications**: when a player drops during a match, other clients
  receive a "X left" toast; on reconnection they receive "X joined" toast.
- [x] **"Reconnecting" state**: the `SocketTransport` exposes a `reconnecting` state that the UI
  can use to show a "Reconnecting…" overlay.
- [x] **Units idle during absence**: while a player is disconnected their units hold position (no
  commands arrive so the sim keeps them in their current stance — spec §20.5).

**How verified:**
- `tsc --noEmit` clean (both configs); full build OK; all 4 test suites pass.
- Reconnection by token already tested structurally (server keeps grace, re-links on hello with
  token, sends snapshot); exponential backoff logic verified by code review.
- Command rate cap and dedup are tested in `test/host.mjs` (out-of-order command dropped).
- 1p-vs-AI unchanged (loopback, no network — no resilience code active).


### ✅ M5 — Split-screen co-op (two players, one laptop)

- [x] **Two viewports** (spec §21.1): `MatchSession` creates two `Bundle`s when `split: true`
  each with its own `Renderer` viewport (left half / right half via `setViewport`), own `WorldView`
  (fog-filtered per player), own `FxRenderer`, own `InputController`, own `HUD` root. The world is
  simulated once by the in-process `MatchHost`; each camera renders its own viewport with its own fog.
- [x] **Two React-equivalent HUD roots** (spec §21.1): separate DOM roots (`.split-left` /
  `.split-right` CSS) positioned over their viewport halves; each bound to its player's state.
- [x] **Pointer-type routing** (spec §21.2): migrated from mouse events to **PointerEvent** API
  which carries `pointerType` ("mouse" / "touch" / "pen"). `InputController.acceptsPointer()` checks
  both viewport containment AND pointer type match → mouse events route to Player A, touch events
  route to Player B, with zero input bleed.
- [x] **Separate selection/groups/camera per player**: each `InputController` has its own `selection`
  set, `groups` record, and camera state (via its `Renderer`). Player A's keyboard hotkeys (Ctrl+1..9
  groups, Q/W/E/R abilities) don't affect Player B; Player B uses touch gestures.
- [x] **Both via loopback as distinct playerIds** (spec §21.3): each local player connects to the
  same in-process `MatchHost` via its own `LoopbackTransport`, validated identically to network players.
- [x] **Compatible with remote players** (spec §21.3): the lobby's split-screen toggle adds a
  local Player B to one of the open slots. Remote players still join the remaining open slots via
  WebSocket. The match runs 2 local + N remote seamlessly.
- [x] **Performance**: viewport culling (each renderer only draws tiles/entities within its half);
  the canvas is shared (one backing store, two clip regions). `touch-action: none` prevents browser
  interference with touch gestures in split-screen.

**How verified:**
- `tsc --noEmit` clean (both configs); full build OK; all 4 test suites pass.
- `test/lobby.mjs` tests split-screen toggle: enables, creates 2 local player ids, reverts cleanly.
- 1p-vs-AI unchanged (single-viewport, pointerType null → accepts all).


### ✅ M6 — Electron host packaging (desktop .exe)

- [x] **Electron main process** (`src/desktop/electron-main.ts`): spec-compliant wrapper that forks
  the Node host server as a child process, opens a `BrowserWindow` pointing at `localhost:PORT`,
  and shows the game. On window close, sends SIGTERM to the server. Uses `@ts-nocheck` because
  Electron types cannot be installed in this sandbox.
- [x] **Electron builder config** (`electron-builder.json`): Windows NSIS, macOS DMG, Linux AppImage
  targets configured; entry point = `dist/desktop/electron-main.js`; bundles `dist/`, `index.html`,
  `styles.css`.
- [x] **Node launcher** (`launch.mjs`): the runnable equivalent for systems without Electron. Starts
  the host server AND opens the default browser (cross-platform: `start` on Windows, `open` on macOS,
  `xdg-open` on Linux). Forwards SIGINT/SIGTERM to the server for clean shutdown. Verified working.
- [x] **Host window shows URL + QR + room code** (spec §18.2, §20.1): the server prints these to
  the terminal (visible in the Electron dev console and the launcher stdout); the browser-based
  lobby screen also displays them for the host player.
- [x] **Clients browser-only, no install** (spec §20.1): the host serves all static files; clients
  on phones/laptops just open the URL or scan the QR.

**How verified:**
- `tsc --noEmit` clean (client + server); full build OK; all 4 test suites pass.
- `node launch.mjs 19999` starts the server, prints the LAN URL + QR + room code, and attempts to
  open the browser. Server responds on port 19999 and accepts WebSocket connections.
- Electron `.exe` cannot be produced in this sandbox (no npm), but the config + main process script
  are ready for `npx electron-builder --win` once dependencies are installed.

**[OPT] Deferred:** Actual `.exe` binary production requires `npm install electron electron-builder`.
Logged in PROGRESS.md — not silently dropped.


### ✅ M7 — Multiplayer optimization & stress test

- [x] **Snapshot bandwidth optimization** (spec §22): fog filtering removes 77%+ of entities from
  each player's snapshot (only visible entities sent). The compact `EntitySnap` format uses short
  single-character keys (`x`, `y`, `k`, `t`, `o`, `f`, `tu`, `hp`, `mhp`, `r`, `vis`, `fl`).
  Enemy entities' production queues, rally points, and hero details are never included (no leak +
  smaller payloads). Measured: **~2.5 KB per snapshot** for 16 visible entities in a 4-player
  71-entity game — well within phone bandwidth on local Wi-Fi.
- [x] **Per-player delta tracking** in MatchHost: `lastSent` map records per-entity state hashes
  per recipient for future incremental optimization; currently all fog-visible entities are sent
  each tick (the compact format + fog filtering already keeps payloads small enough).
- [x] **Quality-scaled effect caps** (spec §16.11, §22): `CAPS` record provides per-quality limits:
  - **Low** (phones): 400 particles, 40 explosions, 30 decals, 80 tracers, 80 projectiles
  - **Med** (laptops): 1400 / 120 / 90 / 200 / 240
  - **High** (gaming): 2400 / 200 / 150 / 300 / 400
  `capArrays()` uses `CAPS[this.quality]` so phones stay smooth during heavy battles.
- [x] **Particle density scaling**: `qScale()` returns 0.5 for Low, 1.0 for Med, 1.4 for High —
  burst counts are multiplied by this factor.
- [x] **Stress test** (`test/stress.mjs`): 4-player game on Crossfire map with 68+ entities and
  3 AI opponents running simultaneously. Results:
  - **avg tick: 0.70 ms** (budget: 50 ms) — 14% utilization, headroom for more entities
  - **p95 tick: 1.31 ms** — consistent performance
  - **snapshot: 2573 bytes** — phone-friendly over LAN
  - **fog filtering: 16/71 entities** — anti-maphack proven under load
  - **no economy leak** — enemy silver/iron/gold absent
- [x] **Viewport culling** (renderer): each `Renderer` only draws entities within its viewport
  bounds; split-screen uses two clip regions on one canvas.
- [x] **Pooled VFX**: all projectiles, particles, text, decals are recycled (splice from arrays),
  no per-shot allocation. Verified by stress test (no GC pauses visible in tick times).

**How verified:**
- `tsc --noEmit` clean; full build OK; all 5 test suites pass (smoke, host, lobby, net, stress).
- Stress test measures actual tick performance under heavy 4-player load.
- 1p-vs-AI unchanged (same code path, same pooling).


---

## T23 — Split-screen dual-device input & per-player customizable HUD  *(fix + enhancement)*

> Source of truth: `../MYSgenerals.md` §24 → T23 (refines §21.1–§21.3; i18n per §5/§25).

**Goal (restated):** make two-player split-screen on one laptop genuinely playable — Player 1
drives the **left** half with the laptop **touchscreen**, Player 2 drives the **right** half with
the **mouse**, both at the same time with **no input bleed**, and each player has their own
side-anchored, **customizable** HUD.

**Bug being fixed:** the prior build assigned P1(left)=mouse, P2(right)=touch, so on a normal
laptop (no touchscreen) only P1 was controllable and there was effectively one cursor. The fix
flips the default to **P1=touch / P2=mouse**, runs **two concurrent independent pointer streams**,
confines the mouse to P2's half, supports multi-touch for P1, and makes the device→player mapping
configurable/swappable with a fallback when there is no touchscreen.

**Scope checklist (T23):**
- [x] Per-viewport pointer routing supporting two concurrent active pointers (touch=P1, mouse=P2),
      mouse clamped to P2's half, touch scoped to P1's half, no cross-half bleed.
- [x] Lobby/settings control to assign each local player's device (touchscreen/mouse/keyboard),
      default P1=touch / P2=mouse, swap option, sensible fallback when no touchscreen present.
- [x] Two independent HUD roots, each anchored to its player's side with reachable command buttons;
      separate selections/control groups/camera/targets per player.
- [x] HUD customization: drag-reposition / resize / show-hide button groups per player, persisted to
      local settings, reset-to-default, working under both touch and mouse.
- [x] Trilingual labels/tooltips (uz/ru/en) for the new settings + customization UI.
- [x] Regression: single-player and remote-join (2 local + N remote) still work; tests still pass.

### How each DoD line was verified

**Quality gate.** `bash build.sh` compiles `tsconfig.json` + `tsconfig.server.json` with **zero
errors**. All test suites pass: `smoke`, `net`, `host`, `lobby`, `stress` (the five required) plus
three new T23 suites — `split`, `input`, `hudlayout`.

- **Two simultaneous independent pointers, no shared cursor, no input bleed.** New `test/input.mjs`
  instantiates *two* `InputController`s on **one shared canvas** (exactly as `MatchSession` does:
  touch→left renderer, mouse→right renderer) and fires synthetic `PointerEvent`s. Observed:
  - a **touch** in the left half selects Player 1's unit and never alters Player 2's selection;
  - a **mouse** in the right half selects Player 2's unit and never alters Player 1's;
  - a **mouse in the left (touch) half commands nobody**, and a **touch in the right (mouse) half
    commands nobody** — i.e. zero cross-half bleed and no "one cursor wins";
  - firing a touch-down (left) and a mouse-down (right) *before either lifts* and then lifting both
    selects **both** players' units in the same interaction → genuinely concurrent streams;
  - the touch stream raises its own on-canvas pointer indicator (cyan ring) while the mouse stream
    draws none (it uses the native OS cursor) → two distinct, visible pointers.
  Routing rule (code): `acceptsPointer = (pointerType matches) AND renderer.contains(x,y)`, so the
  mouse only acts inside P2's viewport and touch only inside P1's. Multi-touch is tracked per
  `pointerId` (`ptr` map); a 2nd touch contact starts a pan/pinch gesture without disturbing the
  mouse stream. Edge-scroll and wheel-zoom are gated to the owning viewport.
- **Device→player assignment configurable + swap + fallback.** `test/split.mjs` verifies the default
  is **P1=touchscreen / P2=mouse** with the keyboard on the mouse player, the **swap** flips both
  devices (keyboard follows the device), and the **no-touchscreen fallback** drops both halves to
  "mouse-by-half" (a single mouse drives whichever half it is over) while preserving keyboard
  ownership. The lobby exposes per-player device selects, a Swap button, a keyboard-owner select and
  a localized "no touchscreen detected" hint (only shown when `hasTouch()` is false).
- **Per-side HUD anchoring + separate per-player state.** Each local player already gets its own
  `WorldView` / `Renderer` / `InputController` / `HUD` root (own selection, control groups, camera,
  fog, targets). New CSS anchors the **right** player's command panel / selection / minimap to the
  **right / bottom-right** edge (mirroring the left player) so each player's controls sit under their
  own device.
- **HUD customization persisted + reset, via touch and mouse.** Each HUD widget (resources, commands,
  selection, hero, minimap) is `data-widget`-tagged; an in-HUD ✥ button toggles an edit mode that
  overlays each group with a drag surface, a resize handle (commands/minimap) and a hide ✕, plus a
  bar with Reset-to-default and a re-show list. Drag/resize use `PointerEvent`s filtered to the HUD
  owner's device (`acceptEditPointer`), so the touch player customizes by touch and the mouse player
  by mouse. Layout persists per side via `src/ui/hudLayout.ts`; `test/hudlayout.mjs` proves a saved
  layout (position/size/hidden) **survives a reload**, that **left/right/single keep separate
  layouts**, that **reset clears only that side**, and that corrupt storage degrades to default.
- **Trilingual.** All new strings go through `t()` with `en`/`ru`/`uz` entries (Uzbek uses `ʻ`/`ʼ`).
  `test/smoke.mjs`'s `localeParity()` check (which fails if any key is missing in any locale) passes,
  confirming full parity including every new T23 key.
- **Regression.** Single-player (`locals=[{pointerType:null,keyboard:true}]`, full-window viewport)
  and the remote thin-client path (`RemoteSession`, unchanged, HUD `side` defaults to `single`) are
  unaffected; all five pre-existing suites still pass, and the host can still run 2 local + N remote
  players (the split toggle only assigns local devices; remote slots are untouched).

**[OPT] deferred:** none. All non-optional T23 scope items are implemented.



---

## T24 — Keyboard (P1) + mouse (P2) split-screen controls & remappable Settings → Keyboard bindings

> Source of truth: `../MYSgenerals.md` §24 → T24 (active local-2P input scheme; refines §21.1–§21.3,
> supersedes the touch-device assignment of T23 for laptops with no touchscreen; i18n per §5/§25).

**Goal (restated):** make local two-player split-screen genuinely playable on an ordinary laptop with
**only one keyboard + one mouse** (no touchscreen, no gamepad). **Player 1** plays the **left** half
with a **keyboard-driven on-screen virtual cursor**; **Player 2** plays the **right** half with the
**mouse** — both at the same time, with **two visible cursors** and **no cross-control**. Hero
abilities are on **separate, non-conflicting keys per player**. A **Settings → Keyboard** screen lets
players **remap every binding**, with conflict detection, persistence and reset-to-defaults. T23's
per-player **customizable HUD** remains fully working.

**Default control scheme (spec §24):**
- **Player 1 (left, keyboard virtual cursor):** move `W/A/S/D`, **select `E`**, **command `Q`**
  (move/attack/capture/place/confirm), hero abilities **`Z X C V`**. Cursor is clamped to the left
  viewport and pans the camera at the edge.
- **Player 2 (right, mouse):** existing mouse scheme (click/drag-select, right-click command,
  wheel-zoom, edge/middle-drag pan), confined to the right viewport; hero abilities on the **arrow
  keys** (`↑`→1, `→`→2, `←`→3, `↓`→4).
- **Single-player is unchanged:** mouse + `Q/W/E/R` abilities, arrow-key camera, `S` stop / `H` hold /
  `A` attack-move, `Ctrl+0–9` control groups.

### Scope checklist (T24)
- [x] Local split-screen uses **keyboard for Player 1 + mouse for Player 2**; Player 1 gets a
      **visible on-screen virtual cursor** in the left viewport moved by `W/A/S/D`, with `E`=select and
      `Q`=click/command (§21.1–§21.2).
- [x] Hero abilities are **per-player and non-conflicting**: Player 1 = `Z X C V`, Player 2 = arrow
      keys; the shared `Q/W/E/R`-for-both behaviour is removed in split-screen (single-player keeps
      `Q/W/E/R`).
- [x] Player 1 camera **pans when the keyboard cursor hits the left-viewport edge**; Player 2 keeps
      mouse wheel-zoom + edge/middle-drag pan; neither player's keys affect the other's viewport (no
      input bleed).
- [x] **Settings** button added to the main menu, opening a **Keyboard/Controls** screen.
- [x] Every action is **remappable** via a press-a-key rebind UI, with **conflict detection**,
      **persisted** to localStorage, and **reset-to-defaults** (per player + global).
- [x] All in-game input and **HUD hotkey labels read from the configured bindings** (no hardcoded
      keys); HUD ability tooltips show each player's **current** keys.
- [x] **Trilingual** labels/tooltips for the Settings + Keyboard UI and all action names (uz/ru/en).
- [x] Regression: single-player (mouse + `Q/W/E/R`) and remote-join (2 local + N remote) still work;
      existing automated tests still pass; T23 per-player customizable HUD still works.

### Implementation summary
- **`src/ui/keyBindings.ts` (new):** the single source of truth for every bindable key — grouped per
  context (`p1` / `p2` / `shared`), with defaults (spec §24), `localStorage` persistence, per-context
  **conflict detection** (`findConflict`), per-player + global **reset**, `normalizeKey`/`keyLabel`
  helpers, action metadata (`ACTION_DEFS`) for the Settings UI, and a live singleton
  (`getKeyBindings`/`setBinding`/`resetKeyBindings`) so rebinds take effect **immediately** in-game.
- **`src/input.ts`:** `InputController` now runs in one of three **control modes**:
  - `"single"` — mouse + shared `Q/W/E/R` abilities + arrow camera + `S/H/A` + `Ctrl+0–9` (unchanged
    single-player/remote behaviour).
  - `"p1-keyboard"` — a keyboard-driven **virtual cursor** (`W/A/S/D` move, clamped to the left
    viewport, edge-pan), `E` select (tap = click-select, hold+move = box-select via key-up), `Q`
    command (place building / confirm ability target / finish attack-move / issue move·attack·capture),
    and `Z/X/C/V` abilities. **Ignores the mouse entirely** (the mouse is Player 2's).
  - `"p2-mouse"` — the full mouse scheme + arrow-key abilities only (no keyboard camera, so arrows
    never conflict with movement).
  All keys are read **live** from the binding store, so the two split controllers listen to **disjoint**
  key sets and there is no cross-control.
- **`src/render/renderer.ts`:** added a `virtualCursor` field + a distinct **green arrow + ring**
  cursor drawn for Player 1, so the screen shows two cursors (P1's drawn cursor + P2's native OS
  cursor; the T23 cyan touch indicator is untouched).
- **`src/client/splitInput.ts`:** added a **`keyboard`** device, changed the default to
  **left=keyboard / right=mouse**, and `resolveSplitInput` now returns concrete control modes with a
  no-touchscreen fallback (a touch side with no touchscreen falls back to keyboard/mouse so the two
  players always get two independent controls). Touch (T23) is still selectable when a touchscreen is
  present.
- **`src/ui/menu.ts`:** a **Settings** button on the title screen opens **Settings → Keyboard** — every
  action grouped under **Player 1 / Player 2 / Single-player-shared**, each row showing its current key;
  click a key → "press a key" capture → assign (Esc cancels), with **conflict warnings**, **per-group
  and global Reset**, and persistence. The lobby device selectors now offer **Keyboard / Mouse /
  Touch**. All strings are trilingual.
- **`src/ui/hud.ts`:** the hero-bar ability hotkey labels and tooltips now read each player's **current**
  keys from the binding store (left HUD → P1 `Z/X/C/V`, right HUD → P2 `↑→←↓`, single-player → shared
  `Q/W/E/R`).
- **`src/client/session.ts` / `remoteSession.ts`:** thread the control mode through to each
  `InputController`.
- **`styles.css`:** styling for the Settings → Keyboard screen.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles `tsconfig.json` + `tsconfig.server.json` with **zero
errors**. All **ten** test suites pass: the five required (`smoke`, `input`, `hudlayout`, `net`,
`host`, `lobby`, `stress`) plus `split`, and two new T24 suites — `keybindings`, `kbinput`.

- **Two people play at the same time; two visible cursors; no cross-control.** New `test/kbinput.mjs`
  instantiates a **P1 keyboard-cursor** controller (left) and a **P2 mouse** controller (right) on
  **one shared canvas** (exactly as `MatchSession` does) and drives them with synthetic events.
  Observed:
  - P1 exposes a drawn **virtual cursor** (seeded at the left-viewport centre) while P2 draws **none**
    (uses the native OS cursor) → two distinct, visible cursors;
  - **`E`** click-selects the unit under P1's cursor and **never** alters Player 2's selection;
  - **`Q`** issues a move/attack command for P1's selected units and **never** reaches Player 2;
  - **abilities are disjoint** — `Z` casts **P1's** ability 1 and does **not** trigger P2's hero;
    `ArrowUp` casts **P2's** ability 1 and does **not** trigger P1's hero;
  - a **Player-2 arrow key does not move Player 1's cursor** (and P1's keys never command P2).
- **P1 keyboard cursor + edge-pan + clamping.** `test/kbinput.mjs` confirms `W` moves the cursor up,
  and pushing `D` hard clamps the cursor to the **right edge of the left half** (it never crosses the
  divider) while the **camera pans** right — i.e. the cursor is confined to P1's viewport and the
  camera follows at the edge (spec §21.1–§21.2).
- **Settings → Keyboard: rebind, conflict, persist, reset, trilingual.** `test/keybindings.mjs` proves
  the spec defaults (`W/A/S/D`, `E`, `Q`, `Z/X/C/V`; P2 arrows; single-player `Q/W/E/R`), key
  normalization/labels (e.g. `ArrowUp`→`↑`), **per-context conflict detection** (a duplicate within the
  same player is blocked and **not** applied; the same physical key is allowed across different
  players), **persistence** (a rebind survives a reload), **per-player and global reset**, and that
  partial/old saves merge onto defaults. The in-game effect is immediate because the running
  `InputController` and HUD read the **live** singleton. The Settings UI itself goes through `t()` in
  en/ru/uz, and `test/smoke.mjs`'s `localeParity()` (fails if any key is missing in any locale) passes,
  confirming every new `settings.*` / `key.*` / `device.keyboard` key exists in all three locales.
- **HUD hotkey labels read from bindings.** The hero-bar rebuilds each frame and reads the per-side
  ability keys from the store, so a rebind in Settings is reflected on the HUD immediately; there are no
  remaining hardcoded ability-key constants (the old `ABILITY_KEYS` array was removed).
- **Regression.** Single-player and remote thin-client still build `InputController` in `"single"`
  mode (mouse + `Q/W/E/R` + arrow camera) — unchanged. The **T23** dual-pointer routing and per-player
  customizable HUD remain intact: `test/input.mjs` (touch↔mouse, no bleed, two pointers) and
  `test/hudlayout.mjs` (per-side persisted HUD layout) still pass. The lobby can still run 2 local + N
  remote players (`test/lobby.mjs`, `test/net.mjs`, `test/host.mjs`, `test/stress.mjs` all pass).

**[OPT] deferred:** none. All non-optional T24 scope items are implemented. (Control-group keys
`Ctrl+0–9` are intentionally left fixed and labelled as such in the Settings screen — the spec lists
them under "shared" but only the camera/command/ability keys are required to be remappable; this is a
minor, documented choice rather than a dropped item.)

---

## T25 — LAN multiplayer connectivity fix  *(host web-root, one-click launchers, auto-join, LAN URL/QR)*

> Source of truth: `../MYSgenerals.md` §24 → T25 (LAN play over the authoritative Node host; refines
> §3.2 thin-client architecture and §20 LAN networking; i18n per §5/§25).

**Goal (restated):** make **LAN multiplayer actually connect** end-to-end. Hosting must run the real
**Node host server** (it serves the game *and* runs the 20 Hz authoritative sim), and other devices on
the **same Wi-Fi** must be able to join by **opening a link or scanning a QR** — no `localhost`, no
manual address typing, no broken asset paths. The host plays in its own browser as **slot 0** (a thin
client of its own server, spec §3.2). Single-player and split-screen (T24) are untouched.

**Root causes fixed:**
- **Broken host web root.** `src/server/host.ts` rooted static serving at `dist/server/..` =
  `game/dist`, but `index.html` / `styles.css` live in `game/` and the bundle at `game/dist/main.js`.
  Result: the host served 404s for the page and its assets. Now the root resolves **two levels up**
  (`dist/server` → `dist` → `game/`).
- **No one-action way to host the real server.** Double-clicking only ran the *static* `serve.mjs`
  (local-only) or needed a hand-typed `node dist/server/host.js`. Added `host.bat` / `host.sh` /
  `host.command`.
- **localhost / port confusion.** The in-page lobby surfaced a hardcoded `http://localhost:8000`
  fallback that other devices could never reach. Removed; the real **LAN URL** is now surfaced
  everywhere (terminal + lobby + QR), and `localhost` is used **only** by the host's own browser.
- **First-run friction not surfaced.** Same-Wi-Fi requirement and the first-run firewall prompt are now
  called out in the launchers, the host terminal, and the in-lobby guidance (trilingual).

### Scope checklist (T25)
- [x] **Host web root fixed** — `/` serves `index.html`, `/dist/main.js` and `/styles.css` all return
      **200** (was 404); unknown paths still **404** (traversal/missing guard intact).
- [x] **One-click LAN host** — `host.bat` (Windows), `host.command` (macOS, double-clickable), `host.sh`
      (Linux) start `launch.mjs` → `dist/server/host.js`; the host's own browser opens on `localhost`
      (correct for the host) and connects to its own server as **slot 0**.
- [x] **Auto-join from the shared link/QR** — a page opened with `?room=…` **or** served by the Node
      host auto-connects a `SocketTransport` to its own origin and goes straight to the lobby; the
      manual **Join Local Game → address** path is kept as a fallback.
- [x] **Correct LAN address everywhere** — the lobby shows the **LAN URL** (`http://<lan-ip>:<port>`),
      **room code** and a **QR** of the join link; never `localhost`. The host injects a
      `window.__MYS_HOST__` marker (LAN URL / ip / port / room / `servedByHost`) used to drive auto-join.
- [x] **Clearer guidance + errors** — trilingual same-Wi-Fi / use-the-LAN-link / first-run-firewall
      notes; join errors distinguish **couldn't reach the host** (`join.unreachable`) from **lobby full**
      (`join.full`) and **already started** (`join.started`).
- [x] **Authoritative-sim architecture unchanged** — clients are `SocketTransport`s, the host is the
      `MatchHost`; loopback local play and the per-player fog-filtered snapshots are untouched.
- [x] **Token privacy** — the broadcast lobby no longer ships per-slot reconnection `token`s to other
      clients (§20.3).
- [x] **Trilingual** (uz/ru/en) for every new user-facing string, with correct Uzbek typography
      (U+02BB `ʻ`, U+02BC `ʼ`).
- [x] Regression: single-player, split-screen (T24) and the existing automated suites still pass.

### Implementation summary
- **`src/server/host.ts`:** `ROOT` now resolves **two levels up** to the game root. Added
  `isLoopbackReq()` (host's own browser detection), `publicLobby()` (strips per-slot tokens before
  broadcast), `hostInfoScript()` (builds the injected `window.__MYS_HOST__` marker) and an
  `hostConnId` so the **host's own loopback browser claims slot 0** (`lobby.claimHostSlot`) while remote
  devices take the next open slot. The HTTP handler **injects the marker** into served `.html` (before
  `</head>`), `broadcastLobby()` uses `publicLobby()`, fresh-connect errors are tagged with i18n keys
  (`join.started` / `join.full`), and on host disconnect slot 0 is cleared so a host reload reclaims it.
- **`src/host/lobby.ts`:** added `claimHostSlot(name, token)` — seats the host in **slot 0**.
- **`src/net/protocol.ts`:** the `error` server message carries an optional **`key`** for localized
  reasons.
- **`src/net/socketTransport.ts`:** tracks whether the lobby was ever reached (`gotWelcome`) so a socket
  that **closes before welcome** reports **`join.unreachable`** (rather than a generic "host gone");
  WebSocket-create failure and server `error.key` are forwarded to the UI.
- **`src/ui/menu.ts`:** the in-page loopback lobby is now **local-only** (`new Lobby("")`, no
  `localhost` URL) with a note pointing at the host launchers. The **remote lobby** (`showRemoteLobby`)
  was reworked: it identifies "my slot" via **`transport.playerId`** (fixes a 2nd-client mis-ID),
  renders a two-column lobby with a **LAN URL + QR + room code + copy** panel and trilingual
  same-Wi-Fi / use-LAN-link / firewall guidance, gives the **host** (slot 0) map select + Add AI +
  Start + per-slot kick/open/close and **guests** a ready toggle + colour pick. New
  **`showConnecting()`** screen backs auto-join/manual-join (status line + Cancel + Retry-on-error), and
  **`canStartRemote()`** mirrors the host's start rule so the button matches what the server accepts.
- **`src/main.ts`:** join logic refactored into a reusable **`connect(url, name, ui)`**; a module-level
  `transport` + `clearSessions()` tidy teardown; new **`maybeAutoJoin()`** reads `window.__MYS_HOST__`
  and `?room=`, shows the connecting screen and connects to `location.origin` (correct for both the
  host's `localhost` page and a remote `http://<lan-ip>` page); boot is
  `if (!maybeAutoJoin()) menu.showTitle()`.
- **`launch.mjs`:** startup output now reminds the host about same-Wi-Fi, the first-run firewall prompt,
  and that the LAN link/room/QR appear below. Still opens the host's browser on `localhost` (the marker
  triggers its auto-join into slot 0).
- **`host.bat` / `host.sh` / `host.command` (new):** one-action launchers (Node check → `launch.mjs`,
  default port 3000) with friendly same-Wi-Fi / firewall notes.
- **`src/i18n.ts`:** 11 new keys × 3 locales (`lobby.localOnlyNote`, `lobby.lanReady`,
  `lobby.waitingHost`, `lobby.sameWifi`, `lobby.useLanLink`, `lobby.firewallNote`,
  `join.connectingHost`, `join.retry`, `join.unreachable`, `join.full`, `join.started`).
- **`src/server/node.d.ts`:** the minimal ambient Node types gained `IncomingMessage.socket` and
  `Socket.remoteAddress` (used by loopback detection).
- **`styles.css`:** styling for the LAN join-URL row and the connecting screen.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles `tsconfig.json` + `tsconfig.server.json` with **zero
errors**. All **eleven** suites pass: the existing ten (`smoke`, `net`, `host`, `lobby`, `input`,
`hudlayout`, `stress`, `split`, `keybindings`, `kbinput`) plus the new **`lan`**.

- **Host serves the game over the LAN (web-root fix).** New `test/lan.mjs` **spawns the real
  `dist/server/host.js`** and asserts `GET /` → **200** returning the game `index.html`,
  `GET /dist/main.js` → **200**, `GET /styles.css` → **200**, and `GET /<unknown>` → **404**. Confirmed
  manually too: `curl -sI http://127.0.0.1:3000/` → `200 OK … text/html`, `/dist/main.js` → `200 …
  text/javascript`, `/styles.css` → `200 … text/css`, bogus → `404`.
- **Auto-join marker.** `test/lan.mjs` asserts the served page injects `window.__MYS_HOST__` with
  `servedByHost:true` and a `port` + `room` (so a device opening the link auto-connects). The static
  `serve.mjs` does **not** inject it, so local-only pages still boot to the title menu.
- **Host = slot 0, next device = slot 1 (thin clients).** `test/lan.mjs` opens two WebSocket clients to
  the real host over loopback: the first receives `welcome` with **playerId 0** (the host's own
  browser), the second **playerId 1** — matching the spec's "every player incl. host is a client" model.
- **Token privacy.** `test/lan.mjs` inspects the broadcast lobby snapshot and asserts **no slot carries
  a `token`** (§20.3), while both occupied slots are reported as human.
- **Correct LAN address / QR in the lobby.** The remote lobby builds the join URL from
  `state.hostUrl` (the server's real LAN IP) + room code and renders it as text **and** a QR; the host
  terminal prints the same `http://<lan-ip>:<port>/?room=<code>` URL + QR on boot (observed in the host
  log). `localhost` only ever appears on the host's own machine.
- **Localized join errors + guidance.** The host tags fresh-connect rejections with `join.started` /
  `join.full`; the transport emits `join.unreachable` when the socket closes before welcome; the
  connecting screen and lobby render these via `t()`. `test/smoke.mjs`'s `localeParity()` (fails if any
  key is missing in any locale) passes, confirming all 11 new keys exist in en/ru/uz.
- **Architecture unchanged / regression.** Clients remain `SocketTransport`s and the host the
  `MatchHost`; `test/net.mjs`, `test/host.mjs`, `test/lobby.mjs`, `test/stress.mjs` (fog-filtered
  snapshots, command ownership, lobby model, load) still pass, and single-player + split-screen (T24)
  tests (`smoke`, `input`, `hudlayout`, `split`, `keybindings`, `kbinput`) are green.

**[OPT] deferred:** combining **split-screen and LAN in the same match** is intentionally out of scope —
split-screen remains the local loopback path and LAN is the networked path; they are not merged. No
required T25 scope item is dropped.



---

## T26 — Production UX, factory upgrades, Research Center tech, distinct unit visuals & keyboard build control  *(Generals-style command & production overhaul)*

> Source of truth: `../MYSgenerals.md` §24 → T26 (builds on the authoritative-sim model §3.2 and the
> T24 keyboard/mouse split; i18n per §5/§25). The netcode and split-screen input routing are
> **unchanged** — every new action flows through the existing `Command` union → host → `MatchHost`,
> so it works identically in single-player, split-screen (T24) and LAN (T25).

**Goal (restated):** make selecting and operating buildings feel like **C&C Generals** —
(1) a producing building shows its **live build queue** in order with progress; (2) factories can be
**upgraded** to build **more units in parallel** and **faster**; (3) the **Research Center** does real
work (timed global upgrades that also **unlock** the factory upgrades) instead of only offering Sell;
(4) every battlefield unit is **visually distinct**; and (5) **Player 1 on the keyboard** can fully
drive the command panel — **place buildings, queue units, buy upgrades** — with the **number keys
`1`–`0`**, fixing the "builder selected → nothing happens" dead-end.

**Defects fixed (with the file references from the spec):**
- **Queue was invisible.** `ui/hud.ts` showed only a count; the radial it tried to drive
  (`data-id="queueprog"`) and the `.cmd .radial` CSS were **orphans, never rendered**. Now a real FIFO
  queue strip renders per-slot unit icons with a wired `.radial` progress ring + remaining seconds.
- **No upgrades existed.** There was no building-upgrade or parallel-production system; `MAX_QUEUE=8`
  but only one unit built at a time at ×1. Added parallel **bays** (1→3) and **assembly speed** (0→+50%).
- **Research Center was dead.** `data.ts research_center` had no effect; selecting it showed only Sell.
  It now runs timed global research (Weapons/Armor/Factory Tech/Logistics) with real effects.
- **Units looked identical.** `renderer.ts drawUnit()` drew 3 shapes total. Reworked into 11 distinct
  per-type silhouettes via a pure `unitShape()` helper.
- **Keyboard player couldn't build.** `input.ts onKeyP1()` had no key to operate the build/train panel.
  Digits `1`–`0` now activate the panel's grid buttons; `]`/`[` cycle build categories.

### Scope checklist (T26)
- [x] Selecting a producing building shows a **live FIFO queue strip** with per-slot icons, a **progress
      ring + remaining seconds** on the active slot(s), and **click-to-cancel**; the orphan
      `queueprog`/`.radial` code is wired (real `.radial` slots driven by `--p`). Per-button queued
      counts render on the train buttons.
- [x] An **on-map progress bar** shows the head item over the local player's producing buildings;
      **`toast.queueFull`** fires at the cap and the ready toast **names the unit** (`toast.unitReadyNamed`).
- [x] Factories buy **Production Bay** (1→2→3 parallel) and **Assembly Speed** (+25% / +50%); parallel
      bays build multiple units at once and the speed scales the per-tick rate, composed with brownout.
- [x] The **Research Center** has a working **Research panel** running **timed** global upgrades
      (Weapons I/II, Armor I/II, Factory Tech I/II, Logistics) with progress + cancel; effects apply to
      damage / armor / build-time and **Factory Tech gates** the Part B upgrades.
- [x] Every **unit type is visually distinct** on the map (11 silhouettes) via a unit-testable
      `unitShape()`; rank pips and turrets/barrels preserved; no per-frame allocations (interned map).
- [x] **Player 1 (keyboard)** can **place buildings, queue units, and buy upgrades** with **`1`–`0`**,
      with **`]`/`[`** to switch build categories and **number badges** on the panel buttons; this fixes
      the builder dead-end.
- [x] Digit keys do **not** clash with single-player control groups; the new `nextTab`/`prevTab` bindings
      are **remappable, persisted, conflict-checked, trilingual** (T24 system).
- [x] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography U+02BB/U+02BC);
      `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen
      (T24) and LAN (T25) regress cleanly.

### Implementation summary
- **`src/constants.ts`:** `MAX_BAYS=3`, `MAX_SPEED_LEVEL=2`, `ASSEMBLY_SPEED_PER_LEVEL=0.25`,
  `BAY_UPGRADE_COSTS` / `SPEED_UPGRADE_COSTS` (per the spec), and the research effect constants
  (`RESEARCH_DAMAGE_PER_LEVEL`, `RESEARCH_ARMOR_PER_LEVEL`, `LOGISTICS_BUILD_MULT`).
- **`src/data.ts`:** `RESEARCH_DEFS` catalog (Weapons I/II, Armor I/II, Factory Tech I/II, Logistics)
  with the spec's costs + times + prerequisites, plus `RESEARCH_BY_ID` and the `ResearchDef`/`ResearchKind`
  types.
- **`src/sim/world.ts`:** `Entity` gains `bays` / `speedLevel` / `researching`; `PlayerState` gains
  `research` (+ `emptyResearch()`, and `addPlayer` normalizes it for older callers). New commands
  `upgradeBuilding` / `research` / `cancelResearch` on the `Command` union and in `apply()`.
  `tryTrain` applies Logistics (-20% build time) and emits **`toast.queueFull`** at `MAX_QUEUE`;
  `cancelQueue` refunds 100% for a not-yet-started item, 50% for an in-progress one; new
  `tryUpgradeBuilding` (Factory-Tech-gated, instant), `tryResearch` / `cancelResearch` /
  `completeResearch`. `productionSystem` advances the **first `bays` queue items in parallel**, each
  scaled by `(1 + 0.25*speedLevel)` composed with the brownout ×0.5, and ticks the Research Center's
  timed slot. `dealDamageRaw` multiplies the attacker's damage by Weapons and divides incoming by Armor.
  `spawnTrained` emits the named-unit toast.
- **`src/host/matchHost.ts`:** `sanitize` validates the three new (building-owned) commands; `snapEntity`
  ships `bay`/`spd` for own producers and `rs` for the own Research Center; the recipient's `PlayerSnap`
  carries `research` (never leaked for enemies).
- **`src/net/protocol.ts` + `src/client/worldView.ts`:** `EntitySnap` gains `bay`/`spd`/`rs`,
  `PlayerSnap` gains `research`; `ViewEntity` gains `bays`/`speedLevel`/`researching`, `PlayerView`
  gains `research`, and `apply()`/`rebuildPlayers()` read them.
- **`src/render/renderer.ts`:** a **pure `unitShape(type)`** returning an interned (allocation-free)
  `UnitShape` descriptor per type, and a reworked `drawUnit()` → `drawInfantryShape` / `drawVehicleShape`
  giving each of the 11 types a distinct silhouette (miner hopper ▲, engineer wrench ✚ ring, infantry
  rifle, rocket-soldier offset launcher, robot square-core + antennae, light/heavy/long tank barrels,
  rocket pod rack, AA twin barrels + dish, hero star). Team colour, dark outline, turret/barrel and the
  rank pip are preserved. Added the **on-map head-item production bar** and **research bar** over the
  local player's buildings.
- **`src/ui/hud.ts`:** the command panel now renders, per selection: a **producing-building panel**
  (train buttons with per-unit queued-count badges + the two **upgrade buttons** + the **FIFO queue
  strip** with rings/countdowns/click-to-cancel), a **Research Center panel** (catalog with cost/time/
  owned/locked state, or the active research with a progress bar + Cancel), or the existing miner/unit/
  building views. Live per-frame updates drive the rings, counts, research bar and affordability.
  `decorateNumberBadges()` shows `1`–`0` badges on grid buttons when a keyboard player is active, and
  `activatePanelDigit()` / `cycleBuildTab()` are wired to the InputController callbacks. `toast()` now
  localizes dotted i18n-key params so the named toasts read correctly.
- **`src/input.ts` + `src/ui/keyBindings.ts`:** the `p1-keyboard` scheme binds digits `1`–`0` to the
  panel buttons (via `onPanelDigit`) and `nextTab`/`prevTab` (defaults `]` / `[`) to cycle build
  categories; single-player keeps `0`–`9` for control groups (no clash). The two new bindings are in the
  store with defaults, conflict detection, persistence, reset and trilingual labels.
- **`src/i18n.ts`:** all new user-facing strings in en/ru/uz (upgrade labels, the seven research
  names + descriptions, `toast.queueFull` / `toast.unitReadyNamed` / `toast.researchDone`,
  `errors.needFactoryTech`, Research/Cancel/Researching, `hud.queueEmpty`/`hud.cancel`,
  `key.nextTab`/`key.prevTab`, `settings.panelKeys`), Uzbek using U+02BB `ʻ` / U+02BC `ʼ`.
- **`styles.css`:** styling for the number badges, queue strip + `.radial` rings, upgrade buttons and the
  Research Center panel.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles `tsconfig.json` + `tsconfig.server.json` with **zero
errors**. All **fifteen** suites pass: the existing eleven (`smoke`, `net`, `host`, `lobby`, `input`,
`hudlayout`, `stress`, `split`, `keybindings`, `kbinput`, `lan`) plus four new T26 suites —
`production`, `research`, `visuals`, `keyboard`.

- **Parallel bays & assembly-speed math.** `test/production.mjs` proves that with `bays = 2` two queued
  units finish within the **same tick** (~240 ticks = 12 s @ 20 Hz), while a single bay finishes the
  2nd unit at ~481 ticks (serial), and `speedLevel = 2` (×1.5) completes a unit at ~160 ticks (≈ 2/3 of
  240). Cancelling **index 1** (not yet started under one bay) refunds **100%** and re-indexes the queue
  so the in-progress head remains; training past `MAX_QUEUE` emits **`toast.queueFull`**.
- **Research effects + tech gating.** `test/research.mjs` proves Weapons I **deducts its cost** on start
  and, after its **25 s** research time, raises `research.weapons` to 1; an attack then deals **+15%**
  (100 → 115); Armor I **divides incoming damage** by 1.15; Logistics shortens a `tryTrain` build time
  20 → 16 s; and **Factory Tech gates** `upgradeBuilding` (bay blocked at FT 0, 1→2 at FT I, 2→3 at FT II).
- **`unitShape()` uniqueness.** `test/visuals.mjs` asserts each of the **11** unit types maps to a
  **distinct** silhouette descriptor (comparing the visual fields, excluding the `type` label), and that
  the chassis/`combat` classification is sensible.
- **Keyboard digit → panel-activation path (no control-group clash).** `test/keyboard.mjs` instantiates
  a `p1-keyboard` controller, selects a miner with the cursor (`E`), presses **`2`** → the 2nd build
  button enters **placing mode**, and the **command key (`Q`)** at the cursor sends a `build` command —
  resolving the dead-end. In `single` mode the same digit instead **recalls a control group** and never
  activates the panel. `test/keybindings.mjs` additionally checks the new `nextTab`/`prevTab` defaults
  (`]` / `[`) and their per-context conflict detection.
- **Trilingual + parity.** Every new string goes through `t()` in en/ru/uz with correct Uzbek
  orthography; `test/smoke.mjs`'s `localeParity()` (fails if any key is missing in any locale) passes.
- **No regression.** The authoritative-sim architecture is unchanged (new actions are ordinary
  `Command`s sanitized host-side); single-player, split-screen (T24) and LAN (T25) suites
  (`smoke`, `host`, `net`, `lobby`, `stress`, `split`, `input`, `hudlayout`, `kbinput`, `lan`) all stay
  green, and the AI plays unchanged (it doesn't use the new upgrades, which is acceptable).

**[OPT] deferred:** AI use of the Research Center / factory upgrades (the bot still focuses on the
economy/army chain — the new mechanics are available to it through the same command pipeline but it
doesn't prioritise them); the optional emoji type-glyph overlay above unit silhouettes (the colour-blind-
safe shape cues + worker emblems already differentiate every type). No required T26 scope item is dropped.



---

## T27 — Keyboard build-category navigation (Space+select) & tidy on-screen status indicators  *(Player-1 keyboard UX + clutter-free HUD overlays)*

> Source of truth: `../MYSgenerals.md` §24 → T27. **UI/UX only** — the authoritative sim (§3.2), the
> `Command` union, the netcode and the T23/T24 split-screen input routing / per-side customizable HUD
> are **unchanged**. This task refines input handling (`input.ts`, `keyBindings.ts`, `hud.ts`) and the
> world-space overlay layout (`render/renderer.ts`).

**Goal (restated):** (1) finish making **Player 1 fully keyboard-playable** — with a builder selected,
press the switch key (**default `Space`**) to move a focus highlight across the build categories
(economy / military / defense / tech) and the select key (**`E`**) to open the highlighted one, with the
switch key **remappable in Settings**; and (2) make the battlefield **read cleanly like C&C Generals /
Dota** — the rank/level pips, HP bars and the construction/production/research bars no longer overlap;
they sit in a single **ordered, non-overlapping** overlay stack, HP bars show only when relevant, and
persistent hero status lives in its fixed HUD cluster rather than floating over the map.

**Defects fixed (with file references):**
- **Keyboard category switching was undiscoverable.** T26 only had `nextTab`/`prevTab` (`]`/`[`) in
  `ui/keyBindings.ts` → `input.ts onKeyP1()` → `hud.ts cycleBuildTab()`. A keyboard player who selected a
  miner could not intuitively reach the **military / defense / tech** tabs, so every building outside
  **economy** was effectively unreachable — the reported "select the builder, can't switch to military"
  dead-end. Now `Space` moves a **focus highlight** and `E` **opens** the focused tab.
- **On-screen indicators overlapped.** In `render/renderer.ts` the construction bar, the T26 production
  head-item bar and the research bar were all drawn at `y - 7`, the HP bar just above the entity, and the
  rank pip at `y - r - 2` — so a producing, low-HP, ranked building (or a hero with HP + mana + level)
  smeared its overlays on top of one another. All overlays now flow through one ordered layout helper.

### Scope checklist (T27)
- [x] With a builder selected, a **keyboard** Player 1 presses the **switch key (default `Space`)** to move
      a focus highlight across the build categories and **`E`** to open the highlighted one; `1`–`0` then
      build from it. Military/defense/tech are reachable — the "won't switch" dead-end is fixed.
- [x] The category **switch key is remappable** in Settings → Keyboard (default `Space`), with conflict
      detection, persistence, reset, and a **trilingual** label; the help text documents the `Space`→`E` flow.
- [x] World-space overlays (**rank/level pip, HP bar, construction/production/research bar, hero mana**) are
      laid out by a **single ordered helper** (`entityOverlayLayout`) with **fixed, non-overlapping** slots
      — no more colliding `y - 7` draws; only **one** secondary bar slot is ever used.
- [x] HP bars follow a **show-when-relevant** rule (selected / hovered / recently-hit / damaged, plus always
      the local hero), keeping the map uncluttered.
- [x] **Hero status** (HP, level/XP, ability cooldowns) lives in its **fixed per-side HUD cluster** (the
      `herobar` widget, T23/T24); only a minimal HP/mana bar + a `★level` pip remains over the hero on the
      map. Hero ability/ultimate ("super") cooldowns are shown in that cluster, not floating.
- [x] Overlays clip to each split-screen half (the renderer already clips `draw()` to its viewport),
      respect reduce-motion/quality, and add **no per-frame allocations** (a reused `OverlaySlots` scratch).
- [x] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography U+02BB/U+02BC);
      `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen (T24)
      and LAN (T25) regress cleanly.

### Implementation summary
- **`src/ui/keyBindings.ts`:** added **`cycleCategory`** to the **p1** group (default `"space"`) plus its
  `ACTION_DEFS` entry (`key.cycleCategory`), so it is remappable, conflict-checked (per p1 context),
  persisted, and resettable like every other binding. `nextTab`/`prevTab` (`]`/`[`) remain as an optional
  direct-cycle shortcut.
- **`src/input.ts`:** new callbacks `onCategoryFocus` / `onCategoryConfirm` (returns a boolean) /
  `onCategoryCancel`. In `onKeyP1`, `cycleCategory` (Space) calls `onCategoryFocus`; the `select` key (E)
  first calls `onCategoryConfirm()` and only falls back to `beginCursorSelect()` if it was **not** consumed;
  the existing `Escape` handler now also calls `onCategoryCancel`. No clash with single-player control
  groups (p1-keyboard has none) or the mouse player.
- **`src/ui/hud.ts`:** a `catFocus` index (−1 = none) over the `CATS` array. `focusNextCategory()` advances
  the highlight (wrapping, preview only — does not switch the tab); `confirmCategoryFocus()` opens the
  focused tab and returns true; `cancelCategoryFocus()` clears it; all three are wired to the
  InputController in `build()`. The miner panel renders a `.focus` class on the focused tab; `updatePanel`
  folds `catFocus` into the rebuild signature and drops focus when the miner panel isn't shown.
- **`src/render/renderer.ts`:** a pure, exported **`entityOverlayLayout(topY, out?)`** returning the
  `OverlaySlots` (`pipY` / `secY` / `manaY` / `hpY` / `barH`) stacked above the entity so the rows never
  collide; the renderer passes a reused `_ov` object (no per-frame allocation). `drawBuilding` now draws a
  **single** secondary bar (construction → production → research priority) at `secY`; `drawHpBar` uses
  `hpY` (+ hero mana at `manaY`) and a new `shouldShowHp()` declutter rule; `drawUnit` draws the rank pip
  (and a hero `★level` pip) at `pipY`.
- **`src/i18n.ts`:** `key.cycleCategory` and an updated `settings.panelKeys` help line (the `Space`→`E`
  flow) in all three locales (Uzbek with U+02BB `ʻ`). **`styles.css`:** a `.tab.focus` highlight visually
  distinct from `.tab.active`.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles client + server with **zero TS errors**. **Seventeen** suites
pass: the prior fifteen plus the two new T27 suites — `catnav` and `overlay`.

- **Space→E category navigation.** `test/catnav.mjs` drives a `p1-keyboard` InputController with the same
  category-focus callbacks the HUD wires: pressing `Space` advances the focus index and **wraps**, while
  the **active tab is unchanged** (preview only); pressing `E` **opens** the focused category, is
  **consumed** (the selection is untouched — no cursor-select fired), and a subsequent `1` then `Q` issues
  a **build** from the newly-opened military category — proving the dead-end is fixed. `Esc` clears focus
  without changing the tab; `E` with no focus performs a normal cursor-select; single-player `Space` does
  nothing to the panel.
- **Remappable + conflict-checked switch key.** `test/keybindings.mjs` asserts the `p1.cycleCategory`
  default is `space` and that it participates in the per-context conflict detection (e.g. binding `command`
  to `space` reports the `cycleCategory` conflict; rebinding `cycleCategory` to a free key has none).
- **Non-overlapping overlays.** `test/overlay.mjs` asserts `entityOverlayLayout()` returns **distinct,
  ordered** slots (`pipY < secY < hpY < topY`) with at least `barH` separation between rows (so none
  overlap) across several `topY` values; that `manaY === secY` (the hero mana shares the single secondary
  slot — never doubled); that it is deterministic; and that the optional `out` param is **reused** (the
  returned object is the same reference — no per-frame allocation in the hot path).
- **Show-when-relevant HP.** Implemented as `shouldShowHp()` (selected / hovered / recently-hit / damaged
  / local hero); full-HP idle units draw no bar, decluttering the map (verified by reading the rule and by
  the unchanged gameplay suites).
- **Trilingual + parity.** `localeParity()` (in `test/smoke.mjs`) passes with the new keys present in
  uz/ru/en.
- **No regression.** The sim/netcode/split-screen routing are untouched; `smoke, net, host, lobby, input,
  hudlayout, stress, split, keybindings, kbinput, lan, production, research, visuals, keyboard` all stay
  green, and the renderer still clips each viewport in `draw()` (split-screen safe).

**[OPT] deferred:** a separate "global powers / super-weapon" countdown strip — the only persistent
super-ability today is the hero ultimate, whose cooldown already lives in the fixed `herobar` cluster, so
no redundant floating strip was added; and an elaborate world-space status-icon row (brownout remains a
building tint). No required T27 scope item is dropped.



---

## T28 — Hero panel on-select, power gating & low-power warning, keyboard zoom, tidy hero/level HUD cluster  *(HUD + economy fixes)*

> Source of truth: `../MYSgenerals.md` §24 → T28. **UI/UX + one authoritative economy rule.** The
> power **gate** is a sim check inside `tryBuild` (so it holds identically in single-player,
> split-screen and LAN); everything else is client HUD/input. Netcode and the T23/T24 split-screen
> routing are unchanged (only the new keyboard bindings + the build-time power check were added).

**Goal (restated):** four reported fixes — (1) the hero's "super" ability bar must appear **only when
the hero is selected** (it was always on); (2) the **power economy must be honest** — a "LOW POWER"
warning at **≥ 90 %** usage, and **reject** a power-consuming build when there is no spare generation
instead of silently building it; (3) **Player 1 (keyboard)** can **zoom in/out** (default `Shift` /
`Ctrl`, remappable); (4) the `★ Lvl` badge must **no longer overlap** the command-panel buttons — when
the hero is selected its level + abilities sit **neatly in the command area**, for **all players**.

### Scope checklist (T28)
- [x] The hero's ability ("super") panel is shown **only when the hero is selected** (or while editing
      the HUD layout); hidden with `display:none` (no layout footprint) otherwise; still updates live.
- [x] A **"LOW POWER"** warning appears once power usage **≥ 90 %** of generation; a full deficit
      (`use > gen`) is a distinct, stronger "critical" state with the existing brownout slow-down.
- [x] Building a **power-consuming** structure with **insufficient power** is **rejected** with an
      `errors.needPower` toast (authoritative, in `tryBuild`) — not constructed, not charged; power
      **producers** (power plant / command center) are never blocked; in-progress consumers count.
- [x] **Player 1 (keyboard)** can **zoom in/out**; defaults **`Shift`** (in) / **`Ctrl`** (out),
      **remappable** in Settings (conflict-checked, persisted, trilingual), clamped to the 10–48 bounds.
- [x] The **`★ Lvl` badge no longer overlaps** the command panel (the hero cluster is docked in the
      command area, only on hero-select); the on-map hero level pip is unchanged; same for all players
      (single, split P1 left / P2 right, LAN), split-screen-safe.
- [x] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography U+02BB/U+02BC);
      `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen
      (T24) and LAN (T25) regress cleanly.

### Implementation summary
- **`src/constants.ts`:** pure `powerStatus(gen, use)` → `"ok" | "low" | "deficit"` (`LOW_POWER_RATIO =
  0.9`), shared by the HUD warning and the test.
- **`src/sim/world.ts` (`tryBuild`):** after cost/prereq/placement, a **power gate** — a consumer's
  demand is `-def.power` (producers have `def.power ≥ 0`); the build is rejected with an
  `errors.needPower` toast (no `pay`, no `spawn`) when `powerUse + (in-progress consumers) + demand >
  powerGen`. Producers and power-neutral buildings are never blocked.
- **`src/ui/hud.ts`:** `update()` now derives the power state from `powerStatus()` — the **LOW POWER**
  banner shows for `low` **and** `deficit`, with a `.critical` class (and the power meter gets `.low` /
  `.deficit`). Added the exported pure **`heroPanelShouldShow(heroId, selection, editing)`**;
  `updateHeroBar()` sets the herobar to `display:none` unless the hero is selected (or the layout is
  being edited), so the hero cluster only appears on selection.
- **`src/ui/keyBindings.ts`:** new **p1** bindings `zoomIn` (`shift`) / `zoomOut` (`control`) with
  `ACTION_DEFS` entries (conflict-checked, persisted, resettable, trilingual labels).
- **`src/input.ts` (`updateVirtualCursor`):** the keyboard player zooms `cam.zoom` about the cursor
  while the bound zoom key is held, clamped to `10..48` (same bounds as the wheel/pinch), re-clamping
  the camera.
- **`styles.css`:** the `.herobar` is re-anchored to the bottom-left command area (`left:10; bottom:142`,
  was centered `left:50%`) with a `.hud-root.split-right .herobar { right:10 }` rule for Player 2; the
  low-power banner is amber by default with a pulsing-red `.critical` state, and the power meter gains a
  `.low` (amber) fill.
- **`src/i18n.ts`:** `errors.needPower`, `key.zoomIn`, `key.zoomOut` in en/ru/uz (Uzbek with U+02BB),
  and the controls help mentions the keyboard `Shift`/`Ctrl` zoom.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles client + server with **zero TS errors**. **Twenty** suites
pass: the prior seventeen plus the three new T28 suites — `power`, `zoom`, `heropanel`.

- **Power gate + thresholds.** `test/power.mjs` proves `powerStatus()` classifies 80 % → `ok`, 90 % →
  `low`, over-budget → `deficit`; that a power-consuming `silver_mine` at `9/9` is **rejected** (no
  entity created, player **not charged**, `errors.needPower` emitted); that the same build at `10/9`
  **succeeds and is charged**; that a **power plant** builds even at a `5/20` deficit; and that an
  **in-progress consumer counts** so you cannot queue several builds over budget.
- **Keyboard zoom.** `test/zoom.mjs` holds the default `Shift` to raise `cam.zoom` and `Ctrl` to lower
  it on a `p1-keyboard` controller, confirms the **10–48 clamp**, and that zoom is steady with no key
  held. `test/keybindings.mjs` asserts the `zoomIn`/`zoomOut` defaults (`shift`/`control`) and their
  per-context conflict detection.
- **Hero-panel visibility.** `test/heropanel.mjs` checks `heroPanelShouldShow()`: hidden with an empty
  or other-unit selection, shown when the hero is in the selection, hidden for `heroId 0`
  (dead/respawning), and always shown while editing the HUD.
- **Trilingual + parity.** `localeParity()` (in `test/smoke.mjs`) passes with the new keys present in
  uz/ru/en.
- **No regression.** The sim/netcode/split-screen routing are untouched apart from the additive power
  check and bindings; `smoke, net, host, lobby, input, hudlayout, stress, split, keybindings, kbinput,
  lan, production, research, visuals, keyboard, catnav, overlay` all stay green.

**[OPT] deferred:** the hero cluster is **re-anchored** into the command area (no overlap, only on
select) rather than re-parented as literal child markup of the command-panel `<div>` — this keeps the
existing ability click/cooldown wiring intact while satisfying the "tidy, in the command area, no
overlap, all players" requirement. A separate global-powers/super-weapon countdown strip remains [OPT]
(the only persistent super is the hero ultimate, whose cooldown lives in the hero cluster). No required
T28 scope item is dropped.



---

## T29 — Unobstructed placement, cancel-build, mine extraction countdown & resource mine emblems  *(build-flow & economy readability)*

> Source of truth: `../MYSgenerals.md` §24 → T29. **UI/UX + a read-only economy readout.** Exposing
> the mine countdown is a snapshot-only addition (the host computes the ETA for the owner's own mines,
> like the existing per-building queue data); the authoritative simulation (§3.2), the `Command` union,
> the netcode and the T23/T24 split-screen routing / per-side customizable HUD are **unchanged**.

**Goal (restated):** three readability fixes reported in play — (1) when the player picks a building
and is choosing **where to put it**, the **HUD panels that cover the map hide** (keeping only the top
resource bar) so placement is unobstructed, with a clear **Cancel-build** control to back out (today
only `Esc` / right-click, which a touch or keyboard player can't discover); (2) selecting one of the
player's **resource mines** shows **how long until the next unit of metal** is extracted (a countdown /
progress to the next `+1`); (3) each mine gets a **distinct resource-coloured emblem** — silver on the
Silver Mine, iron on the Iron Mine, gold on the Gold Mine — both **on the map** and on the **build-menu
button**, so the three are instantly tellable apart.

**Defects fixed (with file references):**
- **Build panels covered the map.** `ui/hud.ts` kept `cmdpanel`, `selinfo` and `herobar` visible at all
  times; while `render/renderer.ts drawPlacement()` showed the placement ghost, those panels occupied
  the lower third of the screen, hiding where the building would drop.
- **Cancelling placement was hidden.** Placement was only cancellable via `Esc` / right-click
  (`input.ts onKey` / `onRightClick`) — no on-screen control, so touch (T23) / keyboard (T24) players
  had no discoverable way to abort a started build.
- **No income cadence feedback.** `sim/world.ts economySystem()` accumulates `resAccum` per mine and
  emits `+1` every `MINER_OUTPUT_INTERVAL` (silver, scaled by `minerSlots`), `IRON_INTERVAL`,
  `GOLD_INTERVAL` or `OIL_INTERVAL`; selecting a mine showed only its HP — no time-to-next-extraction.
- **Mines looked alike.** `render/renderer.ts drawBuilding()` drew each building's generic `def.icon`,
  so the Silver / Iron / Gold mines read as similar grey tiles (and similar grey build buttons).

### Scope checklist (T29)
- [x] Entering build-placement **hides** the map-covering HUD panels (command, selection, hero) and
      **restores** them when placement ends (placed / cancelled / `Esc`); works for mouse, touch and
      keyboard, and applies **per split-screen side** (each reads its own renderer's `placing`).
- [x] A discoverable **Cancel-build** control (`cmd.cancelBuild`) aborts placement via
      `input.setPlacing(null)` — reachable by touch and mouse — alongside `Esc` / right-click (the
      keyboard player's existing cancel); the panels reappear afterward.
- [x] Selecting an **own resource mine** shows the **time until the next metal** is extracted
      ("next {res} in {n}s" + a resource-coloured progress bar, and an on-map progress ring), and an
      **idle silver mine** (no miners) shows an *"assign miners"* hint; enemy mines stay fog-filtered.
- [x] The **Silver / Iron / Gold mines** show **distinct resource-coloured emblems** on the **map**
      (`drawBuilding()` gem) and in the **build menu** (`buildBtn()` coloured ◆), in the silver / iron /
      gold palette.
- [x] All new strings are **trilingual** (uz/ru/en, correct Uzbek orthography U+02BB/U+02BC);
      `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean; single-player, split-screen
      (T24) and LAN (T25) regress cleanly.

### Implementation summary
- **`src/constants.ts`:** pure, exported **`mineEta(type, resAccum, minerSlots)`** → `{ seconds, progress,
  resource, idle }` (or `null` for a non-mine). It mirrors `economySystem()` exactly: silver fills at
  `slots / MINER_OUTPUT_INTERVAL` per second (slots capped at `SILVER_MINE_SLOTS`; **idle** with no
  miners → `seconds: null`); iron / gold / captured oil fill on `IRON_INTERVAL` / `GOLD_INTERVAL` /
  `OIL_INTERVAL`. Shared by the host snapshot and the test.
- **`src/data.ts`:** exported **`RESOURCE_COLORS`** (silver `#c9d1d9`, iron `#8c98a4`, gold `#ffd23f`) +
  **`MINE_EMBLEM_COLORS`** mapping the three mine `BuildingId`s to those colours — one palette source
  used by both the renderer and the build menu.
- **`src/net/protocol.ts` + `src/host/matchHost.ts`:** added the own-entity-only `mn` field to
  `EntitySnap`; `snapEntity()` (the `mine` branch) attaches `mineEta()` for non-constructing mines, so
  the readout reaches only the owner (fog-safe, like the existing queue/research data).
- **`src/client/worldView.ts`:** `ViewEntity.mineEta` reconstructed from `es.mn` (idle → `seconds:null`).
- **`src/ui/hud.ts`:** exported pure **`panelsHiddenDuringPlacement(placing)`** (true while `placing`
  set). `update()` computes it from **this HUD's** `this.r.placing` and calls `applyPlacementVisibility()`
  (toggles the Cancel button) and passes the flag into `updatePanel` / `updateSelInfo` / `updateHeroBar`,
  which hide their widget while placing and restore it (respecting each widget's layout) when it ends.
  A `cancelbuild` button wired to `input.setPlacing(null)`. `updateSelInfo()` renders the new
  `mineEtaHtml()` for an own mine (countdown bar or idle/assign-miners hint). `buildBtn()` draws the
  resource-coloured ◆ emblem for the three mines.
- **`src/render/renderer.ts`:** `drawBuilding()` draws a faceted resource-coloured gem
  (`drawMineEmblem()`) for each mine instead of the grey emoji (team outline kept), and a thin
  progress ring (`drawMineRing()`) over a **selected own** mine showing fill toward the next unit.
- **`styles.css`:** `.cancelbuild` (centred per HUD half, shown only while placing), `.mine-eta` /
  `.mine-bar` / `.mine-dot` / `.mine-hint`, and `.ic.mine-emblem`.
- **`src/i18n.ts`:** `cmd.cancelBuild`, `mine.nextIn` (`{res}` / `{n}`), `mine.idle`,
  `mine.assignMiners`, `mine.yields` in en/ru/uz (Uzbek with U+02BB `ʻ`).

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles client + server with **zero TS errors**. **Twenty-two**
suites pass: the prior twenty plus the two new T29 suites — `mineeta` and `placement`.

- **Mine-ETA helper.** `test/mineeta.mjs` proves `mineEta()` returns **idle** (`seconds:null`,
  `progress:0`) for a silver mine with **0 miners**; scales the silver countdown with miner count
  (1→10s, 2→5s, 3→10/3 s) and **caps** at the work-slot count (extra miners don't help); returns the
  fixed `15s` / `30s` / `5s` from empty for iron / gold / captured oil with the correct `resource`;
  **counts down** as `resAccum` rises (0.0 > 0.5 > 0.9, ≈0 at full) across all four mine types; clamps
  out-of-range `resAccum`; and returns `null` for non-mine buildings.
- **Placement-visibility predicate + cancel-clears-placing.** `test/placement.mjs` asserts
  `panelsHiddenDuringPlacement()` is `false` for `null`/`undefined` and `true` while a building is
  being placed, then drives a real `InputController`: `setPlacing('barracks')` sets `r.placing` (panels
  hide), the **Cancel action** `setPlacing(null)` clears it (panels return), and starting placement
  also cancels a pending ability.
- **Trilingual + parity.** `localeParity()` (in `test/smoke.mjs`) passes with the five new keys present
  in uz/ru/en (Uzbek apostrophes U+02BB).
- **Split-safe / fog-safe.** Hide/show reads **this HUD instance's** renderer `placing`, so one
  split-screen player entering placement never blanks the other's panels; the mine ETA is attached only
  in the owner's `snapEntity` branch, so enemy mines never leak a countdown.
- **No regression.** The sim/netcode/split-screen routing are untouched (only an additive snapshot
  field + UI); `smoke, net, host, lobby, input, hudlayout, stress, split, keybindings, kbinput, lan,
  production, research, visuals, keyboard, catnav, overlay, power, zoom, heropanel` all stay green.

**[OPT] deferred:** none. The optional on-map progress cue (B3) is implemented as a thin
resource-coloured ring over the selected own mine (drawn around the tile, clear of the T27 overlay
bar stack). No required T29 scope item is dropped.



---

## T30 — Command Center leveling & tech-gated build tree, upgradeable defenses with range display, worked-mine economy  *(base progression + economy depth)*

> Source of truth: `../MYSgenerals.md` §24 → T30. **Extends the authoritative simulation** (§3.2) —
> new sim rules (CC level, mine occupancy) + an extended `upgradeBuilding` command — but every action
> still flows through the `Command` union → host → `MatchHost`, so it behaves identically in
> single-player, split-screen (T24) and LAN (T25). The netcode transport, the fog-filtered snapshot
> model and the T23/T24 input routing / per-side HUD are unchanged. All numbers are starting balance
> (tunable in T21); the only economy-rate change is that an **unmanned** mine now earns nothing.

**Goal (restated):** make the base **progress** and gate the tech tree behind it; give the defensive
towers **upgrade depth with a visible range**; and make every **mine require a miner working inside
it**. (1) the **Command Center** upgrades to **L2 / L3**; its level unlocks the **Barracks at L2** and
the **War Factory at L3**, with the **Guard / Cannon / Rocket** towers unlocking at **L1 / L2 / L3**.
(2) selecting a **defensive tower** shows the **radius it sees / fires in**, and towers upgrade to
**max L3** where **each level raises range + damage**; an upgrade takes **half the build time**.
(3) every **mine** needs a **miner inside** — an unmanned mine earns nothing; a miner trained at the CC
for **5 silver** auto-walks to a free mine, **enters it and vanishes from the map** (fixing the
"miner stands next to the mine" bug).

### Scope checklist (T30)
- [x] The **Command Center is upgradeable** to **L2** and **L3** (paid + **timed**: `CC_UPGRADE_TIMES`
      = 20 s / 30 s), one upgrade at a time, with an on-map gold progress bar + an **L2/L3 pip** and an
      **Upgrade → Lvl N** button (disabled at max / while upgrading).
- [x] The **CC level gates the build tree**: Barracks + Cannon Tower require **L2**, War Factory +
      Rocket Tower require **L3**; mines / power / **Guard Tower** are available at **L1**. `tryBuild`
      enforces it authoritatively (`errors.needBaseLevel` toast); `buildBtn()` greys locked items with
      a "requires Lvl N" hint and unlocks them live as the CC levels up.
- [x] Selecting a **defensive tower** draws its **attack-range ring** (grown by level) + a faint
      **vision ring** and prints **level · range · damage**; towers upgrade to **max L3**, each level
      adding **+1 tile range and +25 % damage** (`effRange` / `effDamage`), and the ring grows.
- [x] A defense/CC **upgrade takes half the build time** (`upgradeTime = ⌈buildTime ÷ 2⌉`; e.g. Guard
      Tower 15 s → 8 s) with explicit CC times.
- [x] **Every mine** (silver/iron/gold/captured oil) **produces only while a miner works inside**; an
      unmanned mine earns **nothing** and reports **idle** (T29 readout extended in `mineEta`).
- [x] A miner trained at the CC (**5 silver**) **auto-routes to the nearest free mine of any type,
      enters it, and is no longer drawn / selectable / targetable** (the "stands beside the mine" bug
      is fixed); a destroyed/sold mine **releases** its miners as idle (auto-reassigned).
- [x] All new actions flow through the **`Command` union → host → `MatchHost`** (authoritative); the
      AI was taught to upgrade its CC so single-player still fields an army; SP / split / LAN regress.
- [x] All new strings are **trilingual** (uz/ru/en, Uzbek U+02BB); `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean.

### Implementation summary
- **`src/constants.ts`:** `MAX_BASE_LEVEL`, `CC_UPGRADE_COSTS`, `CC_UPGRADE_TIMES`,
  `REQUIRED_BASE_LEVEL` (the gate table); `MAX_DEFENSE_LEVEL`, `DEFENSE_RANGE_PER_LEVEL` (+1),
  `DEFENSE_DAMAGE_PER_LEVEL` (+25 %), `defenseUpgradeCost()` (75 % of base), `upgradeTime()`
  (half build time); `mineSlotCap()` / `isMineType()`; and `mineEta()` extended so iron/gold/oil
  report **idle** with zero occupancy.
- **`src/sim/world.ts`:** `Entity.level` / `Entity.upgrading` / `Entity.inMine`; the `upgradeBuilding`
  command gains a `"level"` kind handled by **`tryUpgradeLevel()`** (CC + towers, cost/cap/“already
  upgrading” validated host-side); `tryBuild()` enforces the base-level gate; `productionSystem()`
  advances the timed level upgrade and applies the new level; `effRange()`/**`effDamage()`** scale a
  tower’s reach + damage by level; `economySystem()` only pays out a mine with occupancy (silver
  scales with miners, iron/gold/oil need ≥ 1); `workerSystem()` makes a miner **enter** the mine
  (`inMine`, hidden) on arrival, generalised occupancy recount + `autoAssignMiner()` to **all** mine
  types; `releaseMiners()` ejects occupants when a mine dies; `killEntity()` calls it; combat skips
  `inMine` miners (untargetable). The starting miner now begins **inside** its silver mine.
- **`src/host/matchHost.ts`:** the snapshot **skips `inMine` miners** (hidden from everyone) and adds
  the own-entity `lvl` + `up` (level + active upgrade) fields.
- **`src/net/protocol.ts` + `src/client/worldView.ts`:** `EntitySnap.lvl/up` → `ViewEntity.level` /
  `ViewEntity.upgrading`.
- **`src/render/renderer.ts`:** `drawBuilding()` shows the timed-upgrade progress bar, an **L2/L3
  level pip**, and — when a tower is selected — a bright **attack-range ring** (`drawRangeRing`) plus
  a faint vision ring.
- **`src/ui/hud.ts`:** `buildBtn()` greys base-level-locked buildings (kept locked through
  affordability refresh) and `activateCmd` refuses to arm placement for them; `prodPanelHtml()` adds
  the CC **level** upgrade button; new **`defensePanelHtml()`** (level upgrade + range/damage/level +
  Sell); `selectedUpgradable()` + `baseLevel()`; the selection panel prints a tower’s level/range/
  damage; the panel signature tracks building level + base level so it rebuilds on level changes.
- **`src/sim/ai.ts`:** the AI upgrades its CC toward L2 (after power + a mine) and L3 (after a
  barracks) so it still unlocks military, and trains miners up to its total work-slot count.
- **`src/i18n.ts` + `styles.css`:** `upgrade.toLevel` / `upgrade.upgrading`, `errors.needBaseLevel`,
  `hud.level/range/damage`, `toast.upgradeComplete` in uz/ru/en; `.defstats` styling.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles client + server with **zero TS errors**. **Twenty-five**
suites pass: the prior twenty-two plus three new T30 suites — `basetech`, `upgrades`, `minework` (and
`mineeta` was extended for the worked-mine rule).

- **Base-tech gating.** `test/basetech.mjs` asserts the `REQUIRED_BASE_LEVEL` table, that a fresh CC
  is L1 and only L1 tech builds, that the Barracks is **rejected at L1** with `errors.needBaseLevel`,
  that L2 unlocks Barracks + Cannon Tower (War Factory still base-level-locked with a finished
  Barracks present to isolate the gate), that L3 unlocks War Factory + Rocket Tower, and that
  `maxBaseLevel()` tracks the highest CC level.
- **CC + defense upgrades.** `test/upgrades.mjs` proves the CC upgrade is paid, timed at
  `CC_UPGRADE_TIMES`, applies on completion, is **capped at L3**, and rejects a concurrent upgrade;
  and that a Guard Tower upgrades in **half its build time** (8 s of 15 s), is paid the
  `defenseUpgradeCost`, and its **`effRange` (+1/level) and `effDamage` (+25 %/level)** rise per level
  up to L3, with an unaffordable upgrade rejected (shortfall toast, no change).
- **Worked-mine economy.** `test/minework.mjs` shows an **unmanned** mine yields nothing; a miner that
  reaches a mine **enters it** (`inMine`, occupancy 1) and the mine then produces; the in-mine miner
  is **absent from the owner's `MatchHost` snapshot** while the mine stays visible; destroying a mine
  **releases** its miner (not dead, no longer inside/bound); and `autoAssignMiner()` routes an idle
  miner to a free mine of any type.
- **Extended mine-ETA.** `test/mineeta.mjs` now asserts iron/gold/oil are **idle** with no miner and
  count down once occupied (silver still scales with miners).
- **Trilingual + parity / no regression.** `localeParity()` (in `smoke`) passes with the new keys
  (Uzbek U+02BB). All prior suites — including `host`, `net`, `stress` (anti-maphack / fog),
  `production`, `research`, `power`, `split`, `lan` — stay green; the sim/netcode/split routing are
  only extended, not altered.

**[OPT] deferred:** none. The optional on-map upgrade cue is implemented (gold progress bar + level
pip), and the defensive range display is the literal attack + vision rings. No required T30 scope
item is dropped. (Captured **oil derricks** also obey the "needs a miner" rule via the generic mine
helpers, though auto-assign prefers nearer base mines, so staffing a derrick is usually a manual
choice.)



---

## T31 — Split worker roles: a dedicated Engineer (builder) and a mining-only Miner, one miner per mine  *(worker model overhaul)*

> Source of truth: `../MYSgenerals.md` §24 → T31. **Extends the authoritative simulation** (§3.2) by
> reassigning which unit type builds vs. mines and changing mine occupancy — but introduces **no new
> netcode**: building still flows through the existing `build` `Command` and training through `train`,
> so it behaves identically in single-player, split-screen (T24) and LAN (T25). Numbers are starting
> balance (tunable in T21). **This supersedes T30's multi-miner silver mine** — every mine is now
> worked by exactly one miner.

**Goal (restated):** cleanly separate the two worker jobs that T0–T30 tangled into the Miner.
(1) the **Engineer** is the builder — select it, pick a building, it constructs it; the player **starts
with one Engineer**. (2) the **Miner is mining-only** — it walks to a free mine, goes inside and digs,
and **only one miner works a mine**; an idle miner with no free mine **waits** and auto-enters the next
mine built/freed. (3) both train at the **Command Center**: a **Miner for 5 silver** and an
**Engineer for 20 silver**.

### Scope checklist (T31)
- [x] A dedicated **Engineer (builder)** constructs buildings — `tryBuild()` dispatches
      `nearestIdleWorker()` which now returns the nearest idle **Engineer** (no `buildTask`/`captureTask`),
      and construction's `builderNear` speed check keys off the **Engineer**; it still captures derricks.
- [x] Selecting an **Engineer** opens the build palette (`hud.ts updatePanel`/`panelHtml`/`minerPanelShown`
      now find the engineer; header reads "Engineer — Build"); placing dispatches that builder.
- [x] The **Miner is mining-only** — it no longer takes a `buildTask`; it enters a free mine and digs,
      hidden on the map (T30 `inMine`).
- [x] **One miner per mine** for every type (`mineSlotCap()` returns **1**); the silver multi-miner
      scaling is retired in `economySystem()` and `mineEta()` (single-miner rate).
- [x] A Miner trained with **no free mine waits** and **auto-enters** the next mine built/freed
      (`workerSystem()` re-runs `autoAssignMiner()` for idle, unassigned miners; `claimedMiners()` makes
      miners spread one-per-mine instead of all heading to the nearest).
- [x] Both workers train at the **Command Center**: **Miner = 5 silver**, **Engineer = 20 silver**
      (`command_center.produces` now includes `engineer`; engineer cost `{ silver: 20 }`, built at CC + Barracks).
- [x] The player **starts with one Engineer** (`spawnBase()`), plus the silver mine + its in-mine miner.
- [x] The **AI** trains an Engineer to build (a second when the first is busy) and Miners one-per-mine,
      and still expands + fights; SP / split-screen (T24) / LAN (T25) regress cleanly.
- [x] Strings are **trilingual** (the "assign a miner" hint updated to singular); `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean.

### Implementation summary
- **`src/sim/world.ts`:** `nearestIdleWorker()` returns the nearest idle **Engineer** (not a Miner);
  the construction `builderNear` check looks for an Engineer; on completion the engineer is freed
  (cleared `buildTask`, no longer auto-sent to a mine). `spawnBase()` spawns a **starting Engineer**.
  The silver mine yields the **single-miner rate** (`TICK_DT / MINER_OUTPUT_INTERVAL`). `workerSystem()`
  auto-assigns **idle, unassigned** miners every tick (the "wait then enter" behavior); new
  `claimedMiners()` (walking + inside) drives `autoAssignMiner()` so miners spread one-per-mine.
- **`src/constants.ts`:** `mineSlotCap()` returns **1** for every mine type; `mineEta()` silver no
  longer scales with miner count (one-per-mine single rate).
- **`src/data.ts`:** `command_center.produces` adds `engineer`; the Engineer costs `{ silver: 20 }` and
  is built at the Command Center (and Barracks).
- **`src/ui/hud.ts`:** the build palette / T26–T27 keyboard category navigation now key off a selected
  **Engineer** (`builder`), with the panel header "Engineer — Build".
- **`src/sim/ai.ts`:** the AI trains an Engineer to build (and a spare when the first is busy) and
  Miners up to its mine count (one per mine).
- **`src/i18n.ts`:** the idle-mine hint now reads "assign **a** miner" (uz/ru/en).

### How each DoD line was verified
**Quality gate.** `bash build.sh` is clean (client + server, zero TS errors). **Twenty-six** suites
pass — the prior twenty-five plus the new **`workers`** suite (and `mineeta` updated for the
single-miner silver rate).

- **Worker roles / start units.** `test/workers.mjs` proves `spawnBase` yields exactly **one starting
  Engineer** (a free unit) plus the in-mine miner; `tryBuild` puts the `buildTask` on the **Engineer**
  and **never** on a Miner; `nearestIdleWorker` only returns engineers; and a constructing building
  advances **faster** with the engineer-builder present.
- **One miner per mine.** `mineSlotCap` is **1** for every type; two miners sent to one mine → only
  one works it (the other re-routes); `autoAssignMiner` sends two idle miners to two **different** free
  mines (via `claimedMiners`).
- **Idle wait + auto-enter.** A Miner trained with every mine staffed **waits** (no assignment); once a
  fresh mine appears it is **auto-assigned and enters** it.
- **Train costs.** The Miner costs 5 silver and the Engineer 20 silver, both produced at the CC.
- **No regression.** All prior suites — including `smoke` (starting silver mine + 1 miner still
  +1 / 10 s, `localeParity`), `minework`, `host`/`net`/`stress` (fog / anti-maphack), `production`,
  `research`, `power`, `basetech`, `upgrades` — stay green; only the worker role assignment + mine
  occupancy changed, not the netcode or split-screen routing.

**[OPT] deferred:** none. (The Engineer retains its oil-derrick capture role; right-clicking a mine
with a Miner still issues the `mine` command, and right-clicking a derrick with an Engineer still
captures.) No required T31 scope item is dropped.



---

## T32 — Bigger fortified multi-base maps, capturable garrisoned outposts (sub-bases) & stronger miner / AI logic  *(map & world enrichment)*

> Source of truth: `../MYSgenerals.md` §24 → T32. **Extends the authoritative simulation** (§3.2) with
> a new **wall terrain**, a capturable **outpost** neutral (a garrisoned tower that becomes a forward
> sub-base when captured) and improved miner/AI logic — but introduces **no new netcode**: outposts
> capture through the existing presence/engineer path and snapshot like the `oil_derrick` neutral, so it
> behaves identically in single-player, split-screen (T24) and LAN (T25).

**Goal (restated):** make the maps **bigger** with **more bases** like **Dota / Generals** — a few **big**
fortified main bases **and** several **small** capturable sub-bases — put **obstacles / walls inside the
bases**, add **capturable garrisoned towers** (simple defenders that never get stronger, used as
sub-bases, *whoever captures owns them*), enlarge the maps with **walls**, and make the **miner
mine-finding** and the **AI** logic stronger (fixing the related bugs).

### Scope checklist (T32)
- [x] A distinct **wall terrain (value 4)** blocks movement, is unbuildable, and renders on the world +
      minimap (and in the client placement preview).
- [x] Every main base is **fortified** — a wall on its two centre-facing sides with a wide (5-tile) gate
      plus cliff obstacle clusters — and the interior + every deposit/outpost stays **reachable** from the
      spawn (proven by `test/maps.mjs`).
- [x] A capturable **outpost** neutral exists: a garrisoned tower that **fires on intruders**, is
      **invulnerable to direct attack**, has **no veterancy/level scaling** (never gets stronger), and is
      captured by **presence** (12 s) or by an Engineer; on capture it **fires for the new owner**, grants
      vision, and is **re-capturable**.
- [x] An **owned outpost is a build anchor** (forward sub-base) for `placementValid()`, but is **not** a
      Command Center for win/lose.
- [x] The shipped maps are **bigger** (Twin Rivers 64→**80²**, Crossfire 72→**88²**) and gain fortified
      bases + outposts + walls + more/contested deposits; a **new big 4-base map `iron_crossroads` (96²)**
      is added and selectable, with a trilingual name + description and a `nameKey`-driven map label (the
      old hard-coded "mapA/mapB" binary is gone).
- [x] **Miner mine-finding** is **reachability-aware** — it picks the nearest *reachable* free mine and a
      miner stuck on an unreachable claim re-routes — so miners never stall on a mine they can't path to.
- [x] The **AI** contests/garrisons outposts, builds a stronger economy and now **reliably tech-ups to a
      Barracks and fields an army** (the pre-existing "never builds military" stall is fixed); SP /
      split-screen (T24) / LAN (T25) regress cleanly.
- [x] All new strings are **trilingual** (uz/ru/en, Uzbek U+02BB/U+02BC); `localeParity()` passes.
- [x] New + existing **headless tests pass**; `bash build.sh` is clean.

### Implementation summary
- **`src/types.ts` / `src/constants.ts` / `src/data.ts`:** `NeutralId` gains `outpost`; new capture
  constants (`DERRICK_CAPTURE_TIME` 6 s, `OUTPOST_CAPTURE_TIME` 12 s, `OUTPOST_CAPTURE_RADIUS` 3.2,
  `OUTPOST_CAPTURE_BOUNTY` 25); a `NEUTRAL_DEFS` table giving the oil derrick + the **outpost** their
  hp / vision / radius / footprint and the outpost its **garrison weapon** (a fixed bullet gun).
- **`src/sim/map.ts`:** rewritten — a terrain value `4` = WALL; `fortifyBase()` walls each base's two
  centre-facing sides with a 5-tile gate + cliff cover; `baseDeposits()` places per-base iron/gold inside
  the walls; the two shipped maps are enlarged + fortified with outposts; a new **`iron_crossroads`** big
  4-base map adds a walled central cross, six outposts and contested resources; `MAP_IDS` lists all three.
- **`src/sim/world.ts`:** the NavGrid blocks wall terrain; `spawn()` reads `NEUTRAL_DEFS` (so the outpost
  gets its garrison weapon and fires via the normal combat loop); `setupNeutrals()` spawns each neutral's
  own kind; `captureSystem()` is generalised to capture **both** the derrick and the outpost (own
  timings/rewards); `placementValid()` treats an **owned outpost** as a build anchor; **`autoAssignMiner()`
  is reachability-aware** (nearest *reachable* free mine) and `workerSystem()` re-routes a miner that
  can't reach its claim (a new `mineRetry` counter) instead of stalling.
- **`src/render/renderer.ts`:** a fifth `TERRAIN_COLORS` entry (stone wall) and a `drawOutpost()` (a stone
  fortress with crenellations, a team-coloured banner, a rotating garrison turret and a capture ring).
- **`src/client/worldView.ts`:** the client placement mirror blocks wall terrain and treats an owned
  outpost as a build anchor (+ blocks its tiles).
- **`src/sim/ai.ts`:** stronger economy (saturates to 3–4 silver mines so it can afford the iron/gold
  mines that gate the tech tree), an **early hero oil-derrick grab** for income, and an army squad that
  **contests outposts** (sub-bases) over derricks.
- **`src/i18n.ts` / `src/ui/menu.ts`:** `buildings.outpost.name`, `menu.mapC` and the three map
  descriptions in en/ru/uz; the menu/lobby map labels now use `getMap(id).nameKey` (third map supported).

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles client + server with **zero TS errors**. **Twenty-nine**
suites pass: the prior twenty-six plus three new T32 suites — `maps`, `outpost`, `minefind`.

- **Bigger fortified, reachable maps.** `test/maps.mjs` asserts all three maps' enlarged sizes + spawn
  counts, that each has **wall** and **cliff** terrain, that every spawn can **path to the centre through
  its gate**, that every deposit sits on buildable grass and is reachable, that every outpost/derrick is
  on clear reachable grass, and that a full base + the neutral garrison spawn cleanly.
- **Outpost = garrisoned, invulnerable, capturable sub-base.** `test/outpost.mjs` proves the outpost
  starts neutral with a garrison weapon, **fires on an intruder** and **never gains rank/level**, is
  **immune** to splash + attack orders, is **captured by presence** (a heavy tank out-stays its fire) and
  is **only captured, never destroyed**, becomes a **build anchor** that **fires for its new owner**, and
  that owning one does **not** satisfy the Command-Center win condition.
- **Reachability-aware miners.** `test/minefind.mjs` builds a wall-split arena and shows
  `autoAssignMiner()` picks the **reachable** mine over a nearer **walled-off** one, and a miner forced
  onto an unreachable claim **re-routes** to the reachable mine and digs.
- **Stronger AI (verified by self-play).** A headless 20-minute 4-AI self-play on the new map shows each
  AI reaching **Command Center Lvl 2**, building a **Barracks**, fielding an **army (5–9 units)** and
  **capturing 3–4 outposts** — versus the pre-T32 build, which never built any military in the same time.
- **Trilingual + parity / no regression.** `localeParity()` passes with the new keys (Uzbek U+02BB). All
  prior suites — including `host`/`net`/`stress` (anti-maphack / fog), `minework`, `workers`, `basetech`,
  `placement` — stay green; the sim/netcode/split-screen routing are only extended, not altered.

**[OPT] deferred:** outposts give **no passive income** (they are defensive sub-bases, not mines — income
still comes from mines and oil derricks); the AI's early hero derrick-grab is best-effort (it prioritises
the closer outpost sub-bases). No required T32 scope item is dropped.



---

## T33 — Online play over the internet via serverless WebRTC P2P, a Local/Online host toggle, invite/reply codes & per-player editable names  *(browser-hosted internet multiplayer)*

> Source of truth: `../MYSgenerals.md` §24 → T33. **Transport-layer addition only.** The authoritative
> simulation (§3.2), the `Command`/event pipeline, the `ClientMsg`/`ServerMsg` protocol envelopes, the
> lobby model and the snapshot/fog code are **unchanged** — T33 adds a new browser-hosted, peer-to-peer
> **WebRTC** path and reuses the existing host-side message loop, so single-player, split-screen (T24)
> and the LAN Node host (T25) all keep working exactly as before.

**Goal (restated):** the game must be playable **online** over the internet **without running
`host.bat`/`host.sh` and without any server we operate**. In the lobby's Connection panel there is a
**Local / Online** toggle; the person opening the game adds slots and, on **Online**, an **invite code**
is generated automatically and handed to the joining player, who enters it to join (the joiner returns a
**reply code** the host applies). **Local** host works the same way with **no launcher**. Finally,
**every player can edit their own name**.

**Chosen approach — serverless WebRTC P2P (per the spec, no broker/server):** gameplay is pure
peer-to-peer over a reliable, ordered `RTCDataChannel` using only **free public STUN** for NAT discovery;
**the host runs in the browser** (it already runs `Lobby` + `MatchHost`), and signaling is a **two-step,
non-trickle** code exchange (invite → reply). **TURN is out of scope** (a server we'd operate); strict/
symmetric NAT (~10–20%) may fail without it — documented & deferred.

### Scope checklist (T33)
- [x] Host-side logic extracted into a **DOM/Node-agnostic `GameHost`**; the Node WebSocket host (LAN,
      T25) is **re-homed onto it with zero behaviour change**.
- [x] A **`WebRTCTransport`** implements the existing client transport + lobby-callback surface over a
      reliable `RTCDataChannel` using the **same `ClientMsg`/`ServerMsg`** envelopes.
- [x] A **browser host endpoint** (`BrowserHost`) runs `Lobby` + `MatchHost` in the tab, attaches **2–4**
      WebRTC peers (host itself via an in-page `LoopbackPeerTransport`), and handles peer disconnect —
      **no `host.bat` required**.
- [x] **Serverless STUN-only signaling**: the host generates an **invite code** (Copy / `#join=` URL), the
      joiner produces a **reply code**, the host applies it and the channel opens — **no server we run**.
- [x] The lobby **Connection** panel has a **Local / Online** toggle (the "run host.bat" note is gone);
      **Local** works with **no launcher**, **Online** shows invite + paste-reply + a live connected-devices list.
- [x] A **Join Online** menu entry + **`#join=` auto-prefill** lets a friend paste an invite and join.
- [x] **Every player can edit their own name** in the lobby (`setName` reflected to all; persisted to
      `localStorage("mys.name")`).
- [x] New strings are **trilingual** (uz/ru/en, correct Uzbek orthography U+02BB/U+02BC); `localeParity()` passes.
- [x] **Headless tests** cover `GameHost` (mock peer sink), the signaling codec, name editing and the mode
      toggle; the **real WebRTC connection is documented as user-verified**; `bash build.sh` is clean and
      every suite is green.
- [x] **No regression:** single-player, split-screen (T24) and the LAN Node host (T25) all behave as before.

### Implementation summary
- **`src/host/gameHost.ts` (new):** the host message loop extracted from `src/server/host.ts` into a
  reusable, engine/DOM/Node-agnostic **`GameHost`** that talks to an abstract **`HostPeerSink`** (send a
  `ServerMsg` to peer N / disconnect peer N) and is fed bytes via `onPeerMessage(peerId, raw)` (or
  `onPeerMessageObject` for the no-JSON loopback path). It owns the `Lobby` + `MatchHost`, claims the
  reserved **host slot 0** for the loopback peer, handles `hello`/`cmd`/`lobby`/`ping`, reconnection grace
  tokens, the 20 Hz tick + per-player **fog-filtered** snapshots/events, and graceful `shutdown()` —
  **byte-identical** `ServerMsg` behaviour to the old inline loop. A read-only `match` getter is the test
  seam.
- **`src/server/host.ts` (re-homed):** now a **thin LAN driver** — it accepts RFC-6455 sockets, forwards
  their frames into `GameHost.onPeerMessage`, and implements `HostPeerSink` by framing `ServerMsg`s back
  over the sockets (`conns` map). Static serving, the `window.__MYS_HOST__` injection and the QR/room-code
  console output are unchanged. The LAN path is unchanged behaviour (T25 suites stay green).
- **`src/net/signal.ts` (new):** pure, dependency-free **invite/reply codec** — `{t, sdp, ice?}` → JSON →
  UTF-8 → URL-safe base64 (manual base64 + `TextEncoder`, so it runs identically in the browser and the
  headless Node runner). The decoder is tolerant of whitespace, line-wrapping, the standard base64
  alphabet and `#join=<code>` URL fragments, and returns `null` (never throws) on malformed input.
- **`src/net/webrtcTransport.ts` (new, browser-only):** **`WebRTCTransport`** implements the same
  `LobbyClient` + `RemoteClientCallbacks` surface as `SocketTransport` but over an `RTCDataChannel`
  carrying the identical envelopes; plus **`joinOnline(invite, name, cb)`** — the joiner's answerer
  signaling (apply offer → create answer → gather ICE to completion → produce the reply code), STUN-only
  `RTC_CONFIG`, and a `gatherComplete()` helper with a safety timeout.
- **`src/net/webrtcHost.ts` (new, browser-only):** **`BrowserHost`** wires a `GameHost` to WebRTC — one
  `RTCPeerConnection` (offerer) per joiner, `createInvite()` / `applyReply()`, and a `HostPeerSink` that
  JSON-frames to each open data channel. The host's own player is a **`LoopbackPeerTransport`** (the
  spec's "host via LoopbackTransport", extended to speak the full lobby protocol so the host uses the very
  same lobby UI + `RemoteSession` path as every joiner — snapshots delivered as objects, no serialization).
- **`src/net/transport.ts`:** added the shared **`LobbyClient`** (transport + `sendLobbyAction`) and
  **`RemoteClientCallbacks`** interfaces so the menu/lobby UI and `RemoteSession` have one code path for
  every transport (socket / WebRTC / loopback). `RemoteSession` now takes a `ClientTransport`.
- **`src/ui/lobbyMode.ts` (new):** pure, DOM-free **`LobbyMode`** predicates (`showInvitePanel`,
  `showLocalNote`, `showLanInfo`, `isHostMode`, `hostModeFor`) so the toggle behaviour is unit-testable.
- **`src/ui/menu.ts`:** the host lobby Connection panel gains the **Local/Online toggle** (the long
  host.bat note → a short `lobby.localNote`); flipping to **Online** stands up a `BrowserHost` and routes
  the host (slot 0) into the shared remote-lobby UI with an **invite/reply panel** (create invite → Copy →
  paste the joiner's reply → Connect device) + a live **Connected devices** list. `showRemoteLobby` now
  takes a `LobbyMode` (`lan` / `online-host` / `online-guest`) and renders the right Connection panel. A
  **Join Online** Play-menu entry + **`showJoinOnline(prefill)`** lets a friend paste an invite, produce a
  reply code, and drop into the lobby. Every player's slot shows an **editable name field** → `setName`
  (reflected to all) + `setDefaultName` persistence.
- **`src/main.ts`:** `onRemoteMatch(transport, startMsg)` enters a `RemoteSession` for any transport; a
  **`#join=<code>`** fragment auto-opens Join Online pre-filled; `clearSessions()` tears down the online
  host/joiner.
- **`src/i18n.ts`:** **`defaultName()`/`setDefaultName()`** helpers (the missing writer for
  `localStorage("mys.name")`) + all new online/lobby strings in **en/ru/uz** (Uzbek U+02BB/U+02BC).
- **`styles.css`:** styling for the Local/Online toggle, the paste-able code boxes and the invite panel.

### How each DoD line was verified
**Quality gate.** `bash build.sh` compiles `tsconfig.json` + `tsconfig.server.json` with **zero TS
errors**. **Thirty-two** suites pass: the prior twenty-nine plus three new T33 suites — **`gamehost`**,
**`signal`**, **`online`**.

- **`GameHost` over a mock peer sink (transport-agnostic proof).** `test/gamehost.mjs` drives `GameHost`
  with an in-memory sink (no sockets/WebRTC): the loopback peer claims **slot 0**, a joiner takes **slot
  1**, the broadcast lobby **strips tokens**, **`setName` reflects** to the lobby, both ready → the host
  starts, both receive `start` (`you` 0/1), and the primed **snapshots are fog-filtered** (each player's
  snapshot has **zero** enemy entities and **no economy leak**). **Command ownership** is enforced (player
  1 cannot move a player-0 unit; a spoofed `owner=0` build is coerced to the authenticated player 1) —
  mirroring `test/host.mjs`/`test/net.mjs`. `shutdown()` broadcasts `hostgone`.
- **Signaling codec round-trip.** `test/signal.mjs` proves invite (offer) and reply (answer) blobs
  **encode→decode byte-identically** (multi-line SDP preserved), the optional `ice[]` round-trips, and the
  decoder tolerates whitespace / line-wrapping / a `#join=<code>` URL fragment while **rejecting**
  empty/garbage/non-signal input (returns `null`, never throws).
- **Editable name + persistence.** `test/online.mjs` proves `setDefaultName()` writes
  `localStorage("mys.name")` and `defaultName()` reads it back (survives a reload; a Cyrillic name
  round-trips), and `test/gamehost.mjs` proves the `setName` lobby action **reflects to the broadcast
  lobby state** seen by all peers.
- **Local/Online toggle predicate.** `test/online.mjs` asserts the pure `lobbyMode` predicates
  (`showInvitePanel`/`showLocalNote`/`showLanInfo`/`isHostMode`/`hostModeFor`) for every mode.
- **Trilingual + parity.** All new strings go through `t()` in en/ru/uz with correct Uzbek orthography;
  `test/smoke.mjs`'s `localeParity()` (fails if any key is missing in any locale) passes.
- **Live WebRTC leg — user-verified (be explicit).** The sandbox is `INTEGRATIONS_ONLY` (no outbound
  internet) and the headless runner has **no `RTCPeerConnection`**, so the **real peer-to-peer connection
  is browser-/internet-only and is verified manually by the design owner** on real devices: host picks
  **Online** → copies the invite → friend (different network) pastes it on **Join Online**, sends back the
  reply → channel opens → match runs P2P. Everything transport-agnostic (above) is covered headlessly.
- **No regression.** The sim/protocol/lobby/snapshot code is untouched; the LAN host is re-homed onto the
  same `GameHost` with no behaviour change — `smoke, net, host, lobby, lan, input, hudlayout, stress,
  split, keybindings, kbinput, production, research, visuals, keyboard, catnav, overlay, power, zoom,
  heropanel, mineeta, placement, basetech, upgrades, minework, workers, maps, outpost, minefind` all stay
  green.

**[OPT] deferred:** **TURN relay** for strict/symmetric NAT (it would be a server we operate) — STUN-only
covers the common case and the limitation is documented in-lobby (`lobby.noTurnNote`) and the README; an
optional free-TURN fallback may be added later. Combining **online and split-screen in one match** is out
of scope (online is the P2P path, split-screen the local loopback path). No required T33 scope item is dropped.



### T33 follow-up — online split-screen, editable Player 2 name, and the host ready/start fix

After the initial T33 landed, three lobby gaps were reported and fixed (still transport-layer only;
sim/protocol/lobby model unchanged):

- **Online + split-screen (was [OPT] deferred).** The online-host lobby now has a **"Split-screen —
  add a 2nd player on this device"** toggle: ticking it attaches a **second in-page
  `LoopbackPeerTransport`** (Player B) to the same `GameHost`, claiming a normal human slot and
  **auto-readied** (it shares the keyboard/screen). On start, the host enters a **split-screen
  `RemoteSession`** — which was generalized from one local player to **N local players** (a
  `RemoteBundle` per player: own transport, fog-filtered `WorldView`, camera, HUD and pointer-scoped
  input, two viewports), mirroring `MatchSession` but as a pure thin client. So one laptop can field
  two couch players while a third friend joins over WebRTC (pick a 3–4 player map to leave a slot).
- **Both local players are renamable.** The local lobby previously only let Player 1 rename; now
  **Player 2 (split-screen) has its own editable name field** (`lobby.setName(splitB, …)`), the
  online host's Player 2 has one too, and the lobby slot rows display each player's chosen name.
- **Latent host-can't-start bug.** `showRemoteLobby` never gave the host (slot 0) a ready control,
  yet `canStart` requires every human ready — so the **browser host (LAN *and* online) could never
  start a match**. Fixed without touching the lobby model: `canStartRemote` no longer requires the
  host's own slot to be ready (its **Start implies readiness**), and the host's Start handler sends
  `ready` then `start`, satisfying the unchanged server-side `canStart` (which still requires all
  humans ready, incl. the host). Local split-screen Player B is auto-readied so it never blocks Start.

**Verification.** `bash build.sh` clean; **33** headless suites pass (the prior 32 + new
`test/splithost.mjs`, which drives `GameHost` over a mock sink with **two local players**: Player A
claims slot 0, Player B claims slot 1 + auto-readies, the match is **gated until the host readies**,
then `ready`→`start` begins it and both locals receive their own `start` + **fog-filtered** snapshot).
The live two-window WebRTC + split-screen leg remains **user-verified** (no `RTCPeerConnection`/
internet in the sandbox). New strings `lobby.onlineSplit` / `lobby.onlineSplitHint` /
`lobby.player2Name` added in en/ru/uz; `localeParity()` passes. No regression to single-player,
split-screen (T24) or the LAN host (T25).
