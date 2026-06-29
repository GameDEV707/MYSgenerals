// MYS Generals — Electron main process (spec §19). Bundles the Node host server + Chromium
// frontend into one clickable .exe. When launched:
// 1. Starts the authoritative host server (HTTP + WebSocket on a LAN port)
// 2. Opens a BrowserWindow pointing at the host URL (the host's own game client)
// 3. Displays the join URL / QR / room code so others can join from their browsers
//
// Build: `npx electron-builder --win` (or --mac / --linux) — requires npm install.
// This file is the entry point specified in electron-builder config.
//
// NOTE: This file cannot be compiled/run in the current sandbox (no Electron package available).
// It is provided as the spec-compliant Electron wrapper ready to build once npm is accessible.

// @ts-nocheck — Electron types not available in this sandbox
const { app, BrowserWindow, shell } = require("electron");
const { fork } = require("child_process");
const path = require("path");

const PORT = 3000;
let serverProcess: any = null;
let mainWindow: any = null;

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    // Fork the host server as a child process
    const serverPath = path.join(__dirname, "..", "server", "host.js");
    serverProcess = fork(serverPath, [String(PORT)], {
      stdio: "pipe",
      env: { ...process.env, PORT: String(PORT) },
    });
    // Wait a short time for the server to bind
    setTimeout(resolve, 800);
    serverProcess.stdout?.on("data", (data: Buffer) => {
      console.log("[server]", data.toString());
    });
    serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error("[server]", data.toString());
    });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "MYS Generals",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  // Load the game client from the local host server
  mainWindow.loadURL(`http://localhost:${PORT}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
});
