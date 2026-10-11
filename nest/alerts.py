"""Listing alerts by email: the sites send them, we read them.

StreetEasy, Zillow, RentHop, Zumper, Apartments.com and Craigslist all block
automated browsing, but all will email you new matches for a saved search.
Point those alerts at one Gmail label (a filter does it) and this reads them
over IMAP with an app password, or from .eml files for testing.

Parsing is deliberately generic: an alert is a run of listing cards, each with
a link, a price, beds/baths and usually an address and photo. We cut the email
into one chunk per listing link and pull those fields out of each chunk.
Site-specific tweaks go in SOURCES once real alerts are in hand.
"""
from __future__ import annotations

import email, email.policy, html, imaplib, re, time, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path

from .config import CFG, UA

# sender domain -> source name, and what a listing URL looks like once unwrapped
SOURCES = {
    "streeteasy.com": ("streeteasy", r"streeteasy\.com/(building/[^/?#]+/[^/?#]+|rental/\d+)"),
    "zillow.com": ("zillow", r"zillow\.com/(homedetails|apartments|b)/"),
    "renthop.com": ("renthop", r"renthop\.com/listings/"),
    "zumper.com": ("zumper", r"zumper\.com/apartment-buildings/|zumper\.com/address/"),
    "padmapper.com": ("padmapper", r"padmapper\.com/(buildings|apartments)/"),
    "apartments.com": ("apartments.com", r"apartments\.com/[^/]+/[a-z0-9]+/?"),
    "craigslist.org": ("craigslist", r"craigslist\.org/.+/\d+\.html"),
    "listingsproject.com": ("listings project", r"listingsproject\.com/(listings|real-estate)/"),
    "leasebreak.com": ("leasebreak", r"leasebreak\.com/(short-term-rental|lease-takeover|sublet)"),
}
SKIP_LINK = re.compile(r"unsubscribe|preferences|privacy|terms|help|settings|app\.link|apps\.apple|play\.google|"
                       r"facebook\.com|instagram\.com|twitter\.com|x\.com/|mailto:|/saved|/search\b|manage", re.I)


class _Flatten(HTMLParser):
    """HTML -> text, with each <a href> marked as ⟦LINK n⟧ and <img src> kept."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.links, self.imgs, self._skip = [], [], [], 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "script", "head"):
            self._skip += 1
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"]); self.out.append(f" ⟦LINK {len(self.links) - 1}⟧ ")
        elif tag == "img" and a.get("src") and not re.search(r"pixel|track|open\.|spacer|logo|icon|badge", a["src"], re.I):
            w = a.get("width") or ""
            if not (w.isdigit() and int(w) < 60):
                self.imgs.append(a["src"]); self.out.append(f" ⟦IMG {len(self.imgs) - 1}⟧ ")
        elif tag in ("br", "p", "div", "tr", "td", "li", "h1", "h2", "h3", "table"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("style", "script", "head"):
            self._skip = max(0, self._skip - 1)

    def handle_data(self, d):
        if not self._skip:
            self.out.append(d)


def _unwrap(url: str, pattern: str, hops: int = 4) -> str:
    """Click-tracking links (click.streeteasy.com/...) -> the real listing URL, by reading
    the redirect's Location header only; the listing page itself is never fetched."""
    class NoFollow(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    op = urllib.request.build_opener(NoFollow)
    for _ in range(hops):
        if re.search(pattern, url):
            return url
        try:
            op.open(urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA}), timeout=10)
            return url
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location")
            if not loc or e.code not in (301, 302, 303, 307, 308):
                return url
            url = urllib.parse.urljoin(url, loc)
        except Exception:
            return url
    return url


PRICE = re.compile(r"\$\s?(\d{1,2},?\d{3})(?!\d)")
BEDS = re.compile(r"\b(studio)\b|(\d(?:\.5)?)\s*(?:bd|bed|beds|bedrooms?|br)\b", re.I)
BATHS = re.compile(r"(\d(?:\.5)?)\s*(?:ba|bath|baths|bathrooms?)\b", re.I)
SQFT = re.compile(r"([\d,]{3,5})\s*(?:ft²|sq\.?\s*ft|square feet)", re.I)
ADDR = re.compile(r"\b\d{1,5}(?:-\d{1,3})?\s+(?:(?:N|S|E|W|North|South|East|West)\.?\s+)?"
                  r"(?:\d{1,3}(?:st|nd|rd|th)?|[A-Z][a-zA-Z.']+)(?:\s+[A-Z][a-zA-Z.']+){0,3}\s+"
                  r"(?:St|Street|Ave|Avenue|Pl|Place|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Pkwy|Parkway|"
                  r"Ter|Terrace|Way|Sq|Square|Concourse|Plaza|Loop|Walk|Crescent|Hwy|Highway|Broadway|Bowery)\b\.?"
                  r"(?:,?\s*(?:#|Apt\.?|Unit)\s*[\w-]+)?", re.I)
