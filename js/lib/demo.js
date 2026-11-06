// Demo-Modus: komplette In-Browser-Simulation der App mit Beispieldaten.
// Aktiv, wenn localStorage['tp.demo']==='1'. Nichts geht an eine echte Datenbank.
// Man kann die Sicht jeder Person einnehmen und alles (auch Personen) umbenennen.

const FLAG = 'tp.demo', K_DB = 'tp.demo.db', K_ME = 'tp.demo.me', K_SEEN = 'tp.demo.seen';
// Freigeschaltet wird der Zugang in Supabase (mail_settings.demo_email).
// Stimmt die Konto-E-Mail überein, zeigt die Hilfe-Seite einen Knopf hierher.
const ALLPERMS = ['team.edit', 'members.manage', 'invites.create', 'roles.manage', 'positions.manage', 'events.manage', 'guests.manage', 'chat.moderate'];
const ACTIVE = ['proposed', 'confirmed', 'uncertain'];

export function isDemo() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
export function enableDemo() { try { localStorage.setItem(FLAG, '1'); } catch (e) { /* */ } }
// Demo verlassen: nur den Modus ausschalten. Die geänderten Daten bleiben gespeichert
// und sind beim nächsten Öffnen der Demo wieder da. (Komplett zurücksetzen = resetDemo.)
export function disableDemo() {
  try { localStorage.removeItem(FLAG); } catch (e) { /* */ }
}

const now = Date.now(), DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 9);

// ---------- Beispieldaten ----------
const NAMES = [
  ['Anna Berg', 'she'], ['Ben Okafor', 'he'], ['Cem Yılmaz', 'they'], ['Dora Nowak', 'custom'],
  ['Emil Lund', 'he_they'], ['Fatma Demir', 'she_they'], ['Greta Hoff', 'she'], ['Hassan Ali', 'he'],
  ['Ines Vogel', 'she'], ['Jonas Klein', 'he'], ['Katrin Weiss', 'she'], ['Luca Rossi', 'any'],
  ['Mara Schulz', 'she'], ['Nael Haddad', 'he'], ['Olivia Park', 'she'], ['Pavel Novák', 'he'],
  ['Qamar Said', 'they'], ['Rosa Díaz', 'she'], ['Sven Åberg', 'he'], ['Tina Bauer', 'she'],
  ['Umar Khan', 'he'], ['Vera Horn', 'she'], ['Wei Chen', 'they'], ['Yara Saab', 'she'],
];

