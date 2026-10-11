# Fred & Ginger

**Fred is an AI apartment hunter for New York.** You tell him what you want in chat; he watches every listing site, checks each building's record with the city, looks at the photos, researches the landlord, and only puts places worth seeing in your inbox.

Built at AI Engineer NYC 2026 (Oct 11). Live at https://fredandginger.jamesjuliusdarby.com (sign-in required: it's our own apartment hunt).

## What Fred does

- **Runs your search in chat.** Budget, beds, areas, pets and must-haves become dealbreakers and preferences. He remembers what you like across chats and learns from what you save and pass on.
- **Watches every site.** Crawlers collect listings from StreetEasy, Zillow, RentHop, Zumper, Compass, Nooklyn, Craigslist and big landlords' own sites. The same apartment on several sites becomes one place.
- **Checks the building with the city.** NYC Open Data: open HPD violations, heat/pest/leak complaints, 311 noise, bedbugs, evictions, owner and managing agent, rolled into a 0–100 score with the reasons. Area safety from NYPD complaint data.
- **Looks at the photos with Gemini.** Light, kitchen, in-unit laundry, visible damage, whether the photos match the listed beds and baths, and red flags like stock photos, renders or virtual staging. Ask "is there a window in the bedroom?" and he looks (`cloud/src/vision.ts`).
- **Researches the live web with Nimble.** Reads a listing's full page when the card leaves things out, and searches tenant reviews and the landlord's reputation (`cloud/src/nimble.ts`).
- **Shows the real cost.** Fees read from the listing text, total monthly, broker fee, move-in estimate, scam signals.
- **Acts for you.** Email alerts for strong fits, draft tour requests, and messages to landlords that are only sent after you approve them.

## How it's built

- **API and agent** (`cloud/`): a Cloudflare Worker with D1, R2 and Workers AI. Fred is a Mastra agent with ~20 tools that read and write the same data the app shows. Errors, traces and logs go to **Sentry**.
- **App** (`web/`): Next.js on Cloudflare via OpenNext, with Sentry in the browser and server.
- **Contract** (`packages/api/`): Zod schemas shared by both sides, with generated OpenAPI and TypeScript types.
- **Crawlers:** Apify actors, kept in a separate private repo; their row format is `docs/crawlers.md`.
- **Evals** (`evals/`): scripted conversations that check what Fred did, not just what he said, across models (Claude and Gemini).

