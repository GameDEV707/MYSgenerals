#!/usr/bin/env node
// MYS Generals — Host launcher (spec §19 equivalent without Electron).
// Starts the authoritative Node host server and opens the game in the default browser.
// Usage: node launch.mjs [port]
//
// This provides the same experience as the Electron .exe: double-click → host starts →
// shows URL/QR/room code → clients join via browser. The host player also plays in a browser.
import { spawn, exec } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.argv[2] || "3000";

console.log("Starting MYS Generals host...");
console.log("  • Keep every device on the SAME Wi-Fi / network.");
console.log("  • If a firewall prompt appears on first run, allow access (private networks).");
console.log("  • The LAN join link, room code and QR appear below — share them with other players.");
console.log("");

const server = spawn(process.execPath, [join(ROOT, "dist", "server", "host.js"), PORT], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: "", PORT },
});

// Wait for the server to bind, then open the browser
setTimeout(() => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Opening browser: ${url}\n`);
  // Cross-platform browser open
  const platform = process.platform;
  if (platform === "win32") exec(`start "" "${url}"`);
  else if (platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}" 2>/dev/null || echo "Open ${url} in your browser"`);
}, 1200);

// Forward signals to the server
process.on("SIGINT", () => { server.kill("SIGINT"); process.exit(0); });
process.on("SIGTERM", () => { server.kill("SIGTERM"); process.exit(0); });
server.on("exit", (code) => process.exit(code ?? 0));
