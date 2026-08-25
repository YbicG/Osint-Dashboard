# Nationwide OSINT Investigation Platform

## Context

Build a full-fledged OSINT dashboard: search a person by **any** identifier (name, phone, email, username, address, plate, VIN, domain, IP, wallet, face photo, docket number) and get a complete, cited background — identity and aliases, address history, contact history, relatives and associates, criminal and civil court records, incarceration, marriage/divorce/death, property and assets, business ownership, professional licenses, social media presence, and breach exposure — across all 50 states.

The target user is an investigator. That means the product bar is not "it found some stuff" — it is **every displayed fact is traceable to a source, a timestamp, and archived evidence**, because a dossier that can't be defended is worthless.

`C:\Users\CJ\Documents\Development\Osint Dashboard` is empty. Greenfield.

### Decisions locked with the user

| Decision | Choice |
|---|---|
| Deployment | Local-first, server-ready: full multi-user data model (orgs/users/cases/audit) from day one, ships with one seeded admin, no SSO wall. Flip to team mode later with no migration. |
| Data sources | Free/public sources + cheap consumer APIs (~$50–300/mo). Licensed-vendor adapters (TLOxp/Accurint/CLEAR/IDI) built as typed slots, unused until credentials exist. |
| Collection posture | Maximum reach: residential proxy rotation, per-source fingerprint randomization, adaptive rate-limit evasion, cookie-jar injection. |
| Social auth | Public/logged-out **by default**. Optional cookie-jar for user-supplied dedicated accounts, with rotation, health-checking, ban detection. |
| CAPTCHA | Default = **skip and flag** as a coverage gap with a deep link. Typed `CaptchaSolver` interface + manual-solve implementation ships; third-party human-solver slot documented and unwired. |
| Biometrics | Full face pipeline: InsightFace/ArcFace embeddings + pgvector, cross-source face clustering, EXIF/GPS, OCR, reverse image search. |

### Scope boundaries

**Not built, by design:** CAPTCHA-solving automation, credential stuffing, automated account creation or persona/sockpuppet generation, authenticated scraping of accounts that aren't the user's, and anything touching NCIC/N-DEx/Nlets (requires an agency ORI + CJIS compliance — the control set is built, the connection is not).

**Honest capability ceiling.** Criminal history, DMV/plate-to-person, SSN-linked address history, credit headers, and full DOB are not on the open internet — they are behind GLBA/DPPA/FCRA-gated licensed vendors. On free + cheap-API sources this platform reliably delivers: aliases, address history (good), phones/emails (good), relatives/associates (moderate), court records (strong where portals are public), incarceration (strong), property/business/licenses (strong), socials (strong), sanctions (complete). It will be weak on: certified criminal history, DMV, and exact DOB. The vendor adapters are the upgrade path, and the UI does not change when they light up.

---

## Architecture

Turborepo + pnpm monorepo, matching the `redbaron-dashboard` / `apps-dashboard` pattern already on this machine.

```
osint-dashboard/
  apps/
    web/           Next.js 16 · React 19 · Tailwind v4 · shadcn/Radix · TanStack Table
    worker/        BullMQ consumers · Playwright pool · connector execution
    vision/        Python 3.14 FastAPI sidecar: InsightFace, OCR, EXIF, pHash
  packages/
    contracts/     Zod schemas — the canonical claim/entity model, shared everywhere
    db/            Drizzle schema + migrations (Postgres 17 + pgvector + pg_trgm)
    core/          entity resolution, normalization, scoring, graph algorithms
    connectors/    connector SDK + all source implementations + jurisdiction registry
    browser/       Playwright pool, stealth, proxy rotation, cookie jars, CaptchaSolver
    ui/            shared shadcn components
  infra/
    docker-compose.yml   postgres+pgvector · redis · minio (evidence blobs) · vision
```

**Drizzle, not Prisma** (despite `inventory-management` using Prisma): this workload is recursive CTEs for graph traversal, pgvector similarity, `pg_trgm` fuzzy name matching, and JSONB claim payloads. Drizzle handles all four natively; Prisma fights every one.

### The central design decision: claims, not fields

Never store `person.address = X`. Store an atomic, sourced assertion:

```
claim(subject_entity_id, predicate, value_jsonb, source_id, run_id,
      observed_at, confidence, raw_snippet, evidence_url, screenshot_sha256)
```

Core tables: `entity` (person/org/address/phone/email/username/vehicle/vessel/aircraft/domain/ip/wallet/case/image), `entity_alias`, `claim`, `edge` (typed relationship, each backed by claims), `identity_cluster` (resolution result + manual merge/split overrides), `source`, `collection_run` (archives request + response + screenshot), `case`, `subject`, `audit_log`.

