#!/usr/bin/env bash
# Build script for MYS Generals (dependency-free TypeScript -> ES modules).
# The sandbox has no npm registry access, so we use the globally installed tsc.
set -e
cd "$(dirname "$0")"
# NODE_OPTIONS is cleared because the sandbox sets a missing proxy-bootstrap preload.
NODE_OPTIONS="" tsc -p tsconfig.json
echo "Client build complete -> dist/"
NODE_OPTIONS="" tsc -p tsconfig.server.json
echo "Server build complete -> dist/server/"
echo "Run server: NODE_OPTIONS=\"\" node dist/server/host.js"
