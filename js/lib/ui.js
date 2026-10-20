// Wiederverwendbare Bausteine der Oberfläche
import { html, useState, useEffect, useRef, useCallback } from './h.js';
import { t, pronounText, LANGS, setLanguage, lang } from './i18n.js';
import { sb } from './sb.js';
import { useStore, setState, getState, closeDialog, applyTheme, toast } from './store.js';

// ---------- Symbole (nach Feather Icons, MIT-Lizenz) ----------
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M12.2 6.2L11 5M3 21l9-9"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  tasks: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
};

export function Icon({ name, size = 20, className = '' }) {
  return html`<svg class=${'ico ' + className} width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export function BrandMark({ size = 22 }) {
  return html`<span class="brand-mark"><svg width=${size} height=${size} viewBox="0 0 64 64" fill="#fff" aria-hidden="true"><circle cx="23" cy="22" r="7" opacity=".75"/><path d="M9 48c0-8.3 6.3-14 14-14s14 5.7 14 14v2H9z" opacity=".75"/><circle cx="40" cy="25" r="8"/><path d="M24 52c0-9.4 7.2-16 16-16s16 6.6 16 16v2H24z"/></svg></span>`;
}

export const appName = () => (window.TP_CONFIG && window.TP_CONFIG.appName) || 'Teamplaner';

// ---------- Farben ----------
export const PALETTE = ['#7c5cff', '#ff4f8b', '#ff9f2e', '#f5b800', '#12b8a6', '#2f9bff', '#3ad17a', '#e5484d', '#a855f7', '#0ea5e9'];

export function colorFor(s) {
  let h = 0;
  const str = String(s || '?');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function Swatches({ value, onChange }) {
  return html`<div class="swatches">${PALETTE.map((c) => html`
    <button type="button" class=${'swatch' + (c === value ? ' on' : '')} style=${{ background: c }}
      aria-label=${c} aria-pressed=${c === value} onClick=${() => onChange(c)}></button>`)}</div>`;
}

// ---------- Personen ----------
export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ profile, name, size = '' }) {
  const n = name || (profile && profile.display_name) || '?';
  return html`<span class=${'avatar ' + size} style=${{ background: colorFor((profile && profile.id) || n) }}>${initials(n)}</span>`;
}

// Personen-Kachel: erscheint nach 1 Sekunde Hovern (am Handy: antippen)
// und zeigt Name, Gast-Status und Pronomen.
let closeOpenCard = null;

export function PersonHover({ profile, guest, children, className = '' }) {
  const [card, setCard] = useState(null);
  const ref = useRef();
  const timer = useRef();
  const pointer = useRef('mouse');
  const p = profile || {};

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 260;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 170 < window.innerHeight;
    if (closeOpenCard) closeOpenCard();
    closeOpenCard = () => setCard(null);
    setCard({ x, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setCard(null), 180); };
  const keep = () => clearTimeout(timer.current);

  useEffect(() => {
    if (!card) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setCard(null); };
    const esc = (e) => { if (e.key === 'Escape') setCard(null); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', hide, true);
    };
  }, [card]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pron = pronounText(p);
  return html`<span class=${'hover-wrap ' + className} ref=${ref}
    onPointerDown=${(e) => { pointer.current = e.pointerType; }}
    onPointerEnter=${(e) => { if (e.pointerType !== 'mouse') return; keep(); timer.current = setTimeout(show, 1000); }}
    onPointerLeave=${(e) => { if (e.pointerType === 'mouse') hide(); }}
    onClick=${(e) => { if (pointer.current !== 'mouse') { e.preventDefault(); e.stopPropagation(); card ? setCard(null) : show(); } }}>
    ${children}
    ${card && html`<div class=${'person-card' + (card.below ? '' : ' above')} role="tooltip"
        style=${{ left: card.x + 'px', top: card.y + 'px' }} onPointerEnter=${keep} onPointerLeave=${hide}
        onClick=${(e) => e.stopPropagation()}>
      <div class="row nowrap">
        <${Avatar} profile=${p} size="lg" />
        <div class="grow" style="min-width:0">
          <div class="pc-name">${p.display_name || '?'}</div>
          ${(guest || p.is_guest) && html`<span class="chip">${t('common.guest')}</span>`}
        </div>
      </div>
      <div class="pc-label">${t('profile.pronouns')}</div>
      <div class=${pron ? 'pc-pron' : 'faint small'}>${pron || t('profile.pronouns_none_shown')}</div>
    </div>`}
  </span>`;
}

export function Person({ profile, sub, size = 'sm', guest }) {
  const p = profile || {};
  return html`<div class="person">
    <${PersonHover} profile=${p} guest=${guest}><${Avatar} profile=${p} size=${size} /></${PersonHover}>
    <div class="who">
      <div class="name"><${PersonHover} profile=${p} guest=${guest}>${p.display_name || '?'}</${PersonHover}>
        ${guest || p.is_guest ? html` <span class="chip">${t('common.guest')}</span>` : ''}</div>
      ${sub ? html`<div class="small faint">${sub}</div>` : ''}
    </div>
  </div>`;
}

export function StatusBadge({ status }) {
  return html`<span class=${'badge st-' + status}>${t('status.' + status)}</span>`;
}

// ---------- Allgemein ----------
export function Spinner({ small }) {
  return html`<div class=${'spinner' + (small ? ' sm' : '')} role="status" aria-label=${t('common.loading')}></div>`;
}

export function Empty({ icon = 'star', title, text, children }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${28} /></div>
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p>${text}</p>`}
    ${children}
  </div>`;
}

export function ErrorBox({ error, onRetry }) {
  return html`<div class="card"><${Empty} icon="alert" title=${t('err.load')} text=${String((error && error.message) || error || '')}>
    ${onRetry && html`<button class="btn" onClick=${() => onRetry()}><${Icon} name="refresh" />${t('common.retry')}</button>`}
  <//></div>`;
}

