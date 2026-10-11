// Fred's emails: the HTML and plain-text versions, in the app's look (warm paper, near-black ink,
// the window mark with one pane lit), built from tables and inline styles so Gmail renders them.
// Sent with Cloudflare Email Sending from fred@jamesjuliusdarby.com.

const INK = '#141413', MUTED = '#6b6a64', PAPER = '#f5f5f2', CARD = '#ffffff', LINE = '#e7e6e1', CHIP = '#f0efeb', LIT = '#ffdd55', GOOD = '#2e9e5b';
const FONT = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const APP_URL = 'https://fredandginger.jamesjuliusdarby.com';
export const FROM = { email: 'fred@jamesjuliusdarby.com', name: 'Fred' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Fred's window mark, as table cells: email apps don't render SVG reliably. */
function mark(px = 22) {
  const pane = (lit: boolean) => `<td width="${px / 2}" height="${Math.round(px * 0.62)}" style="background:${lit ? LIT : CARD};border:1.5px solid ${INK};font-size:0;line-height:0">&nbsp;</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1.5px solid ${INK};border-radius:3px"><tr>${pane(true)}${pane(false)}</tr><tr>${pane(false)}${pane(false)}</tr></table>`;
}

function page(o: { title: string; preview: string; heading: string; sub?: string; body: string; footer: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden">${esc(o.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 16px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
  <tr><td style="padding:0 2px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle">${mark()}</td><td width="10"></td><td valign="middle" style="font:600 20px ${FONT};color:${INK};letter-spacing:-0.01em">Fred</td></tr></table></td></tr>
  <tr><td style="padding:0 2px ${o.sub ? 6 : 22}px;font:600 30px/1.15 ${FONT};color:${INK};letter-spacing:-0.025em">${esc(o.heading)}</td></tr>
  ${o.sub ? `<tr><td style="padding:0 2px 26px;font:400 15px/1.5 ${FONT};color:${MUTED}">${esc(o.sub)}</td></tr>` : ''}
  ${o.body}
  <tr><td style="border-top:1px solid ${LINE};padding:20px 2px 0;font:400 12px/1.6 ${FONT};color:${MUTED}">${o.footer}<br><br>Fred &amp; Ginger &middot; New York</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (label: string, href: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${INK};border-radius:10px"><a href="${href}" style="display:inline-block;padding:11px 18px;font:600 14px ${FONT};color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
const chip = (t: string) => `<td style="background:${CHIP};border-radius:999px;padding:5px 11px;font:500 13px/1 ${FONT};color:${INK};white-space:nowrap">${esc(t)}</td><td width="6"></td>`;

export type Email = { subject: string; html: string; text: string };

export function codeEmail(code: string): Email {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `${spaced} is your Fred code`,
    text: `Your code is ${spaced}\n\nEnter it in Fred to start getting alerts at this address. It expires in 10 minutes.\n\nIf you didn't ask for this, ignore it; nothing will be sent here.`,
    html: page({
      title: 'Your Fred code', preview: `${spaced}: enter it in Fred to turn on email alerts`,
      heading: 'Your code', sub: 'Enter it in Fred to start getting alerts at this address.',
      body: `<tr><td style="padding:0 0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:16px;border-collapse:separate">
        <tr><td align="center" style="padding:28px 20px;font:600 40px/1 ${FONT};letter-spacing:0.18em;color:${INK}">${spaced}</td></tr></table></td></tr>
        <tr><td style="padding:0 2px 28px;font:400 14px/1.5 ${FONT};color:${MUTED}">It expires in 10 minutes.</td></tr>`,
      footer: "If you didn't ask for this, ignore it. Nothing will be sent to this address unless the code is entered.",
    }),
  };
}

export type AlertPlace = {
  id: string; price: number; area: string; address: string;
  beds: number | null; baths: number | null; buildingScore?: number | null;
  verdict: string; why: string | null; photo: string | null; url?: string | null;
};

export function alertEmail(places: AlertPlace[], o: { searchLine: string; example?: boolean }): Email {
  const n = places.length;
  const heading = n === 1 ? `New ${places[0].verdict.toLowerCase()}: ${money(places[0].price)} in ${places[0].area}` : `${n} new places fit your search`;
  const subject = n === 1
    ? `${places[0].verdict}: ${money(places[0].price)} · ${places[0].area}${places[0].beds != null ? `, ${places[0].beds} bed` : ''}`
    : `${n} new places fit your search · from ${money(Math.min(...places.map((p) => p.price)))}`;
  const size = (p: AlertPlace) => [p.beds != null && `${p.beds === 0 ? 'Studio' : `${p.beds} bed`}`, p.baths != null && `${p.baths} bath`].filter(Boolean) as string[];
  const cards = places.map((p) => `
<tr><td style="padding:0 0 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:16px;border-collapse:separate;overflow:hidden">
${p.photo ? `<tr><td style="padding:0;font-size:0;line-height:0"><a href="${APP_URL}"><img src="${esc(p.photo)}" width="520" alt="Photo of ${esc(p.address)}" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:16px 16px 0 0"></a></td></tr>` : ''}
<tr><td style="padding:20px 22px 22px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font:600 26px/1.1 ${FONT};color:${INK};letter-spacing:-0.02em">${money(p.price)}<span style="font:400 15px ${FONT};color:${MUTED};letter-spacing:0">/mo</span></td>
    <td align="right" style="font:600 13px ${FONT};color:${GOOD};white-space:nowrap"><span style="font-size:15px">&#9679;</span>&nbsp;${esc(p.verdict)}</td>
  </tr></table>
  <div style="font:600 16px/1.4 ${FONT};color:${INK};margin:8px 0 2px">${esc(p.area)}</div>
  <div style="font:400 14px/1.4 ${FONT};color:${MUTED};margin:0 0 14px">${esc(p.address)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>${[...size(p), ...(p.buildingScore != null ? [`Building ${p.buildingScore}/100`] : [])].map(chip).join('')}</tr></table>
  ${p.why ? `<div style="font:400 15px/1.55 ${FONT};color:${INK};margin:0 0 18px">${esc(p.why)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td>${button('See it in Fred', APP_URL)}</td>
    ${p.url ? `<td width="16"></td><td><a href="${esc(p.url)}" style="font:500 14px ${FONT};color:${MUTED};text-decoration:underline">Original listing</a></td>` : ''}
  </tr></table>
</td></tr></table></td></tr>`).join('');
  const why = (p: AlertPlace) => (p.why ? `\n${p.why}` : '');
  return {
    subject: o.example ? `Example: ${subject}` : subject,
    text: `${heading}\n${o.searchLine}\n\n` + places.map((p) => `${money(p.price)}/mo · ${p.area} · ${p.verdict}\n${p.address}${size(p).length ? ` · ${size(p).join(', ')}` : ''}${why(p)}\nSee it in Fred: ${APP_URL}${p.url ? `\nOriginal listing: ${p.url}` : ''}`).join('\n\n')
      + `\n\nOpen your inbox: ${APP_URL}\n\n${o.example ? 'This is an example alert you asked Fred to send.' : 'You get these because you turned on email alerts in Fred.'} Change or stop them any time in Fred.`,
    html: page({
      title: heading, preview: places.map((p) => `${p.area} ${money(p.price)}`).join(' · '),
      heading, sub: o.searchLine,
      body: cards + `<tr><td align="center" style="padding:8px 0 28px"><a href="${APP_URL}" style="font:600 15px ${FONT};color:${INK};text-decoration:underline">Open your inbox in Fred</a></td></tr>`,
      footer: `${o.example ? 'This is an example alert you asked Fred to send.' : 'You get these because you turned on email alerts in Fred.'} Change or stop them any time in Fred.`,
    }),
  };
}

/** Send through the EMAIL binding. Locally (FRED_DEV=1) nothing is sent: it's logged instead. */
export async function sendEmail(env: { EMAIL?: SendEmail; FRED_DEV?: string }, to: string, e: Email): Promise<{ messageId: string | null; error?: string }> {
  if (env.FRED_DEV === '1' || !env.EMAIL) {
    console.log(`[email not sent: local dev] to=${to} subject=${e.subject}`);
    return { messageId: null };
  }
  try {
    const r = await env.EMAIL.send({ from: FROM, to, subject: e.subject, html: e.html, text: e.text });
    return { messageId: r.messageId };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { messageId: null, error: `${code ?? 'E_UNKNOWN'}: ${(err as Error).message}` };
  }
}
