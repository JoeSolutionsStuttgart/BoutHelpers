// Hintergrund-Nutzungsdaten: welche Seite, wie lange, wohin geklickt.
// Bewusst NICHT erfasst: Eingabefelder, Passwörter, Chat-Texte, Namen, IDs im Klartext.
// Alle IDs in Pfaden/Zielen werden durch :id ersetzt. Keine Anzeige in der App.
import { sb } from './sb.js';
import { getState } from './store.js';

const KEY = 'tp.ev';
const MAX_QUEUE = 300;
let queue = [];
let sid = '';
let curPath = null;
let enteredAt = 0;
let flushTimer = null;
let started = false;

function loadQueue() {
  try { queue = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { queue = []; }
  if (!Array.isArray(queue)) queue = [];
}
function saveQueue() {
  try { localStorage.setItem(KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch (e) { /* ohne Speicher */ }
}
function sessionId() {
  try {
    let s = sessionStorage.getItem('tp.sid');
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tp.sid', s); }
    return s;
  } catch (e) { return sid || (sid = Math.random().toString(36).slice(2)); }
}

// IDs (UUID, lange Zahlen/Token) durch :id ersetzen
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function normPath(hash) {
  let p = String(hash || location.hash || '').replace(/^#/, '') || '/';
  p = p.split('?')[0];
  p = p.replace(UUID, ':id');
  p = p.replace(/\/[A-Za-z0-9_-]{16,}/g, '/:id'); // Einladungs-/Gästelink-Token
  return p.slice(0, 120) || '/';
}

function push(ev) {
  queue.push({ sid: sessionId(), lang: document.documentElement.lang || '', ...ev });
  saveQueue();
}

function lang() { return document.documentElement.lang || ''; }

// Beschreibung des Klickziels (nie Eingaben/Freitext)
function clickTarget(el) {
  const a = el.closest && el.closest('a[href]');
  if (a) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return 'link ' + normPath(href);
    return 'link extern';
  }
  const tab = el.closest && el.closest('[role="tab"], .tab, .nav-item, .bottomnav a');
  if (tab) {
    const key = (tab.getAttribute('href') || '').replace(/^#/, '');
    if (key) return 'nav ' + normPath(key);
  }
  const btn = el.closest && el.closest('button, [role="button"], .btn');
  if (btn) {
    // bewusst nur statische Beschriftung, kein Freitext aus Eingaben
    const lbl = (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '').trim();
    return 'btn ' + (lbl.replace(/\s+/g, ' ').slice(0, 60) || '?');
  }
  const field = el.closest && el.closest('input, textarea, select, label.check');
  if (field) {
    const type = field.tagName === 'INPUT' ? (field.getAttribute('type') || 'text') : field.tagName.toLowerCase();
    return 'feld ' + type; // nur die Art, nie der Inhalt
  }
  return '';
}

function onClick(e) {
  try {
    const el = e.target;
    if (!el || !el.closest) return;
    const target = clickTarget(el);
    if (target) push({ kind: 'click', path: normPath(), target });
  } catch (err) { /* egal */ }
}

function leaveCurrent() {
  if (curPath === null) return;
  const dur = Math.max(0, Math.min(86400000, Date.now() - enteredAt));
  push({ kind: 'view', path: curPath, dur });
  curPath = null;
}
function enter() {
  const p = normPath();
  if (p === curPath) return;
  leaveCurrent();
  curPath = p;
  enteredAt = Date.now();
}

async function flush(force) {
  if (!queue.length) return;
  if (!getState().user) return; // nur angemeldet (RPC verlangt Anmeldung)
  const batch = queue.slice(0, 50);
  try {
    const { error } = await sb.rpc('log_events', { evs: batch });
    if (error) return; // beim nächsten Mal erneut
    queue = queue.slice(batch.length);
    saveQueue();
    if (force && queue.length) flush(true);
  } catch (e) { /* offline – später erneut */ }
}

const onHashChange = () => { enter(); };
const onHide = () => { if (document.visibilityState === 'hidden') { leaveCurrent(); flush(true); } };
const onPageHide = () => { leaveCurrent(); flush(true); };

export function startTracking() {
  if (started) return;
  started = true;
  loadQueue();
  enter();
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  flushTimer = setInterval(() => flush(false), 15000);
  flush(false);
}

export function stopTracking() {
  if (!started) return;
  started = false;
  leaveCurrent();
  flush(true);
  window.removeEventListener('hashchange', onHashChange);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', onPageHide);
  clearInterval(flushTimer);
}