See [Built with](#built-with) for the sponsor integrations.

## The original prototype (nest/)

Fred started as a Python CLI that read listing alert emails and checked buildings against NYC Open Data. Plain Python 3.11+, standard library only; data goes in `./data/nest.db`.

### Setup

1. Copy `config.example.json` to `config.json` and fill in your search.
2. **Alerts.** Save searches on StreetEasy, RentHop, Zumper, Zillow and Craigslist (needs an account), with instant email alerts. Then add a Gmail filter that labels them `nest-alerts`:
   `from:(streeteasy.com OR renthop.com OR zumper.com OR zillow.com OR craigslist.org OR listingsproject.com OR leasebreak.com)`
3. **IMAP.** Create a Google app password (Account → Security → App passwords) and put it in `config.json` under `imap`.

### Use

```sh
python3 -m nest building "170 N 10th St, Brooklyn"   # what the city knows about a building
python3 -m nest ingest                               # read new alert emails
python3 -m nest ingest --eml path/to/folder          # or saved .eml files
python3 -m nest list                                 # listings, best building first
```

### Where listings come from

| Source | How |
|---|---|
| StreetEasy, Zillow, RentHop, Zumper/PadMapper, Apartments.com, Craigslist | Saved-search alert emails. None has a public API. |
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

`https://fredandginger.jamesjuliusdarby.com`, a Cloudflare Worker with D1 and static assets.

- **Sign-in:** one login each for James and Erin. Passwords are Worker secrets: `npx wrangler secret put PASSWORD_JAMES` / `PASSWORD_ERIN`.
- **Crawls:** Fred starts the crawlers on Apify when he needs fresh listings for the saved search (`cloud/src/agent/crawl.ts`). Apify calls `/hooks/apify` when a run ends.
- **Every 2 minutes:** a cron stores a batch of finished-run rows, geocodes new addresses, and runs building checks. It does a few at a time to stay under Workers' per-invocation request limits.
- **Same apartment, several sites:** it becomes one listing, matched by normalised street + unit, then by BBL + unit after geocoding.
- **The UI:** New / Both like / I like / Erin likes / Passed, notes, filters and a map.
- **Deploy:** merge to `main`. CI (`.github/workflows/ci.yml`) runs the checks, then applies migrations and deploys, one deploy at a time. That needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets and the `DEPLOY_FROM_CI=true` variable on the repo. By hand, only if CI can't: `cd cloud && npx wrangler d1 migrations apply nest --remote && npx wrangler deploy`.

## The new app (web/)

A Next.js app with Tailwind 4 and Geist that will replace the grid the Worker serves today. The design is in two pages; ask Erin for access: the [app shell](https://claude.ai/artifact/7uQWQmj21bLe4dhVkFe8zd) and the [research behind it](https://claude.ai/artifact/SeW3ZkN9Rm7BWNP5ckdsyA).

- **Local:** `cd web && npm install && npm run dev`, then open http://localhost:3000.
- **Data:** `/api/*`, `/login` and `/logout` are proxied to the Worker. Production is the default. To use `wrangler dev`, put `FRED_API_URL=http://localhost:8787` in `web/.env.local`.
- **Theme:** `web/app/globals.css`. Token names follow shadcn/ui, so shadcn and AI Elements components pick them up.
- **Hosting:** Cloudflare, as its own Worker (`fred-web`) built with [OpenNext](https://opennext.js.org/cloudflare).
  - `npm run preview` runs the Cloudflare build locally.
  - `npm run deploy` ships it, but needs access to the Cloudflare account.
  - It's served on fredandginger.jamesjuliusdarby.com through `nest`'s `WEB` service binding: `nest` keeps `/api`, `/login`, `/logout` and `/hooks` and hands every other page to `fred-web`. The old grid is still at nest.jamesjuliusdarby.com.
  - Next is pinned to 16.3.8 because the adapter doesn't support 16.4 yet: 16.4 adds a `preview-props.json` the adapter doesn't bundle, and every page returns 500.

## The API contract (packages/api)

The routes and data shapes the app and the Worker agree on, written once as Zod schemas. Types are generated from them, so the two sides can't drift apart.

- **Source:** `packages/api/src/schemas.ts` (shapes) and `routes.ts` (every route). The Worker implements them in `cloud/src/v2.ts`, and TypeScript rejects a handler whose response doesn't match.
- **Generated:** `npm run gen:api` at the repo root writes `packages/api/openapi.json` and `web/lib/api/schema.gen.ts`. Commit both; `npm run check:api` fails if they're out of date.
- **In the app:** `import type { components } from '@/lib/api/schema.gen'`, then `components['schemas']['OpportunityCard']` and so on. The chat parts are there too: `DataSearchUpdated`, `DataScan`, `DataSuggestions`, `DataWatch`.
- **Real data:** the places routes (`/api/opportunities*`, and the counts in `/api/me`) serve real listings from D1 (`cloud/src/places.ts`): everything that passes the person's dealbreakers, the places Fred added, and anything they saved or passed on, marked `X-Fred-Data: real`. Saving or passing also writes the old grid's `votes` table, and a vote there shows in the app.
- **Example data for the rest:** the other routes still serve the mockup's examples (`packages/api/src/fixtures.ts`), marked with an `X-Fred-Data: example` header. `POST /api/chat` streams the mockup's chat turn in the AI SDK format, so `useChat` works against it. Routes switch to real data one at a time without changing shape.
- **Local:** `npm install` at the repo root (it's an npm workspace with `cloud` and `packages/*`; `web` keeps its own install), then `cd cloud && npx wrangler dev`.

## Crawlers

The Apify actors that collect listings live in a separate private repo. Each one pushes dataset rows in the shape in [`docs/crawlers.md`](docs/crawlers.md); the Worker starts them (`cloud/src/ingest.ts`, `SOURCES`) and reads their datasets when Apify calls `/hooks/apify`.

## Built with

- **Gemini:** Fred runs on any model Mastra knows, set as `provider/model` in `FRED_MODEL`. For Gemini, set `FRED_MODEL=google/gemini-3.8-flash` (or another `google/…` model) and add the key with `npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY`. Fred's effort setting (`FRED_EFFORT`) becomes Gemini's thinking level. `evals/isolate.ts` runs the same failure cases on Gemini and Claude side by side.
- **Nimble:** Fred's web research (`cloud/src/nimble.ts`): searching the web and reading listing pages and building reviews. Key: `NIMBLE_API_KEY`.
- **Sentry:** errors, traces and logs from the API Worker (`cloud/src/index.ts`, `SENTRY_DSN` in `cloud/wrangler.jsonc`).
- **Cloudflare:** Workers, D1, R2 (listing photos), Workers AI (chat recall embeddings), Email Sending.
- **Apify:** runs the crawlers. **Mastra:** Fred's agent loop and tools. **NYC Open Data:** building checks.
