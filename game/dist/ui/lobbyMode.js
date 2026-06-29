// MYS Generals — lobby Connection-panel mode (spec §24 T33-C1). Pure, DOM-free predicates that
// decide what the "Connection" panel shows for each host/join mode, so the toggle behaviour is
// unit-testable (test/online.mjs) independently of the menu DOM.
// The right-hand panel shows the invite/reply controls only when this browser is the online host.
export function showInvitePanel(mode) { return mode === "online-host"; }
// The short "this device only" note is shown for local play (it replaces the old run-host.bat note).
export function showLocalNote(mode) { return mode === "local"; }
// The LAN room-code / join-URL / QR block is shown only for the Node LAN host path.
export function showLanInfo(mode) { return mode === "lan"; }
// Whether this browser is the authoritative host in the given mode (drives host-only controls).
export function isHostMode(mode) { return mode === "local" || mode === "online-host"; }
// Map the two-way Local/Online toggle to a host LobbyMode.
export function hostModeFor(online) { return online ? "online-host" : "local"; }
