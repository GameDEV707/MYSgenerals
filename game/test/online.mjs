// MYS Generals — T33 online UI-logic test (spec §24 T33-C1/D1/E2).
// Covers the transport-agnostic online pieces that don't need a browser: the per-player editable
// name persistence (defaultName/setDefaultName ↔ localStorage) and the Local/Online Connection-panel
// mode predicates. The live WebRTC connection is user-verified.
// Run: NODE_OPTIONS="" node test/online.mjs

// Provide a mock localStorage BEFORE exercising the name helpers (the sandbox has none).
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

const { defaultName, setDefaultName } = await import("../dist/i18n.js");
const { showInvitePanel, showLocalNote, showLanInfo, isHostMode, hostModeFor } = await import("../dist/ui/lobbyMode.js");

let failures = 0;
function assert(c, m) { if (!c) { console.error("  ✗ " + m); failures++; } else console.log("  ✓ " + m); }

console.log("Editable name persists to localStorage('mys.name') (§24 T33-D1):");
assert(defaultName() === "Player", "default name is 'Player' when nothing saved");
setDefaultName("Bekzod");
assert(store["mys.name"] === "Bekzod", "setDefaultName writes localStorage('mys.name')");
assert(defaultName() === "Bekzod", "defaultName reads the persisted name back (survives a reload)");
setDefaultName("Олег");
assert(defaultName() === "Олег", "a Cyrillic name round-trips through localStorage");

console.log("Local/Online Connection-panel mode predicates (§24 T33-C1):");
assert(showInvitePanel("online-host") === true, "invite panel shows for the online host");
assert(showInvitePanel("local") === false, "invite panel hidden for local play");
assert(showInvitePanel("online-guest") === false, "invite panel hidden for the online guest");
assert(showInvitePanel("lan") === false, "invite panel hidden for LAN");

assert(showLocalNote("local") === true, "the 'this device' note shows only for local");
assert(showLocalNote("online-host") === false, "no local note when hosting online");

assert(showLanInfo("lan") === true, "the room-code/QR block shows only for LAN");
assert(showLanInfo("online-host") === false, "no LAN block when hosting online");

assert(isHostMode("local") === true && isHostMode("online-host") === true, "local + online-host are host modes");
assert(isHostMode("online-guest") === false && isHostMode("lan") === false, "guest/LAN are not host modes");

assert(hostModeFor(true) === "online-host", "toggle ON → online-host");
assert(hostModeFor(false) === "local", "toggle OFF → local");

console.log("");
if (failures === 0) { console.log("ALL ONLINE TESTS PASSED ✓"); process.exit(0); }
else { console.error(failures + " ONLINE TEST(S) FAILED ✗"); process.exit(1); }
