// Gemeinsamer Zustand der App (Anmeldung, Profil, Teams, Meldungen, Dialoge)
import { useEffect, useReducer, useRef } from './h.js';
import { sb, q } from './sb.js';
import { t } from './i18n.js';

const state = {
  ready: false,
  session: null,
  user: null,
  profile: null,
  teams: [], // [{ team_id, is_owner, teams: {...} }]
  toasts: [],
  dialog: null,
  langVersion: 0,
};

const subs = new Set();
let version = 0;

export const getState = () => state;

export function setState(patch) {
  Object.assign(state, patch);
  version++;
  subs.forEach((f) => f());
}

export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  const seen = useRef(version);
  seen.current = version;
  useEffect(() => {
    subs.add(force);
    // Änderungen zwischen Zeichnen und Anmelden nicht verpassen
    if (seen.current !== version) force();
    return () => subs.delete(force);
  }, []);
  return state;
}

export const isGuest = () => !!(state.user && (state.user.is_anonymous || (state.profile && state.profile.is_guest)));

// ---------- Meldungen ----------
let toastId = 0;
export function toast(text, kind = 'ok') {
  const id = ++toastId;
  setState({ toasts: [...state.toasts, { id, text, kind }] });
  setTimeout(() => setState({ toasts: state.toasts.filter((x) => x.id !== id) }), kind === 'error' ? 6000 : 3200);
}

export function errText(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/not allowed|row-level security|permission denied/i.test(m)) return t('err.not_allowed');
  if (/invite invalid/i.test(m)) return t('err.invite_invalid');
  if (/link invalid/i.test(m)) return t('err.link_invalid');
  if (/too many attempts/i.test(m)) return t('err.too_many');
  if (/cannot grant/i.test(m)) return t('err.cannot_grant');
  if (/Invalid login credentials/i.test(m)) return t('err.login');
  if (/already registered|already been registered/i.test(m)) return t('err.exists');
  if (/Email not confirmed/i.test(m)) return t('err.not_confirmed');
  if (/Password should|weak.password|at least/i.test(m)) return t('err.password');
  if (/duplicate key|unique/i.test(m)) return t('err.duplicate');
  if (/check constraint|violates check/i.test(m)) return t('err.invalid');
  if (/rate limit|too many requests/i.test(m)) return t('err.rate');
  if (/Anonymous sign-ins are disabled/i.test(m)) return t('err.anon_disabled');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return t('err.network');
  return t('err.generic') + (m ? ` (${m})` : '');
}

export function toastError(e) {
  console.error(e);
  toast(errText(e), 'error');
}

// ---------- Dialoge (Bestätigen / Eingabe) ----------
export function confirmDialog(opts) {
  return new Promise((resolve) => setState({ dialog: { type: 'confirm', ...opts, resolve } }));
}
export function promptDialog(opts) {
  return new Promise((resolve) => setState({ dialog: { type: 'prompt', ...opts, resolve } }));
}
export function closeDialog(value) {
  const d = state.dialog;
  setState({ dialog: null });
  if (d && d.resolve) d.resolve(value);
}

// ---------- Profil und Teams ----------
export async function loadProfile() {
  if (!state.user) return null;
  const rows = await q(sb.from('profiles').select('*').eq('id', state.user.id).limit(1));
  setState({ profile: rows[0] || null });
  return rows[0] || null;
}

export async function loadTeams() {
  if (!state.user) return setState({ teams: [] });
  const rows = await q(
    sb.from('team_members').select('team_id, is_owner, teams(id, name, color, description)').eq('user_id', state.user.id)
  );
  rows.sort((a, b) => String(a.teams && a.teams.name).localeCompare(String(b.teams && b.teams.name)));
  setState({ teams: rows.filter((r) => r.teams) });
}

// ---------- Darstellung ----------
export function applyTheme(theme) {
  const v = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = v;
  try { localStorage.setItem('tp.theme', v); } catch (e) { /* ohne Speicher */ }
  const dark = v === 'dark' || (v === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#13111f' : '#fff7f0');
}
