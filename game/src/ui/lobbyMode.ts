// MYS Generals — lobby Connection-panel mode (spec §24 T33-C1). Pure, DOM-free predicates that
// decide what the "Connection" panel shows for each host/join mode, so the toggle behaviour is
// unit-testable (test/online.mjs) independently of the menu DOM.

// local       — single-player / split-screen / vs-AI on this device (today's behaviour, no host.bat).
// online-host — this browser hosts an internet P2P match: show invite + reply + connected devices.
// online-guest— this browser joined someone else's online match.
// lan         — joined a Node LAN host (T25): room code + join URL + QR.
export type LobbyMode = "local" | "online-host" | "online-guest" | "lan";

// The right-hand panel shows the invite/reply controls only when this browser is the online host.
export function showInvitePanel(mode: LobbyMode): boolean { return mode === "online-host"; }

// The short "this device only" note is shown for local play (it replaces the old run-host.bat note).
export function showLocalNote(mode: LobbyMode): boolean { return mode === "local"; }

// The LAN room-code / join-URL / QR block is shown only for the Node LAN host path.
export function showLanInfo(mode: LobbyMode): boolean { return mode === "lan"; }

// Whether this browser is the authoritative host in the given mode (drives host-only controls).
export function isHostMode(mode: LobbyMode): boolean { return mode === "local" || mode === "online-host"; }

// Map the two-way Local/Online toggle to a host LobbyMode.
export function hostModeFor(online: boolean): LobbyMode { return online ? "online-host" : "local"; }
