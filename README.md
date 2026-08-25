# OSINT Dashboard

A nationwide OSINT investigation platform: search a person by any identifier
(name, phone, email, username, address, plate, VIN, domain, IP, wallet,
docket number, or a face photo) and get a sourced dossier — every field
traces back to a source, a timestamp, and archived evidence.

See [`docs/PLAN.md`](./docs/PLAN.md) for the full architecture and phased
roadmap. This README covers running what's built so far.

## Status

**Phases 1–3 (Foundation, Collection Engine, Vertical Slice) are complete.**
Phase 4 (connector breadth), Phase 5 (analysis views), and a working slice of
Phase 6 (vision) and Phase 7 (reporting) are also built. Everything below
typechecks clean across all 9 packages, and the full test suite (83 tests)
and the Next.js production build both pass. See "What's not built yet" for
the honest remainder.

### What works right now

- **Universal search** with type auto-detection, a required purpose-code
  compliance gate, and per-search audit logging.
- **21 live, independently-verified connectors** across federal registries,
  courts, sanctions/exclusion lists, business/professional licensing, vital
  records, and digital footprint — see the full list below. Several caught
  their originally-assumed source having moved, changed shape, or never
  having existed as a free API, and adapted to a real, verified alternative
  or an honest documented placeholder rather than faking coverage (notably
  `vital.ssdi` and `sanctions.uk_hmt` — see their file headers).
- **Real-time collection progress** via SSE — connector status chips and a
  live claim feed as a search runs.
- **Claim/entity/edge data model** with full provenance (source, collected/
  observed date, raw snippet, evidence URL) on every field, surfaced via a
  provenance drawer on every claim card.
- **Entity resolution** — Jaro-Winkler + nickname matching + blocking keys,
  Fellegi-Sunter-style scoring, auto-merge above threshold, a persistent
  **review queue** (`/resolution`) for the ambiguous band, gated to
  admin/supervisor roles.
- **Hash-chained, tamper-evident audit log** covering search creation,
  entity merges, case lifecycle, source enable/disable, and report exports.
- **Session-based auth** with roles (admin/supervisor/analyst/auditor) and a
  seeded admin account.
- **Dossier UI**: category tabs, timeline view, link graph (Cytoscape,
  click-to-navigate, on-demand expand), and a map view (MapLibre + OSM
  raster tiles, geocoded via Nominatim) — all four views over the same
  underlying claims/edges.
- **Case management** — create/list/close cases, notes, subjects, and a
  case-scoped "New search" that inherits the case's purpose code.
- **Report export** — PDF (rendered via headless Chromium, exhibit-numbered
  with citations and an FCRA disclaimer), CSV, and JSON, with a **redaction
  selector** in the dossier UI so an operator can exclude specific claims
  from what gets exported without touching the underlying data.
- **Admin console** — per-source health dashboard (hit/miss/blocked/error
  breakdown, claim yield, last-run time) with an admin-only kill switch that
  takes effect on the next search.
- **Vision sidecar** (`apps/vision`) — a real FastAPI service wrapping
  InsightFace (ArcFace 512-dim embeddings, matching the `face_embedding`
  pgvector column) for face detection/embedding/comparison, plus EXIF/GPS
  extraction. Gated behind a `X-Biometric-Consent-Ack` header per the
  BIPA/CUBI compliance requirement in the plan. Verified live end-to-end
  during development (see "Vision service" below) — this is not a stub.
- **Search history** — every search ever run, most recent first.

## Prerequisites

- Node.js >= 22, pnpm >= 10
- Docker Desktop (Postgres + pgvector, Redis, MinIO)
- Python >= 3.12 (only if running the vision sidecar)

## Setup

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis minio
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` runs the web app (http://localhost:3000) and the worker
concurrently via Turborepo. Sign in with the admin credentials from `.env`
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

**Playwright's Chromium is required** for both the collection worker's
browser-transport connectors and the PDF report renderer:

```bash
pnpm --filter @osint/web exec playwright install chromium
```

### Vision service (optional)

```bash
cd apps/vision
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # or .venv/bin/pip on macOS/Linux
./.venv/Scripts/python -m uvicorn app.main:app --port 8001
```

First request downloads the ~280MB InsightFace `buffalo_l` model pack
(cached under `INSIGHTFACE_HOME`/`MODEL_CACHE_DIR` afterward). Or via Docker:
`docker compose -f infra/docker-compose.yml --profile vision up -d vision`.

## Monorepo layout

```
apps/
  web/           Next.js 16 UI + API routes
  worker/        BullMQ connector execution pipeline
  vision/        FastAPI face/EXIF sidecar (InsightFace, real + verified)
packages/
  contracts/     Zod schemas — the canonical claim/entity/connector model
  db/            Drizzle schema, migrations, seed
  core/          Entity resolution, normalization, audit hash-chain, auth
  connectors/    Connector SDK + all 21 source implementations
  browser/       Playwright pool, stealth, proxy rotation, CAPTCHA interface