Consequence: every field in the UI is clickable to its provenance — which source said it, when, the raw snippet, the archived screenshot. Conflicting values (two DOBs, two SSNs) are surfaced as conflicts rather than silently overwritten. This is what makes the output evidentiary.

### Entity resolution (`packages/core`)

Blocking keys (double-metaphone last name + DOB year, E.164 phone, normalized address hash, email local-part) → pairwise scoring (Jaro-Winkler names, nickname expansion table Bob↔Robert, DOB proximity, address/phone/relative overlap) → Fellegi-Sunter weighted score. Auto-merge above threshold, review queue in the band, manual merge/split always available and always audit-logged.

### Connector SDK — the leverage point

County court, jail, and property portals cluster into ~8 software families. **One parameterized adapter × a county registry, not 3,000 scrapers.**

```ts
defineConnector({
  id: 'portal.odyssey',
  jurisdiction: { country: 'US', scope: 'county' },   // driven by jurisdictions.json
  category: 'courts',
  accepts: ['person.name', 'person.dob', 'case.number'],
  emits: ['court_case', 'charge', 'disposition', 'address', 'alias'],
  cost: { type: 'free' },
  rateLimit: { rpm: 15 },
  transport: 'browser',
  legal: { robots: 'honor', tosNote: '...' },
  async *run(ctx, input) { yield claim(...) }
})
```

Families: **Tyler Odyssey**, **Journal Technologies eCourt**, **Thomson Reuters C-Track**, **equivant/Courtview**, **JailTracker**, **Zuercher**, **qPublic/Schneider Geospatial**, **Vision Government Solutions**. `jurisdictions.json` maps ~3,000 counties → family → base URL → quirks.

### Collection pipeline

Search → **plan** (which connectors accept this input type in this jurisdiction) → fan out to BullMQ → **stream via SSE as each returns** → claims land → incremental entity resolution → graph updates live. The UI shows every connector as a live chip: `pending / running / hit / miss / blocked / error`, so coverage gaps are visible rather than silent.

---

## Connector catalog (~120 definitions, 3,000+ endpoints)

**Federal / national** — FBI Wanted API, Interpol Red Notices, BOP inmate locator, ICE detainee locator, US Marshals, PACER via CourtListener/RECAP API v4 (free tier, rate-limited; bulk dumps free), SEC EDGAR + Forms 3/4/5, FINRA BrokerCheck, SEC IAPD, FEC + state campaign finance, SAM.gov, USAspending, ProPublica Form 990, NPI registry, HHS-OIG exclusions, FAA aircraft registry, USCG vessel documentation, FCC ULS amateur radio, NHTSA VIN decoder, NSOPW.

**Courts & corrections** — 8 portal-family adapters across ~3,000 counties; statewide portals for the ~45 states that publish; 50 state DOC inmate locators; county jail rosters; sex-offender registries (NSOPW + 50 state).

**Property & assets** — county assessor/parcel, recorder of deeds, UCC filings (50 SoS), tax liens, foreclosures.

**Business & professional** — 50 Secretary of State business registries, OpenCorporates, DBA/fictitious names, 50-state professional license boards (medical, legal, nursing, contractor, real estate, insurance).

