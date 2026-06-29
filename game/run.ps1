# MYS Generals - PowerShell launcher (Windows / macOS / Linux). Requires Node.js.
# Usage:  ./run.ps1 [port]
param([int]$Port = 8000)
Set-Location -Path $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install it from https://nodejs.org" -ForegroundColor Yellow
  exit 1
}
node serve.mjs $Port
