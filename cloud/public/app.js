// nest front end: one page, plain JS.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n == null ? '' : '$' + Math.round(n).toLocaleString('en-US'));
const SRC = { streeteasy: 'StreetEasy', zillow: 'Zillow', craigslist: 'Craigslist', renthop: 'RentHop', zumper: 'Zumper', nooklyn: 'Nooklyn', compass: 'Compass', 'apartments.com': 'Apartments.com' };
const srcName = (s) => SRC[s] || (s.startsWith('landlord:') ? s.slice(9).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const S = { view: 'new', data: null, map: null, layer: null, showMap: false, filters: {} };
try { Object.assign(S.filters, JSON.parse(localStorage.getItem('nest.filters') || '{}')); } catch (e) {}

const api = async (path, opts) => {
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  return r.json();
};

function views() {
  const d = S.data, o = d ? d.names[d.other] : 'Them', c = (d && d.counts) || {};
  const V = [['new', 'New', c.new], ['both', 'Both like', c.both], ['liked', 'I like', c.liked], ['theirs', `${o} likes`, c.theirs], ['passed', 'Passed', c.passed]];
  $('views').innerHTML = V.map(([k, n, x]) => `<button data-v="${k}" class="${S.view === k ? 'on' : ''}">${esc(n)}<i>${x ?? ''}</i></button>`).join('');
  $('views').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.view = b.dataset.v; load(); }));
}

async function load() {
  const f = S.filters, q = new URLSearchParams({ view: S.view });
  if (f.max) q.set('maxPrice', f.max);
  if (f.beds !== undefined && f.beds !== '') q.set('minBeds', f.beds);
  if (f.area) q.set('area', f.area);
  if (f.score) q.set('minScore', f.score);
  if (f.sort) q.set('sort', f.sort);
  S.data = await api('/api/listings?' + q);
  $('me').textContent = S.data.names[S.data.me][0];
  $('me').title = `Signed in as ${S.data.names[S.data.me]} · sign out`;
  views(); paint();
}

const FLAG = { price_far_below_norm: 'price far below normal', wire_or_p2p_payment: 'asks for wire / Zelle / gift cards', deposit_before_viewing: 'deposit before viewing',
  owner_away: 'owner "out of the country"', foreign_or_whatsapp_contact: 'WhatsApp / overseas contact', email_in_body: 'email in post body', room_or_share: 'a room, not a whole apartment',
  map_pin_outside_borough: 'map pin outside the area' };
function warn(l) {
  const f = [...new Set(l.sources.flatMap((s) => s.flags || []))].filter((x) => x !== 'email_in_body');
  return f.length ? `<div class="warn">⚠ ${f.map((x) => esc(FLAG[x] || x)).join(' · ')}</div>` : '';
}
function scoreCls(s) { return s == null ? 'u' : s >= 80 ? 'g' : s >= 60 ? 'm' : 'b'; }