function seed() {
  const prof = (i) => {
    const [name, pron] = NAMES[i];
    return { id: 'u' + (i + 1), display_name: name, pronouns: pron === 'custom' ? 'custom' : pron, pronouns_custom: pron === 'custom' ? 'xier/xiem' : '', language: 'de', theme: 'system', is_guest: false, bio: i === 0 ? 'Ich organisiere gern und helfe am Getränkestand.' : '' };
  };
  const profiles = NAMES.map((_, i) => prof(i));
  profiles.push({ id: 'g1', display_name: 'Bäckerei Müller', pronouns: '', pronouns_custom: '', language: 'de', theme: 'system', is_guest: true, bio: '' });

  const teams = [
    { id: 'tA', name: 'Stadtfest-Crew', description: 'Wir organisieren das große Stadtfest.', color: '#ff4f8b', discoverable: true, binding: false },
    { id: 'tB', name: 'Theater-AG', description: 'Bühne, Technik und Garderobe für unsere Stücke.', color: '#7c5cff', discoverable: true, binding: false },
  ];
  // Mitglieder: tA = u1..u16, tB = u1,u17..u24  → 24 verschiedene Personen
  const team_members = [];
  for (let i = 1; i <= 16; i++) team_members.push({ team_id: 'tA', user_id: 'u' + i, is_owner: i === 1, joined_at: iso(now - i * DAY) });
  team_members.push({ team_id: 'tB', user_id: 'u1', is_owner: true, joined_at: iso(now - 30 * DAY) });
  for (let i = 17; i <= 24; i++) team_members.push({ team_id: 'tB', user_id: 'u' + i, is_owner: false, joined_at: iso(now - i * DAY) });

  const roles = [
    { id: 'rA1', team_id: 'tA', name: 'Admin', color: '#7c5cff', permissions: ALLPERMS.slice(), sort: 0 },
    { id: 'rA2', team_id: 'tA', name: 'Orga', color: '#ff9f2e', permissions: ['invites.create', 'events.manage', 'guests.manage', 'chat.moderate'], sort: 1 },
    { id: 'rA3', team_id: 'tA', name: 'Technik', color: '#12b8a6', permissions: ['positions.manage'], sort: 2 },
    { id: 'rA4', team_id: 'tA', name: 'Helfer*in', color: '#2f9bff', permissions: [], sort: 3 },
    { id: 'rB1', team_id: 'tB', name: 'Leitung', color: '#7c5cff', permissions: ALLPERMS.slice(), sort: 0 },
    { id: 'rB2', team_id: 'tB', name: 'Regie', color: '#ff4f8b', permissions: ['events.manage', 'chat.moderate'], sort: 1 },
  ];
  const member_roles = [
    { team_id: 'tA', user_id: 'u1', role_id: 'rA1' }, { team_id: 'tA', user_id: 'u2', role_id: 'rA2' },
    { team_id: 'tA', user_id: 'u3', role_id: 'rA3' }, { team_id: 'tA', user_id: 'u4', role_id: 'rA2' },
    { team_id: 'tA', user_id: 'u6', role_id: 'rA4' }, { team_id: 'tA', user_id: 'u7', role_id: 'rA4' },
    { team_id: 'tB', user_id: 'u1', role_id: 'rB1' }, { team_id: 'tB', user_id: 'u17', role_id: 'rB2' },
  ];
  const position_types = [
    { id: 'cA1', team_id: 'tA', name: 'Catering', description: 'Essen & Getränke', color: '#ff9f2e', sort: 0 },
    { id: 'cA2', team_id: 'tA', name: 'Einlass', description: '', color: '#2f9bff', sort: 1, shift_templates: [{ id: 'tE1', name: '', from: '17:00', to: '20:00', slots: 2 }, { id: 'tE2', name: 'Spätschicht', from: '20:00', to: '23:00', slots: 2 }] },
    { id: 'cA3', team_id: 'tA', name: 'Technik', description: 'Ton & Licht', color: '#7c5cff', sort: 2 },
    { id: 'cA4', team_id: 'tA', name: 'Deko', description: '', color: '#12b8a6', sort: 3 },
    { id: 'cA5', team_id: 'tA', name: 'Sanitäter', description: 'Erste Hilfe', color: '#ff4f8b', sort: 4 },
    { id: 'cB1', team_id: 'tB', name: 'Garderobe', description: '', color: '#ff9f2e', sort: 0 },
    { id: 'cB2', team_id: 'tB', name: 'Bühne', description: '', color: '#7c5cff', sort: 1 },
    { id: 'cB3', team_id: 'tB', name: 'Kasse', description: '', color: '#12b8a6', sort: 2 },
  ];
  const preferences = [];
  const prefPairs = [['u1', 'cA1', 1], ['u1', 'cA2', 2], ['u2', 'cA1', 1], ['u5', 'cA1', 2], ['u6', 'cA1', 1], ['u7', 'cA4', 1], ['u3', 'cA3', 1], ['u8', 'cA2', 1], ['u9', 'cA2', 2], ['u10', 'cA2', 1], ['u11', 'cA3', 2], ['u12', 'cA4', 1], ['u13', 'cA4', 2], ['u14', 'cA4', 1], ['u16', 'cA5', 1], ['u4', 'cA5', 2]];
  prefPairs.forEach(([u, c, r]) => preferences.push({ team_id: 'tA', user_id: u, position_type_id: c, rank: r, shifts: [] }));
  // Beispiel: u8 bewirbt sich für die Früh-Einlass-Schicht
  const pe = preferences.find((p) => p.user_id === 'u8' && p.position_type_id === 'cA2'); if (pe) pe.shifts = ['tE1'];

  const events = [
    { id: 'eA1', team_id: 'tA', title: 'Stadtfest 2026', description: 'Großes Fest auf dem Lindenplatz.', location: 'Lindenplatz', address: 'Lindenplatz 1, 12345 Musterstadt', starts_at: iso(now + 12 * DAY), ends_at: iso(now + 12 * DAY + 7 * 3600000), binding: false, respond_by: iso(now + 6 * DAY), created_at: iso(now - 5 * DAY) },
    { id: 'eA2', team_id: 'tA', title: 'Sommerkonzert', description: '', location: 'Stadtpark', address: '', starts_at: iso(now + 40 * DAY), ends_at: iso(now + 40 * DAY + 4 * 3600000), binding: false, created_at: iso(now - 2 * DAY) },
    { id: 'eB1', team_id: 'tB', title: 'Premiere: Hamlet', description: 'Großes Haus.', location: 'Stadttheater', address: 'Theaterstr. 5, 12345 Musterstadt', starts_at: iso(now + 20 * DAY), ends_at: iso(now + 20 * DAY + 3 * 3600000), binding: false, created_at: iso(now - 7 * DAY) },
  ];
  const T = (h) => iso(now + 12 * DAY + h * 3600000);
  const positions = [
    { id: 'pC', event_id: 'eA1', team_id: 'tA', position_type_id: 'cA1', name: 'Catering', description: 'Kuchen & Getränke', deadline: iso(now + 8 * DAY), reminder_hours: 48, remind_at: iso(now + 6 * DAY), reminder_sent_at: null, sort: 0, created_at: iso(now - 5 * DAY) },
    { id: 'pE', event_id: 'eA1', team_id: 'tA', position_type_id: 'cA2', name: 'Einlass', description: '', deadline: null, reminder_hours: 48, sort: 1, created_at: iso(now - 5 * DAY) },
    { id: 'pT', event_id: 'eA1', team_id: 'tA', position_type_id: 'cA3', name: 'Technik', description: 'Bühne & Ton', deadline: iso(now + 5 * DAY), reminder_hours: 24, remind_at: iso(now + 4 * DAY), reminder_sent_at: null, sort: 2, created_at: iso(now - 5 * DAY) },
    { id: 'pD', event_id: 'eA1', team_id: 'tA', position_type_id: 'cA4', name: 'Deko', description: '', deadline: null, reminder_hours: 48, sort: 3, created_at: iso(now - 5 * DAY) },
    { id: 'pS', event_id: 'eA1', team_id: 'tA', position_type_id: 'cA5', name: 'Sanitäter', description: '', deadline: null, reminder_hours: 48, sort: 4, created_at: iso(now - 5 * DAY) },
    { id: 'pG', event_id: 'eB1', team_id: 'tB', position_type_id: 'cB1', name: 'Garderobe', description: '', deadline: null, reminder_hours: 48, sort: 0, created_at: iso(now - 7 * DAY) },
    { id: 'pB', event_id: 'eB1', team_id: 'tB', position_type_id: 'cB2', name: 'Bühne', description: '', deadline: null, reminder_hours: 48, sort: 1, created_at: iso(now - 7 * DAY) },
  ];
  const shifts = [
    { id: 'sC1', position_id: 'pC', event_id: 'eA1', team_id: 'tA', name: '', slots: 3, starts_at: T(2), ends_at: T(5), sort: 0 },
    { id: 'sC2', position_id: 'pC', event_id: 'eA1', team_id: 'tA', name: 'Spätschicht', slots: 2, starts_at: T(5), ends_at: T(7), sort: 1 },
    { id: 'sE1', position_id: 'pE', event_id: 'eA1', team_id: 'tA', name: '', slots: 2, starts_at: T(0), ends_at: T(2), sort: 0 },
    { id: 'sE2', position_id: 'pE', event_id: 'eA1', team_id: 'tA', name: 'Spätschicht', slots: 2, starts_at: T(2), ends_at: T(4), sort: 1 },
    { id: 'sT1', position_id: 'pT', event_id: 'eA1', team_id: 'tA', name: '', slots: 2, starts_at: T(-1), ends_at: T(7), sort: 0 },
    { id: 'sD1', position_id: 'pD', event_id: 'eA1', team_id: 'tA', name: '', slots: 4, starts_at: null, ends_at: null, sort: 0 },
    { id: 'sS1', position_id: 'pS', event_id: 'eA1', team_id: 'tA', name: '', slots: 2, starts_at: T(0), ends_at: T(7), sort: 0 },
    { id: 'sG1', position_id: 'pG', event_id: 'eB1', team_id: 'tB', name: '', slots: 2, starts_at: null, ends_at: null, sort: 0 },
    { id: 'sB1', position_id: 'pB', event_id: 'eB1', team_id: 'tB', name: '', slots: 3, starts_at: null, ends_at: null, sort: 0 },
  ];
  const A = (sh, pos, u, st, note) => ({ id: uid('a'), shift_id: sh, position_id: pos, event_id: 'eA1', team_id: 'tA', user_id: u, status: st, note: note || '', source: 'manual', created_at: iso(now - DAY) });
  const assignments = [
    A('sC1', 'pC', 'u1', 'confirmed'), A('sC1', 'pC', 'u2', 'proposed'), A('sC1', 'pC', 'u5', 'uncertain', 'Muss Urlaub klären'),
    A('sC2', 'pC', 'u6', 'confirmed'), A('sC2', 'pC', 'u7', 'waitlist'),
    A('sE1', 'pE', 'u3', 'confirmed'), A('sE1', 'pE', 'u8', 'proposed'),
    A('sE2', 'pE', 'u9', 'confirmed'), A('sE2', 'pE', 'u10', 'declined', 'Bin im Urlaub'),
    A('sT1', 'pT', 'u3', 'confirmed'), A('sT1', 'pT', 'u11', 'proposed'),
    A('sD1', 'pD', 'u12', 'confirmed'), A('sD1', 'pD', 'u13', 'confirmed'), A('sD1', 'pD', 'u14', 'proposed'), A('sD1', 'pD', 'u15', 'waitlist'),
    A('sS1', 'pS', 'u16', 'confirmed'), A('sS1', 'pS', 'u4', 'uncertain'),
  ];
  const availability = [];
  const avSpec = [['u2', 'yes', ['u6']], ['u5', 'partly', ['u1']], ['u6', 'yes', ['u2']], ['u7', 'yes', []], ['u8', 'partly', []], ['u9', 'yes', ['u8']], ['u11', 'no', []], ['u12', 'yes', []], ['u13', 'partly', ['u12']], ['u14', 'yes', []], ['u15', 'yes', []], ['u16', 'yes', []]];
  avSpec.forEach(([u, stt, partners]) => availability.push({ event_id: 'eA1', user_id: u, status: stt, note: stt === 'no' ? 'Verhindert' : '', partners, windows: stt === 'partly' ? [{ from: T(0), to: T(3) }] : [], updated_at: iso(now - DAY) }));

  const tasks = [
    { id: uid('k'), position_id: 'pC', event_id: 'eA1', title: 'Kuchen backen', details: '3 Bleche', done: false, assignee: 'u5', sort: 0, created_by: 'u1', created_at: iso(now - 2 * DAY) },
    { id: uid('k'), position_id: 'pC', event_id: 'eA1', title: 'Getränke bestellen', details: '', done: true, done_by: 'u2', done_at: iso(now - DAY), sort: 1, created_by: 'u1', created_at: iso(now - 3 * DAY) },
    { id: uid('k'), position_id: 'pC', event_id: 'eA1', title: 'Stände aufbauen', details: 'Ab 9 Uhr', done: false, assignee: null, sort: 2, created_by: 'u2', created_at: iso(now - DAY) },
    { id: uid('k'), position_id: 'pT', event_id: 'eA1', title: 'Technik testen', details: '', done: false, assignee: 'u3', sort: 0, created_by: 'u3', created_at: iso(now - DAY) },
  ];
  const messages = [
    { id: uid('m'), event_id: 'eA1', position_id: null, user_id: 'u2', body: 'Hallo zusammen! 🎉 @Anna Berg, können wir uns kurz abstimmen?', mentions: ['u1'], created_at: iso(now - 2 * 3600000) },
    { id: uid('m'), event_id: 'eA1', position_id: null, user_id: 'u1', body: 'Klar, ich bin dabei!', created_at: iso(now - 3000000) },
    { id: uid('m'), event_id: 'eA1', position_id: 'pC', user_id: 'u6', body: 'Ich bringe Muffins mit.', created_at: iso(now - 1500000) },
    { id: uid('m'), event_id: 'eA1', position_id: 'pC', user_id: 'u1', body: 'Super, danke!', created_at: iso(now - 600000) },
  ];
  const polls = [
    { id: 'plE', event_id: 'eA1', team_id: 'tA', position_id: null, question: 'Wann machen wir die Manöverkritik?', multiple: false, allow_add: true, closed: false, created_by: 'u2', created_at: iso(now - DAY) },
    { id: 'plC', event_id: 'eA1', team_id: 'tA', position_id: 'pC', question: 'Was sollen wir mitbringen?', multiple: true, allow_add: true, closed: false, created_by: 'u6', created_at: iso(now - 2 * 3600000) },
  ];
  const poll_options = [
    { id: 'oE1', poll_id: 'plE', team_id: 'tA', text: 'Freitagabend', sort: 0, created_by: 'u2' },
    { id: 'oE2', poll_id: 'plE', team_id: 'tA', text: 'Samstagmittag', sort: 1, created_by: 'u2' },
    { id: 'oE3', poll_id: 'plE', team_id: 'tA', text: 'Sonntag', sort: 2, created_by: 'u8' },
    { id: 'oC1', poll_id: 'plC', team_id: 'tA', text: 'Kuchen', sort: 0, created_by: 'u6' },
    { id: 'oC2', poll_id: 'plC', team_id: 'tA', text: 'Getränke', sort: 1, created_by: 'u6' },
    { id: 'oC3', poll_id: 'plC', team_id: 'tA', text: 'Servietten', sort: 2, created_by: 'u1' },
  ];
  const poll_votes = [
    { id: uid('v'), poll_id: 'plE', option_id: 'oE1', team_id: 'tA', user_id: 'u2' },
    { id: uid('v'), poll_id: 'plE', option_id: 'oE1', team_id: 'tA', user_id: 'u8' },
    { id: uid('v'), poll_id: 'plE', option_id: 'oE2', team_id: 'tA', user_id: 'u9' },
    { id: uid('v'), poll_id: 'plC', option_id: 'oC1', team_id: 'tA', user_id: 'u6' },
    { id: uid('v'), poll_id: 'plC', option_id: 'oC2', team_id: 'tA', user_id: 'u6' },
    { id: uid('v'), poll_id: 'plC', option_id: 'oC1', team_id: 'tA', user_id: 'u1' },
  ];
  const notices = [
    { id: uid('n'), team_id: 'tA', event_id: null, position_id: null, title: 'Parkplätze', body: 'Bitte nicht vor dem Haupteingang parken – dort halten die Lieferwagen.', pinned: true, created_by: 'u2', created_at: iso(now - DAY), updated_at: iso(now - DAY) },
    { id: uid('n'), team_id: 'tA', event_id: null, position_id: null, title: '', body: 'Die T-Shirts in Teamfarbe könnt ihr im Lager abholen.', pinned: false, created_by: 'u1', created_at: iso(now - 2 * DAY), updated_at: iso(now - 2 * DAY) },
    { id: uid('n'), team_id: 'tA', event_id: 'eA1', position_id: null, title: 'Treffpunkt', body: 'Alle um 9:00 Uhr am Haupteingang. Bringt Sonnencreme mit!', pinned: true, created_by: 'u2', created_at: iso(now - 12 * 3600000), updated_at: iso(now - 12 * 3600000) },
    { id: uid('n'), team_id: 'tA', event_id: 'eA1', position_id: 'pC', title: '', body: 'Der große Kühlschrank ist für uns reserviert.', pinned: false, created_by: 'u6', created_at: iso(now - 3 * 3600000), updated_at: iso(now - 3 * 3600000) },
  ];
  const guest_links = [{ id: 'gl1', team_id: 'tA', event_id: 'eA1', position_id: 'pC', position_ids: [], token: 'stadtfest-catering', password: 'kalo-mivi-42', label: 'Bäckerei Müller', active: true, fail_count: 0, created_at: iso(now - 4 * DAY) }];
  const event_guests = [{ id: 'eg1', event_id: 'eA1', position_id: 'pC', user_id: 'g1', link_id: 'gl1', joined_at: iso(now - 3 * DAY) }];
  const join_requests = [
    { id: uid('j'), team_id: 'tA', user_id: 'u17', message: 'Ich würde gern beim Catering helfen.', created_at: iso(now - DAY) },
    { id: uid('j'), team_id: 'tA', user_id: 'u18', message: '', created_at: iso(now - 2 * DAY) },
  ];
  const invites = [];
  const feedback = [
    { id: uid('f'), user_id: 'u5', kind: 'idea', body: 'Könnten wir eine Kalender-Export-Funktion bekommen?', done: false, created_at: iso(now - DAY) },
    { id: uid('f'), user_id: 'u8', kind: 'problem', body: 'Die Push-Nachricht kam bei mir doppelt an.', done: false, created_at: iso(now - 2 * DAY) },
  ];
  return { profiles, teams, team_members, roles, member_roles, position_types, preferences, events, positions, shifts, assignments, availability, tasks, messages, polls, poll_options, poll_votes, notices, guest_links, event_guests, join_requests, invites, feedback };
}

