# Website frontend

HTML/templates and the existing responsive UI live here. Runtime data comes only from `GET /api/v1/content`. Contact submission uses `POST /api/v1/inquiries`. A failed request keeps the branded retry screen; there is no static workbook fallback or browser Excel library.

The backend serves this directory's index/assets/components through a public allowlist at its root origin. Alternatively, with a backend already running:

```sh
npm ci
npm start   # 0.0.0.0:5173; /api and /media proxy to BACKEND_URL (default port 3000)
```

`assets/js/api-config.js` is a **public** configuration file, never a secret file. Empty `ADDABAAZ_API_BASE_URL` uses the current origin, which works with the backend server and development proxy. For split hosting set the deployed HTTPS API origin, e.g. `https://api.example.com`, and allow your website's origin in backend CORS.

A split static host must serve this directory at `/` and these shared modules at `/shared/`: `api-client.js`, `workbook.js` (schema/helpers only; no browser Excel dependency), `copy-keys.js`, `runtime-data.js`. Proxy `/media` to the backend as well for startup branding, or change the startup logo/favicon/preload URLs in index.html to the backend's absolute URLs. Do not publish the entire repository. The API's content media URLs are automatically resolved against the API origin.

Use the same-origin backend deployment unless you specifically need split hosting. GitHub Pages cannot host the API/database. After frontend changes, run `npm run version-assets` from the repository root. Do not apply immutable caching to index/config/shared modules.
