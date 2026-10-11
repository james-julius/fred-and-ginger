// nest: Apartments.com NYC rental search results -> dataset rows in the nest SCHEMA.
// (Rent.com and ApartmentGuide share this inventory, so they have no actor of their own.)
//
// STATUS (2026-10-10): BLOCKED. This is a probe, not a working crawler. It loads the
// given searchUrls and saves the HTML + response list to the key-value store.
// Every configuration tried got Akamai "Access Denied" (403, or 200 with a 347-byte
// denial page) on ~10 residential IPs:
//   - Playwright Chromium + fingerprint-injector, headless and headful (xvfb)
//   - Google Chrome, no fingerprint injection, headful, with and without asset blocking
//   - Camoufox 152 (patched Firefox): denied on the very first request
//   - Patchright + Google Chrome headful, no request interception
// Chrome variants get Akamai's interstitial (sec-if-cpt) challenge, POST the sensor,
// then are denied on reload, i.e. the sensor data fails, not the IP alone.
// Note: on Apify every page gets an inline script injected before <html> that
// replaces document.cookie with a no-op; the addInitScript below undoes it.
// Camoufox variant: Dockerfile FROM apify/actor-node-playwright-firefox:22-1.62.1 plus
// `env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD npx camoufox-js fetch`, no --no-optional.
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'patchright';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const blockScripts = input.blockScripts ?? true;
const urls = input.searchUrls ?? [];

const proxyConfiguration = input.proxyGroup === 'none' ? undefined : await Actor.createProxyConfiguration(input.proxyGroup === 'DATACENTER' ? {} : { groups: ['RESIDENTIAL'], countryCode: input.proxyCountry || 'US' });
let bytes = 0;
const hosts = {};
const reqs = [];
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    persistCookiesPerSession: true,
    sessionPoolOptions: { blockedStatusCodes: [] },
    maxConcurrency: 2,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 75,
    requestHandlerTimeoutSecs: 120,
    browserPoolOptions: { useFingerprints: false },
    launchContext: { launcher: chromium, useChrome: true, launchOptions: { headless: input.headless ?? false } },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'domcontentloaded';
            page.on('requestfinished', async (r) => { try { const z = await r.sizes(); bytes += z.responseBodySize + z.responseHeadersSize; } catch {} });
            if (input.cookieFix ?? true) {
                await page.addInitScript(() => {
                    const d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
                    try { Object.defineProperty(document, 'cookie', { get() { return d.get.call(this); }, set(v) { d.set.call(this, v); }, configurable: false, enumerable: true }); } catch {}
                });
            }
            page.on('response', (r) => reqs.push(`${r.status()} ${r.request().resourceType()} ${r.request().method()} ${r.url().slice(0, 200)}`));
            if (input.noRoute ?? true) return;
            await page.route('**/*', (route) => {
                const t = route.request().resourceType();
                if ((input.blockTypes ?? ['image', 'media', 'font', 'stylesheet']).includes(t)) return route.abort();
                let host = '';
                try { host = new URL(route.request().url()).hostname; } catch {}
                if (!input.allowAll && !/(^|\.)apartments\.com$/i.test(host)) { hosts[host] = (hosts[host] || 0) + 1; return route.abort(); }
                if (blockScripts && t === 'script') return route.abort();
                return route.continue();
            });
        },
    ],
    async requestHandler({ request, page, response }) {
        const status = response?.status() ?? 0;
        for (let k = 0; k < (input.reloads ?? 3); k++) {
            try { await page.waitForSelector('[data-listingid], #placardContainer', { state: 'attached', timeout: 20000 }); log.info(`placards after ${k} reloads`); break; } catch { log.warning(`no placards (try ${k}): ${(await page.title().catch(() => '?'))}`); }
            await page.waitForTimeout(3000);
            const r = await page.goto(request.url, { waitUntil: 'domcontentloaded' }).catch((e) => null);
            log.info(`reload status ${r?.status()}`);
        }
        await page.waitForTimeout(2000);
        log.info(`cookie test: ${await page.evaluate(() => { document.cookie = 'nesttest=1; path=/'; return document.cookie.slice(0, 300); }).catch((e) => String(e))}`);
        const html = await page.content();
        log.info(`${request.url}: status ${status}, ${html.length} bytes, final ${page.url()}`);
        await Actor.setValue(`html-${request.userData.i}`, html, { contentType: 'text/html' });
    },
});
await crawler.run(urls.map((u, i) => ({ url: u, userData: { i } })));
log.info(`~${(bytes / 1e6).toFixed(2)} MB`);
await Actor.setValue('hosts', hosts);
await Actor.setValue('reqs', reqs.join('\n'), { contentType: 'text/plain' });
await Actor.exit();