export function PasswordInput({ value, onInput, autocomplete = 'current-password', minlength, required, placeholder, name }) {
  const [show, setShow] = useState(false);
  return html`<span class="pw-wrap">
    <input class="input" type=${show ? 'text' : 'password'} autocomplete=${autocomplete} minlength=${minlength}
      required=${required} placeholder=${placeholder} name=${name} value=${value} onInput=${onInput} />
    <button type="button" class="pw-eye" aria-pressed=${show} title=${t(show ? 'auth.pw_hide' : 'auth.pw_show')}
      aria-label=${t(show ? 'auth.pw_hide' : 'auth.pw_show')} onClick=${() => setShow((v) => !v)}>
      <${Icon} name=${show ? 'eyeOff' : 'eye'} size=${18} /></button>
  </span>`;
}

export function Field({ label, hint, children, className = '' }) {
  return html`<label class=${'field ' + className}><span class="label">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}

export function Modal({ title, onClose, children, footer, wide }) {
  const box = useRef();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    const first = box.current && box.current.querySelector('input:not([type=checkbox]), textarea, select');
    if (first && window.matchMedia('(min-width: 600px)').matches) first.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, []);
  return html`<div class="overlay" onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title} ref=${box}>
      <div class="modal-head"><h2>${title}</h2>
        ${onClose && html`<button class="btn icon" onClick=${onClose} aria-label=${t('common.close')}><${Icon} name="x" /></button>`}
      </div>
      <div class="modal-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </div>
  </div>`;
}

// Bestätigen-/Eingabe-Dialoge aus dem gemeinsamen Zustand
let dialogSeq = 0;
const dialogIds = new WeakMap();

export function DialogHost() {
  const { dialog } = useStore();
  if (!dialog) return null;
  if (!dialogIds.has(dialog)) dialogIds.set(dialog, ++dialogSeq);
  if (dialog.type === 'confirm') {
    return html`<${Modal} title=${dialog.title} onClose=${() => closeDialog(false)} footer=${html`
      <button class="btn ghost" onClick=${() => closeDialog(false)}>${t('common.cancel')}</button>
      <button class=${'btn ' + (dialog.danger ? 'danger' : 'primary')} onClick=${() => closeDialog(true)}>${dialog.ok || t('common.ok')}</button>`}>
      <p class="pre">${dialog.text}</p>
    <//>`;
  }
  return html`<${PromptDialog} dialog=${dialog} key=${dialogIds.get(dialog)} />`;
}

