// Sprachen: die 20 meistgesprochenen Sprachen Europas
export const LANGS = [
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'pt', name: 'Português', locale: 'pt-PT' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL' },
  { code: 'uk', name: 'Українська', locale: 'uk-UA' },
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'ro', name: 'Română', locale: 'ro-RO' },
  { code: 'tr', name: 'Türkçe', locale: 'tr-TR' },
  { code: 'el', name: 'Ελληνικά', locale: 'el-GR' },
  { code: 'hu', name: 'Magyar', locale: 'hu-HU' },
  { code: 'cs', name: 'Čeština', locale: 'cs-CZ' },
  { code: 'sv', name: 'Svenska', locale: 'sv-SE' },
  { code: 'bg', name: 'Български', locale: 'bg-BG' },
  { code: 'sr', name: 'Srpski', locale: 'sr-Latn-RS' },
  { code: 'da', name: 'Dansk', locale: 'da-DK' },
  { code: 'fi', name: 'Suomi', locale: 'fi-FI' },
];

const cache = {};
let dict = {};
let english = {};
let current = 'de';

async function fetchLang(code) {
  if (!cache[code]) cache[code] = import(`../../i18n/${code}.js`).then((m) => m.default);
  return cache[code];
}

export function pickLanguage(wanted) {
  if (wanted && LANGS.some((l) => l.code === wanted)) return wanted;
  const nav = (navigator.languages || [navigator.language || 'de']).map((x) => String(x).slice(0, 2).toLowerCase());
  const hit = nav.find((c) => LANGS.some((l) => l.code === c));
  return hit || (window.TP_CONFIG && window.TP_CONFIG.defaultLanguage) || 'de';
}

export async function setLanguage(code) {
  code = pickLanguage(code);
  const [d, en] = await Promise.all([fetchLang(code), fetchLang('en')]);
  dict = d;
  english = en;
  current = code;
  document.documentElement.lang = code;
  try { localStorage.setItem('tp.lang', code); } catch (e) { /* ohne Speicher */ }
  return code;
}

export function lang() { return current; }
export function locale() { return (LANGS.find((l) => l.code === current) || LANGS[0]).locale; }

// Text holen; {name} wird ersetzt
export function t(key, vars) {
  let s = dict[key];
  if (s == null) s = english[key];
  if (s == null) s = key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}

// Pronomen: in der eingestellten Sprache und auf Englisch
export const PRONOUNS = ['she', 'he', 'they', 'she_they', 'he_they', 'any', 'name_only'];

export function pronounText(p) {
  if (!p) return '';
  if (p.pronouns === 'custom') return (p.pronouns_custom || '').trim();
  if (!p.pronouns) return '';
  const key = 'pron.' + p.pronouns;
  const local = dict[key] || english[key] || '';
  const en = english[key] || '';
  if (current === 'en' || !en || local === en) return local;
  return `${local} · ${en}`;
}

// Datum und Uhrzeit
const fmt = (opts) => new Intl.DateTimeFormat(locale(), opts);
export const fmtDate = (d) => (d ? fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '');
export const fmtTime = (d) => (d ? fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '');
export const fmtDay = (d) => fmt({ day: 'numeric' }).format(new Date(d));
export const fmtMonth = (d) => fmt({ month: 'short' }).format(new Date(d));
export const fmtLongDay = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));

export function fmtRange(a, b) {
  if (!a) return '';
  if (!b) return fmtDateTime(a);
  const sameDay = new Date(a).toDateString() === new Date(b).toDateString();
  return sameDay ? `${fmtDateTime(a)} – ${fmtTime(b)}` : `${fmtDateTime(a)} – ${fmtDateTime(b)}`;
}

export function fmtRelative(d) {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

// <input type="datetime-local"> <-> ISO
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}
