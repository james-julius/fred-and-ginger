# Listing rows: what every nest actor pushes to its dataset

Every source actor in `actor/<source>/` pushes one dataset row per rental listing.
Field names and types below are fixed so `nest` can ingest every source the same way.
Unknown values are `null`; never guess.

| field | type | notes |
|---|---|---|
| `source` | string | `streeteasy`, `zillow`, `craigslist`, `renthop`, `zumper`, `rentcafe:<company>`, ... |
| `sourceId` | string | the site's own listing id |
| `url` | string | absolute URL of the listing page a person would open |
| `street` | string | "255 Lorimer Street" (no unit) |
| `unit` | string\|null | "4B" (no "#", no "Apt") |
| `neighbourhood` | string\|null | as the site names it |
| `borough` | string\|null | Manhattan / Brooklyn / Queens / Bronx / Staten Island |
| `zip` | string\|null | |
| `lat`, `lon` | number\|null | |
| `price` | integer | monthly rent in USD (gross, as advertised) |
| `netEffective` | integer\|null | when the site shows a net-effective price |
| `beds` | number | 0 = studio |
| `baths` | number\|null | full + 0.5 × half |
| `sqft` | integer\|null | null if 0 / not given |
| `noFee` | boolean\|null | null = the site doesn't say |
| `available` | string\|null | ISO date |
| `photos` | string[] | up to 8 image URLs |
| `agency` | string\|null | broker / management company |
| `listedAt` | string\|null | ISO datetime the site says it was posted |
| `scrapedAt` | string | ISO datetime |
| `raw` | object | anything else useful from the source, untouched |

## House rules for all actors

- Search/results pages only, plus detail pages only when a required field is missing. No logins, ever.
- Residential proxy is shared: 10 GB/month for everything. Block images, fonts and media, and keep concurrency at 2–3.
- Low volume: these run once or twice a day for one person's search.
- Test runs: `maxItems` ≤ 30, and report what the run cost.