// ---------- Zustand (persistiert) ----------
let db, state;
function load() {
  let fresh = false;
  try {
    const raw = localStorage.getItem(K_DB);
    if (raw) { db = JSON.parse(raw); } else { db = seed(); fresh = true; }
  } catch (e) { db = seed(); fresh = true; }
  let me = 'u1'; let s = {};
  try { me = localStorage.getItem(K_ME) || 'u1'; } catch (e) { /* */ }
  try { s = JSON.parse(localStorage.getItem(K_SEEN) || '{}'); } catch (e) { s = {}; }
  state = { me, seen: s };
  if (!db.profiles.some((p) => p.id === state.me)) state.me = 'u1';
  // Startzustand sofort persistieren, damit zufällige ids stabil bleiben und ab jetzt alles gespeichert wird
  if (fresh) save();
}
function save() {
  try {
    localStorage.setItem(K_DB, JSON.stringify(db));
    localStorage.setItem(K_ME, state.me);
    localStorage.setItem(K_SEEN, JSON.stringify(state.seen));
  } catch (e) { /* */ }
}
export function resetDemo() { try { [K_DB, K_ME, K_SEEN].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ } location.reload(); }
export function demoViewer() { load(); return state.me; }
export function demoPeople() { load(); return db.profiles.filter((p) => !p.is_guest).map((p) => ({ id: p.id, name: p.display_name })); }
export function demoTeamsAndGroups() {
  load();
  return {
    teams: db.teams.map((t) => ({ id: t.id, name: t.name })),
    groups: db.positions.map((p) => ({ id: p.id, name: p.name, event: (db.events.find((e) => e.id === p.event_id) || {}).title })),
    people: db.profiles.map((p) => ({ id: p.id, name: p.display_name, guest: p.is_guest })),
  };
}
export function setViewer(id) { load(); state.me = id; save(); location.reload(); }
export function renameEntity(kind, id, name) {
  load();
  const t = { person: ['profiles', 'display_name'], team: ['teams', 'name'], group: ['positions', 'name'] }[kind];
  if (!t) return;
  const row = db[t[0]].find((r) => r.id === id);
  if (row) { row[t[1]] = name; save(); }
}

