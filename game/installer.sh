#!/usr/bin/env bash
# =============================================================================
#  MYS Generals — one-click installer / setup  (macOS / Linux)
# =============================================================================
#  Just run:   ./installer.sh
#
#  This checks for everything the game needs and installs WHATEVER IS MISSING,
#  then compiles the project so it is ready to play. It is safe to re-run — it
#  only installs the pieces you don't already have.
#
#  What it ensures:
#    1. Node.js          — REQUIRED to run/host the game   (installed if missing)
#    2. TypeScript (tsc) — optional, only to rebuild src/  (installed if missing)
#    3. A fresh build into dist/                            (compiled if tsc is present)
#
#  The game itself is dependency-free (no npm packages, no node_modules needed
#  to play), so Node.js is the only hard requirement.
# =============================================================================
set -u
cd "$(dirname "$0")"

# ---- pretty output (falls back to plain text if the terminal has no colour) ----
if [ -t 1 ]; then C_OK="\033[32m"; C_INFO="\033[36m"; C_WARN="\033[33m"; C_ERR="\033[31m"; C_OFF="\033[0m";
else C_OK=""; C_INFO=""; C_WARN=""; C_ERR=""; C_OFF=""; fi
ok()   { printf "${C_OK}[OK]${C_OFF} %s\n"   "$1"; }
info() { printf "${C_INFO}[..]${C_OFF} %s\n" "$1"; }
warn() { printf "${C_WARN}[!]${C_OFF} %s\n"  "$1"; }
err()  { printf "${C_ERR}[X]${C_OFF} %s\n"   "$1" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "==================================================="
echo "   MYS Generals — setup"
echo "==================================================="
echo

# Use sudo for system package managers when we're not already root and sudo exists.
SUDO=""
if [ "$(id -u)" -ne 0 ] && have sudo; then SUDO="sudo"; fi

# ---------------------------------------------------------------------------
# Node.js installers
# ---------------------------------------------------------------------------
install_node_via_pkg() {
  # Try the system package manager (needs admin). Returns 0 on success.
  if have apt-get; then $SUDO apt-get update -y && $SUDO apt-get install -y nodejs npm && return 0; fi
  if have dnf;     then $SUDO dnf install -y nodejs npm && return 0; fi
  if have yum;     then $SUDO yum install -y nodejs npm && return 0; fi
  if have pacman;  then $SUDO pacman -Sy --noconfirm nodejs npm && return 0; fi
  if have zypper;  then $SUDO zypper install -y nodejs npm && return 0; fi
  if have apk;     then $SUDO apk add --no-cache nodejs npm && return 0; fi
  if have brew;    then brew install node && return 0; fi
  return 1
}

install_node_via_nvm() {
  # User-space install — no admin rights needed. Downloads nvm, then Node LTS.
  info "Installing Node.js with nvm (no admin rights needed)…"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    if   have curl; then curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || return 1
    elif have wget; then wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || return 1
    else err "Need 'curl' or 'wget' to install Node.js automatically."; return 1; fi
  fi
  # shellcheck disable=SC1090,SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts && nvm use --lts
}

# ---- 1) Node.js (required) ----
if have node; then
  ok "Node.js found ($(node --version))"
else
  warn "Node.js not found — installing it now…"
  if install_node_via_pkg && have node; then
    ok "Node.js installed ($(node --version))"
  elif install_node_via_nvm && have node; then
    ok "Node.js installed via nvm ($(node --version))"
  else
    err "Could not install Node.js automatically."
    err "Please install it from https://nodejs.org and run ./installer.sh again."
    exit 1
  fi
fi

# ---- 2) TypeScript compiler (optional — only needed to rebuild from src/) ----
TSC=""
if have tsc; then
  TSC="tsc"
elif have npx && npx --no-install tsc --version >/dev/null 2>&1; then
  TSC="npx tsc"
fi

if [ -z "$TSC" ] && have npm; then
  info "Installing the TypeScript compiler…"
  if npm install -g typescript >/dev/null 2>&1 && have tsc; then
    TSC="tsc"
  elif [ -n "$SUDO" ] && $SUDO npm install -g typescript >/dev/null 2>&1 && have tsc; then
    TSC="tsc"
  elif npm install --no-save typescript >/dev/null 2>&1; then
    TSC="npx tsc"   # local fallback (creates ./node_modules)
  fi
fi

if [ -n "$TSC" ]; then
  TSC_VER="$(NODE_OPTIONS="" $TSC --version 2>/dev/null | grep -i version | head -n1)"
  ok "TypeScript ready (${TSC_VER:-installed})"
else
  warn "TypeScript not available — skipping the (optional) rebuild."
  warn "That's fine: the bundled dist/ already lets you play without building."
fi

# ---- 3) Build (best-effort; the shipped dist/ already works) ----
if [ -n "$TSC" ]; then
  info "Compiling the game (client + server)…"
  # NODE_OPTIONS is cleared to avoid inherited preloads breaking tsc.
  if NODE_OPTIONS="" $TSC -p tsconfig.json && NODE_OPTIONS="" $TSC -p tsconfig.server.json; then
    ok "Build complete → dist/"
  else
    warn "Build reported an error, but the bundled dist/ still lets you play."
  fi
fi

# Make the launchers runnable.
chmod +x run.sh host.sh build.sh installer.sh 2>/dev/null || true

echo
ok "Setup complete — MYS Generals is ready to play!"
echo
echo "  Play (single-player / split-screen / vs-AI):"
echo "      ./run.sh            then open the printed URL in your browser"
echo "  Host for friends on the same Wi-Fi / LAN:"
echo "      ./host.sh"
echo

# Offer to launch right away when run interactively.
if [ -t 0 ]; then
  printf "Start the game now? [y/N] "
  read -r ans
  case "$ans" in
    [Yy]*) exec ./run.sh ;;
    *)     echo "You can start it any time with ./run.sh" ;;
  esac
fi
