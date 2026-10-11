// Nimble (nimbleway.com): live web search, and reading a listing page the crawlers only saw a
// card for. Fred uses both to research a place: tenant reviews, the landlord, what the full
// listing says about windows, layout and laundry. NIMBLE_API_KEY is a Worker secret.
const BASE = 'https://sdk.nimbleway.com/v2';

async function call(key: string, path: string, body: unknown, ms: number) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`Nimble ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json<any>();
}

export type WebResult = { title: string; url: string; snippet: string };

export async function webSearch(key: string, query: string, max = 5): Promise<WebResult[]> {
  const d = await call(key, '/search', { query, max_results: max, search_depth: 'lite', country: 'US', locale: 'en' }, 15_000);
  return (d.results ?? []).map((r: any) => ({ title: String(r.title ?? ''), url: String(r.url ?? ''), snippet: String(r.description ?? '').slice(0, 400) }));
}

/** A page as Markdown, main content only, rendered (most listing sites need JavaScript). */
export async function readPage(key: string, url: string): Promise<string> {
  const d = await call(key, '/extract', { url, formats: ['markdown'], markdown_backend: 'main_content', render: true, country: 'US' }, 45_000);
  return String(d?.data?.markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // links: keep the text
    .replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
