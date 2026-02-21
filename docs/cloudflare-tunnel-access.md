# Cloudflare Tunnel + Access (Family Only)

This guide publishes local `SceneWords` with your own domain, but only allows approved family accounts.

## 0) Prerequisites

- Domain is hosted on Cloudflare (or moved to Cloudflare DNS).
- Local app is reachable at `http://127.0.0.1:8000`.
- `cloudflared` installed on this Windows machine.

## 1) Install cloudflared

```powershell
winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
```

## 2) Create tunnel + DNS + local config

From repo root:

```powershell
.\scripts\cf-tunnel-init.ps1 `
  -TunnelName "scenewords-home" `
  -ZoneName "yourdomain.com" `
  -Hostname "sw" `
  -ServiceUrl "http://127.0.0.1:8000"
```

This script will:

- run `cloudflared tunnel login` if needed
- create/reuse the tunnel
- create DNS route `sw.yourdomain.com`
- generate `.cloudflared/config.yml`

## 3) Run app and tunnel

Terminal A:

```powershell
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Terminal B:

```powershell
.\scripts\cf-tunnel-run.ps1
```

Now `https://sw.yourdomain.com` should reach your local service.

## 4) Lock down with Cloudflare Access

In Cloudflare dashboard:

- `Zero Trust` -> `Access` -> `Applications` -> `Add an application`
- Type: `Self-hosted`
- Application domain: `sw.yourdomain.com`
- Session duration: set short, e.g. `12h` or `24h`

Recommended policies for family use:

1. `Allow` policy:
   - `Emails` in allowlist (all family emails)
2. Identity provider:
   - `One-time PIN` (email OTP), or
   - Google OAuth with allowed specific emails
3. Optional hardening:
   - block all countries except where family resides
   - add backup admin email in allowlist

## 5) Optional: run tunnel as service (auto start)

```powershell
cloudflared service install
```

If you run multiple tunnels on same host, prefer an explicit service command with the config path.

## Notes

- `.cloudflared/config.yml` is gitignored in this repo.
- Tunnel credentials live in `%USERPROFILE%\.cloudflared\`.
- If `SceneWords` uses `VIDEO_GATEWAY_BEARER_TOKEN`, keep it enabled. Access is outer auth layer, token is inner layer.
