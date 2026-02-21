param(
  [string]$ConfigPath = ".cloudflared/config.yml"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-CloudflaredPath {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $candidates = @(
    "C:\Program Files\cloudflared\cloudflared.exe",
    "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "cloudflared is not installed."
}

$cloudflared = Resolve-CloudflaredPath

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfigPath = Join-Path $repoRoot $ConfigPath

if (-not (Test-Path $resolvedConfigPath)) {
  throw "Config not found: $resolvedConfigPath. Run .\scripts\cf-tunnel-init.ps1 first."
}

& $cloudflared tunnel --config $resolvedConfigPath run
