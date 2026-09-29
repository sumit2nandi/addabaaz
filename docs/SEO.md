# Google search (SEO)

What is built, what you must do after deploying, and what is *not* in our control.

> **Honest expectations.** Nothing can guarantee a Google ranking. What we *can* do is make sure every page is crawlable, indexable, fast, correctly described and eligible for rich results (video thumbnails, sitelinks search box, breadcrumbs). Ranking beyond that depends on content, competition and links from other sites — see [What only you can do](#what-only-you-can-do).

## What the site now does

| Problem before | Now |
|---|---|
| Pages were `/#/show/shahid`. Google ignores everything after `#`, so the whole site looked like *one* page. | Real URLs: `/show/shahid`, `/watch/<id>`, `/soon/<id>`, `/shows`, `/about`… Old `/#/…` links are converted automatically. |
| One static `<title>` and description for everything, and an empty page until JavaScript ran. | The server sends every page with its **own title, description, canonical URL, Open Graph/Twitter tags and JSON-LD already in the HTML**, plus a plain-text copy of the content (headings, episode links, gallery alt text). Link previews (WhatsApp, Facebook, X) work because those bots don't run JavaScript. The app keeps the tags in sync while people navigate. |
| No `robots.txt`, no sitemap, every URL returned 200. | `/robots.txt`, `/sitemap.xml` (pages, shows, upcoming titles, every episode with **video** entries and thumbnails). Unknown URLs return a real **404**; duplicates **301** to the one clean URL (trailing slash, `/index.html`, `/show/<upcoming id>` → `/soon/<id>`). |
| Duplicate/private pages could compete. | Search, sign-in, account, profiles, billing, My List are `noindex`. Reels are `noindex` unless you write a description (they are near-duplicates otherwise); `/reels/<id>` canonicalises to `/watch/<id>`. `/admin`, `/api`, `/data` send `X-Robots-Tag: noindex`. |
| Staging copies could be indexed. | Only `NODE_ENV=production` (or `ALLOW_INDEXING=true`) is indexable. Anything else serves `Disallow: /` and `noindex`. |
| Speed. | gzip compression, ETag revalidation on pages (`304`), `modulepreload` for the app's JavaScript, preload of the hero image on show pages, 7-day cache for `/media`. |

### Structured data (JSON-LD)

| Page | Types |
|---|---|
| Home | `WebSite` + `SearchAction` (sitelinks search box), `Organization` |
| Show | `TVSeries` (`CreativeWorkSeries` for stand-up/podcast), trailer `VideoObject`, `BreadcrumbList` |
| Watch | `VideoObject` (upload date, ISO-8601 duration, YouTube `embedUrl`, thumbnail, free/premium), `BreadcrumbList` |
| Lists (shows, upcoming) | `CollectionPage` + `ItemList` |
| Plans | `Product` with `Offer`s in INR |
| About / Contact | `AboutPage` / `ContactPage`, `Organization` (address, phone, email, social profiles from the studio profile) |

Premium videos are marked `isAccessibleForFree: false` and never expose a stream URL.

Code map: `app/js/routes.js` (page table), `app/js/seo/meta.js` (**all** titles/descriptions/JSON-LD; runs on server and browser), `app/js/seo/head.js` (browser tag updater), `server/src/seo.js` (HTML, robots, sitemap), `app/js/router.js` (History routing). Tests: `server/test/seo.test.js`.

## After you deploy — checklist (30 minutes, one time)

1. **Set `PUBLIC_SITE_URL=https://addabaaz.in`** (exact public address, https, no trailing slash) and run with `NODE_ENV=production`. Canonical URLs and the sitemap use it. `/admin` → Dashboard shows a *Google indexing* check.
2. **HTTPS everywhere; one hostname.** Redirect `http→https` and `www→apex` (or the reverse) at your proxy/CDN. Two hostnames serving the same pages split your ranking. Set `TRUST_PROXY=1` behind a proxy.
3. **Google Search Console** (search.google.com/search-console) → add the *domain property* → verify (DNS, or set `GOOGLE_SITE_VERIFICATION` to the HTML-tag token) → **Sitemaps → submit `https://addabaaz.in/sitemap.xml`**.
4. In Search Console → **URL inspection**: test `/`, one `/show/…` and one `/watch/…` page → *View crawled page* should show your title and content; then *Request indexing* for the home page and shows. Check **Pages** for "Excluded" reasons after a week; **Video pages** report once Google finds them.
5. Run the **Rich Results Test** (search.google.com/test/rich-results) on a show and a watch page. Fix warnings it lists.
6. Bing Webmaster Tools → import from Search Console (covers Bing, DuckDuckGo, Yahoo). Optional: set `BING_SITE_VERIFICATION`.
7. Check speed on PageSpeed Insights (pagespeed.web.dev), mobile tab.

## Writing content that ranks

The admin console has hints on these fields:

- **Show tagline + description** – Google shows ~155 characters. Lead with the hook; name the show, genre and language ("Bengali"). Unique per show.
- **Video description** (new optional field on each video) – 1–2 sentences. Episodes without one get an automatic description built from the show, so they are never empty; **reels are kept out of Google until you write one**, because "Part 18" reels of the same series look like duplicates.
- **Titles** – the app cleans messy YouTube titles for display (`Part - 18` → "Part 18 — Shahid"). If a video's `title` is good on its own, it ranks well as-is; you can set `shortTitle`.
- **Gallery images** – set a `caption`; it becomes the image's alt text.
- **Posters** – use a real 1200×630-ish poster as the *large* poster: it is the link-preview image and the Google thumbnail.

## What only you can do

- **Backlinks and mentions** — the biggest ranking factor we can't build. Link from your YouTube channel description, Facebook and Instagram bios, press coverage, festival pages, cast members' profiles.
- **YouTube ↔ site cross-links** — put the `addabaaz.in/show/<id>` link in each video description. Videos also rank on YouTube itself, which will often outrank a website for video queries; both are useful.
- **Bengali queries** — many searches are in Bengali script. Titles/descriptions keep the Bengali title *and* an English name; write Bengali descriptions for shows where you can.
- **Consistency** — publish regularly; the sitemap `lastmod` follows your newest episode.
- **Google Business Profile** for the Kolkata studio address (helps "film production house Kolkata" searches for the About/Services pages).

## Limits and notes

- SEO only works when pages are served by **this Node server**. A pure static host (`build:www`, GitHub Pages) and the Android/iOS apps keep hash URLs and the static home-page metadata.
- The page content for crawlers is a hidden text copy (headings, links, descriptions) — Google also renders JavaScript, so it sees the full app; the text copy is what non-rendering bots (link previews, some crawlers) use. It is not a second, different version of the page.
- Video *rich results* on Google for YouTube-hosted videos can prefer the YouTube page as the "primary" one; ours will still be indexed as a watch page when it contains the embedded player.
- Sitemaps larger than 50,000 URLs need splitting (not an issue at this size).
- Not verified here: how Google actually crawls/ranks the deployed site (needs a public URL) and the Rich Results Test itself. The tags, sitemap and behaviours are covered by automated tests and a headless-browser run.
