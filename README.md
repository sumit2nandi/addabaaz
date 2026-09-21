# ADDABAAZ

A static film-production website with **Excel-powered content** and a browser-based content editor without a login requirement. No backend, database, build step or subscription is required to host it.

## Quick start

Serve the repository over HTTP; do not double-click the HTML files (`file://` blocks template/workbook loading).

```sh
npm ci
npm start
```

Open `http://localhost:3000/` for the website or `http://localhost:3000/admin.html` for the editor. The development server binds to `0.0.0.0` for remote previews. Alternatively, with Python installed:

```sh
python3 -m http.server 3000 --bind 0.0.0.0
```

Production remains plain static hosting, including GitHub Pages and subdirectory deployments. Publish `index.html`, `admin.html`, `components/`, `assets/`, `data/` and the existing media folders together. Node, Python and `node_modules` are **not** needed on the production server.

## Editing content

### With the admin page

1. Open **`admin.html`** directly—no Google account, username or password is required. It loads the published `data/website.xlsx`.
2. Select a worksheet, search for a row, and edit its fields. Add, delete or reorder content rows using the buttons. Copy and Settings keys are fixed; only their values are editable.
3. Choose **Preview changes** to open an unpublished preview in a new tab. Validation runs first. Previews use this browser's local storage and **never change the regular website**.
4. Choose **Download Excel** to get the updated `website.xlsx`.
5. Back up the previous workbook, replace **`data/website.xlsx`** in the repository/hosting files, and deploy as usual. Reload the website to see the published content.

**Open Excel** imports an existing `.xlsx` workbook. It does not grant permission to overwrite that file. In supported Chromium browsers over HTTPS (or localhost), **Link local workbook** lets you open an existing file and **Save to linked file** writes directly back to it after permission and confirmation. External file changes are checked before overwriting. In other browsers, or when file access is blocked by an embedded preview, use import/download instead.

Edits stay in memory until downloaded or saved. Leaving with unsaved changes triggers a browser warning. Preview snapshots remain in local storage until replaced or browser site data is cleared; normal visitors do not load them. A downloaded file is not automatically deployed.

### With Excel or LibreOffice

Edit **`data/website.xlsx`** directly, save as `.xlsx`, and deploy the updated file. The workbook has frozen header rows, filters, and a **Read Me** worksheet.

- Preserve sheet names, column headers, and Copy/Settings keys. Columns may be reordered; data rows may be added, removed and reordered.
- Keep cells formatted as **Text**, especially durations (`00:30`), leading-zero numbers (`01`), YouTube IDs and ISO dates (`2026-09-14T13:30:04Z`). Do not use date/time cells, formulas, rich-text cells or Excel hyperlink objects; paste URLs as plain text.
- Use plain text, not HTML. Bengali and other Unicode text are preserved.
- Empty optional cells and empty catalogue worksheets are supported. Required fields and relationships are validated before rendering, importing, saving or previewing.
- Limits: 10 MB per workbook, 5,000 data rows per sheet, 16,000 characters per cell. Only `.xlsx` is supported, not `.xls`, `.xlsm` or CSV.
- Exports rebuild the supported content sheets and Read Me. Custom Excel formatting, unrelated worksheets and unsupported objects are not preserved; keep a backup.
- Images/videos are not embedded in Excel. Upload new images to the site separately. YouTube videos use their 11-character IDs, not full watch URLs.

## Workbook reference

| Worksheet | Content / conventions |
| --- | --- |
| **Shows** | `key`, title, subtitle, description, image, genre. Keys must be unique and stable. Episode counts are derived automatically. |
| **Episodes** | One episode per row. `project` must match a Shows `key`. Row order controls episode order. Includes original IDs, position, YouTube ID, publish date, duration, views, thumbnail, availability, episode number and kind. |
| **Promos** | Promotional videos and specials, in row order. `kind`: `PROMO` or `SPECIAL`. `availability`: `available` or `unavailable`. |
| **Upcoming** | Poster filename, optional title, `featured` and `home` (`yes`/`no`). Multiple featured posters form a slideshow in row order. `home=yes` includes a poster in the home rail; all rows appear in the full gallery. |
| **BTS** | Behind-the-scenes filename and optional title, in display order. |
| **Team** | Team member ID, name, role, quote and image path. |
| **Services** | Service ID, display number, title and description. |
| **Missions** | Mission ID, language (`en` or `bn`) and text. |
| **Copy** | Template-bound titles, navigation, page copy, contact text, contact/social links, form labels, metadata, branding and footer. Keys identify the component and field. |
| **Settings** | Schema version, image folders, homepage limits and public inquiry-form endpoints/field IDs. |