**Digital** — username enumeration (Maigret 0.5.0's 3,000-site definition DB ported into the TS engine so it runs behind our proxy/rate-limit/stealth layer rather than shelling out), public social scraping (X, Reddit, Instagram, TikTok, YouTube, Facebook, LinkedIn, GitHub, Twitch, Telegram), HIBP breach exposure (indicators only, never credentials), Gravatar, WHOIS/RDAP, DNS, Certificate Transparency (crt.sh), Shodan, Censys, VirusTotal, IP geolocation + VPN/proxy detection, paste-site monitoring, blockchain explorers + OFAC crypto addresses.

**Sanctions & watchlists** — OFAC SDN + consolidated (public domain, ingested directly), UN, EU, UK HMT, BIS Denied Persons, State Dept debarred, PEP lists. *OpenSanctions is CC BY-NC — free for non-commercial use only; a consulting business would need a license, so primary sources are ingested directly and OpenSanctions is an optional enrichment.*

**Vital records & genealogy** — SSDI/Death Master File, Find a Grave, obituary aggregators, FamilySearch API, state marriage/divorce indexes, census (1950 and earlier), voter registration in states where public (FL, OH, MI, NC, WA, and others).

**Consumer APIs (optional keys, graceful degradation)** — **EnformionGO** (formerly Endato — rebranded, note for implementation), PeopleDataLabs, Twilio Lookup, NumVerify, Hunter.io, IPQualityScore, Shodan, HIBP.

---

## UI — "intel console"

Dark-first, dense, keyboard-driven. Cmd+K command palette everywhere.

- **Universal search** — auto-detects input type, shows the detected type as an editable chip, supports multi-field advanced builder, bulk CSV, saved searches.
- **Live result stream** — connector chips resolving in real time; coverage gaps explicit.
- **Dossier** — tabs: Identity · Addresses · Contact · Relationships · Criminal/Legal · Property/Assets · Business · Digital · Financial · Vehicles · Media · Timeline · Map · Graph · Sources. Every field carries a provenance affordance; conflicts render as conflicts.
- **Link graph** — Cytoscape.js: expand-node, path-finding between any two entities ("how is A connected to B"), filter by edge type and confidence.
- **Timeline** — virtualized, every dated claim, filterable by category and source.
- **Map** — MapLibre GL + OSM, address history with tenure bands, incident plotting.
- **Case management** — cases, subjects, notes, tasks, attachments, chain-of-custody log, deconfliction alerts.
- **Report builder** — drag exhibits, auto-citation, exhibit numbering, redaction tool, PDF/DOCX export.
- **Monitoring** — saved subjects, scheduled re-runs, change diffing, alerts.
- **Admin** — source health dashboard, proxy pool, cookie jars, API keys, feature flags, audit log viewer.

**Exports** — JSON, CSV, GraphML, Maltego, i2 ANB, STIX.

---

## Compliance layer (built in from day one — cheap now, impossible to retrofit)

Purpose-code prompt per search · hash-chained append-only audit log · field-level encryption for sensitive PII · configurable retention/purge · **FCRA gate** (this is not a consumer report and may not be used for employment, credit, housing, or insurance decisions) · biometric jurisdiction acknowledgment with faceprint purge on case close (IL BIPA, TX CUBI, WA carry private rights of action — the gate is the difference between a feature and a liability).

---

## Build phases

Each phase ends with something runnable.

| # | Phase | Delivers |
|---|---|---|
| 1 | **Foundation** | Monorepo, Docker Compose (Postgres+pgvector, Redis, MinIO), Drizzle schema + migrations, contracts package, auth/RBAC/audit skeleton, seeded admin. |
| 2 | **Collection engine** | Connector SDK, BullMQ pipeline, Playwright pool with stealth + proxy rotation + cookie jars, CaptchaSolver interface (manual impl, skip-and-flag default), SSE streaming, source health. |
| 3 | **Vertical slice** | Universal search + type detection, ~15 high-value connectors, entity resolution v1, dossier UI with provenance drawer. **First genuinely usable build.** |
| 4 | **Connector breadth** | The 8 portal families + jurisdiction registry, 50-state DOC/SoS/registry sweeps, federal set, sanctions ingestion. Bulk of the ~120. |
| 5 | **Analysis** | Link graph, timeline, map, conflict detection, path-finding, entity merge/split review queue. |
| 6 | **Vision** | Python sidecar: face detect/embed/match/cluster, EXIF/GPS, OCR, pHash dedup, reverse image search + BIPA gate. |
| 7 | **Case & reporting** | Case management, chain of custody, report builder with redaction, all export formats, monitoring + alerts. |
| 8 | **Hardening** | Consumer API integrations, licensed-vendor adapter stubs, Playwright E2E, Vitest coverage, perf tuning, admin console, docs. |

---

## Verification

- **Per phase:** `pnpm lint && pnpm typecheck && pnpm build` clean; Vitest unit tests on normalization, scoring, and every connector parser against recorded fixtures.
- **Connectors:** each ships with a recorded HTTP/HTML fixture so parsers are tested without hitting live sites; a separate opt-in `test:live` suite validates real endpoints and feeds the source-health dashboard.
- **Entity resolution:** labeled fixture set of known-same and known-different identity pairs; assert precision/recall thresholds so tuning can't silently regress.
- **E2E (Playwright):** search a seeded synthetic subject → connectors stream → dossier populates → provenance drawer shows source + snippet + screenshot → graph renders → PDF report exports with correct citations.
- **Compliance:** tests asserting the audit log hash-chain is unbroken, purpose codes are required, and faceprint purge fires on case close.
- **Manual:** `docker compose up` then `pnpm dev`, search a real public figure, confirm live hits across courts, business, property, and social.

---

## Open item for Phase 8

Whether to wrap in Tauri for a desktop binary. Not needed for local use (`localhost` works fine) and easy to add later — deferring rather than deciding now.
