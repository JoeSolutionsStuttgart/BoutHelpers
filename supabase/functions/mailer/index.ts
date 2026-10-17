// =============================================================
// TEAMPLANER — Edge Function "mailer"
// Verschickt alle E-Mails der App über Brevo und alle Push-Nachrichten (Web Push):
//   * Einteilungen (Button "E-Mails senden")
//   * Nachrücken von der Warteliste
//   * Einladungslinks
//   * Erinnerungen vor der Gruppen-Deadline (offene Punkte)
//   * Bestätigte Beitrittsanfragen
//
// Benötigte Secrets (Supabase → Edge Functions → Secrets):
//   BREVO_API_KEY   API-Schlüssel aus Brevo (SMTP & API → API Keys)
//   MAIL_FROM       Absenderadresse, in Brevo als Absender bestätigt
//   MAIL_FROM_NAME  Absendername, z. B. "Teamplaner"
//   APP_URL         Adresse der App, z. B. https://name.github.io/chronik/planer/
//   TIMEZONE        optional, Zeitzone für Datumsangaben (Standard Europe/Berlin)
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  für Push-Benachrichtigungen (tools/vapid.html)
//   VAPID_SUBJECT   optional, z. B. mailto:du@example.org (Standard: mailto:MAIL_FROM)
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const BREVO_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
const FROM = Deno.env.get('MAIL_FROM') ?? '';
const FROM_NAME = Deno.env.get('MAIL_FROM_NAME') ?? 'Teamplaner';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/?$/, '/');
const TZ = Deno.env.get('TIMEZONE') ?? 'Europe/Berlin';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const PUSH_ON = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (PUSH_ON) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || `mailto:${FROM || 'admin@example.org'}`, VAPID_PUBLIC, VAPID_PRIVATE);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Outbox = {
  id: string; to_email: string; to_name: string; kind: string; lang: string; attempts: number;
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

function layout(lang: string, title: string, inner: string) {
  const T = TEXTS[lang] ?? TEXTS.de;
  return `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;background:#fff7f0;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#241d3b">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7f0;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 24px rgba(36,29,59,.08)">
      <tr><td style="background:linear-gradient(135deg,#7c5cff,#ff4f8b);background-color:#7c5cff;padding:22px 26px;color:#ffffff">
        <div style="font-size:13px;font-weight:700;letter-spacing:.06em;opacity:.9;text-transform:uppercase">${esc(FROM_NAME)}</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">${esc(title)}</div>
      </td></tr>
      <tr><td style="padding:24px 26px;font-size:15px;line-height:1.55">${inner}</td></tr>
      <tr><td style="padding:14px 26px 22px;font-size:12px;color:#8c86a3">${esc(fill(T.footer, { app: FROM_NAME }))}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:22px 0 6px"><a href="${esc(href)}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${esc(label)}</a></p>`;

const rows = (items: [string, string][]) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:12px 0;border-collapse:collapse">${items
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:7px 10px 7px 0;color:#8c86a3;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;font-weight:600">${esc(v)}</td></tr>`)
    .join('')}</table>`;

// Inhalt einer Mail zusammenbauen
function render(m: Outbox): { subject: string; html: string; text: string } {
  const lang = TEXTS[m.lang] ? m.lang : 'de';
  const T = TEXTS[lang];
  const p = m.payload ?? {};
  const hello = fill(T.hello, { name: m.to_name || '' });
  let subject = '';
  let inner = '';
  let text = '';

  if (m.kind === 'assignment' || m.kind === 'waitlist_promoted') {
    const promoted = m.kind === 'waitlist_promoted';
    subject = fill(promoted ? T.wl_subject : T.as_subject, { position: p.position_name, event: p.event_title });
    const status = T['st_' + (promoted ? 'proposed' : p.status)] ?? '';
    const when = p.position_start ? range(lang, p.position_start, p.position_end) : range(lang, p.event_start, p.event_end);
    const link = `${APP_URL}#/event/${p.event_id}`;
    const facts: [string, string][] = [
      [T.lbl_event, p.event_title], [T.lbl_date, when], [T.lbl_location, p.location],
      [T.lbl_position, p.position_name], [T.lbl_status, status], [T.lbl_team, p.team_name],
    ];
    inner = `<p style="margin:0 0 6px">${esc(hello)}</p><p style="margin:0">${esc(promoted ? T.wl_intro : T.as_intro)}</p>${rows(facts)}`
      + (p.position_description ? `<p style="margin:0;color:#5d5677;font-size:14px">${esc(p.position_description)}</p>` : '')
      + button(link, T.as_cta) + `<p style="margin:12px 0 0;font-size:13px;color:#5d5677">${esc(T.as_note)}</p>`;
    text = `${hello}\n${promoted ? T.wl_intro : T.as_intro}\n\n${facts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${T.as_cta}: ${link}\n\n${T.as_note}`;
  } else if (m.kind === 'invite') {
    subject = fill(T.inv_subject, { team: p.team_name });
    const link = `${APP_URL}#/invite/${p.token}`;
    const intro = fill(T.inv_intro, { inviter: p.inviter, team: p.team_name });
    inner = `<p style="margin:0 0 10px">${esc(intro)}</p>${p.note ? `<p style="margin:0 0 10px;font-style:italic;color:#5d5677">„${esc(p.note)}“</p>` : ''}`
      + button(link, T.inv_cta) + `<p style="margin:12px 0 0;font-size:13px;color:#5d5677">${esc(T.inv_valid)}</p>`;
    text = `${intro}\n${p.note ? `"${p.note}"\n` : ''}\n${T.inv_cta}: ${link}\n${T.inv_valid}`;
  } else if (m.kind === 'deadline_reminder') {
    const date = fmt(lang, p.deadline);
    subject = fill(T.dl_subject, { group: p.position_name, date });
    const link = `${APP_URL}#/group/${p.position_id}`;
    const intro = fill(T.dl_intro, { group: p.position_name, event: p.event_title, date });
    const tasks: string[] = Array.isArray(p.open_tasks) ? p.open_tasks : [];
    inner = `<p style="margin:0 0 6px">${esc(hello)}</p><p style="margin:0 0 10px">${esc(intro)}</p>`
      + `<ul style="margin:0 0 6px;padding-left:20px">${tasks.map((x) => `<li style="margin:4px 0">${esc(x)}</li>`).join('')}</ul>`
      + button(link, T.dl_cta);
    text = `${hello}\n${intro}\n\n${tasks.map((x) => `• ${x}`).join('\n')}\n\n${T.dl_cta}: ${link}`;
  } else if (m.kind === 'join_approved') {
    subject = fill(T.ja_subject, { team: p.team_name });
    const link = `${APP_URL}#/team/${p.team_id}`;
    inner = `<p style="margin:0 0 6px">${esc(hello)}</p><p style="margin:0">${esc(T.ja_intro)}</p>` + button(link, T.ja_cta);
    text = `${hello}\n${T.ja_intro}\n\n${T.ja_cta}: ${link}`;
  } else {
    throw new Error('unknown kind ' + m.kind);
  }
  return { subject, html: layout(lang, subject, inner), text };
}