Images for Shows and Team are relative to the site root, e.g. `images/Team/Deep.png`, or HTTP(S) URLs. Upcoming and BTS use a **filename only**, resolved against `upcomingFolder` and `btsFolder` in Settings (folders must end in `/`). Spaces, parentheses and Bengali filenames work. Media paths used in CSS cannot contain quote characters.

Home show cards and the top-three hero slides retain the original view-count ranking. Shows without episodes are retained in the workbook but are not displayed in the home show rail. The `position` column is preserved metadata, not a sort override. Video availability does not verify the actual availability on YouTube.

### Common changes

- **Add a show:** add a Shows row with a unique `key`, then add Episodes rows whose `project` matches it. Add/upload the poster separately.
- **Rename a show key:** update matching episode `project` values too. Prefer changing the title without changing the stable key.
- **Choose featured posters:** set `featured=yes` on any number of Upcoming rows. One poster is static; multiple posters crossfade smoothly every five seconds in workbook row order, looping from the last poster to the first indefinitely. Swipe on touchscreens, drag left/right with a mouse, use the keyboard arrow keys, or choose a gold slide marker, just like the homepage banner. There are no previous/next or play/pause buttons. Click or keyboard-activate an image to open its full-size popup, just like other upcoming posters. Titles become badge text. Autoplay continues after swipes and pointer clicks (including at the last poster); it pauses during a drag, keyboard focus, hidden browser tabs, other site tabs and open popups. Reduced-motion users get manual navigation without autoplay or fades. The `home` flag still controls the separate home rail.
- **Change a phone number:** search for the old number in Copy. Update both visible text and the corresponding `tel:` or WhatsApp `href` value.
- **Change contact-form destinations:** update Settings `appsScriptUrl`, or `googleFormAction` and `formField.*`. These are public integration settings, not secrets. The existing cross-origin form integration cannot confirm delivery because it uses opaque `no-cors` responses; test the configured destination separately.

## Admin access

Google sign-in has been removed. The editor opens directly, without an OAuth client ID, allowlist or login screen. It is a public static tool for editing local workbooks. It cannot publish changes or overwrite hosted files; actual publishing still requires access to your repository or hosting account. Never place confidential information or credentials in the public workbook.

## Deployment and stale-cache troubleshooting

If admin reports `Upcoming / featured: only one featured poster is allowed`, it is running the older validator. The current validator permits multiple featured rows.

- Confirm GitHub Pages is deploying the intended branch and that its latest build has completed successfully. Updating the repository alone does not mean deployment has finished.
- Deploy the HTML, JavaScript, CSS, components and workbook together, not just the Excel file. After the deployment completes, hard-refresh `admin.html` (`Ctrl+Shift+R` / `Cmd+Shift+R`), or close and reopen the tab. An already-open editor retains its old JavaScript until reloaded.
- All browser entry points, transitive module imports, component templates and interaction scripts now use a consistent content-based version query. The editor footer displays its build ID for diagnosis. Workbook fetches request uncached data.
- After changing runtime files, run **`npm run version-assets`** before committing/deploying. It stamps a new deterministic asset revision and is safe to rerun. Its generated URLs are checked in, so GitHub Pages still needs no build system. This prevents stale JavaScript from being reused once the new HTML is loaded; it cannot force an old open tab to refresh itself.

### Why does the page say “Loading ADDABAAZ…”?

The page reads the Excel workbook and loads section templates before displaying the site, so a brief loading message is normal. It is unrelated to authentication. The startup path now:

