// Verbindung zu Supabase
const cfg = window.TP_CONFIG || {};

export const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);

export const sb = configured
  ? window.supabase.createClient(cfg.supabaseUrl.replace(/\/+$/, ''), cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Ergebnis einer Abfrage holen oder Fehler werfen
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}

export const rpc = (fn, args) => q(sb.rpc(fn, args || {}));

// Adresse der App (für Links in E-Mails, Einladungen, Gästelinks)
export function appBase() {
  if (cfg.appUrl) return cfg.appUrl.replace(/\/?$/, '/');
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}
export const appLink = (hashPath) => appBase() + '#' + hashPath;

// E-Mails verschickt die Datenbank sofort selbst. Hier werden nur wartende
// Push-Nachrichten angestoßen (Edge Function "push").
export async function flushMail() {
  const { flushPush } = await import('./push.js');
  await flushPush();
}

export const PERMISSIONS = [
  'team.edit', 'members.manage', 'invites.create', 'roles.manage',
  'positions.manage', 'events.manage', 'guests.manage', 'chat.moderate',
];

export const ACTIVE = ['proposed', 'confirmed', 'uncertain'];
