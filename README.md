# addabaaz

ADDABAAZ — film & ad production house, Kolkata.

## Repository layout

| Path | What it is |
| --- | --- |
| `frontend/` | **The Angular app — the site you should work on and deploy.** See [`frontend/README.md`](frontend/README.md). |
| `index.html` | The original single-file version of the site, kept for reference only. It is no longer the source of truth. |
| `images/`, `BTS/`, `UpcomingReleases/` | Media shared by both versions. The Angular app mirrors them into `frontend/public/` at build time (hard links, no duplication). |

## Quick start

```bash
cd frontend
npm install
npm start        # http://localhost:4200
```

Production build (prerendered static output):

```bash
cd frontend
npm run build    # → frontend/dist/frontend/browser
```
