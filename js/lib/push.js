// Push-Benachrichtigungen (Web Push über den Service Worker sw.js)
// Der öffentliche Schlüssel kommt aus der Datenbank; erzeugt wird er von der Edge Function "push".
import { sb, rpc } from './sb.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
const sameKey = (buf, b64) => {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = keyToBytes(b64);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

let keyPromise = null;
// Öffentlicher Schlüssel (null = Push auf dem Server noch nicht eingerichtet)
export function pushPublicKey(refresh = false) {
  if (refresh || !keyPromise) keyPromise = rpc('push_public_key').catch(() => null);
  return keyPromise;
}

// Edge Function "push" aufrufen. Liefert deren Antwort oder { error }.
export async function callPushFunction(body = {}) {
  try {
    const { data, error } = await sb.functions.invoke('push', { body });
    if (error) {
      let detail = '';
      try { detail = error.context && (await error.context.json()).error; } catch (e) { /* keine Details */ }
      const status = error.context && error.context.status;
      return { error: detail || error.message || 'error', status, missing: status === 404 || /not found|failed to send a request/i.test(String(error.message)) };
    }
    return data || {};
  } catch (e) {
    return { error: String(e && e.message), missing: true };
  }
}

// Wartende Push-Nachrichten sofort losschicken (z. B. nach einer @Erwähnung)
export async function flushPush() {
  if (await pushPublicKey()) await callPushFunction({});
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('sw', e); return null; }
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function store(sub) {
  const j = sub.toJSON();
  await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
}

// Push auf diesem Gerät einschalten
export async function enablePush() {
  if (!pushSupported()) throw new Error('unsupported');
  let key = await pushPublicKey(true);
  if (!key) {
    // Erster Start: Die Funktion erzeugt die Schlüssel
    const res = await callPushFunction({ setup: true });
    if (res.missing) throw new Error('function missing');
    if (res.error) throw new Error(res.error);
    key = await pushPublicKey(true);
    if (!key) throw new Error('not configured');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
    await sub.unsubscribe(); // mit altem Schlüssel angemeldet
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) });
  await store(sub);
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Nach dem Anmelden: dieses Gerät gehört jetzt der angemeldeten Person
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (!sub) return;
    const key = await pushPublicKey();
    if (key && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
      await enablePush(); // Schlüssel hat sich geändert → neu anmelden
      return;
    }
    await store(sub);
  } catch (e) { console.warn('push sync', e); }
}

// Beim Abmelden: keine Nachrichten mehr für die alte Person auf diesem Gerät
export async function forgetDevice() {
  try {
    const sub = await currentSubscription();
    if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch (e) { /* egal */ }
}