async function sendBrevo(m: Outbox) {
  const { subject, html, text } = render(m);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: FROM, name: FROM_NAME },
      to: [{ email: m.to_email, name: m.to_name || undefined }],
      subject, htmlContent: html, textContent: text,
      tags: ['teamplaner', m.kind],
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

  if (!BREVO_KEY || !FROM || !APP_URL || APP_URL === '/') {
    return json({ error: 'Secrets BREVO_API_KEY, MAIL_FROM und APP_URL fehlen.' }, 500);
  }

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
  return json({ sent, failed, push });
});

// ---------------- Texte ----------------
type MailTexts = Record<string, string>;

const TEXTS: Record<string, MailTexts> = {
  de: {
    p_confirm: "Bitte bestätige deine Einteilung in der App.", p_soon_title: "Gleich geht's los: {position}", p_soon_body: "Beginn um {time} – {event}", p_mention_title: "{name} hat dich erwähnt · {room}", p_test_title: "Push funktioniert! 🎉", p_test_body: "So sehen deine Benachrichtigungen aus.",
    hello: 'Hallo {name},', footer: 'Diese E-Mail wurde von {app} verschickt.',
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
    hello: 'Hello {name},', footer: 'This email was sent by {app}.',
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
    hello: 'Bonjour {name},', footer: 'Cet e-mail a été envoyé par {app}.',
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
    hello: 'Hola, {name}:', footer: 'Este correo lo ha enviado {app}.',
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
    hello: 'Ciao {name},', footer: 'Questa e-mail è stata inviata da {app}.',
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
    hello: 'Olá, {name},', footer: 'Este e-mail foi enviado por {app}.',
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
    hello: 'Hallo {name},', footer: 'Deze e-mail is verstuurd door {app}.',
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
    hello: 'Cześć {name},', footer: 'Tę wiadomość wysłała aplikacja {app}.',
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
    hello: 'Привіт, {name}!', footer: 'Цей лист надіслав застосунок {app}.',
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
    hello: 'Привет, {name}!', footer: 'Это письмо отправлено приложением {app}.',
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
    hello: 'Salut, {name},', footer: 'Acest e-mail a fost trimis de {app}.',
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
    hello: 'Merhaba {name},', footer: 'Bu e-posta {app} tarafından gönderildi.',
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
    hello: 'Γεια σου {name},', footer: 'Αυτό το email στάλθηκε από το {app}.',
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
    hello: 'Szia {name}!', footer: 'Ezt az e-mailt a(z) {app} küldte.',
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
    hello: 'Ahoj {name},', footer: 'Tento e-mail odeslala aplikace {app}.',
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
    hello: 'Hej {name},', footer: 'Det här mejlet skickades av {app}.',
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
    hello: 'Здравей, {name},', footer: 'Този имейл е изпратен от {app}.',
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
    hello: 'Zdravo {name},', footer: 'Ovaj imejl je poslala aplikacija {app}.',
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
    hello: 'Hej {name},', footer: 'Denne mail er sendt af {app}.',
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
    hello: 'Hei {name},', footer: 'Tämän viestin lähetti {app}.',
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
