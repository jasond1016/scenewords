param(
  [string]$LanIp,
  [int]$Port = 8443,
  [string]$Host = "0.0.0.0",
  [string]$CertFile = "certs/scenewords-ip.pem",
  [string]$KeyFile = "certs/scenewords-ip-key.pem",
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
  Write-Host "SceneWords HTTPS listening on $Host`:$Port" -ForegroundColor Cyan
  Write-Host "If you want a copyable iPad URL, pass -LanIp <your-lan-ip>." -ForegroundColor DarkGray
}

Write-Host "Using certificate: $resolvedCertFile" -ForegroundColor DarkGray
Write-Host "Using private key: $resolvedKeyFile" -ForegroundColor DarkGray

$uvicornArgs = @(
  "run",
  "uvicorn",
  "app.main:create_app",
  "--factory",
  "--host",
  $Host,
  "--port",
  $Port.ToString(),
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
  & $uv $uvicornArgs
}
finally {
  Pop-Location
}
