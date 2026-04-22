param(
  [string]$LanIp,
  [int]$Port = 8443,
  [string]$BindHost = "0.0.0.0",
  [string]$CertFile = "certs/scenewords-ip.pem",
  [string]$KeyFile = "certs/scenewords-ip-key.pem",
  [int]$GracefulShutdownSec = 5,
  [switch]$Reload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-UvPath {
  $cmd = Get-Command uv -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "uv is not installed or not on PATH."
}

function Resolve-RepoPath([string]$RelativePath) {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $RelativePath))
}

$uv = Resolve-UvPath
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedCertFile = Resolve-RepoPath $CertFile
$resolvedKeyFile = Resolve-RepoPath $KeyFile

if (-not (Test-Path $resolvedCertFile)) {
  throw "Certificate file not found: $resolvedCertFile"
}

if (-not (Test-Path $resolvedKeyFile)) {
  throw "Private key file not found: $resolvedKeyFile"
}

if ($LanIp) {
  Write-Host "SceneWords HTTPS URL: https://$LanIp`:$Port" -ForegroundColor Cyan
}
else {
  Write-Host "SceneWords HTTPS listening on $BindHost`:$Port" -ForegroundColor Cyan
  Write-Host "If you want a copyable iPad URL, pass -LanIp <your-lan-ip>." -ForegroundColor DarkGray
}

Write-Host "Using certificate: $resolvedCertFile" -ForegroundColor DarkGray
Write-Host "Using private key: $resolvedKeyFile" -ForegroundColor DarkGray
Write-Host "Graceful shutdown timeout: $GracefulShutdownSec s" -ForegroundColor DarkGray

$uvicornArgs = @(
  "run",
  "uvicorn",
  "app.main:create_app",
  "--factory",
  "--host",
  $BindHost,
  "--port",
  $Port.ToString(),
  "--timeout-graceful-shutdown",
  $GracefulShutdownSec.ToString(),
  "--ssl-certfile",
  $resolvedCertFile,
  "--ssl-keyfile",
  $resolvedKeyFile
)

if ($Reload) {
  $uvicornArgs += "--reload"
}

Push-Location $repoRoot
try {
  $env:VIDEO_GATEWAY_SHUTDOWN_DIAGNOSTICS = "true"
  $env:VIDEO_GATEWAY_WORKER_SHUTDOWN_TIMEOUT_SEC = [Math]::Max(1, $GracefulShutdownSec).ToString()
  & $uv $uvicornArgs
}
finally {
  Pop-Location
}
