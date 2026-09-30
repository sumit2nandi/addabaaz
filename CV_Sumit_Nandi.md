# Sumit Nandi
**Full-Stack Developer | Product Engineer | Open Source Contributor**  
📍 Bengaluru, India  |  📧 sumit2nandi@gmail.com  |  🔗 [github.com/sumit2nandi](https://github.com/sumit2nandi)  |  💼 [linkedin.com/in/sumit2nandi](https://linkedin.com/in/sumit2nandi)

---

## Professional Summary

Product-focused full-stack engineer with 5+ years building consumer-facing web applications, developer tools, and data-intensive platforms. Strong bias for **end-to-end ownership** — from product discovery and system design through to production operations and iteration. Deep experience with **TypeScript/React/Node**, **PostgreSQL**, **cloud infrastructure (AWS/GCP)**, and **real-time systems**. Proven track record of shipping high-leverage features in small, high-autonomy teams. Open source contributor (Vercel, Astro, TanStack ecosystems). Currently building **Addabaaz** — a Bengali entertainment platform serving video, reels, and community features to 10k+ users.

---

## Technical Leadership & Core Competencies

| Area | Technologies & Depth |
|------|---------------------|
| **Frontend** | React 18, TypeScript, Next.js (App Router), Astro, TanStack Query/Router, Zustand, Tailwind CSS, Framer Motion, Playwright/Cypress |
| **Backend** | Node.js (Fastify/Express/Hono), tRPC, GraphQL (Apollo/Pothos), REST, WebSockets, Server-Sent Events |
| **Data** | PostgreSQL (Prisma, Drizzle, raw SQL), Redis, SQLite, ClickHouse, Elasticsearch, data modeling & migrations |
| **Infrastructure** | AWS (ECS, Lambda, RDS, S3, CloudFront, Route53), GCP (Cloud Run, Cloud SQL), Docker, Kubernetes (EKS/GKE), Terraform, GitHub Actions |
| **Observability** | OpenTelemetry, Grafana, Loki, Tempo, Sentry, Datadog, custom logging/metrics pipelines |
| **Product & Process** | RFC-driven design, feature flags, A/B testing, analytics (PostHog, Mixpanel), CI/CD, trunk-based development, code review culture |

---

## Experience

### **Addabaaz** — *Founding Engineer / Full-Stack Lead*  
**2023 – Present**  |  Bengaluru (Remote)  
*Bengali streaming & community platform: video-on-demand, vertical reels feed, live chat, profiles, subscriptions.*

- **Architected & built the full stack** from scratch: React 18 + TypeScript frontend (Vite, no framework lock-in), Node.js/Fastify API, PostgreSQL (Prisma), Redis caching, HLS video delivery via CloudFront.
- **Designed the reels feed** — vertical, snap-scrolling, intersection-observer-driven lazy loading, IntersectionObserver + `requestVideoFrameCallback` for performant autoplay/mute logic, `playsInline` + `webkit-playsinline` for iOS/Android compatibility.
- **Built the video player abstraction layer** supporting YouTube IFrame API, native HLS (Safari), hls.js (Chrome/Firefox), and progressive MP4 — unified controller interface (`play`, `pause`, `seek`, `mute`, `cast`, `subtitles`).
- **Implemented auth & profiles**: JWT + refresh rotation, bcrypt/argon2, magic-link email, Google/Apple OAuth, multi-profile support ("Who's watching?"), kids-mode catalog filtering.
- **Payments & subscriptions**: Razorpay integration (INR), webhook-driven entitlement sync, plan gating for premium reels (signed R2 URLs, short-lived tokens).
- **Real-time features**: WebSocket server for live chat during premieres, presence indicators, toast notifications, optimistic UI with TanStack Query mutations.
- **CI/CD & ops**: GitHub Actions → Docker → AWS ECS (Fargate), blue/green deployments, Terraform for infra, structured logging (pino), Sentry + custom error reporting, feature flags (LaunchDarkly-style homegrown).
- **Performance**: LCP < 1.8s on 3G, 95th-pctl API latency < 200ms, bundle size < 180KB gzipped (code-split by route), Service Worker for offline-first catalog browsing.
- **Team**: Mentored 2 junior engineers, established RFC process, code review standards, on-call rotation.

### **Freelance / Contract — Senior Full-Stack Engineer**  
**2021 – 2023**  |  Remote  
*Short-term engagements for early-stage startups (SaaS, fintech, creator economy).*

- **Fintech dashboard (YC W22)**: Rebuilt React/Next.js dashboard with tRPC + Prisma + PostgreSQL; reduced API surface by 60%, added row-level security, real-time transaction feed via SSE.
- **Creator analytics platform**: Ingested 50M+ events/day from TikTok/Instagram/YouTube APIs → ClickHouse → Grafana dashboards; built React admin with virtualized tables, export pipelines.
- **E-commerce headless CMS**: Next.js + Shopify Storefront API + Sanity CMS; ISR for 10k+ SKUs, incremental builds < 3min, Core Web Vitals all green.
- **Open source contributions**: Merged PRs to **TanStack Query** (persister, devtools), **Astro** (image optimization, i18n), **Vercel/next.js** (turbopack diagnostics), **Prisma** (migration DX).

### **Early Career — Software Engineer**  
**2019 – 2021**  |  Bengaluru  
*Full-stack roles at product companies (edtech, logistics). Built REST APIs, React admin panels, background job queues (BullMQ), PostgreSQL schemas, Dockerized deployments.*

---

## Key Projects (Selected)

| Project | Stack | Highlights |
|---------|-------|------------|
| **Addabaaz** (production) | React, TS, Fastify, Prisma, PostgreSQL, Redis, AWS, HLS/hls.js | 10k+ MAU, vertical reels feed, live chat, subscriptions, multi-profile, kids mode |
| **tanstack-query-persister-indexeddb** (OSS) | TypeScript, IndexedDB, Web Workers | 500+ ⭐, adopted by 20+ projects, offline-first mutation queue |
| **astro-i18n-autodetect** (OSS) | Astro, TypeScript, Middleware | Zero-config locale detection, 1.2k+ downloads/week |
| **realtime-dashboard-template** (OSS) | Next.js, tRPC, SSE, Prisma, Tailwind | 800+ ⭐, reference impl for real-time SaaS dashboards |
| **clickhouse-analytics-pipeline** | Node, ClickHouse, Kafka, Grafana | 50M events/day, sub-second aggregations, cost < $200/mo |

---

## Open Source & Community

- **TanStack Query** — Core team contributor (persisters, devtools, hydration fixes)
- **Astro** — Image optimization, i18n routing, middleware APIs
- **Vercel** — Next.js turbopack diagnostics, `create-t3-app` templates
- **Prisma** — Migration CLI DX, `prisma migrate diff` improvements
- **Speaker** — ReactIndia 2023 ("Building Offline-First React Apps"), Bangalore TypeScript Meetup (quarterly)
- **Writer** — Technical blog (sumit2nandi.dev): 15+ articles on React internals, TypeScript patterns, PostgreSQL performance, distributed systems (50k+ reads)

---

## Education

**B.Tech, Computer Science & Engineering**  
National Institute of Technology, Durgapur — *2015–2019*  
Relevant: Distributed Systems, Database Systems, Computer Networks, Operating Systems

---

## Additional

- **Languages**: English (fluent), Hindi (native), Bengali (conversational)
- **Interests**: Mechanical keyboards, analog photography, Carnatic music, open source sustainability
- **Availability**: Open to senior/lead full-stack roles (remote/hybrid), preferably product-focused, high-autonomy teams

---

*References and portfolio available on request. Last updated: September 2026.*