// =============================================================
// Edge Function "mailer"
// Verschickt alle E-Mails der App über Brevo und alle Push-Nachrichten (Web Push):
//   * Einteilungen (Button "E-Mails senden")
//   * Nachrücken von der Warteliste
//   * Einladungslinks
//   * Erinnerungen vor der Gruppen-Deadline (offene Punkte)
//   * Bestätigte Beitrittsanfragen
// Außerdem: Abmelden per Klick (Link in jeder Mail und "List-Unsubscribe"-Kopfzeile).
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   BREVO_API_KEY   API-Schlüssel aus Brevo (SMTP & API → API Keys)
//   MAIL_FROM       Absenderadresse auf deiner eigenen, in Brevo bestätigten Domain
//   APP_URL         Adresse der App, z. B. https://name.github.io/chronik/planer/
// Optional:
//   MAIL_FROM_NAME  Absendername (Standard: appName aus config.js der App)
//   REPLY_TO        Adresse für Antworten, z. B. dein normales Postfach
//   TIMEZONE        Zeitzone für Datumsangaben (Standard Europe/Berlin)
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  für Push-Benachrichtigungen (tools/vapid.html)
//   VAPID_SUBJECT   z. B. mailto:du@example.org (Standard: mailto:MAIL_FROM)
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
// Wichtig: Bei dieser Funktion "Verify JWT" ausschalten, damit Abmelde-Klicks aus
// Mailprogrammen (ohne Anmeldung) ankommen.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const BREVO_KEY = env('BREVO_API_KEY');
const FROM = env('MAIL_FROM');
const REPLY_TO = env('REPLY_TO');
const APP_URL = env('APP_URL').replace(/\/?$/, '/');
const TZ = env('TIMEZONE') || 'Europe/Berlin';
const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const UNSUB_SECRET = env('UNSUB_SECRET') || SERVICE_KEY;
const VAPID_PUBLIC = env('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE = env('VAPID_PRIVATE_KEY');
const PUSH_ON = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (PUSH_ON) webpush.setVapidDetails(env('VAPID_SUBJECT') || `mailto:${FROM || 'admin@example.org'}`, VAPID_PUBLIC, VAPID_PRIVATE);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ---------------- App-Name aus config.js ----------------
// Der Name steht nur an einer Stelle: in config.js der App. Die Funktion liest ihn von dort.
let APP = env('APP_NAME') || 'Teamplaner';
let appLoaded = !!env('APP_NAME');
async function loadAppName() {
  if (appLoaded || !APP_URL.startsWith('http')) return;
  try {
    const res = await fetch(APP_URL + 'config.js', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return;
    const m = (await res.text()).match(/appName\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/);
    if (m && m[2].trim()) APP = m[2].replace(/\\(.)/g, '$1').trim();
    appLoaded = true;
  } catch { /* beim nächsten Aufruf erneut versuchen */ }
}
const fromName = () => env('MAIL_FROM_NAME') || APP;

type Outbox = {
  id: string; to_user: string | null; to_email: string; to_name: string; kind: string; lang: string; attempts: number;
  payload: Record<string, any>;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function fill(s: string, vars: Record<string, unknown>) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function fmt(lang: string, iso?: string | null, withTime = true) {
  if (!iso) return '';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  try { return new Intl.DateTimeFormat(LOCALES[lang] ?? 'de-DE', opts).format(new Date(iso)); } catch { return iso; }
}

function range(lang: string, a?: string | null, b?: string | null) {
  if (!a) return '';
  if (!b) return fmt(lang, a);
  const sameDay = new Date(a).toDateString() === new Date(b).toDateString();
  if (sameDay) {
    const t = new Intl.DateTimeFormat(LOCALES[lang] ?? 'de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(b));
    return `${fmt(lang, a)} – ${t}`;
  }
  return `${fmt(lang, a)} – ${fmt(lang, b)}`;
}

// ---------------- Abmelden ----------------
// Welche Einstellung (profiles.mail_prefs) eine Mail-Art abschaltet
const category = (kind: string) => (kind === 'invite' ? null : kind === 'deadline_reminder' ? 'deadline' : 'assignment');

async function sign(u: string, c: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(UNSUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`unsub:${u}:${c}`)));
  return btoa(String.fromCharCode(...mac.slice(0, 18))).replace(/\+/g, '-').replace(/\//g, '_');
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
type Unsub = { page: string; oneClick: string };
async function unsubLinks(m: Outbox): Promise<Unsub | null> {
  const c = category(m.kind);
  if (!c || !m.to_user || !UNSUB_SECRET) return null;
  const s = await sign(m.to_user, c);
  return {
    page: `${APP_URL}#/unsubscribe/${m.to_user}/${c}/${s}`,
    oneClick: `${SUPABASE_URL}/functions/v1/mailer?unsub=1&u=${m.to_user}&c=${c}&s=${s}`,
  };
}

// ---------------- Kalendereintrag (.ics) ----------------
function icsText(s: unknown) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFold(line: string) {
  // Zeilen nach RFC 5545 bei 75 Bytes umbrechen, ohne UTF-8-Zeichen zu zerteilen
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function buildIcs(p: Record<string, any>, link: string) {
  const startIso = p.position_start || p.event_start;
  if (!startIso) return null;
  const start = new Date(startIso);
  const endIso = p.position_start ? p.position_end : p.event_end;
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + 2 * 3600 * 1000);
  let host = 'app';
  try { host = new URL(APP_URL).host || host; } catch { /* egal */ }
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${icsText(APP)}//Planer//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${p.assignment_id || p.position_id || crypto.randomUUID()}@${host}`,
    `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`${p.position_name} – ${p.event_title}`)}`,
    p.location ? `LOCATION:${icsText(p.location)}` : '',
    `DESCRIPTION:${icsText([p.team_name, p.position_description, link].filter(Boolean).join('\n'))}`,
    `URL:${link}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  const text = lines.map(icsFold).join('\r\n') + '\r\n';
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------- Mail-Layout ----------------
// Tabellen-Layout mit festen Farben: sieht in Gmail, Outlook, Apple Mail und auf dem Handy gleich aus.
const C = { bg: '#f5f1ff', card: '#ffffff', ink: '#241d3b', soft: '#5d5677', muted: '#8c86a3', brand: '#7c5cff', pink: '#ff4f8b', tint: '#f3efff', line: '#ebe6f7' };
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function layout(o: { lang: string; title: string; preheader: string; inner: string; reason: string; unsub: Unsub | null }) {
  const T = TEXTS[o.lang] ?? TEXTS.de;
  const logo = APP_URL.startsWith('http') ? `${APP_URL}img/icon-192.png` : '';
  const links = [
    `<a href="${esc(APP_URL + '#/profile')}" style="color:${C.muted};text-decoration:underline">${esc(T.footer_settings)}</a>`,
    o.unsub ? `<a href="${esc(o.unsub.page)}" style="color:${C.muted};text-decoration:underline">${esc(T.footer_unsub)}</a>` : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');
  return `<!doctype html>
<html lang="${esc(o.lang)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(o.title)}</title>
<style>
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  a { color:${C.brand}; }
  @media (max-width:600px) { .px { padding-left:20px !important; padding-right:20px !important; } .h1 { font-size:22px !important; } }
  @media (prefers-color-scheme: dark) {
    .bg { background:#16121f !important; } .card { background:#221c30 !important; }
    .ink { color:#f1edfb !important; } .soft { color:#c9c2dd !important; } .ticket { background:#2c2540 !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(o.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" class="bg" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px">
    <tr><td class="px" style="padding:0 8px 16px;font-family:${FONT}">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
        ${logo ? `<td style="padding-right:10px;vertical-align:middle"><img src="${esc(logo)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:10px"></td>` : ''}
        <td class="ink" style="vertical-align:middle;font-size:17px;font-weight:800;color:${C.ink};letter-spacing:-.01em">${esc(APP)}</td>
      </tr></table>
    </td></tr>
    <tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border-radius:22px;overflow:hidden">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td height="6" bgcolor="${C.brand}" style="height:6px;line-height:6px;font-size:6px;background:${C.brand};background-image:linear-gradient(90deg,${C.brand},${C.pink})">&nbsp;</td></tr>
        <tr><td class="px" style="padding:30px 36px 8px;font-family:${FONT}">
          <h1 class="h1 ink" style="margin:0;font-size:24px;line-height:1.25;font-weight:800;color:${C.ink}">${esc(o.title)}</h1>
        </td></tr>
        <tr><td class="px ink" style="padding:12px 36px 32px;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.ink}">${o.inner}</td></tr>
      </table>
    </td></tr>
    <tr><td class="px" style="padding:20px 24px 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};text-align:center">
      ${esc(o.reason)}<br>${links}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const para = (s: string) => `<p style="margin:0 0 14px">${esc(s)}</p>`;

// "Bulletproof"-Button: funktioniert auch ohne CSS-Unterstützung, plus Link zum Kopieren
function button(lang: string, href: string, label: string) {
  const T = TEXTS[lang] ?? TEXTS.de;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px"><tr>
    <td align="center" bgcolor="${C.brand}" style="border-radius:999px;background:${C.brand}">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}&nbsp;&rarr;</a>
    </td></tr></table>
  <p class="soft" style="margin:10px 0 0;font-size:12px;line-height:1.5;color:${C.muted}">${esc(T.btn_fallback)}<br>
    <a href="${esc(href)}" style="color:${C.brand};word-break:break-all">${esc(href)}</a></p>`;
}

// Infokasten ("Ticket") mit Event, Datum, Ort ...
function ticket(items: [string, string][]) {
  const rowsHtml = items.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td class="soft" style="padding:6px 14px 6px 0;font-size:13px;color:${C.soft};white-space:nowrap;vertical-align:top">${esc(k)}</td>`
    + `<td class="ink" style="padding:6px 0;font-size:15px;font-weight:700;color:${C.ink};vertical-align:top">${esc(v)}</td></tr>`).join('');
  return `<table role="presentation" class="ticket" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.tint}" style="margin:6px 0 4px;background:${C.tint};border-radius:16px;border-left:5px solid ${C.brand}">
    <tr><td style="padding:14px 18px;font-family:${FONT}"><table role="presentation" cellspacing="0" cellpadding="0" border="0">${rowsHtml}</table></td></tr></table>`;
}

const footerText = (T: MailTexts, reason: string, unsub: Unsub | null) =>
  `\n\n--\n${reason}\n${T.footer_settings}: ${APP_URL}#/profile${unsub ? `\n${T.footer_unsub}: ${unsub.page}` : ''}`;

type Rendered = { subject: string; html: string; text: string; ics: string | null };

// Inhalt einer Mail zusammenbauen
function render(m: Outbox, unsub: Unsub | null = null): Rendered {
  const lang = TEXTS[m.lang] ? m.lang : 'de';
  const T = TEXTS[lang];
  const p = m.payload ?? {};
  const hello = fill(T.hello, { name: m.to_name || '' }).replace(/\s+,/, ',');
  let reason = fill(T.footer_reason, { app: APP });
  let subject = '';
  let title = '';
  let preheader = '';
  let inner = '';
  let text = '';
  let ics: string | null = null;

  if (m.kind === 'assignment' || m.kind === 'waitlist_promoted') {
    const promoted = m.kind === 'waitlist_promoted';
    subject = fill(promoted ? T.wl_subject : T.as_subject, { position: p.position_name, event: p.event_title });
    title = subject;
    const status = T['st_' + (promoted ? 'proposed' : p.status)] ?? '';
    const when = p.position_start ? range(lang, p.position_start, p.position_end) : range(lang, p.event_start, p.event_end);
    const link = `${APP_URL}#/event/${p.event_id}`;
    const facts: [string, string][] = [
      [T.lbl_event, p.event_title], [T.lbl_date, when], [T.lbl_location, p.location],
      [T.lbl_position, p.position_name], [T.lbl_status, status], [T.lbl_team, p.team_name],
    ];
    ics = buildIcs(p, link);
    preheader = `${when}${p.location ? ' · ' + p.location : ''} – ${T.p_confirm}`;
    inner = para(hello) + para(promoted ? T.wl_intro : T.as_intro) + ticket(facts)
      + (p.position_description ? `<p class="soft" style="margin:12px 0 0;font-size:14px;color:${C.soft}">${esc(p.position_description)}</p>` : '')
      + button(lang, link, T.as_cta)
      + `<p class="soft" style="margin:20px 0 0;font-size:14px;color:${C.soft}">${esc(T.as_note)}${ics ? ' ' + esc(T.cal_hint) : ''}</p>`;
    text = `${hello}\n${promoted ? T.wl_intro : T.as_intro}\n\n${facts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')}`
      + `${p.position_description ? `\n\n${p.position_description}` : ''}\n\n${T.as_cta}:\n${link}\n\n${T.as_note}${ics ? ' ' + T.cal_hint : ''}`;
  } else if (m.kind === 'invite') {
    subject = fill(T.inv_subject, { team: p.team_name });
    title = subject;
    reason = fill(T.footer_reason_invite, { app: APP, inviter: p.inviter || '?' });
    const link = `${APP_URL}#/invite/${p.token}`;
    const intro = fill(T.inv_intro, { inviter: p.inviter, team: p.team_name });
    preheader = `${intro} ${T.inv_valid}`;
    inner = para(intro)
      + (p.note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="ticket" bgcolor="${C.tint}" style="background:${C.tint};border-radius:16px;border-left:5px solid ${C.pink}"><tr><td style="padding:14px 18px;font-family:${FONT};font-style:italic;color:${C.soft}" class="soft">„${esc(p.note)}“</td></tr></table>` : '')
      + button(lang, link, T.inv_cta) + `<p class="soft" style="margin:18px 0 0;font-size:14px;color:${C.soft}">${esc(T.inv_valid)}</p>`;
    text = `${intro}\n${p.note ? `"${p.note}"\n` : ''}\n${T.inv_cta}:\n${link}\n\n${T.inv_valid}`;
  } else if (m.kind === 'deadline_reminder') {
    const date = fmt(lang, p.deadline);
    subject = fill(T.dl_subject, { group: p.position_name, date });
    title = subject;
    const link = `${APP_URL}#/group/${p.position_id}`;
    const intro = fill(T.dl_intro, { group: p.position_name, event: p.event_title, date });
    const tasks: string[] = Array.isArray(p.open_tasks) ? p.open_tasks : [];
    preheader = tasks.slice(0, 4).join(' · ');
    const list = tasks.map((x) =>
      `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;font-size:15px;color:${C.brand}">&#9744;</td><td class="ink" style="padding:6px 0;font-size:15px;color:${C.ink}">${esc(x)}</td></tr>`).join('');
    inner = para(hello) + para(intro)
      + `<table role="presentation" class="ticket" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.tint}" style="background:${C.tint};border-radius:16px;border-left:5px solid ${C.pink}"><tr><td style="padding:12px 18px;font-family:${FONT}"><table role="presentation" cellspacing="0" cellpadding="0" border="0">${list}</table></td></tr></table>`
      + button(lang, link, T.dl_cta);
    text = `${hello}\n${intro}\n\n${tasks.map((x) => `[ ] ${x}`).join('\n')}\n\n${T.dl_cta}:\n${link}`;
  } else if (m.kind === 'join_approved') {
    subject = fill(T.ja_subject, { team: p.team_name });
    title = subject;
    const link = `${APP_URL}#/team/${p.team_id}`;
    preheader = T.ja_intro;
    inner = para(hello) + para(T.ja_intro) + button(lang, link, T.ja_cta);
    text = `${hello}\n${T.ja_intro}\n\n${T.ja_cta}:\n${link}`;
  } else {
    throw new Error('unknown kind ' + m.kind);
  }
  return {
    subject,
    html: layout({ lang, title, preheader, inner, reason, unsub }),
    text: text + footerText(T, reason, unsub),
    ics,
  };
}

async function sendBrevo(m: Outbox) {
  const unsub = await unsubLinks(m);
  const { subject, html, text, ics } = render(m, unsub);
  const headers: Record<string, string> = {};
  if (unsub) {
    headers['List-Unsubscribe'] = `<${unsub.oneClick}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: FROM, name: fromName() },
      to: [{ email: m.to_email, ...(m.to_name ? { name: m.to_name } : {}) }],
      ...(REPLY_TO ? { replyTo: { email: REPLY_TO } } : {}),
      subject, htmlContent: html, textContent: text,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(ics ? { attachment: [{ name: 'event.ics', content: ics }] } : {}),
      tags: [m.kind],
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---------------- Push-Nachrichten ----------------
type PushRow = { id: string; user_id: string; kind: string; lang: string; attempts: number; payload: Record<string, any> };

function renderPush(m: PushRow): { title: string; body: string; url: string; tag: string } {
  const lang = TEXTS[m.lang] ? m.lang : 'de';
  const T = TEXTS[lang];
  const p = m.payload ?? {};
  const time = (iso?: string) => (iso ? new Intl.DateTimeFormat(LOCALES[lang] ?? 'de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso)) : '');
  switch (m.kind) {
    case 'assignment':
    case 'waitlist_promoted':
      return { title: fill(m.kind === 'assignment' ? T.as_subject : T.wl_subject, { position: p.position_name, event: p.event_title }),
        body: T.p_confirm, url: `#/event/${p.event_id}`, tag: 'as-' + p.assignment_id };
    case 'shift_soon':
      return { title: fill(T.p_soon_title, { position: p.position_name }),
        body: fill(T.p_soon_body, { time: time(p.starts), event: p.event_title }) + (p.location ? ` · ${p.location}` : ''),
        url: `#/group/${p.position_id}`, tag: 'soon-' + p.position_id };
    case 'deadline_reminder':
      return { title: fill(T.dl_subject, { group: p.position_name, date: fmt(lang, p.deadline) }),
        body: (Array.isArray(p.open_tasks) ? p.open_tasks : []).slice(0, 5).join(' · '), url: `#/group/${p.position_id}`, tag: 'dl-' + p.position_id };
    case 'mention':
      return { title: fill(T.p_mention_title, { name: p.author, room: p.room }), body: p.text ?? '',
        url: p.position_id ? `#/group/${p.position_id}/chat` : `#/event/${p.event_id}/chat`, tag: '' };
    case 'join_approved':
      return { title: fill(T.ja_subject, { team: p.team_name }), body: '', url: `#/team/${p.team_id}`, tag: 'team-' + p.team_id };
    case 'test':
      return { title: T.p_test_title, body: T.p_test_body, url: '#/profile', tag: 'test' };
    default:
      throw new Error('unknown push kind ' + m.kind);
  }
}

async function sendPushes(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  if (!PUSH_ON) return { sent, failed };
  const { data, error } = await db.rpc('claim_push', { max_rows: 100 });
  if (error) { console.error('claim_push', error); return { sent, failed }; }
  for (const m of (data ?? []) as PushRow[]) {
    try {
      const msg = renderPush(m);
      const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', m.user_id);
      let ok = 0;
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ ...msg, url: APP_URL + msg.url }),
            { TTL: 6 * 3600, urgency: m.kind === 'mention' || m.kind === 'shift_soon' ? 'high' : 'normal' },
          );
          ok++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id); // Gerät abgemeldet
          else console.error('push', code, (e as Error).message);
        }
      }
      await db.from('push_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), error: ok ? null : 'no device reached' }).eq('id', m.id);
      sent++;
    } catch (e) {
      failed++;
      await db.from('push_outbox').update({ status: m.attempts >= 3 ? 'failed' : 'pending', error: String((e as Error).message ?? e).slice(0, 500) }).eq('id', m.id);
    }
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
  const url = new URL(req.url);

  // Abmelden: GET (Link geöffnet) → Seite in der App, POST (Ein-Klick aus dem Mailprogramm oder App) → abschalten
  if (url.searchParams.has('unsub')) {
    const u = url.searchParams.get('u') ?? '';
    const c = url.searchParams.get('c') ?? '';
    const s = url.searchParams.get('s') ?? '';
    if (req.method === 'GET') {
      return new Response(null, { status: 302, headers: { location: `${APP_URL}#/unsubscribe/${u}/${c}/${s}` } });
    }
    const valid = /^[0-9a-f-]{36}$/i.test(u) && (c === 'assignment' || c === 'deadline') && sameText(await sign(u, c), s);
    if (!valid) return json({ error: 'invalid link' }, 400);
    const { data } = await db.from('profiles').select('mail_prefs').eq('id', u).maybeSingle();
    if (data) await db.from('profiles').update({ mail_prefs: { ...(data.mail_prefs ?? {}), [c]: false } }).eq('id', u);
    return json({ ok: true });
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!BREVO_KEY || !FROM || !APP_URL.startsWith('http')) {
    return json({ error: 'Secrets BREVO_API_KEY, MAIL_FROM und APP_URL fehlen.' }, 500);
  }
  await loadAppName();

  // 1. Erinnerungen vor Deadlines und "gleich geht's los" einreihen
  const { error: remErr } = await db.rpc('queue_deadline_reminders');
  if (remErr) console.error('reminders', remErr);
  const { error: soonErr } = await db.rpc('queue_shift_soon');
  if (soonErr) console.error('shift soon', soonErr);

  // 2. Push-Nachrichten zuerst (sind eilig, z. B. Erwähnungen)
  const push = await sendPushes();

  // 3. Mail-Warteschlange abarbeiten (in Runden, höchstens 200 Mails pro Aufruf)
  let sent = 0;
  let failed = 0;
  for (let round = 0; round < 4; round++) {
    const { data, error } = await db.rpc('claim_outbox', { max_rows: 50 });
    if (error) return json({ error: error.message }, 500);
    const batch = (data ?? []) as Outbox[];
    if (!batch.length) break;
    for (const m of batch) {
      try {
        await sendBrevo(m);
        await db.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', m.id);
        sent++;
      } catch (e) {
        failed++;
        await db.from('email_outbox').update({
          status: m.attempts >= 5 ? 'failed' : 'pending', error: String((e as Error).message ?? e).slice(0, 500),
        }).eq('id', m.id);
      }
    }
  }
  return json({ sent, failed, push, app: APP });
});

// ---------------- Texte ----------------
type MailTexts = Record<string, string>;

const TEXTS: Record<string, MailTexts> = {
  de: {
    p_confirm: "Bitte bestätige deine Einteilung in der App.", p_soon_title: "Gleich geht's los: {position}", p_soon_body: "Beginn um {time} – {event}", p_mention_title: "{name} hat dich erwähnt · {room}", p_test_title: "Push funktioniert! 🎉", p_test_body: "So sehen deine Benachrichtigungen aus.",
    hello: 'Hallo {name},', footer_reason: "Du bekommst diese E-Mail, weil du bei {app} angemeldet bist und diese Benachrichtigung eingeschaltet ist.", footer_reason_invite: "Du bekommst diese E-Mail, weil {inviter} dich zu {app} eingeladen hat. Falls du damit nichts anfangen kannst, ignoriere sie einfach.", footer_settings: "E-Mail-Einstellungen", footer_unsub: "Abmelden", cal_hint: "Im Anhang findest du einen Kalendereintrag zum Speichern.", btn_fallback: "Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:",
    lbl_event: 'Event', lbl_date: 'Datum', lbl_location: 'Ort', lbl_position: 'Position', lbl_status: 'Status', lbl_team: 'Team',
    st_proposed: 'Vorgemerkt – bitte bestätigen', st_confirmed: 'Bestätigt', st_uncertain: 'Ungewiss',
    as_subject: 'Deine Einteilung: {position} bei {event}', as_intro: 'du bist für folgendes Event eingeteilt:', as_cta: 'Einteilung ansehen & bestätigen', as_note: 'Bitte bestätige deine Einteilung – oder sag ab, falls du nicht kannst. Dann rückt automatisch jemand von der Warteliste nach.',
    wl_subject: 'Du bist nachgerückt: {position} bei {event}', wl_intro: 'ein Platz ist frei geworden und du bist von der Warteliste nachgerückt. Bitte bestätige, ob du dabei bist:',
    inv_subject: 'Einladung ins Team „{team}“', inv_intro: '{inviter} lädt dich ins Team „{team}“ ein.', inv_valid: 'Der Link ist 24 Stunden gültig.', inv_cta: 'Einladung annehmen',
    dl_subject: 'Erinnerung: {group} – Deadline {date}', dl_intro: 'die Deadline deiner Gruppe „{group}“ ({event}) ist am {date}. Diese Punkte sind noch offen:', dl_cta: 'Zur Gruppe',
    ja_subject: 'Willkommen im Team „{team}“', ja_intro: 'deine Beitrittsanfrage wurde angenommen – schön, dass du dabei bist!', ja_cta: 'Zum Team',
  },
  en: {
    p_confirm: "Please confirm your assignment in the app.", p_soon_title: "Starting soon: {position}", p_soon_body: "Starts at {time} – {event}", p_mention_title: "{name} mentioned you · {room}", p_test_title: "Push works! 🎉", p_test_body: "This is how your notifications look.",
    hello: 'Hello {name},', footer_reason: "You are receiving this email because you have an account with {app} and this notification is switched on.", footer_reason_invite: "You are receiving this email because {inviter} invited you to {app}. If this means nothing to you, simply ignore it.", footer_settings: "Email settings", footer_unsub: "Unsubscribe", cal_hint: "A calendar entry is attached so you can save the date.", btn_fallback: "If the button does not work, copy this link into your browser:",
    lbl_event: 'Event', lbl_date: 'Date', lbl_location: 'Location', lbl_position: 'Position', lbl_status: 'Status', lbl_team: 'Team',
    st_proposed: 'Pending – please confirm', st_confirmed: 'Confirmed', st_uncertain: 'Uncertain',
    as_subject: 'Your assignment: {position} at {event}', as_intro: 'you have been assigned to the following event:', as_cta: 'View & confirm assignment', as_note: 'Please confirm your assignment – or decline if you cannot make it. Someone from the waiting list will then move up automatically.',
    wl_subject: 'You moved up: {position} at {event}', wl_intro: 'a slot has become free and you moved up from the waiting list. Please confirm whether you can make it:',
    inv_subject: 'Invitation to the team “{team}”', inv_intro: '{inviter} invites you to the team “{team}”.', inv_valid: 'The link is valid for 24 hours.', inv_cta: 'Accept invitation',
    dl_subject: 'Reminder: {group} – deadline {date}', dl_intro: 'the deadline of your group “{group}” ({event}) is on {date}. These items are still open:', dl_cta: 'Open group',
    ja_subject: 'Welcome to the team “{team}”', ja_intro: 'your join request has been accepted – great to have you!', ja_cta: 'Open team',
  },
  fr: {
    p_confirm: "Merci de confirmer ton affectation dans l’app.", p_soon_title: "Ça commence bientôt : {position}", p_soon_body: "Début à {time} – {event}", p_mention_title: "{name} t’a mentionné·e · {room}", p_test_title: "Le push fonctionne ! 🎉", p_test_body: "Voici à quoi ressemblent tes notifications.",
    hello: 'Bonjour {name},', footer_reason: "Tu reçois cet e-mail parce que tu as un compte sur {app} et que cette notification est activée.", footer_reason_invite: "Tu reçois cet e-mail parce que {inviter} t’a invité·e sur {app}. Si cela ne te dit rien, ignore-le simplement.", footer_settings: "Paramètres e-mail", footer_unsub: "Se désabonner", cal_hint: "Un événement de calendrier est joint pour enregistrer la date.", btn_fallback: "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
    lbl_event: 'Événement', lbl_date: 'Date', lbl_location: 'Lieu', lbl_position: 'Poste', lbl_status: 'Statut', lbl_team: 'Équipe',
    st_proposed: 'Pressenti·e – merci de confirmer', st_confirmed: 'Confirmé', st_uncertain: 'Incertain',
    as_subject: 'Ton affectation : {position} à {event}', as_intro: 'tu es affecté·e à l’événement suivant :', as_cta: 'Voir et confirmer', as_note: 'Merci de confirmer ton affectation – ou de te désister si tu ne peux pas. Une personne de la liste d’attente prendra alors ta place.',
    wl_subject: 'Tu passes de la liste d’attente : {position} à {event}', wl_intro: 'une place s’est libérée et tu passes de la liste d’attente. Merci de confirmer si tu es disponible :',
    inv_subject: 'Invitation dans l’équipe « {team} »', inv_intro: '{inviter} t’invite dans l’équipe « {team} ».', inv_valid: 'Le lien est valable 24 heures.', inv_cta: 'Accepter l’invitation',
    dl_subject: 'Rappel : {group} – date limite {date}', dl_intro: 'la date limite de ton groupe « {group} » ({event}) est le {date}. Ces points sont encore ouverts :', dl_cta: 'Ouvrir le groupe',
    ja_subject: 'Bienvenue dans l’équipe « {team} »', ja_intro: 'ta demande d’adhésion a été acceptée – ravi·e de t’avoir avec nous !', ja_cta: 'Ouvrir l’équipe',
  },
  es: {
    p_confirm: "Confirma tu asignación en la app.", p_soon_title: "Empieza pronto: {position}", p_soon_body: "Comienza a las {time} – {event}", p_mention_title: "{name} te ha mencionado · {room}", p_test_title: "¡Las notificaciones funcionan! 🎉", p_test_body: "Así se ven tus notificaciones.",
    hello: 'Hola, {name}:', footer_reason: "Recibes este correo porque tienes una cuenta en {app} y esta notificación está activada.", footer_reason_invite: "Recibes este correo porque {inviter} te ha invitado a {app}. Si no sabes de qué se trata, simplemente ignóralo.", footer_settings: "Ajustes de correo", footer_unsub: "Darse de baja", cal_hint: "Adjuntamos una entrada de calendario para que guardes la fecha.", btn_fallback: "Si el botón no funciona, copia este enlace en tu navegador:",
    lbl_event: 'Evento', lbl_date: 'Fecha', lbl_location: 'Lugar', lbl_position: 'Puesto', lbl_status: 'Estado', lbl_team: 'Equipo',
    st_proposed: 'Preasignado – confirma, por favor', st_confirmed: 'Confirmado', st_uncertain: 'Incierto',
    as_subject: 'Tu asignación: {position} en {event}', as_intro: 'te han asignado al siguiente evento:', as_cta: 'Ver y confirmar', as_note: 'Confirma tu asignación o recházala si no puedes. Entonces subirá automáticamente alguien de la lista de espera.',
    wl_subject: 'Has subido de la lista de espera: {position} en {event}', wl_intro: 'ha quedado una plaza libre y has subido de la lista de espera. Confirma si puedes participar:',
    inv_subject: 'Invitación al equipo «{team}»', inv_intro: '{inviter} te invita al equipo «{team}».', inv_valid: 'El enlace es válido durante 24 horas.', inv_cta: 'Aceptar invitación',
    dl_subject: 'Recordatorio: {group} – fecha límite {date}', dl_intro: 'la fecha límite de tu grupo «{group}» ({event}) es el {date}. Estos puntos siguen pendientes:', dl_cta: 'Abrir grupo',
    ja_subject: 'Bienvenido/a al equipo «{team}»', ja_intro: 'tu solicitud ha sido aceptada. ¡Qué bien tenerte!', ja_cta: 'Abrir equipo',
  },
  it: {
    p_confirm: "Conferma la tua assegnazione nell’app.", p_soon_title: "Si comincia presto: {position}", p_soon_body: "Inizio alle {time} – {event}", p_mention_title: "{name} ti ha menzionato/a · {room}", p_test_title: "Le notifiche funzionano! 🎉", p_test_body: "Ecco come appaiono le tue notifiche.",
    hello: 'Ciao {name},', footer_reason: "Ricevi questa e-mail perché hai un account su {app} e questa notifica è attiva.", footer_reason_invite: "Ricevi questa e-mail perché {inviter} ti ha invitato su {app}. Se non ti dice nulla, ignorala pure.", footer_settings: "Impostazioni e-mail", footer_unsub: "Annulla iscrizione", cal_hint: "In allegato trovi un evento da salvare nel calendario.", btn_fallback: "Se il pulsante non funziona, copia questo link nel browser:",
    lbl_event: 'Evento', lbl_date: 'Data', lbl_location: 'Luogo', lbl_position: 'Posizione', lbl_status: 'Stato', lbl_team: 'Team',
    st_proposed: 'Proposto – conferma, per favore', st_confirmed: 'Confermato', st_uncertain: 'Incerto',
    as_subject: 'La tua assegnazione: {position} a {event}', as_intro: 'sei stato/a assegnato/a al seguente evento:', as_cta: 'Vedi e conferma', as_note: 'Conferma la tua assegnazione oppure rinuncia se non puoi. Qualcuno dalla lista d’attesa prenderà automaticamente il tuo posto.',
    wl_subject: 'Sei salito/a dalla lista d’attesa: {position} a {event}', wl_intro: 'si è liberato un posto e sei salito/a dalla lista d’attesa. Conferma se ci sei:',
    inv_subject: 'Invito nel team «{team}»', inv_intro: '{inviter} ti invita nel team «{team}».', inv_valid: 'Il link è valido 24 ore.', inv_cta: 'Accetta l’invito',
    dl_subject: 'Promemoria: {group} – scadenza {date}', dl_intro: 'la scadenza del tuo gruppo «{group}» ({event}) è il {date}. Questi punti sono ancora aperti:', dl_cta: 'Apri il gruppo',
    ja_subject: 'Benvenuto/a nel team «{team}»', ja_intro: 'la tua richiesta di adesione è stata accettata – che bello averti con noi!', ja_cta: 'Apri il team',
  },
  pt: {
    p_confirm: "Confirma a tua atribuição na app.", p_soon_title: "Começa já a seguir: {position}", p_soon_body: "Início às {time} – {event}", p_mention_title: "{name} mencionou-te · {room}", p_test_title: "As notificações funcionam! 🎉", p_test_body: "É assim que as tuas notificações aparecem.",
    hello: 'Olá, {name},', footer_reason: "Recebes este e-mail porque tens uma conta em {app} e esta notificação está ativada.", footer_reason_invite: "Recebes este e-mail porque {inviter} te convidou para {app}. Se não sabes do que se trata, ignora-o.", footer_settings: "Definições de e-mail", footer_unsub: "Cancelar subscrição", cal_hint: "Em anexo encontras uma entrada de calendário para guardar a data.", btn_fallback: "Se o botão não funcionar, copia este link para o teu navegador:",
    lbl_event: 'Evento', lbl_date: 'Data', lbl_location: 'Local', lbl_position: 'Posição', lbl_status: 'Estado', lbl_team: 'Equipa',
    st_proposed: 'Pré-atribuído – confirma, por favor', st_confirmed: 'Confirmado', st_uncertain: 'Incerto',
    as_subject: 'A tua atribuição: {position} em {event}', as_intro: 'foste atribuído/a ao seguinte evento:', as_cta: 'Ver e confirmar', as_note: 'Confirma a tua atribuição – ou recusa, se não puderes. Alguém da lista de espera sobe então automaticamente.',
    wl_subject: 'Subiste da lista de espera: {position} em {event}', wl_intro: 'ficou uma vaga livre e subiste da lista de espera. Confirma se podes participar:',
    inv_subject: 'Convite para a equipa «{team}»', inv_intro: '{inviter} convida-te para a equipa «{team}».', inv_valid: 'O link é válido durante 24 horas.', inv_cta: 'Aceitar convite',
    dl_subject: 'Lembrete: {group} – prazo {date}', dl_intro: 'o prazo do teu grupo «{group}» ({event}) é a {date}. Estes pontos ainda estão em aberto:', dl_cta: 'Abrir grupo',
    ja_subject: 'Bem-vindo/a à equipa «{team}»', ja_intro: 'o teu pedido de adesão foi aceite – que bom ter-te connosco!', ja_cta: 'Abrir equipa',
  },
  nl: {
    p_confirm: "Bevestig je indeling in de app.", p_soon_title: "Zo meteen: {position}", p_soon_body: "Begint om {time} – {event}", p_mention_title: "{name} heeft je genoemd · {room}", p_test_title: "Push werkt! 🎉", p_test_body: "Zo zien je meldingen eruit.",
    hello: 'Hallo {name},', footer_reason: "Je ontvangt deze e-mail omdat je een account hebt bij {app} en deze melding aan staat.", footer_reason_invite: "Je ontvangt deze e-mail omdat {inviter} je heeft uitgenodigd voor {app}. Zegt dit je niets, negeer hem dan gewoon.", footer_settings: "E-mailinstellingen", footer_unsub: "Afmelden", cal_hint: "In de bijlage vind je een agenda-item om de datum op te slaan.", btn_fallback: "Werkt de knop niet? Kopieer deze link naar je browser:",
    lbl_event: 'Evenement', lbl_date: 'Datum', lbl_location: 'Locatie', lbl_position: 'Positie', lbl_status: 'Status', lbl_team: 'Team',
    st_proposed: 'Voorgesteld – graag bevestigen', st_confirmed: 'Bevestigd', st_uncertain: 'Onzeker',
    as_subject: 'Je indeling: {position} bij {event}', as_intro: 'je bent ingedeeld voor het volgende evenement:', as_cta: 'Indeling bekijken en bevestigen', as_note: 'Bevestig je indeling – of zeg af als je niet kunt. Dan schuift er automatisch iemand van de wachtlijst door.',
    wl_subject: 'Je bent doorgeschoven: {position} bij {event}', wl_intro: 'er is een plek vrijgekomen en je bent van de wachtlijst doorgeschoven. Bevestig of je erbij bent:',
    inv_subject: 'Uitnodiging voor het team „{team}”', inv_intro: '{inviter} nodigt je uit voor het team „{team}”.', inv_valid: 'De link is 24 uur geldig.', inv_cta: 'Uitnodiging accepteren',
    dl_subject: 'Herinnering: {group} – deadline {date}', dl_intro: 'de deadline van je groep „{group}” ({event}) is op {date}. Deze punten staan nog open:', dl_cta: 'Naar de groep',
    ja_subject: 'Welkom in het team „{team}”', ja_intro: 'je verzoek is geaccepteerd – fijn dat je erbij bent!', ja_cta: 'Naar het team',
  },
  pl: {
    p_confirm: "Potwierdź przydział w aplikacji.", p_soon_title: "Zaraz zaczynasz: {position}", p_soon_body: "Początek o {time} – {event}", p_mention_title: "{name} wspomniał(a) o tobie · {room}", p_test_title: "Powiadomienia działają! 🎉", p_test_body: "Tak wyglądają twoje powiadomienia.",
    hello: 'Cześć {name},', footer_reason: "Otrzymujesz tę wiadomość, ponieważ masz konto w {app} i to powiadomienie jest włączone.", footer_reason_invite: "Otrzymujesz tę wiadomość, ponieważ {inviter} zaprosił(a) cię do {app}. Jeśli nic ci to nie mówi, po prostu ją zignoruj.", footer_settings: "Ustawienia e-mail", footer_unsub: "Wypisz się", cal_hint: "W załączniku znajdziesz wpis do kalendarza.", btn_fallback: "Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:",
    lbl_event: 'Wydarzenie', lbl_date: 'Data', lbl_location: 'Miejsce', lbl_position: 'Stanowisko', lbl_status: 'Status', lbl_team: 'Zespół',
    st_proposed: 'Wstępnie przydzielony – prosimy o potwierdzenie', st_confirmed: 'Potwierdzony', st_uncertain: 'Niepewny',
    as_subject: 'Twój przydział: {position} – {event}', as_intro: 'przydzielono cię do następującego wydarzenia:', as_cta: 'Zobacz i potwierdź', as_note: 'Potwierdź przydział – albo odmów, jeśli nie możesz. Wtedy automatycznie wejdzie ktoś z listy rezerwowej.',
    wl_subject: 'Wchodzisz z listy rezerwowej: {position} – {event}', wl_intro: 'zwolniło się miejsce i wchodzisz z listy rezerwowej. Potwierdź, czy będziesz:',
    inv_subject: 'Zaproszenie do zespołu „{team}”', inv_intro: '{inviter} zaprasza cię do zespołu „{team}”.', inv_valid: 'Link jest ważny 24 godziny.', inv_cta: 'Przyjmij zaproszenie',
    dl_subject: 'Przypomnienie: {group} – termin {date}', dl_intro: 'termin twojej grupy „{group}” ({event}) mija {date}. Te punkty są wciąż otwarte:', dl_cta: 'Otwórz grupę',
    ja_subject: 'Witamy w zespole „{team}”', ja_intro: 'twoja prośba o dołączenie została przyjęta – miło, że jesteś!', ja_cta: 'Otwórz zespół',
  },
  uk: {
    p_confirm: "Підтвердьте призначення в застосунку.", p_soon_title: "Скоро початок: {position}", p_soon_body: "Початок о {time} — {event}", p_mention_title: "{name} згадав(ла) вас · {room}", p_test_title: "Сповіщення працюють! 🎉", p_test_body: "Ось так виглядають ваші сповіщення.",
    hello: 'Привіт, {name}!', footer_reason: "Ви отримали цей лист, бо маєте обліковий запис у {app} і це сповіщення увімкнене.", footer_reason_invite: "Ви отримали цей лист, бо {inviter} запросив(ла) вас до {app}. Якщо вам це ні про що не говорить, просто проігноруйте його.", footer_settings: "Налаштування e-mail", footer_unsub: "Відписатися", cal_hint: "У вкладенні — подія для календаря, щоб зберегти дату.", btn_fallback: "Якщо кнопка не працює, скопіюйте це посилання в браузер:",
    lbl_event: 'Подія', lbl_date: 'Дата', lbl_location: 'Місце', lbl_position: 'Позиція', lbl_status: 'Статус', lbl_team: 'Команда',
    st_proposed: 'Попередньо — будь ласка, підтвердьте', st_confirmed: 'Підтверджено', st_uncertain: 'Невідомо',
    as_subject: 'Ваше призначення: {position} — {event}', as_intro: 'вас призначено на таку подію:', as_cta: 'Переглянути й підтвердити', as_note: 'Будь ласка, підтвердьте призначення — або відмовтеся, якщо не можете. Тоді автоматично посунеться хтось із листа очікування.',
    wl_subject: 'Ви посунулися з листа очікування: {position} — {event}', wl_intro: 'звільнилося місце, і ви посунулися з листа очікування. Підтвердьте, будь ласка, чи будете:',
    inv_subject: 'Запрошення до команди «{team}»', inv_intro: '{inviter} запрошує вас до команди «{team}».', inv_valid: 'Посилання дійсне 24 години.', inv_cta: 'Прийняти запрошення',
    dl_subject: 'Нагадування: {group} — дедлайн {date}', dl_intro: 'дедлайн вашої групи «{group}» ({event}) — {date}. Ці пункти ще відкриті:', dl_cta: 'До групи',
    ja_subject: 'Ласкаво просимо до команди «{team}»', ja_intro: 'ваш запит на вступ прийнято — раді вас бачити!', ja_cta: 'До команди',
  },
  ru: {
    p_confirm: "Подтвердите назначение в приложении.", p_soon_title: "Скоро начало: {position}", p_soon_body: "Начало в {time} — {event}", p_mention_title: "{name} упомянул(а) вас · {room}", p_test_title: "Уведомления работают! 🎉", p_test_body: "Так выглядят ваши уведомления.",
    hello: 'Привет, {name}!', footer_reason: "Вы получили это письмо, потому что у вас есть аккаунт в {app} и это уведомление включено.", footer_reason_invite: "Вы получили это письмо, потому что {inviter} пригласил(а) вас в {app}. Если вам это ни о чём не говорит, просто проигнорируйте его.", footer_settings: "Настройки e-mail", footer_unsub: "Отписаться", cal_hint: "Во вложении — событие для календаря, чтобы сохранить дату.", btn_fallback: "Если кнопка не работает, скопируйте эту ссылку в браузер:",
    lbl_event: 'Мероприятие', lbl_date: 'Дата', lbl_location: 'Место', lbl_position: 'Позиция', lbl_status: 'Статус', lbl_team: 'Команда',
    st_proposed: 'Предварительно — пожалуйста, подтвердите', st_confirmed: 'Подтверждено', st_uncertain: 'Под вопросом',
    as_subject: 'Ваше назначение: {position} — {event}', as_intro: 'вы назначены на следующее мероприятие:', as_cta: 'Посмотреть и подтвердить', as_note: 'Пожалуйста, подтвердите назначение — или откажитесь, если не можете. Тогда автоматически продвинется кто-то из листа ожидания.',
    wl_subject: 'Вы продвинулись из листа ожидания: {position} — {event}', wl_intro: 'освободилось место, и вы продвинулись из листа ожидания. Подтвердите, пожалуйста, что будете:',
    inv_subject: 'Приглашение в команду «{team}»', inv_intro: '{inviter} приглашает вас в команду «{team}».', inv_valid: 'Ссылка действует 24 часа.', inv_cta: 'Принять приглашение',
    dl_subject: 'Напоминание: {group} — дедлайн {date}', dl_intro: 'дедлайн вашей группы «{group}» ({event}) — {date}. Эти пункты ещё открыты:', dl_cta: 'К группе',
    ja_subject: 'Добро пожаловать в команду «{team}»', ja_intro: 'ваша заявка принята — рады вас видеть!', ja_cta: 'К команде',
  },
  ro: {
    p_confirm: "Te rugăm să confirmi repartizarea în aplicație.", p_soon_title: "Începe în curând: {position}", p_soon_body: "Începe la {time} – {event}", p_mention_title: "{name} te-a menționat · {room}", p_test_title: "Notificările funcționează! 🎉", p_test_body: "Așa arată notificările tale.",
    hello: 'Salut, {name},', footer_reason: "Primești acest e-mail pentru că ai un cont în {app} și această notificare este activată.", footer_reason_invite: "Primești acest e-mail pentru că {inviter} te-a invitat în {app}. Dacă nu îți spune nimic, ignoră-l.", footer_settings: "Setări e-mail", footer_unsub: "Dezabonare", cal_hint: "În atașament găsești un eveniment de calendar pentru a salva data.", btn_fallback: "Dacă butonul nu funcționează, copiază acest link în browser:",
    lbl_event: 'Eveniment', lbl_date: 'Data', lbl_location: 'Loc', lbl_position: 'Poziție', lbl_status: 'Stare', lbl_team: 'Echipă',
    st_proposed: 'Propus – te rugăm să confirmi', st_confirmed: 'Confirmat', st_uncertain: 'Nesigur',
    as_subject: 'Repartizarea ta: {position} la {event}', as_intro: 'ai fost repartizat la următorul eveniment:', as_cta: 'Vezi și confirmă', as_note: 'Te rugăm să confirmi repartizarea – sau să refuzi dacă nu poți. Atunci avansează automat cineva de pe lista de așteptare.',
    wl_subject: 'Ai avansat de pe lista de așteptare: {position} la {event}', wl_intro: 's-a eliberat un loc și ai avansat de pe lista de așteptare. Te rugăm să confirmi dacă participi:',
    inv_subject: 'Invitație în echipa „{team}”', inv_intro: '{inviter} te invită în echipa „{team}”.', inv_valid: 'Linkul este valabil 24 de ore.', inv_cta: 'Acceptă invitația',
    dl_subject: 'Memento: {group} – termen {date}', dl_intro: 'termenul grupului tău „{group}” ({event}) este pe {date}. Aceste puncte sunt încă deschise:', dl_cta: 'Deschide grupul',
    ja_subject: 'Bine ai venit în echipa „{team}”', ja_intro: 'cererea ta de aderare a fost acceptată – ne bucurăm că ești aici!', ja_cta: 'Deschide echipa',
  },
  tr: {
    p_confirm: "Lütfen atamanı uygulamada onayla.", p_soon_title: "Birazdan başlıyor: {position}", p_soon_body: "Başlangıç {time} – {event}", p_mention_title: "{name} senden bahsetti · {room}", p_test_title: "Bildirimler çalışıyor! 🎉", p_test_body: "Bildirimlerin böyle görünecek.",
    hello: 'Merhaba {name},', footer_reason: "Bu e-postayı {app} hesabın olduğu ve bu bildirim açık olduğu için alıyorsun.", footer_reason_invite: "Bu e-postayı {inviter} seni {app} uygulamasına davet ettiği için alıyorsun. Sana bir şey ifade etmiyorsa yok sayabilirsin.", footer_settings: "E-posta ayarları", footer_unsub: "Abonelikten çık", cal_hint: "Tarihi kaydetmen için ekte bir takvim kaydı var.", btn_fallback: "Düğme çalışmazsa bu bağlantıyı tarayıcına kopyala:",
    lbl_event: 'Etkinlik', lbl_date: 'Tarih', lbl_location: 'Yer', lbl_position: 'Pozisyon', lbl_status: 'Durum', lbl_team: 'Ekip',
    st_proposed: 'Önerildi – lütfen onayla', st_confirmed: 'Onaylandı', st_uncertain: 'Belirsiz',
    as_subject: 'Atamanız: {event} – {position}', as_intro: 'aşağıdaki etkinliğe atandın:', as_cta: 'Görüntüle ve onayla', as_note: 'Lütfen atamanı onayla – katılamıyorsan reddet. O zaman bekleme listesinden biri otomatik olarak yükselir.',
    wl_subject: 'Bekleme listesinden yükseldin: {event} – {position}', wl_intro: 'bir yer boşaldı ve bekleme listesinden yükseldin. Katılıp katılamayacağını lütfen onayla:',
    inv_subject: '“{team}” ekibine davet', inv_intro: '{inviter} seni “{team}” ekibine davet ediyor.', inv_valid: 'Bağlantı 24 saat geçerlidir.', inv_cta: 'Daveti kabul et',
    dl_subject: 'Hatırlatma: {group} – son tarih {date}', dl_intro: '“{group}” grubunun ({event}) son tarihi {date}. Bu maddeler hâlâ açık:', dl_cta: 'Gruba git',
    ja_subject: '“{team}” ekibine hoş geldin', ja_intro: 'katılma isteğin kabul edildi – aramızda olduğun için çok mutluyuz!', ja_cta: 'Ekibe git',
  },
  el: {
    p_confirm: "Επιβεβαίωσε την ανάθεσή σου στην εφαρμογή.", p_soon_title: "Ξεκινά σε λίγο: {position}", p_soon_body: "Έναρξη στις {time} – {event}", p_mention_title: "{name} σε ανέφερε · {room}", p_test_title: "Οι ειδοποιήσεις λειτουργούν! 🎉", p_test_body: "Έτσι φαίνονται οι ειδοποιήσεις σου.",
    hello: 'Γεια σου {name},', footer_reason: "Λαμβάνεις αυτό το email επειδή έχεις λογαριασμό στο {app} και αυτή η ειδοποίηση είναι ενεργή.", footer_reason_invite: "Λαμβάνεις αυτό το email επειδή ο/η {inviter} σε προσκάλεσε στο {app}. Αν δεν σου λέει κάτι, απλώς αγνόησέ το.", footer_settings: "Ρυθμίσεις email", footer_unsub: "Απεγγραφή", cal_hint: "Στο συνημμένο θα βρεις μια καταχώριση ημερολογίου για να αποθηκεύσεις την ημερομηνία.", btn_fallback: "Αν το κουμπί δεν λειτουργεί, αντέγραψε αυτόν τον σύνδεσμο στον browser:",
    lbl_event: 'Εκδήλωση', lbl_date: 'Ημερομηνία', lbl_location: 'Τοποθεσία', lbl_position: 'Θέση', lbl_status: 'Κατάσταση', lbl_team: 'Ομάδα',
    st_proposed: 'Προτεινόμενο – παρακαλούμε επιβεβαίωσε', st_confirmed: 'Επιβεβαιωμένο', st_uncertain: 'Αβέβαιο',
    as_subject: 'Η ανάθεσή σου: {position} στην {event}', as_intro: 'σου ανατέθηκε θέση στην παρακάτω εκδήλωση:', as_cta: 'Προβολή και επιβεβαίωση', as_note: 'Επιβεβαίωσε την ανάθεση – ή αρνήσου αν δεν μπορείς. Τότε ανεβαίνει αυτόματα κάποιος από τη λίστα αναμονής.',
    wl_subject: 'Ανέβηκες από τη λίστα αναμονής: {position} στην {event}', wl_intro: 'ελευθερώθηκε μια θέση και ανέβηκες από τη λίστα αναμονής. Επιβεβαίωσε αν θα είσαι εκεί:',
    inv_subject: 'Πρόσκληση στην ομάδα «{team}»', inv_intro: '{inviter} σε προσκαλεί στην ομάδα «{team}».', inv_valid: 'Ο σύνδεσμος ισχύει 24 ώρες.', inv_cta: 'Αποδοχή πρόσκλησης',
    dl_subject: 'Υπενθύμιση: {group} – προθεσμία {date}', dl_intro: 'η προθεσμία της ομάδας σου «{group}» ({event}) είναι στις {date}. Αυτά τα σημεία εκκρεμούν ακόμη:', dl_cta: 'Στην ομάδα',
    ja_subject: 'Καλώς ήρθες στην ομάδα «{team}»', ja_intro: 'το αίτημα συμμετοχής σου έγινε δεκτό – χαιρόμαστε που είσαι εδώ!', ja_cta: 'Στην ομάδα',
  },
  hu: {
    p_confirm: "Kérjük, erősítsd meg a beosztásodat az appban.", p_soon_title: "Hamarosan kezdődik: {position}", p_soon_body: "Kezdés {time} – {event}", p_mention_title: "{name} megemlített · {room}", p_test_title: "Működnek az értesítések! 🎉", p_test_body: "Így néznek ki az értesítéseid.",
    hello: 'Szia {name}!', footer_reason: "Azért kapod ezt az e-mailt, mert van fiókod a(z) {app} alkalmazásban, és ez az értesítés be van kapcsolva.", footer_reason_invite: "Azért kapod ezt az e-mailt, mert {inviter} meghívott a(z) {app} alkalmazásba. Ha nem tudod, miről van szó, egyszerűen hagyd figyelmen kívül.", footer_settings: "E-mail-beállítások", footer_unsub: "Leiratkozás", cal_hint: "A mellékletben egy naptárbejegyzést találsz a dátum mentéséhez.", btn_fallback: "Ha a gomb nem működik, másold ezt a linket a böngésződbe:",
    lbl_event: 'Esemény', lbl_date: 'Dátum', lbl_location: 'Helyszín', lbl_position: 'Pozíció', lbl_status: 'Állapot', lbl_team: 'Csapat',
    st_proposed: 'Előjegyezve – kérjük, erősítsd meg', st_confirmed: 'Megerősítve', st_uncertain: 'Bizonytalan',
    as_subject: 'Beosztásod: {position} – {event}', as_intro: 'beosztottak a következő eseményre:', as_cta: 'Megtekintés és megerősítés', as_note: 'Kérjük, erősítsd meg a beosztásodat – vagy mondd le, ha nem tudsz jönni. Ekkor automatikusan feljebb lép valaki a várólistáról.',
    wl_subject: 'Feljebb léptél a várólistáról: {position} – {event}', wl_intro: 'felszabadult egy hely, és feljebb léptél a várólistáról. Kérjük, erősítsd meg, hogy ott leszel-e:',
    inv_subject: 'Meghívó a(z) „{team}” csapatba', inv_intro: '{inviter} meghív a(z) „{team}” csapatba.', inv_valid: 'A link 24 óráig érvényes.', inv_cta: 'Meghívó elfogadása',
    dl_subject: 'Emlékeztető: {group} – határidő {date}', dl_intro: 'a(z) „{group}” csoportod ({event}) határideje: {date}. Ezek a pontok még nyitottak:', dl_cta: 'A csoporthoz',
    ja_subject: 'Üdv a(z) „{team}” csapatban', ja_intro: 'a csatlakozási kérelmedet elfogadták – örülünk, hogy itt vagy!', ja_cta: 'A csapathoz',
  },
  cs: {
    p_confirm: "Potvrď prosím přiřazení v aplikaci.", p_soon_title: "Brzy začínáš: {position}", p_soon_body: "Začátek v {time} – {event}", p_mention_title: "{name} tě zmínil/a · {room}", p_test_title: "Upozornění fungují! 🎉", p_test_body: "Takhle vypadají tvoje upozornění.",
    hello: 'Ahoj {name},', footer_reason: "Tento e-mail dostáváš, protože máš účet v {app} a toto upozornění je zapnuté.", footer_reason_invite: "Tento e-mail dostáváš, protože tě {inviter} pozval(a) do {app}. Pokud ti to nic neříká, jednoduše ho ignoruj.", footer_settings: "Nastavení e-mailů", footer_unsub: "Odhlásit odběr", cal_hint: "V příloze najdeš událost do kalendáře.", btn_fallback: "Pokud tlačítko nefunguje, zkopíruj tento odkaz do prohlížeče:",
    lbl_event: 'Akce', lbl_date: 'Datum', lbl_location: 'Místo', lbl_position: 'Pozice', lbl_status: 'Stav', lbl_team: 'Tým',
    st_proposed: 'Předběžně – prosím potvrď', st_confirmed: 'Potvrzeno', st_uncertain: 'Nejisté',
    as_subject: 'Tvoje přiřazení: {position} – {event}', as_intro: 'byl/a jsi přiřazen/a na tuto akci:', as_cta: 'Zobrazit a potvrdit', as_note: 'Potvrď prosím přiřazení – nebo ho odmítni, pokud nemůžeš. Pak automaticky postoupí někdo z čekací listiny.',
    wl_subject: 'Postoupil/a jsi z čekací listiny: {position} – {event}', wl_intro: 'uvolnilo se místo a postoupil/a jsi z čekací listiny. Potvrď prosím, zda přijdeš:',
    inv_subject: 'Pozvánka do týmu „{team}“', inv_intro: '{inviter} tě zve do týmu „{team}“.', inv_valid: 'Odkaz platí 24 hodin.', inv_cta: 'Přijmout pozvánku',
    dl_subject: 'Připomenutí: {group} – termín {date}', dl_intro: 'termín tvé skupiny „{group}“ ({event}) je {date}. Tyto body jsou stále otevřené:', dl_cta: 'Do skupiny',
    ja_subject: 'Vítej v týmu „{team}“', ja_intro: 'tvoje žádost o vstup byla přijata – jsme rádi, že jsi s námi!', ja_cta: 'Do týmu',
  },
  sv: {
    p_confirm: "Bekräfta din indelning i appen.", p_soon_title: "Snart dags: {position}", p_soon_body: "Börjar {time} – {event}", p_mention_title: "{name} nämnde dig · {room}", p_test_title: "Push fungerar! 🎉", p_test_body: "Så här ser dina aviseringar ut.",
    hello: 'Hej {name},', footer_reason: "Du får det här mejlet eftersom du har ett konto hos {app} och den här aviseringen är påslagen.", footer_reason_invite: "Du får det här mejlet eftersom {inviter} har bjudit in dig till {app}. Om det inte säger dig något kan du bara ignorera det.", footer_settings: "E-postinställningar", footer_unsub: "Avregistrera", cal_hint: "En kalenderhändelse är bifogad så att du kan spara datumet.", btn_fallback: "Om knappen inte fungerar, kopiera den här länken till din webbläsare:",
    lbl_event: 'Evenemang', lbl_date: 'Datum', lbl_location: 'Plats', lbl_position: 'Position', lbl_status: 'Status', lbl_team: 'Team',
    st_proposed: 'Föreslagen – bekräfta gärna', st_confirmed: 'Bekräftad', st_uncertain: 'Osäker',
    as_subject: 'Din indelning: {position} på {event}', as_intro: 'du har delats in på följande evenemang:', as_cta: 'Visa och bekräfta', as_note: 'Bekräfta din indelning – eller tacka nej om du inte kan. Då flyttas någon från väntelistan upp automatiskt.',
    wl_subject: 'Du har flyttats upp: {position} på {event}', wl_intro: 'en plats har blivit ledig och du har flyttats upp från väntelistan. Bekräfta om du kan vara med:',
    inv_subject: 'Inbjudan till teamet ”{team}”', inv_intro: '{inviter} bjuder in dig till teamet ”{team}”.', inv_valid: 'Länken gäller i 24 timmar.', inv_cta: 'Acceptera inbjudan',
    dl_subject: 'Påminnelse: {group} – deadline {date}', dl_intro: 'deadline för din grupp ”{group}” ({event}) är {date}. Dessa punkter återstår:', dl_cta: 'Till gruppen',
    ja_subject: 'Välkommen till teamet ”{team}”', ja_intro: 'din ansökan har godkänts – kul att du är med!', ja_cta: 'Till teamet',
  },
  bg: {
    p_confirm: "Моля, потвърди разпределението си в приложението.", p_soon_title: "Скоро започва: {position}", p_soon_body: "Начало в {time} – {event}", p_mention_title: "{name} те спомена · {room}", p_test_title: "Известията работят! 🎉", p_test_body: "Така изглеждат твоите известия.",
    hello: 'Здравей, {name},', footer_reason: "Получаваш този имейл, защото имаш акаунт в {app} и това известие е включено.", footer_reason_invite: "Получаваш този имейл, защото {inviter} те покани в {app}. Ако не ти говори нищо, просто го игнорирай.", footer_settings: "Настройки за имейл", footer_unsub: "Отписване", cal_hint: "В прикачения файл има събитие за календара, за да запазиш датата.", btn_fallback: "Ако бутонът не работи, копирай тази връзка в браузъра:",
    lbl_event: 'Събитие', lbl_date: 'Дата', lbl_location: 'Място', lbl_position: 'Позиция', lbl_status: 'Статус', lbl_team: 'Екип',
    st_proposed: 'Предложен – моля, потвърди', st_confirmed: 'Потвърден', st_uncertain: 'Несигурно',
    as_subject: 'Твоето разпределение: {position} – {event}', as_intro: 'разпределен си за следното събитие:', as_cta: 'Виж и потвърди', as_note: 'Моля, потвърди разпределението си – или откажи, ако не можеш. Тогава автоматично ще се придвижи някой от списъка на чакащите.',
    wl_subject: 'Придвижи се от списъка на чакащите: {position} – {event}', wl_intro: 'освободи се място и ти се придвижи от списъка на чакащите. Моля, потвърди дали ще присъстваш:',
    inv_subject: 'Покана за екипа „{team}“', inv_intro: '{inviter} те кани в екипа „{team}“.', inv_valid: 'Линкът е валиден 24 часа.', inv_cta: 'Приеми поканата',
    dl_subject: 'Напомняне: {group} – краен срок {date}', dl_intro: 'крайният срок на групата ти „{group}“ ({event}) е {date}. Тези точки са още отворени:', dl_cta: 'Към групата',
    ja_subject: 'Добре дошъл в екипа „{team}“', ja_intro: 'заявката ти е приета – радваме се, че си с нас!', ja_cta: 'Към екипа',
  },
  sr: {
    p_confirm: "Molimo potvrdi raspored u aplikaciji.", p_soon_title: "Uskoro počinje: {position}", p_soon_body: "Početak u {time} – {event}", p_mention_title: "{name} te je pomenuo/la · {room}", p_test_title: "Obaveštenja rade! 🎉", p_test_body: "Ovako izgledaju tvoja obaveštenja.",
    hello: 'Zdravo {name},', footer_reason: "Добијаш овај имејл јер имаш налог на {app} и ово обавештење је укључено.", footer_reason_invite: "Добијаш овај имејл јер те је {inviter} позвао/ла у {app}. Ако ти то ништа не значи, само га занемари.", footer_settings: "Подешавања имејла", footer_unsub: "Одјави се", cal_hint: "У прилогу је догађај за календар да сачуваш датум.", btn_fallback: "Ако дугме не ради, копирај овај линк у прегледач:",
    lbl_event: 'Događaj', lbl_date: 'Datum', lbl_location: 'Mesto', lbl_position: 'Pozicija', lbl_status: 'Status', lbl_team: 'Tim',
    st_proposed: 'Predloženo – molimo potvrdi', st_confirmed: 'Potvrđeno', st_uncertain: 'Neizvesno',
    as_subject: 'Tvoj raspored: {position} – {event}', as_intro: 'raspoređen/a si na sledeći događaj:', as_cta: 'Pogledaj i potvrdi', as_note: 'Molimo potvrdi raspored – ili otkaži ako ne možeš. Tada automatski napreduje neko sa liste čekanja.',
    wl_subject: 'Napredovao/la si sa liste čekanja: {position} – {event}', wl_intro: 'oslobodilo se mesto i napredovao/la si sa liste čekanja. Molimo potvrdi da li dolaziš:',
    inv_subject: 'Pozivnica u tim „{team}”', inv_intro: '{inviter} te poziva u tim „{team}”.', inv_valid: 'Link važi 24 sata.', inv_cta: 'Prihvati pozivnicu',
    dl_subject: 'Podsetnik: {group} – rok {date}', dl_intro: 'rok tvoje grupe „{group}” ({event}) je {date}. Ove stavke su još otvorene:', dl_cta: 'Na grupu',
    ja_subject: 'Dobro došao/la u tim „{team}”', ja_intro: 'tvoj zahtev je prihvaćen – drago nam je što si tu!', ja_cta: 'Na tim',
  },
  da: {
    p_confirm: "Bekræft venligst din vagt i appen.", p_soon_title: "Snart i gang: {position}", p_soon_body: "Starter kl. {time} – {event}", p_mention_title: "{name} har nævnt dig · {room}", p_test_title: "Push virker! 🎉", p_test_body: "Sådan ser dine notifikationer ud.",
    hello: 'Hej {name},', footer_reason: "Du modtager denne e-mail, fordi du har en konto hos {app}, og denne notifikation er slået til.", footer_reason_invite: "Du modtager denne e-mail, fordi {inviter} har inviteret dig til {app}. Hvis det ikke siger dig noget, kan du bare ignorere den.", footer_settings: "E-mailindstillinger", footer_unsub: "Afmeld", cal_hint: "Der er vedhæftet en kalenderbegivenhed, så du kan gemme datoen.", btn_fallback: "Hvis knappen ikke virker, så kopiér dette link ind i din browser:",
    lbl_event: 'Arrangement', lbl_date: 'Dato', lbl_location: 'Sted', lbl_position: 'Position', lbl_status: 'Status', lbl_team: 'Hold',
    st_proposed: 'Foreslået – bekræft venligst', st_confirmed: 'Bekræftet', st_uncertain: 'Usikker',
    as_subject: 'Din vagt: {position} til {event}', as_intro: 'du er sat på følgende arrangement:', as_cta: 'Se og bekræft', as_note: 'Bekræft venligst din vagt – eller meld fra, hvis du ikke kan. Så rykker en fra ventelisten automatisk op.',
    wl_subject: 'Du er rykket op: {position} til {event}', wl_intro: 'en plads er blevet ledig, og du er rykket op fra ventelisten. Bekræft venligst, om du kan:',
    inv_subject: 'Invitation til holdet „{team}“', inv_intro: '{inviter} inviterer dig til holdet „{team}“.', inv_valid: 'Linket er gyldigt i 24 timer.', inv_cta: 'Accepter invitationen',
    dl_subject: 'Påmindelse: {group} – deadline {date}', dl_intro: 'deadline for din gruppe „{group}“ ({event}) er {date}. Disse punkter er stadig åbne:', dl_cta: 'Til gruppen',
    ja_subject: 'Velkommen på holdet „{team}“', ja_intro: 'din anmodning er godkendt – dejligt, at du er med!', ja_cta: 'Til holdet',
  },
  fi: {
    p_confirm: "Vahvistathan sijoituksesi sovelluksessa.", p_soon_title: "Pian alkaa: {position}", p_soon_body: "Alkaa klo {time} – {event}", p_mention_title: "{name} mainitsi sinut · {room}", p_test_title: "Ilmoitukset toimivat! 🎉", p_test_body: "Tältä ilmoituksesi näyttävät.",
    hello: 'Hei {name},', footer_reason: "Saat tämän sähköpostin, koska sinulla on tili palvelussa {app} ja tämä ilmoitus on käytössä.", footer_reason_invite: "Saat tämän sähköpostin, koska {inviter} kutsui sinut palveluun {app}. Jos tämä ei sano sinulle mitään, voit jättää viestin huomiotta.", footer_settings: "Sähköpostiasetukset", footer_unsub: "Peru tilaus", cal_hint: "Liitteenä on kalenterimerkintä päivämäärän tallentamista varten.", btn_fallback: "Jos painike ei toimi, kopioi tämä linkki selaimeesi:",
    lbl_event: 'Tapahtuma', lbl_date: 'Päivä', lbl_location: 'Paikka', lbl_position: 'Tehtävä', lbl_status: 'Tila', lbl_team: 'Tiimi',
    st_proposed: 'Ehdotettu – vahvistathan', st_confirmed: 'Vahvistettu', st_uncertain: 'Epävarma',
    as_subject: 'Sijoituksesi: {position} – {event}', as_intro: 'sinut on sijoitettu seuraavaan tapahtumaan:', as_cta: 'Katso ja vahvista', as_note: 'Vahvista sijoituksesi – tai peru, jos et pääse. Silloin joku jonotuslistalta nousee automaattisesti tilallesi.',
    wl_subject: 'Nousit jonotuslistalta: {position} – {event}', wl_intro: 'paikka vapautui ja nousit jonotuslistalta. Vahvistathan, pääsetkö mukaan:',
    inv_subject: 'Kutsu tiimiin ”{team}”', inv_intro: '{inviter} kutsuu sinut tiimiin ”{team}”.', inv_valid: 'Linkki on voimassa 24 tuntia.', inv_cta: 'Hyväksy kutsu',
    dl_subject: 'Muistutus: {group} – määräaika {date}', dl_intro: 'ryhmäsi ”{group}” ({event}) määräaika on {date}. Nämä kohdat ovat vielä avoinna:', dl_cta: 'Ryhmään',
    ja_subject: 'Tervetuloa tiimiin ”{team}”', ja_intro: 'liittymispyyntösi on hyväksytty – kiva, että olet mukana!', ja_cta: 'Tiimiin',
  },
};

const LOCALES: Record<string, string> = {
  de: 'de-DE', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL', pl: 'pl-PL', uk: 'uk-UA', ru: 'ru-RU',
  ro: 'ro-RO', tr: 'tr-TR', el: 'el-GR', hu: 'hu-HU', cs: 'cs-CZ', sv: 'sv-SE', bg: 'bg-BG', sr: 'sr-Latn-RS', da: 'da-DK', fi: 'fi-FI',
};