- Downloads the Excel reader and application modules concurrently, and waits for the reader before opening the workbook.
- Downloads interaction scripts in parallel while executing them in their original dependency order.
- Loads optional Google Fonts and Font Awesome styles without blocking page startup.
- Catches failed module imports, missing scripts/templates and Excel-reader failures, including failures before application initialization.
- Times out workbook requests after 20 seconds and overall startup after 25 seconds. Failed startup displays an actionable message and a reload link instead of leaving the loading label indefinitely.

If an error remains after reloading, check the named deployment file or network request. The workbook still needs to be a valid `.xlsx`, and JavaScript must be enabled. The admin keeps Open Excel available if only the published workbook fails, allowing you to import a corrected file locally.

## Components and maintenance

```text
index.html                       Small site shell and bootstrap
admin.html                       Standalone content editor
components/
  navigation.html                Header and navigation
  home.html                      Hero and home rails
  player.html                    Video player and episodes
  upcoming.html, bts.html         Full galleries
  about.html, services.html       Studio information
  contact.html                   Inquiry form and contact layout
  video-preview.html             Hover video preview
  poster-preview.html, modal.html
  footer.html
assets/css/
  site.css                       Original website styling
  admin.css                      Responsive editor styling
assets/js/
  workbook.js                    Shared schema, validation and XLSX I/O
  copy-keys.js                   Stable text/attribute binding names
  site-loader.js                 Loads Excel and HTML components
  site-content.js                Safe copy/team/service/mission rendering
  admin.js                       Editing and file workflows
  page-bootstrap.js              Async startup, dependency loading, timeout/recovery
  site/                          Existing interactions, split by responsibility
    helpers.js, hero.js, navigation.js, catalog.js,
    galleries.js, featured-upcoming.js, video-preview.js, poster-preview.js,
    contact.js, app.js
assets/vendor/                   Pinned ExcelJS browser bundle and license
data/website.xlsx                Single source of website content
```

Content changes need **only the workbook**. Layout changes belong in components/CSS; behavior changes belong in the relevant JavaScript file. Template `data-copy` / `data-copy-href` / similar attributes map to Copy worksheet keys. New template bindings must be added both to `copy-keys.js` and to the workbook; tests check that these remain in sync. Dynamic UI controls and validation messages are application code, not catalogue content.

The browser XLSX library is vendored so the workbook does not depend on a runtime CDN. `npm run vendor` restores the checked-in ExcelJS 4.4.0 bundle from the locked dependency. Keep its license with the bundle. Existing Google Fonts, Font Awesome, YouTube and Google Forms integrations still need internet access.

## Publishing and security

This is a **static local editor without sign-in**, not a server-side CMS or authorization service. The admin page cannot modify a hosted workbook. A visitor may use the editor on their own downloaded/local copy, but publishing still requires access to your repository or hosting account. There is no client-side password pretending to protect hosted data.

- **The workbook is public. Never put credentials, private contacts, submissions or other secrets in it.**
- Imported content is validated. Text is rendered as text/escaped HTML, not executable markup. Unsafe URLs, invalid identifiers, formulas, duplicate IDs and orphan episodes are rejected.
- Only use workbooks from trusted editors. File and row limits are not a complete defense against malicious compressed archives.
- A broken/missing workbook produces a visible error; the website does not silently fall back to outdated hardcoded content.
- For instant authenticated publishing from the browser, add a server-side storage API with real authentication, authorization, backups and concurrency handling. Do not put a repository token or hosting credential into this static admin page.
- Deploy the workbook and templates together when changing the schema. Serve `.xlsx` normally and avoid long-lived immutable caching for `data/website.xlsx`; fetches request fresh data.

## Tests

```sh
npm ci
npm run version-assets           # Refresh cache-busting revisions after runtime edits
npm run validate                 # Check an edited workbook before publishing
npm test                         # Schema, references, media paths, XLSX round trips
npx playwright install chromium
npm run test:browser              # Site + admin desktop/mobile browser workflows
```

Startup tests cover blocked scripts, stalled network requests, unavailable fonts/icons and direct admin access. Browser tests block external resources; they verify local content, interactions and embed URLs, not actual YouTube streaming or Google Form delivery. An existing Chromium executable can be used with `CHROMIUM_PATH=/path/to/chromium npm run test:browser`.
