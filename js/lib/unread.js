// Ungelesenes: neue Chat-Nachrichten und neue/erledigte Aufgaben in Gruppen (von anderen Personen)
import { useEffect } from './h.js';
import { sb, rpc } from './sb.js';
import { getState, setState } from './store.js';

export const EMPTY_UNREAD = { total: 0, byTeam: {}, byEvent: {}, eventChat: {}, groupChat: {}, groupTasks: {}, byGroup: {}, groupsOfEvent: {} };

let timer = null;
let poll = null;
let channel = null;

const add = (obj, key, n) => { obj[key] = (obj[key] || 0) + n; };

function showTotal(n) {
  const name = (window.TP_CONFIG && window.TP_CONFIG.appName) || 'Teamplaner';
  document.title = (n ? `(${n}) ` : '') + name;
  try {
    if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  } catch (e) { /* nicht unterstützt */ }
}

export async function loadUnread() {
  if (!getState().user) { setState({ unread: EMPTY_UNREAD }); showTotal(0); return; }
  try {
    const rows = (await rpc('my_unread')) || [];
    const u = { total: 0, byTeam: {}, byEvent: {}, eventChat: {}, groupChat: {}, groupTasks: {}, byGroup: {}, groupsOfEvent: {} };
    rows.forEach((r) => {
      u.total += r.n;
      add(u.byTeam, r.team_id, r.n);
      add(u.byEvent, r.event_id, r.n);
      if (r.scope === 'event_chat') u.eventChat[r.ref] = r.n;
      else {
        (r.scope === 'group_chat' ? u.groupChat : u.groupTasks)[r.ref] = r.n;
        add(u.byGroup, r.ref, r.n);
        add(u.groupsOfEvent, r.event_id, r.n);
      }
    });
    setState({ unread: u });
    showTotal(u.total);
  } catch (e) { console.warn('unread', e); }
}

export function refreshUnread() {
  clearTimeout(timer);
  timer = setTimeout(loadUnread, 500);
}

const onVisible = () => { if (document.visibilityState === 'visible') refreshUnread(); };

export function startUnread() {
  stopUnread();
  loadUnread();
  channel = sb.channel('unread-' + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refreshUnread)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refreshUnread)
    .subscribe();
  poll = setInterval(loadUnread, 60000);
  document.addEventListener('visibilitychange', onVisible);
}

export function stopUnread() {
  clearInterval(poll);
  clearTimeout(timer);
  if (channel) sb.removeChannel(channel);
  channel = null;
  document.removeEventListener('visibilitychange', onVisible);
  setState({ unread: EMPTY_UNREAD });
  showTotal(0);
}

// Als gelesen markieren (sofort in der Anzeige, dann in der Datenbank)
export async function markSeen(scope, ref) {
  if (!ref || !getState().user) return;
  const u = getState().unread || EMPTY_UNREAD;
  const map = { event_chat: 'eventChat', group_chat: 'groupChat', group_tasks: 'groupTasks' }[scope];
  if (u[map] && u[map][ref]) {
    const n = u[map][ref];
    const next = { ...u, total: Math.max(0, u.total - n), [map]: { ...u[map], [ref]: 0 } };
    setState({ unread: next });
    showTotal(next.total);
  }
  try { await rpc('mark_seen', { sc: scope, r: ref }); } catch (e) { /* egal */ }
  refreshUnread();
}

// In einer Ansicht: beim Öffnen und bei jeder Änderung (deps) als gelesen markieren
export function useSeen(scope, ref, deps = []) {
  useEffect(() => {
    if (!ref) return undefined;
    const id = setTimeout(() => markSeen(scope, ref), 300);
    return () => clearTimeout(id);
  }, [scope, ref, ...deps]);
}
