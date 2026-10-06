# Maintenance mode

Take the viewer side of ADDABAAZ offline on purpose — for a migration, a risky deploy, a database fix or a
storage move — without touching `.env`, redeploying, or losing the ability to turn it back on.

**Admin → Maintenance** is the switch. While it is on:

* every browser page is answered with the branded **maintenance page** (`maintenance.html`) and a real
  `503` + `Retry-After`, so search engines back off and come back later;
* every viewer API call answers `503` with `{"error":{"code":"maintenance","message":"…","until":"…"}}`;
* an **open tab** or a **resumed app** shows the maintenance screen the moment one of its calls is refused,
  keeps polling `/api/v1/status`, and reloads itself as soon as the site is back.

Nothing is lost, nobody is signed out, and payments already in flight still settle.

## What keeps working

| Still available | Why |
|---|---|
| `/api/v1/health`, `/health/ready` | uptime checks and load balancers must keep seeing the process |
| `/api/v1/status` | what the site and the apps poll to know we are down and when we come back |
| `/admin/*` (and the console page) | **this is how the switch gets turned off** |
| `/auth/*` | signing in to reach that console |
| `/payments/webhook` | a payment that already happened must still settle |
| `/api/v1/notifications/unsubscribe` | unsubscribe links in e-mails that were already sent |
| `/app/*`, `/media/*`, `/uploads/*`, `sw.js` | the maintenance page and the consoles need their assets |

Everything else under `/api/v1` — catalog, plans, credits, support, push and playback — is refused.

## Turning it on

1. **Admin → Maintenance**.
2. Write the message viewers will read (240 characters; leave it empty for the default).
3. Optionally set **Back by** — the site reopens by itself at that moment even if nobody remembers. The
   quick buttons fill in 30 min / 1 h / 2 h / 4 h. Leave it empty to stay down until you switch it off.
4. Flip **Maintenance mode** on. The page tells you when it started and links to a live preview.

The whole call is one API request (`PATCH /api/v1/admin/maintenance`), so a script can do it too:

```bash
# on (for an hour)
curl -X PATCH https://your-site/api/v1/admin/maintenance \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"message":"Upgrading for an hour — thanks for your patience!","until":"'"$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"'"}'

# off
curl -X PATCH https://your-site/api/v1/admin/maintenance \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"enabled":false}'
```

Every change is written to the audit log (`maintenance.on`, `maintenance.off`, `maintenance.update`).

## How it behaves

* **Nobody is locked out of the console.** Sign-in and `/admin/*` always pass, so the switch can never
  strand you. Keep an `ADMIN_TOKEN` or an admin account handy anyway — the console is the only way back in.
* **The window can end by itself.** `until` in the past means "not in maintenance", whatever the switch
  says. The console shows "window ended" so you can tidy the switch off.
* **A database outage is not maintenance mode.** If the settings cannot be read, the site keeps serving
  normally — an outage is what the health endpoints and the error monitor are for.
* **Open clients recover on their own.** The app polls `/api/v1/status` every 20 seconds while the screen is
  up and reloads when the site is back; the page itself does the same, so nobody has to know to refresh.
* **Nothing is cached.** All maintenance responses are `no-store`, and the page is never part of the service
  worker's app shell, so an installed app cannot come back to a stale copy of it.

## Unconfigured / off

With the switch untouched, nothing changes at all: the keys are unset, the state reads `active: false`, and
the page only exists as a preview at `/maintenance`. There is no env var to set and no migration to run.

## Troubleshooting

| Symptom | Check |
|---|---|
| Viewers still see the site | `curl -s https://your-site/api/v1/status` → `maintenance.active`. A cache in front of the site cannot hold pages back for long (`no-store` + `Retry-After`), but a CDN with its own "always online" rule can. |
| The console does not load | Only `/api/v1/admin/*` and `/auth/*` are exempt — a reverse proxy rule blocking `/admin` will still block it. |
| Payment webhooks | They must reach `/api/v1/payments/webhook`; if Razorpay retries them later, settlement is idempotent anyway. |
| The switch flips back to off | An `until` in the past. Clear the “Back by” field to stay down until you turn it off. |
| The app shows the screen after you turned it off | It polls every 20 seconds and reloads itself; a device that stayed closed reloads normally on its next launch. |