NOFEE = re.compile(r"\bno[\s-]?fee\b", re.I)


def parse(msg: email.message.Message) -> dict:
    """One alert email -> {"source", "subject", "listings": [{url, price, beds, ...}]}."""
    frm = (msg.get("From") or "").lower()
    dom = next((d for d in SOURCES if d in frm), None)
    source, pattern = SOURCES.get(dom, ("other", r"$^"))
    body = msg.get_body(preferencelist=("html", "plain"))
    raw = body.get_content() if body else ""
    if body is not None and body.get_content_type() == "text/plain":
        raw = re.sub(r"(https?://\S+)", r'<a href="\1">\1</a>', html.escape(raw)).replace("\n", "<br>")
    fl = _Flatten(); fl.feed(raw)
    text = "".join(fl.out)
    # split into one chunk per distinct listing link; the card's text sits around its links
    parts = re.split(r"(⟦LINK \d+⟧)", text)
    chunks, cur, cur_link = [], [], None
    for p in parts:
        m = re.match(r"⟦LINK (\d+)⟧", p)
        if not m:
            cur.append(p); continue
        href = html.unescape(fl.links[int(m.group(1))])
        if SKIP_LINK.search(href) or not href.startswith("http"):
            continue
        if cur_link and href != cur_link and PRICE.search("".join(cur)):
            chunks.append((cur_link, "".join(cur))); cur = []
        cur_link = cur_link if cur_link and href == cur_link else href
    if cur_link:
        chunks.append((cur_link, "".join(cur)))
    out, seen = [], set()
    for href, chunk in chunks:
        price = PRICE.search(chunk)
        if not price:
            continue                       # banners, footers, "see all results"
        url = _unwrap(href, pattern)
        if url in seen:
            continue
        seen.add(url)
        t = re.sub(r"\s+", " ", re.sub(r"⟦(LINK|IMG) \d+⟧", " ", chunk)).strip()
        b = BEDS.search(t)
        img = re.search(r"⟦IMG (\d+)⟧", chunk)
        addr = ADDR.search(t)
        out.append({"source": source, "url": url, "price": int(price.group(1).replace(",", "")),
                    "beds": 0.0 if b and b.group(1) else (float(b.group(2)) if b else None),
                    "baths": float(BATHS.search(t).group(1)) if BATHS.search(t) else None,
                    "sqft": int(SQFT.search(t).group(1).replace(",", "")) if SQFT.search(t) else None,
                    "address": addr.group(0).strip() if addr else None,
                    "no_fee": bool(NOFEE.search(t)), "photo": fl.imgs[int(img.group(1))] if img else None,
                    "text": t[:400]})
    return {"source": source, "subject": msg.get("Subject", ""), "msgid": msg.get("Message-ID") or msg.get("Subject"),
            "listings": out}


def from_files(folder: str | Path) -> list[dict]:
    return [parse(email.message_from_bytes(p.read_bytes(), policy=email.policy.default))
            for p in sorted(Path(folder).glob("*.eml"))]


def from_imap(seen: set, days: int = 14) -> list[dict]:
    c = CFG.get("imap") or {}
    if not (c.get("user") and c.get("app_password")):
        raise SystemExit("set imap.user and imap.app_password in config.json "
                         "(Google account → Security → App passwords)")
    m = imaplib.IMAP4_SSL(c.get("host", "imap.gmail.com"))
    m.login(c["user"], c["app_password"])
    m.select(f'"{c.get("folder", "nest-alerts")}"', readonly=True)
    since = time.strftime("%d-%b-%Y", time.localtime(time.time() - days * 86400))
    _, ids = m.search(None, f"(SINCE {since})")
    out = []
    for i in ids[0].split():
        _, hdr = m.fetch(i, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        mid = email.message_from_bytes(hdr[0][1]).get("Message-ID")
        if mid in seen:
            continue
        _, data = m.fetch(i, "(BODY.PEEK[])")
        out.append(parse(email.message_from_bytes(data[0][1], policy=email.policy.default)))
    m.logout()
    return out