infra/
  docker-compose.yml
```

## Connector catalog (21)

| Connector | Category | Key/cost |
|---|---|---|
| OFAC Specially Designated Nationals List | Sanctions | Free |
| FBI Wanted | Federal | Free |
| SEC EDGAR Full-Text Search | Federal | Free |
| CourtListener (RECAP/PACER + Case Law) | Courts | Free (optional token) |
| Username Enumeration (20 sites) | Digital | Free |
| RDAP Domain Registration Lookup | Digital | Free |
| Certificate Transparency (crt.sh) | Digital | Free |
| IP Geolocation & Proxy Detection | Digital | Free |
| Twilio Lookup (line type/carrier/caller name) | Consumer API | Paid (optional) |
| NHTSA vPIC VIN Decoder | Federal | Free |
| USAspending.gov Contracts & Grants | Federal | Free |
| ProPublica Nonprofit Explorer (Form 990) | Federal | Free |
| NPPES NPI Registry (healthcare providers) | Business | Free |
| HHS-OIG Exclusions List (LEIE) | Sanctions | Free |
| WikiTree Deceased-Person Search | Vital Records | Free |
| FAA Airmen Certification Database | Business | Free |
| FCC Universal Licensing System | Business | Free |
| OpenCorporates Company Search | Business | Free/freemium (optional key) |
| Shodan Host Lookup | Consumer API | Paid (optional) |
| UN Security Council Consolidated Sanctions | Sanctions | Free |
| UK Sanctions List (OFSI successor) | Sanctions | Free |

## Adding a connector

See `packages/connectors/src/sources/*` for examples. A connector is a
`defineConnector({...})` call declaring what input types it accepts, what
predicates it emits, its rate limit/cost/jurisdiction, and an async
generator `run()` that yields `claim(...)` calls. Register it in
`packages/connectors/src/registry/index.ts` and add its source metadata to
`packages/db/src/seed.ts`. Ship a fixture-based test using a **real recorded
response** alongside it (see `packages/connectors/src/__tests__/rdap.test.ts`)
— every connector in this catalog was live-verified against its actual
endpoint before being written, not assumed from documentation.

## What's not built yet (honest backlog)

- **County court/jail/property portal adapters** — the 8 portal-family
  pattern (Tyler Odyssey, etc.) has a working jurisdiction registry
  (`packages/connectors/src/registry/jurisdictions.ts`) but no adapter
  implementation yet. This is the single biggest remaining chunk of
  "nationwide" coverage — everything else in the plan's connector catalog
  (50-state DOC/SoS sweeps, remaining federal sources) is the same pattern:
  proven architecture, needs data-entry-shaped implementation work.
- **Face clustering across a case** — the vision service's `/embed` and
  `/compare` endpoints work and are wired to the right schema
  (`face_embedding`, pgvector cosine index), but nothing in the worker
  pipeline yet calls them from an image-bearing connector or runs the
  cross-source clustering query. OCR (`document_text` claims) is not
  implemented — would need Tesseract or a cloud OCR API, neither wired.
- **Report builder polish** — redaction and citations work; there's no
  drag-to-reorder exhibit builder or letterhead/branding customization.
- **Monitoring & scheduled re-runs** — `subject.monitoringEnabled` exists in
  the schema; no scheduler wired to it yet.
- **Proxy pool / cookie jar admin UI** — the underlying classes work and are
  unit-tested (15 tests), but there's no UI over them; they're configured via
  env vars only (`PROXY_POOL_JSON`, cookie jar has no persistence layer yet).
- **Licensed-vendor adapters** (TLOxp/Accurint/CLEAR/IDI) — intentionally
  unbuilt per the plan until real credentials exist.
- **E2E test suite** (Playwright, browser-driven) — unit/fixture tests exist
  per-package (83 passing); no browser-driven end-to-end test yet, since
  that needs a live Postgres to run against.

## Known limitations observed during development

- `federal.fbi_wanted` occasionally gets a 403 from `api.fbi.gov` via
  Node's `fetch` (undici) even with a descriptive User-Agent — `curl`
  against the identical URL succeeds, and the response body is a generic
  bot-wall page. Consistent with a WAF fingerprinting the TLS/HTTP client
  stack rather than anything connector-specific. The platform's `blocked`
  classification handles this correctly (surfaces as a coverage gap, not a
  false "no results"); if persistent, route it through the Playwright-based
  `browser` transport instead of `http`.
- `federal.faa_airmen` downloads a ~57MB monthly ZIP and parses ~1.27M CSV
  rows in-process. It works and is cached, but is the heaviest connector in
  the catalog by a wide margin — worth profiling under real load before
  putting it on a short cache TTL.