function PromptDialog({ dialog }) {
  const [val, setVal] = useState(dialog.value || '');
  const submit = (e) => { e && e.preventDefault(); if (dialog.required && !val.trim()) return; closeDialog(val); };
  return html`<${Modal} title=${dialog.title} onClose=${() => closeDialog(null)} footer=${html`
    <button class="btn ghost" onClick=${() => closeDialog(null)}>${t('common.cancel')}</button>
    <button class="btn primary" onClick=${submit}>${dialog.ok || t('common.ok')}</button>`}>
    <form onSubmit=${submit} class="stack">
      ${dialog.text && html`<p class="muted">${dialog.text}</p>`}
      <${Field} label=${dialog.label || ''}>
        ${dialog.multiline
          ? html`<textarea class="input" value=${val} maxlength=${dialog.maxLength || 2000} onInput=${(e) => setVal(e.target.value)}></textarea>`
          : html`<input class="input" type=${dialog.inputType || 'text'} value=${val} maxlength=${dialog.maxLength || 200} onInput=${(e) => setVal(e.target.value)} />`}
      <//>
    </form>
  <//>`;
}

export function Toasts() {
  const { toasts } = useStore();
  return html`<div class="toasts" aria-live="polite">${toasts.map((x) => html`
    <div class=${'toast ' + (x.kind === 'error' ? 'error' : '')} key=${x.id}>
      <${Icon} name=${x.kind === 'error' ? 'alert' : 'check'} />${x.text}
    </div>`)}</div>`;
}

// Text direkt an Ort und Stelle ändern (alle Schriftfelder sind änderbar)
export function EditableText({ value, onSave, canEdit, multiline, placeholder, as = 'span', className = '', maxLength = 200, required = true }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setVal(value || ''); }, [value, editing]);
  const Tag = as;
  if (!editing) {
    const shown = value || (canEdit ? placeholder : '');
    if (!shown) return null;
    return html`<${Tag} class=${'editable ' + (canEdit ? 'can ' : '') + className + (multiline ? ' pre' : '')}
      tabIndex=${canEdit ? 0 : undefined} role=${canEdit ? 'button' : undefined}
      title=${canEdit ? t('common.click_to_edit') : undefined}
      onClick=${() => canEdit && setEditing(true)}
      onKeyDown=${(e) => { if (canEdit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditing(true); } }}>
      ${value ? value : html`<span class="faint">${placeholder}</span>`}${canEdit && html`<${Icon} name="edit" size=${14} className="pen" />`}
    <//>`;
  }
  const save = async () => {
    const v = val.trim();
    if (required && !v) return;
    if (v === (value || '')) return setEditing(false);
    setBusy(true);
    try { await onSave(v); setEditing(false); } catch (e) { /* Meldung kommt vom Aufrufer */ } finally { setBusy(false); }
  };
  return html`<div class="edit-inline">
    ${multiline
      ? html`<textarea class="input" value=${val} maxlength=${maxLength} onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => e.key === 'Escape' && setEditing(false)} ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus())}></textarea>`
      : html`<input class="input" value=${val} maxlength=${maxLength} onInput=${(e) => setVal(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus())} />`}
    <button class="btn small primary" disabled=${busy} onClick=${save}><${Icon} name="check" size=${16} />${t('common.save')}</button>
    <button class="btn small ghost" onClick=${() => setEditing(false)}>${t('common.cancel')}</button>
  </div>`;
}

export function CopyField({ value }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast(t('common.copied')); } catch (e) { window.prompt(t('common.copy'), value); }
  };
  return html`<div class="copy"><code title=${value}>${value}</code>
    <button class="btn small" onClick=${copy}><${Icon} name="copy" size=${16} />${t('common.copy')}</button></div>`;
}