function card(l) {
  const d = S.data, other = d.names[d.other];
  const beds = l.beds === 0 ? 'Studio' : l.beds != null ? `${l.beds} bd` : '';
  const spec = [beds, l.baths ? `${l.baths} ba` : '', l.sqft ? `${l.sqft.toLocaleString()} ft²` : ''].filter(Boolean).join(' · ');
  const hist = l.price_history || [];
  const first = hist.length ? hist[0][1] : l.price, drop = first - l.price;
  const fresh = Date.now() / 1000 - l.first_seen < 86400;
  const tags = [fresh ? '<span class="tag new">New today</span>' : '', drop > 0 ? `<span class="tag drop">↓ ${money(drop)}</span>` : '',
                l.no_fee === 1 ? '<span class="tag">No fee</span>' : '',
                l.sources.some((s) => s.comingSoon) ? '<span class="tag excl">Coming soon</span>' : l.sources.some((s) => s.exclusive) ? `<span class="tag excl">${esc(srcName(l.sources.find((s) => s.exclusive).source))} exclusive</span>` : ''].join('');
  const b = l.building;
  const bld = b
    ? `<div class="bld"><div class="score ${scoreCls(b.score)}" title="Building score from NYC Open Data">${b.score}</div><div><ul>${
        b.flags.slice(0, 3).map((x) => `<li class="x">${esc(x)}</li>`).join('') || b.good.slice(0, 2).map((x) => `<li class="ok">✓ ${esc(x)}</li>`).join('')
      }</ul>${b.agent || b.owner ? `<div class="who">${esc(b.agent || b.owner)}${b.units ? ` · ${b.units} units` : ''}</div>` : ''}</div></div>`
    : `<div class="bld"><div class="score u">${l.geo_state === 'pending' ? '…' : 'n/a'}</div><div class="meta">${
        l.geo_state === 'pending' ? 'Checking the building with the city…' : l.geo_state === 'none' ? 'No street address given, so no building check' : 'Couldn’t match the address to a city building'}</div></div>`;
  const oh = l.open_house && l.open_house.startTime
    ? `Open house ${new Date(l.open_house.startTime).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${l.open_house.appointmentOnly ? ' (by appt)' : ''}` : '';
  const avail = l.available ? `Available ${new Date(l.available + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  const theirs = l.their_vote === 1 ? `<span class="theirs"><b>♥</b> ${esc(other)} likes this</span>` : l.their_vote === -1 ? `<span class="theirs">${esc(other)} passed</span>` : '';
  const el = document.createElement('article');
  el.className = 'card' + (l.my_vote === -1 ? ' passed' : '');
  el.innerHTML = `
    <div class="ph">${l.photos.length ? `<img loading="lazy" alt="" src="${esc(l.photos[0])}">` : ''}
      ${l.photos.length > 1 ? '<button class="nav prev" aria-label="Previous photo">‹</button><button class="nav next" aria-label="Next photo">›</button>' : ''}
      ${l.photos.length ? `<span class="count">1/${l.photos.length}</span>` : ''}<div class="tags">${tags}</div></div>
    <div class="body">
      <div class="top"><span class="price">${money(l.price)}</span><span class="spec">${esc(spec)}</span></div>
      <div class="addr">${esc(l.street || 'Address not given')}${l.unit ? ' #' + esc(l.unit) : ''} <small>${esc(l.neighbourhood || '')}</small></div>
      <div class="meta">${[avail, oh, l.net_effective ? `${money(l.net_effective)} net effective` : ''].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      ${warn(l)}
      ${bld}
      <div class="src">${l.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(srcName(s.source))} ↗</a>`).join('')}</div>
    </div>
    <div class="acts">
      <button class="vote like${l.my_vote === 1 ? ' on' : ''}">♥ Like</button>
      <button class="vote pass${l.my_vote === -1 ? ' on' : ''}">✕ Pass</button>
      <span class="grow"></span>${theirs}
    </div>
    <div class="notes">
      ${l.their_note ? `<div class="their"><b>${esc(other)}:</b> ${esc(l.their_note)}</div>` : ''}
      <textarea placeholder="Note for ${esc(other)}…" rows="1">${esc(l.my_note || '')}</textarea>
    </div>`;
  // photos
  let i = 0;
  const img = el.querySelector('.ph img'), cnt = el.querySelector('.count');
  const show = (d2) => { i = (i + d2 + l.photos.length) % l.photos.length; img.src = l.photos[i]; cnt.textContent = `${i + 1}/${l.photos.length}`; };
  el.querySelector('.prev')?.addEventListener('click', () => show(-1));
  el.querySelector('.next')?.addEventListener('click', () => show(1));
  // votes: click again to clear
  const vote = async (v) => {
    const nv = l.my_vote === v ? 0 : v;
    l.my_vote = nv;
    el.querySelector('.like').classList.toggle('on', nv === 1);
    el.querySelector('.pass').classList.toggle('on', nv === -1);
    el.classList.toggle('passed', nv === -1);
    await api('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, vote: nv }) });
    if (S.view === 'new' && nv !== 0) setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = 0; setTimeout(() => el.remove(), 250); }, 250);
    refreshCounts();
  };
  el.querySelector('.like').onclick = () => vote(1);
  el.querySelector('.pass').onclick = () => vote(-1);
  const ta = el.querySelector('textarea');
  let t;
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => api('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, note: ta.value }) }), 600); });
  return el;
}

async function refreshCounts() {
  const q = new URLSearchParams({ view: 'none' });
  const d = await api('/api/listings?' + q);
  S.data.counts = d.counts; views();
}

function paint() {
  const L = S.data.listings;
  $('list').replaceChildren(...L.map(card));
  const msg = { new: ['All caught up', 'New listings arrive every few hours.'], both: ['Nothing you both like yet', 'Like a few each and the overlap shows up here.'],
                liked: ['No likes yet', ''], theirs: [`${S.data.names[S.data.other]} hasn't liked anything new`, ''], passed: ['Nothing passed', ''] }[S.view] || ['Nothing here', ''];
  $('empty').hidden = !!L.length;
  $('empty').innerHTML = `<b>${esc(msg[0])}</b>${esc(msg[1])}`;
  if (S.showMap) paintMap();
}

function paintMap() {
  if (!S.map) {
    S.map = L.map('map', { zoomControl: true }).setView([40.72, -73.95], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap, &copy; CARTO', maxZoom: 19 }).addTo(S.map);
  }
  S.layer?.remove();
  S.layer = L.layerGroup().addTo(S.map);
  const pts = [];
  for (const l of S.data.listings) {
    if (l.lat == null) continue;
    const cls = l.my_vote === 1 && l.their_vote === 1 ? 'both' : l.my_vote === 1 ? 'like' : '';
    const m = L.marker([l.lat, l.lon], { icon: L.divIcon({ className: '', html: `<span class="pin ${cls}">${money(l.price)}</span>`, iconSize: [0, 0] }) });
    m.on('click', () => { const c = [...$('list').children][S.data.listings.indexOf(l)]; c?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    m.addTo(S.layer); pts.push([l.lat, l.lon]);
  }
  if (pts.length) S.map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  setTimeout(() => S.map.invalidateSize(), 50);
}

// filters
const F = { max: 'fmax', beds: 'fbeds', area: 'farea', score: 'fscore', sort: 'fsort' };
for (const [k, id] of Object.entries(F)) {
  if (S.filters[k] != null) $(id).value = S.filters[k];
  $(id).addEventListener('change', () => { S.filters[k] = $(id).value; try { localStorage.setItem('nest.filters', JSON.stringify(S.filters)); } catch (e) {} load(); });
}
api('/api/areas').then((a) => {
  $('farea').innerHTML = '<option value="">ours</option><option value="*">all NYC</option>' + a.map((x) => `<option value="${esc(x.name)}">${esc(x.name)} (${x.n})</option>`).join('');
  if (S.filters.area) $('farea').value = S.filters.area;
});

$('mapbtn').onclick = () => { S.showMap = !S.showMap; $('map').hidden = !S.showMap; $('mapbtn').classList.toggle('on', S.showMap); if (S.showMap) paintMap(); };

// settings
async function openSettings() {
  const s = await api('/api/searches'), c = s.criteria || {};
  const f = $('sform');
  f.maxRent.value = c.maxRent || ''; f.minBeds.value = c.minBeds ?? 1; f.areas.value = (c.areas || []).join(', ');
  paintRuns();
  $('settings').showModal();
}
async function paintRuns() {
  const r = await api('/api/runs');
  const t = r.totals || {};
  $('runs').innerHTML = `<div>${t.active || 0} active listings · ${t.buildings || 0} buildings checked</div>` +
    (r.runs.map((x) => `<div>${new Date(x.started * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${esc(srcName(x.source))} · ${esc(x.status)}${x.items != null ? ` · ${x.items} found, ${x.added} new` : ''}${x.cost ? ` · $${x.cost.toFixed(3)}` : ''}${x.error ? ' · ' + esc(x.error) : ''}</div>`).join('') || '<div>No runs yet.</div>');
}
$('setbtn').onclick = openSettings;
$('ssave').onclick = async () => {
  const f = $('sform');
  const areas = f.areas.value.split(/[,\n]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
  await api('/api/searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxRent: f.maxRent.value, minBeds: f.minBeds.value, areas }) });
  $('ssave').textContent = 'Saved'; setTimeout(() => ($('ssave').textContent = 'Save'), 1500);
};
$('srun').onclick = async () => {
  $('srun').disabled = true; $('srun').textContent = 'Starting…';
  const r = await api('/api/runs', { method: 'POST' });
  $('srun').textContent = r.started?.length ? `Started ${r.started.length} crawler${r.started.length > 1 ? 's' : ''}` : 'Save a search first';
  setTimeout(() => { $('srun').disabled = false; $('srun').textContent = 'Run crawlers now'; }, 4000);
  paintRuns();
};

load();
