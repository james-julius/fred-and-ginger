# Fred & Ginger (nest)

An NYC apartment hunter: it collects listings from the sites' own alert emails, checks every building against NYC Open Data, and ranks what's worth seeing.

Plain Python 3.11+, standard library only. Data goes in `./data/nest.db`.

## Setup

1. Copy `config.example.json` to `config.json` and fill in your search.
2. **Alerts.** Save searches on StreetEasy, RentHop, Zumper, Zillow and Craigslist (needs an account), with instant email alerts. Then add a Gmail filter that labels them `nest-alerts`:
   `from:(streeteasy.com OR renthop.com OR zumper.com OR zillow.com OR craigslist.org OR listingsproject.com OR leasebreak.com)`
3. **IMAP.** Create a Google app password (Account → Security → App passwords) and put it in `config.json` under `imap`.

## Use

```sh
python3 -m nest building "170 N 10th St, Brooklyn"   # what the city knows about a building
python3 -m nest ingest                               # read new alert emails
python3 -m nest ingest --eml path/to/folder          # or saved .eml files
python3 -m nest list                                 # listings, best building first
```

## Where listings come from

| Source | How |
|---|---|
| StreetEasy, Zillow, RentHop, Zumper/PadMapper, Apartments.com, Craigslist | Saved-search alert emails. None has a public API, and all block automated browsing. |
| Listings Project, Leasebreak | Their email newsletters and alerts |
| Building and management sites (RentCafe/Yardi, Entrata, AppFolio) | Next: polled daily |
| NYC Housing Connect lotteries | Next: NYC Open Data |

Tracking links in alerts are unwrapped by reading the redirect header only; listing pages are never fetched.

## Building checks (NYC Open Data, no key)

The city has data on every residential building. For each one, nest checks:

- HPD violations: open class B/C, and the last 3 years
- HPD complaints in the last 12 months: heat, pests, leaks, mould
- 311 calls: noise and the rest
- Bedbug filings
- Evictions in the last 3 years
- DOB permits: construction and scaffolding
- Owner and managing agent

Counts are scaled by building size, then rolled into a 0–100 score with the reasons listed.

## The shared site (cloud/)

`https://fredandginger.jamesjuliusdarby.com`, a Cloudflare Worker with D1 and static assets, on the personal Cloudflare account (jamesdarby7).

- **Sign-in:** one login each for James and Erin. Passwords are Worker secrets: `npx wrangler secret put PASSWORD_JAMES` / `PASSWORD_ERIN`.
- **Every 4 hours:** a cron starts each crawler on Apify with the saved search. Apify calls `/hooks/apify` when a run ends.
- **Every 2 minutes:** a cron stores a batch of finished-run rows, geocodes new addresses, and runs building checks. It does a few at a time to stay under Workers' per-invocation request limits.
- **Same apartment, several sites:** it becomes one listing, matched by normalised street + unit, then by BBL + unit after geocoding.
- **The UI:** New / Both like / I like / Erin likes / Passed, notes, filters and a map.
- **Deploy:** `cd cloud && npx wrangler deploy`. Migrations: `npx wrangler d1 migrations apply nest --remote`.

## The new app (web/)

A Next.js app with Tailwind 4 and Geist that will replace the grid the Worker serves today. The design is in two pages; ask Erin for access: the [app shell](https://claude.ai/artifact/7uQWQmj21bLe4dhVkFe8zd) and the [research behind it](https://claude.ai/artifact/SeW3ZkN9Rm7BWNP5ckdsyA).

- **Local:** `cd web && npm install && npm run dev`, then open http://localhost:3000.
- **Data:** `/api/*`, `/login` and `/logout` are proxied to the Worker. Production is the default. To use `wrangler dev`, put `FRED_API_URL=http://localhost:8787` in `web/.env.local`.
- **Theme:** `web/app/globals.css`. Token names follow shadcn/ui, so shadcn and AI Elements components pick them up.
- **Hosting:** Cloudflare, as its own Worker (`fred-web`) built with [OpenNext](https://opennext.js.org/cloudflare).
  - `npm run preview` runs the Cloudflare build locally.
  - `npm run deploy` ships it, but needs access to the Cloudflare account.
  - It lives on workers.dev until we decide how it shares the domain with `nest`.
  - Next is pinned to 16.3.8 because the adapter doesn't support 16.4 yet: 16.4 adds a `preview-props.json` the adapter doesn't bundle, and every page returns 500.

## The API contract (packages/api)

The routes and data shapes the app and the Worker agree on, written once as Zod schemas. Types are generated from them, so the two sides can't drift apart.

- **Source:** `packages/api/src/schemas.ts` (shapes) and `routes.ts` (every route). The Worker implements them in `cloud/src/v2.ts`, and TypeScript rejects a handler whose response doesn't match.
- **Generated:** `npm run gen:api` at the repo root writes `packages/api/openapi.json` and `web/lib/api/schema.gen.ts`. Commit both; `npm run check:api` fails if they're out of date.
- **In the app:** `import type { components } from '@/lib/api/schema.gen'`, then `components['schemas']['OpportunityCard']` and so on. The chat parts are there too: `DataSearchUpdated`, `DataScan`, `DataSuggestions`, `DataWatch`.
- **Real data:** the places routes (`/api/opportunities*`, and the counts in `/api/me`) serve real listings from D1 (`cloud/src/places.ts`): everything that passes the person's dealbreakers, the places Fred added, and anything they saved or passed on, marked `X-Fred-Data: real`. Saving or passing also writes the old grid's `votes` table, and a vote there shows in the app.
- **Example data for the rest:** the other routes still serve the mockup's examples (`packages/api/src/fixtures.ts`), marked with an `X-Fred-Data: example` header. `POST /api/chat` streams the mockup's chat turn in the AI SDK format, so `useChat` works against it. Routes switch to real data one at a time without changing shape.
- **Local:** `npm install` at the repo root (it's an npm workspace with `cloud` and `packages/*`; `web` keeps its own install), then `cd cloud && npx wrangler dev`.

## Crawlers (actor/)

Apify actors on the jamesjulius account (deploy with `apify push`). Every actor pushes rows in the shape described in `actor/SCHEMA.md`.

| Actor | How |
|---|---|
| `nest-streeteasy` | Crawlee + Playwright, residential proxy, fingerprints; reads the listing data embedded in the HTML, scripts blocked |
| `nest-zillow` | Same approach, plus Zillow's own search endpoint for later pages |
| `nest-renthop` | Playwright (Cloudflare challenge); search cards + detail HTML fetched in-page |
| `nest-zumper` | Playwright (Fastly challenge); Zumper's JSON search API called in-page |
| `nest-craigslist` | Cheerio + datacenter proxy against Craigslist's JSON search API; scam flags |
| `nest-landlords` | Plain HTTP; adapters per platform (SightMap, own JSON, WordPress…) plus a browser pass, for 23 NYC landlords. Add one in `src/companies.js` |
| `nest-compass` | Playwright; Compass search plus exclusives, every 12 hours |
| `nest-nooklyn` | Nooklyn's listing API |
| `apartments` | Probe only: Akamai blocks every approach, not deployed |
