param(
  [Parameter(Mandatory = $true)]
  [string]$TunnelName,

  [Parameter(Mandatory = $true)]
  [string]$ZoneName,

  [string]$Hostname = "scenewords",
  [string]$ServiceUrl = "http://127.0.0.1:8000",
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

  throw "cloudflared not found. Install it first."
}

$cloudflared = Resolve-CloudflaredPath

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedConfigPath = Join-Path $repoRoot $ConfigPath
$configDir = Split-Path -Parent $resolvedConfigPath
if (-not (Test-Path $configDir)) {
  New-Item -ItemType Directory -Path $configDir | Out-Null
}

$certPath = Join-Path $HOME ".cloudflared/cert.pem"
if (-not (Test-Path $certPath)) {
  Write-Host "[1/5] No cert.pem found. Running: cloudflared tunnel login" -ForegroundColor Yellow
  & $cloudflared tunnel login
}
else {
  Write-Host "[1/5] Found cert.pem: $certPath" -ForegroundColor Green
}

Write-Host "[2/5] Ensure tunnel exists: $TunnelName" -ForegroundColor Cyan
$tunnelId = $null
try {
  $allTunnels = & $cloudflared tunnel list --output json | ConvertFrom-Json
  $existing = $allTunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  if ($existing) {
    $tunnelId = $existing.id
    Write-Host "Tunnel exists. Reusing id: $tunnelId" -ForegroundColor Green
  }
}
catch {
  Write-Host "Could not list tunnels yet. Will try create directly." -ForegroundColor Yellow
}

if (-not $tunnelId) {
  & $cloudflared tunnel create $TunnelName | Out-Host
  $allTunnelsAfterCreate = & $cloudflared tunnel list --output json | ConvertFrom-Json
  $created = $allTunnelsAfterCreate | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  if (-not $created) {
    throw "Tunnel '$TunnelName' was not found after creation."
  }
  $tunnelId = $created.id
  Write-Host "Tunnel created. id: $tunnelId" -ForegroundColor Green
}

$fullHostname = "$Hostname.$ZoneName"

Write-Host "[3/5] Bind DNS route: $fullHostname" -ForegroundColor Cyan
& $cloudflared tunnel route dns $TunnelName $fullHostname | Out-Host

$credentialsFile = (Join-Path $HOME ".cloudflared/$tunnelId.json") -replace "\\", "/"
$yaml = @"
tunnel: $tunnelId
credentials-file: $credentialsFile

ingress:
  - hostname: $fullHostname
    service: $ServiceUrl
  - service: http_status:404
"@

Write-Host "[4/5] Write config: $resolvedConfigPath" -ForegroundColor Cyan
Set-Content -Path $resolvedConfigPath -Value $yaml -Encoding UTF8

Write-Host "[5/5] Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1) Start your app on $ServiceUrl"
Write-Host "2) Run tunnel: .\scripts\cf-tunnel-run.ps1 -ConfigPath `"$ConfigPath`""
Write-Host "3) In Cloudflare Zero Trust -> Access -> Applications, protect https://$fullHostname"
Write-Host "4) Add policy: Include specific family emails (OTP or Google OAuth)"
