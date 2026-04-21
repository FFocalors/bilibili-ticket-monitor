$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
Set-Location $repoRoot

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Fail-Setup {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Red
  Write-Host "Install Node.js 20+ and run this script again: https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Command "node")) {
  Fail-Setup "Node.js was not found."
}

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
  Fail-Setup "Current Node.js version is $nodeVersion. Node.js 20+ is required."
}

if (-not (Test-Command "pnpm")) {
  if (Test-Command "corepack") {
    Write-Host "pnpm was not found. Trying to enable pnpm through corepack..." -ForegroundColor Yellow
    corepack enable
  }
}

if (-not (Test-Command "pnpm")) {
  Write-Host "pnpm was not found. Run: npm install -g pnpm" -ForegroundColor Red
  exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
pnpm install

$configPath = Join-Path $repoRoot "config\events.yaml"
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Host "config/events.yaml was not found. Starting first-time setup..." -ForegroundColor Cyan
  & (Join-Path $repoRoot "scripts\configure.ps1")
}

Write-Host "Starting GUI: http://127.0.0.1:4173" -ForegroundColor Green
Write-Host "If your browser does not open automatically, copy the URL above." -ForegroundColor Yellow
pnpm gui