// ---------- Abfrage-Engine ----------
const rel = { shifts: ['shifts', 'shift_id'], profiles: ['profiles', 'user_id'], teams: ['teams', 'team_id'], events: ['events', 'event_id'], positions: ['positions', 'position_id'] };
const childRel = { poll_options: 'poll_id', poll_votes: 'option_id' };
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
// Löschen wie in der echten Datenbank: Kinder kaskadieren, damit danach wirklich nichts übrig bleibt
const CASCADE = {
  teams: [['events', 'team_id'], ['position_types', 'team_id'], ['preferences', 'team_id'], ['roles', 'team_id'], ['member_roles', 'team_id'], ['team_members', 'team_id'], ['join_requests', 'team_id'], ['invites', 'team_id'], ['notices', 'team_id'], ['polls', 'team_id'], ['poll_options', 'team_id'], ['poll_votes', 'team_id'], ['guest_links', 'team_id'], ['assignments', 'team_id'], ['shifts', 'team_id'], ['positions', 'team_id']],
  events: [['positions', 'event_id'], ['shifts', 'event_id'], ['assignments', 'event_id'], ['tasks', 'event_id'], ['messages', 'event_id'], ['polls', 'event_id'], ['notices', 'event_id'], ['guest_links', 'event_id'], ['event_guests', 'event_id'], ['availability', 'event_id']],
  positions: [['shifts', 'position_id'], ['assignments', 'position_id'], ['tasks', 'position_id'], ['messages', 'position_id'], ['polls', 'position_id'], ['notices', 'position_id'], ['guest_links', 'position_id'], ['event_guests', 'position_id']],
  polls: [['poll_options', 'poll_id'], ['poll_votes', 'poll_id']],
  position_types: [['preferences', 'position_type_id']],
};
function cascadeDelete(table, ids) {
  if (!ids.length) return;
  (CASCADE[table] || []).forEach(([child, key]) => {
    const rows = (db[child] || []).filter((r) => ids.includes(r[key]));
    if (!rows.length) return;
    const childIds = rows.map((r) => r.id).filter((x) => x != null);
    db[child] = db[child].filter((r) => !ids.includes(r[key]));
    cascadeDelete(child, childIds);
  });
}
function embed(row, sel) {
  const r = Object.assign({}, row);
  splitTop(sel || '*').forEach((part) => {
    const m = part.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/);
    if (!m) return;
    const [, alias, name, fk, inner] = m;
    if (childRel[name]) { r[alias || name] = (db[name] || []).filter((x) => x[childRel[name]] === row.id).map((x) => embed(x, inner)); return; }
    const [table, col] = rel[name] || [name, 'id'];
    let key = col;
    if (fk && /done_by/.test(fk)) key = 'done_by';
    else if (fk && /assignee/.test(fk)) key = 'assignee';
    const target = (db[table] || []).find((x) => x.id === row[key]);
    r[alias || name] = target ? embed(target, inner) : null;
  });
  return r;
}
function builder(table) {
  const st = { filters: [], orders: [], op: 'select', sel: '*', retSel: '*', payload: null, lim: null };
  const b = {
    select(s, o) { if (st.op === 'select') st.sel = s || '*'; else st.retSel = s || '*'; return b; },
    eq(c, v) { if (!c.includes('.')) st.filters.push((r) => r[c] === v); return b; },
    neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
    in(c, v) { st.filters.push((r) => v.includes(r[c])); return b; },
    is(c, v) { st.filters.push((r) => (r[c] == null) === (v === null)); return b; },
    gte(c, v) { if (!c.includes('.')) st.filters.push((r) => r[c] >= v); return b; },
    lte(c, v) { if (!c.includes('.')) st.filters.push((r) => r[c] <= v); return b; },
    match(o) { Object.entries(o).forEach(([c, v]) => st.filters.push((r) => r[c] === v)); return b; },
    order(c, o) { st.orders.push({ c, dir: o && o.ascending === false ? -1 : 1, nf: !!(o && o.nullsFirst) }); return b; },
    nullsFirst() { return b; },
    limit(n) { st.lim = n; return b; },
    insert(rows) { st.op = 'insert'; st.payload = [].concat(rows); return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    upsert(rows) { st.op = 'insert'; st.payload = [].concat(rows); return b; },
    delete() { st.op = 'delete'; return b; },
    then(res, rej) {
      const all = db[table] || (db[table] = []);
      let data;
      if (st.op === 'select') {
        data = all.filter((r) => st.filters.every((f) => f(r)));
        if (st.orders.length) {
          data = data.slice().sort((a, x) => {
            for (const o of st.orders) {
              let av = a[o.c], xv = x[o.c];
              if (av == null && xv == null) continue;
              if (av == null) return o.nf ? -1 : 1;
              if (xv == null) return o.nf ? 1 : -1;
              if (av < xv) return -1 * o.dir; if (av > xv) return 1 * o.dir;
            }
            return 0;
          });
        }
        if (st.lim) data = data.slice(0, st.lim);
        data = data.map((r) => embed(r, st.sel));
      } else if (st.op === 'insert') {
        data = st.payload.map((p) => { const r = Object.assign({ id: uid('d'), created_at: iso(Date.now()), updated_at: iso(Date.now()) }, p); all.push(r); return embed(r, st.retSel); });
        save();
      } else if (st.op === 'update') {
        data = all.filter((r) => st.filters.every((f) => f(r))); data.forEach((r) => Object.assign(r, st.payload, { updated_at: iso(Date.now()) })); data = data.map((r) => embed(r, st.retSel)); save();
      } else {
        data = all.filter((r) => st.filters.every((f) => f(r)));
        const ids = data.map((r) => r.id).filter((x) => x != null);
        db[table] = all.filter((r) => !data.includes(r));
        if (table === 'position_types') db.positions.forEach((p) => { if (ids.includes(p.position_type_id)) p.position_type_id = null; });
        cascadeDelete(table, ids);
        save();
      }
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}

// ---------- Rechte & Hilfen ----------
function permsOf(me, team) {
  const tm = db.team_members.find((m) => m.team_id === team && m.user_id === me);
  if (!tm) return [];
  if (tm.is_owner) return ALLPERMS.slice();
  const rids = db.member_roles.filter((x) => x.team_id === team && x.user_id === me).map((x) => x.role_id);
  const set = new Set();
  db.roles.filter((r) => rids.includes(r.id)).forEach((r) => (r.permissions || []).forEach((p) => set.add(p)));
  return [...set];
}
const isGroupMember = (me, pos) => db.assignments.some((a) => a.position_id === pos && a.user_id === me && ACTIVE.includes(a.status)) || db.event_guests.some((g) => g.position_id === pos && g.user_id === me);
function canSeeGroup(me, pos) { const p = db.positions.find((x) => x.id === pos); if (!p) return false; return isGroupMember(me, pos) || permsOf(me, p.team_id).includes('events.manage'); }
const teamName = (id) => (db.teams.find((t) => t.id === id) || {}).name;
const eventTitle = (id) => (db.events.find((e) => e.id === id) || {}).title;
const posName = (id) => (db.positions.find((p) => p.id === id) || {}).name;
const seenAt = (sc, ref) => state.seen[state.me + ':' + sc + ':' + ref] || iso(now - 14 * DAY);

function computeUnread() {
  const me = state.me, out = [];
  const myTeams = db.team_members.filter((m) => m.user_id === me).map((m) => m.team_id);
  const evs = db.events.filter((e) => myTeams.includes(e.team_id));
  const grps = db.positions.filter((p) => isGroupMember(me, p.id));
  const push = (scope, ref, event_id, team_id, n) => { if (n > 0) out.push({ scope, ref, event_id, team_id, n }); };
  evs.forEach((e) => {
    push('event_chat', e.id, e.id, e.team_id, db.messages.filter((m) => m.event_id === e.id && !m.position_id && m.user_id !== me && m.created_at > seenAt('event_chat', e.id)).length);
    push('event_polls', e.id, e.id, e.team_id, db.polls.filter((p) => p.event_id === e.id && !p.position_id && p.created_by !== me && p.created_at > seenAt('event_polls', e.id)).length);
    push('event_board', e.id, e.id, e.team_id, db.notices.filter((n) => n.event_id === e.id && !n.position_id && n.created_by !== me && n.created_at > seenAt('event_board', e.id)).length);
  });
  grps.forEach((p) => {
    push('group_chat', p.id, p.event_id, p.team_id, db.messages.filter((m) => m.position_id === p.id && m.user_id !== me && m.created_at > seenAt('group_chat', p.id)).length);
    push('group_tasks', p.id, p.event_id, p.team_id, db.tasks.filter((t) => t.position_id === p.id && ((t.created_at > seenAt('group_tasks', p.id) && t.created_by !== me) || (t.done && t.done_at > seenAt('group_tasks', p.id) && t.done_by !== me))).length);
    push('group_polls', p.id, p.event_id, p.team_id, db.polls.filter((pl) => pl.position_id === p.id && pl.created_by !== me && pl.created_at > seenAt('group_polls', p.id)).length);
    push('group_board', p.id, p.event_id, p.team_id, db.notices.filter((n) => n.position_id === p.id && n.created_by !== me && n.created_at > seenAt('group_board', p.id)).length);
  });
  myTeams.forEach((tid) => push('team_board', tid, null, tid, db.notices.filter((n) => n.team_id === tid && !n.event_id && !n.position_id && n.created_by !== me && n.created_at > seenAt('team_board', tid)).length));
  return out;
}

// ---------- RPCs ----------
const nextVotes = (opt, me, poll) => {
  const existing = db.poll_votes.find((v) => v.option_id === opt && v.user_id === me);
  if (existing) { db.poll_votes = db.poll_votes.filter((v) => v !== existing); return; }
  if (!poll.multiple) db.poll_votes = db.poll_votes.filter((v) => !(v.poll_id === poll.id && v.user_id === me));
  db.poll_votes.push({ id: uid('v'), poll_id: poll.id, option_id: opt, team_id: poll.team_id, user_id: me });
};
const RPC = {
  my_permissions: (a) => permsOf(state.me, a.t),
  can_see_group: (a) => canSeeGroup(state.me, a.pos),
  room_members: (a) => {
    const ev = a.ev, pos = a.pos;
    const ids = new Set();
    db.team_members.filter((m) => db.events.some((e) => e.id === ev && e.team_id === m.team_id)).forEach((m) => ids.add(m.user_id));
    db.event_guests.filter((g) => g.event_id === ev).forEach((g) => ids.add(g.user_id));
    let list = db.profiles.filter((p) => ids.has(p.id));
    if (pos) list = list.filter((p) => isGroupMember(p.id, pos) || permsOf(p.id, (db.positions.find((x) => x.id === pos) || {}).team_id).includes('events.manage'));
    return list.map((p) => ({ id: p.id, display_name: p.display_name, pronouns: p.pronouns, pronouns_custom: p.pronouns_custom, is_guest: p.is_guest, bio: p.bio }));
  },
  my_unread: () => computeUnread(),
  my_news: () => computeUnread().map((x) => ({ scope: x.scope, team_id: x.team_id, event_id: x.event_id, position_id: x.scope.startsWith('group') ? x.ref : null, team_name: teamName(x.team_id), event_title: x.event_id ? eventTitle(x.event_id) : null, group_name: x.scope.startsWith('group') ? posName(x.ref) : null, n: x.n })),
  mark_seen: (a) => { state.seen[state.me + ':' + a.sc + ':' + a.r] = iso(Date.now()); save(); return null; },
  search_teams: (a) => db.teams.map((t) => ({ id: t.id, name: t.name, description: t.description, color: t.color, member_count: db.team_members.filter((m) => m.team_id === t.id).length, is_member: db.team_members.some((m) => m.team_id === t.id && m.user_id === state.me), requested: db.join_requests.some((j) => j.team_id === t.id && j.user_id === state.me) })),
  my_join_requests: () => db.join_requests.filter((j) => j.user_id === state.me).map((j) => ({ id: j.id, team_id: j.team_id, team_name: teamName(j.team_id), team_color: (db.teams.find((t) => t.id === j.team_id) || {}).color, created_at: j.created_at })),
  request_join: (a) => { db.join_requests.push({ id: uid('j'), team_id: a.t, user_id: state.me, message: a.msg || '', created_at: iso(Date.now()) }); save(); return null; },
  approve_join_request: (a) => { const j = db.join_requests.find((x) => x.id === a.req); if (j) { if (!db.team_members.some((m) => m.team_id === j.team_id && m.user_id === j.user_id)) db.team_members.push({ team_id: j.team_id, user_id: j.user_id, is_owner: false, joined_at: iso(Date.now()) }); db.join_requests = db.join_requests.filter((x) => x !== j); save(); } return null; },
  transfer_ownership: (a) => { db.team_members.filter((m) => m.team_id === a.t).forEach((m) => { m.is_owner = m.user_id === a.new_owner; }); save(); return null; },
  remove_guest: (a) => { db.event_guests = db.event_guests.filter((g) => !(g.user_id === a.uid && db.events.some((e) => e.id === g.event_id && e.team_id === a.t))); save(); return null; },
  signup_shift: (a) => {
    const s = db.shifts.find((x) => x.id === a.sh); if (!s) throw new Error('not found');
    const used = db.assignments.filter((x) => x.shift_id === a.sh && ACTIVE.includes(x.status)).length;
    const stt = used < s.slots ? 'confirmed' : 'waitlist';
    const ex = db.assignments.find((x) => x.shift_id === a.sh && x.user_id === state.me);
    if (ex) { ex.status = stt; ex.source = 'self'; } else db.assignments.push({ id: uid('a'), shift_id: a.sh, position_id: s.position_id, event_id: s.event_id, team_id: s.team_id, user_id: state.me, status: stt, note: '', source: 'self', created_at: iso(Date.now()) });
    save(); return stt;
  },
  assign_person: (a) => {
    const s = db.shifts.find((x) => x.id === a.sh); if (!s) throw new Error('not found');
    const bind = (db.events.find((e) => e.id === s.event_id) || {}).binding;
    const stt = (bind || a.want_confirmed) ? 'confirmed' : 'proposed';
    const ex = db.assignments.find((x) => x.shift_id === a.sh && x.user_id === a.uid);
    if (ex) { ex.status = stt; ex.source = 'manual'; ex.note = ''; } else db.assignments.push({ id: uid('a'), shift_id: a.sh, position_id: s.position_id, event_id: s.event_id, team_id: s.team_id, user_id: a.uid, status: stt, note: '', source: 'manual', notified_at: iso(Date.now()), created_at: iso(Date.now()) });
    save(); return stt;
  },
  respond_assignment: (a) => {
    const cur = db.assignments.find((x) => x.id === a.a && x.user_id === state.me); if (!cur) throw new Error('not found');
    if (cur.status === 'waitlist') { if (a.new_status === 'declined') db.assignments = db.assignments.filter((x) => x !== cur); save(); return null; }
    if ((db.events.find((e) => e.id === cur.event_id) || {}).binding) throw new Error('assignment is binding');
    cur.status = a.new_status; cur.note = (a.msg || '').slice(0, 500); save(); return null;
  },
  set_group_deadline: (a) => { const p = db.positions.find((x) => x.id === a.pos); if (p) { p.deadline = a.dl; p.remind_at = a.dl ? a.remind : null; save(); } return null; },
  create_poll: (a) => {
    const pid = uid('pl'); const tid = a.pos ? (db.positions.find((p) => p.id === a.pos) || {}).team_id : (db.events.find((e) => e.id === a.ev) || {}).team_id;
    db.polls.push({ id: pid, event_id: a.pos ? (db.positions.find((p) => p.id === a.pos) || {}).event_id : a.ev, team_id: tid, position_id: a.pos || null, question: (a.question || '').trim(), multiple: !!a.multiple, allow_add: !!a.allow_add, closed: false, created_by: state.me, created_at: iso(Date.now()) });
    (a.options || []).forEach((o, i) => { if (o && o.trim()) db.poll_options.push({ id: uid('o'), poll_id: pid, team_id: tid, text: o.trim(), sort: i, created_by: state.me }); });
    save(); return pid;
  },
  add_poll_option: (a) => { const pl = db.polls.find((p) => p.id === a.p); if (pl && !pl.closed) { const mx = Math.max(-1, ...db.poll_options.filter((o) => o.poll_id === a.p).map((o) => o.sort)); db.poll_options.push({ id: uid('o'), poll_id: a.p, team_id: pl.team_id, text: (a.otext || '').trim(), sort: mx + 1, created_by: state.me }); save(); } return null; },
  poll_vote: (a) => { const o = db.poll_options.find((x) => x.id === a.opt); if (!o) throw new Error('not found'); const pl = db.polls.find((p) => p.id === o.poll_id); if (pl.closed) throw new Error('poll closed'); nextVotes(a.opt, state.me, pl); save(); return null; },
  set_poll_closed: (a) => { const pl = db.polls.find((p) => p.id === a.p); if (pl) { pl.closed = !!a.c; save(); } return null; },
  delete_poll: (a) => { db.polls = db.polls.filter((p) => p.id !== a.p); db.poll_options = db.poll_options.filter((o) => o.poll_id !== a.p); db.poll_votes = db.poll_votes.filter((v) => v.poll_id !== a.p); save(); return null; },
  clone_event: (a) => {
    const e = db.events.find((x) => x.id === a.src); if (!e) throw new Error('not found');
    const nid = uid('e'); const delta = a.new_start ? (new Date(a.new_start).getTime() - new Date(e.starts_at).getTime()) : 0;
    db.events.push(Object.assign({}, e, { id: nid, title: (a.new_title || e.title).trim(), starts_at: a.new_start, ends_at: a.new_end, respond_by: null, created_at: iso(Date.now()) }));
    db.positions.filter((p) => p.event_id === a.src).forEach((p) => {
      const np = uid('p');
      db.positions.push(Object.assign({}, p, { id: np, event_id: nid, deadline: p.deadline ? iso(new Date(p.deadline).getTime() + delta) : null, remind_at: p.remind_at ? iso(new Date(p.remind_at).getTime() + delta) : null, reminder_sent_at: null, created_at: iso(Date.now()) }));
      db.shifts.filter((sh) => sh.position_id === p.id).forEach((sh) => db.shifts.push(Object.assign({}, sh, { id: uid('s'), position_id: np, event_id: nid, starts_at: sh.starts_at ? iso(new Date(sh.starts_at).getTime() + delta) : null, ends_at: sh.ends_at ? iso(new Date(sh.ends_at).getTime() + delta) : null })));
    });
    save(); return nid;
  },
  create_team: (a) => { const tid = uid('t'); db.teams.push({ id: tid, name: a.p_name, description: a.p_description || '', color: a.p_color || '#7c5cff', discoverable: false, binding: false }); db.team_members.push({ team_id: tid, user_id: state.me, is_owner: true, joined_at: iso(Date.now()) }); try { (JSON.parse(a.p_roles) || []).forEach((r, i) => db.roles.push({ id: uid('r'), team_id: tid, name: r.name, color: r.color || '#7c5cff', permissions: r.permissions || [], sort: i })); } catch (e) { /* */ } save(); return tid; },
  send_event_mails: () => db.assignments.filter((x) => ACTIVE.includes(x.status)).length,
  queue_event_mails: () => 0,
  send_feedback: (a) => { db.feedback.push({ id: uid('f'), user_id: state.me, kind: a.k || 'other', body: a.b || '', done: false, created_at: iso(Date.now()) }); save(); return null; },
  admin_feedback: () => db.feedback.map((f) => ({ id: f.id, kind: f.kind, body: f.body, done: f.done, created_at: f.created_at, name: (db.profiles.find((p) => p.id === f.user_id) || {}).display_name })),
  admin_feedback_done: (a) => { const f = db.feedback.find((x) => x.id === a.f); if (f) { f.done = !!a.d; save(); } return null; },
  is_app_admin: () => state.me === 'u1',
  can_demo: () => false, // in der Demo keinen weiteren Demo-Knopf zeigen
  guest_link_info: (a) => { const l = db.guest_links.find((x) => x.token === (a.tok || '').toLowerCase()); if (!l) return []; return [{ kind: l.position_id ? 'group' : 'event', team_name: teamName(l.team_id), event_title: eventTitle(l.event_id), event_start: (db.events.find((e) => e.id === l.event_id) || {}).starts_at, group_name: posName(l.position_id), active: l.active }]; },
  invite_info: () => [],
  accept_invite: () => null, redeem_guest_link: () => [{ ok: false, ev: null, pos: null }], send_invite_mail: () => null,
  unsubscribe: () => true, save_push_subscription: () => null, queue_test_push: () => true,
  push_status: () => ({ key: true, enabled: true, devices: 1, cron_status: 200, cron_error: null, last: iso(now) }),
  push_public_key: () => '',
};

// ---------- Client ----------
export function makeDemoClient() {
  load();
  const sessionUser = () => { const p = db.profiles.find((x) => x.id === state.me) || db.profiles[0]; return { id: p.id, email: 'demo@local', is_anonymous: false, user_metadata: { display_name: p.display_name } }; };
  return {
    from: builder,
    rpc: (fn, args) => Promise.resolve({ data: RPC[fn] ? RPC[fn](args || {}) : null, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: sessionUser(), access_token: 'demo' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: () => Promise.resolve({ error: { message: 'Demo' } }),
      signUp: () => Promise.resolve({ data: { session: null }, error: null }),
      signOut: () => { disableDemo(); setTimeout(() => { location.hash = '#/login'; location.reload(); }, 0); return Promise.resolve({}); },
      updateUser: () => Promise.resolve({ error: null }),
      resetPasswordForEmail: () => Promise.resolve({ error: null }),
      signInAnonymously: () => Promise.resolve({ error: null }),
    },
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    removeChannel() {},
    functions: { invoke: (n) => Promise.resolve({ data: n === 'push' ? { sent: 1, failed: 0, devices: 1, errors: [] } : {}, error: null }) },
  };
}