// Rote Zahl für Ungelesenes
export function UnreadBadge({ n }) {
  if (!n) return null;
  return html`<span class="unread-badge" title=${t('unread.n', { n })} aria-label=${t('unread.n', { n })}>${n > 99 ? '99+' : n}</span>`;
}

export function Tabs({ base, active, items }) {
  return html`<nav class="tabs" role="tablist">${items.filter((x) => !x.hidden).map((x) => html`
    <a href=${'#' + base + '/' + x.key} role="tab" aria-selected=${x.key === active} class=${'tab' + (x.key === active ? ' active' : '')}>
      ${x.icon && html`<${Icon} name=${x.icon} size=${18} />`}${x.label}${x.count ? html`<span class="count">${x.count}</span>` : ''}<${UnreadBadge} n=${x.unread} />
    </a>`)}</nav>`;
}

export function Progress({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return html`<div class=${'progress' + (pct >= 100 ? ' full' : '')} role="progressbar" aria-valuenow=${value} aria-valuemax=${max}><i style=${{ width: pct + '%' }}></i></div>`;
}

// ---------- Daten laden ----------
export function useAsync(fn, deps) {
  const [st, set] = useState({ loading: true, data: null, error: null });
  const run = useRef(0);
  const reload = useCallback(async (silent) => {
    const id = ++run.current;
    if (!silent) set((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (id === run.current) set({ loading: false, data, error: null });
    } catch (error) {
      console.error(error);
      if (id === run.current) set({ loading: false, data: null, error });
    }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...st, reload, setData: (d) => set((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// Live-Aktualisierung über Supabase Realtime
export function useRealtime(key, tables, filter, onChange) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!key) return undefined;
    let timer = null;
    const fire = (payload) => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(payload), 250);
    };
    let ch = sb.channel(key + ':' + Math.random().toString(36).slice(2));
    tables.forEach((table) => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, fire);
    });
    ch.subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [key]);
}

// ---------- Sprache und Darstellung ----------
export async function changeLanguage(code) {
  await setLanguage(code);
  const s = getState();
  setState({ langVersion: s.langVersion + 1 });
  if (s.user && s.profile && s.profile.language !== code) {
    const { error } = await sb.from('profiles').update({ language: code }).eq('id', s.user.id);
    if (!error) setState({ profile: { ...s.profile, language: code } });
  }
}

export function LangSelect({ className = '' }) {
  useStore();
  return html`<label class=${'row nowrap ' + className} title=${t('profile.language')}>
    <span class="sr">${t('profile.language')}</span>
    <${Icon} name="globe" size=${18} />
    <select class="input lang-select" value=${lang()} onChange=${(e) => changeLanguage(e.target.value)}>
      ${LANGS.map((l) => html`<option value=${l.code}>${l.name}</option>`)}
    </select>
  </label>`;
}

export async function changeTheme(theme) {
  applyTheme(theme);
  const s = getState();
  setState({ themeVersion: Date.now() });
  if (s.user && s.profile && s.profile.theme !== theme) {
    const { error } = await sb.from('profiles').update({ theme }).eq('id', s.user.id);
    if (!error) setState({ profile: { ...s.profile, theme } });
  }
}

export function ThemeSwitch({ compact, iconsOnly }) {
  useStore();
  const cur = document.documentElement.dataset.theme || 'system';
  const opts = [['light', 'sun'], ['dark', 'moon'], ['system', 'monitor']];
  if (compact) {
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    const ic = opts.find((o) => o[0] === cur)[1];
    return html`<button class="btn icon" onClick=${() => changeTheme(next)} title=${t('theme.' + cur)} aria-label=${t('theme.' + cur)}><${Icon} name=${ic} /></button>`;
  }
  return html`<div class="seg" role="group" aria-label=${t('profile.theme')}>${opts.map(([k, ic]) => html`
    <button type="button" class=${cur === k ? 'on' : ''} aria-pressed=${cur === k} title=${t('theme.' + k)} aria-label=${t('theme.' + k)} onClick=${() => changeTheme(k)}><${Icon} name=${ic} size=${16} />${iconsOnly ? '' : t('theme.' + k)}</button>`)}</div>`;
}

export function go(path) {
  location.hash = '#' + path;
}
