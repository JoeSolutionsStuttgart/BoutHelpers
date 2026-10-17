// Push-Benachrichtigungen (Web Push über den Service Worker sw.js)
import { sb, rpc } from './sb.js';

const cfg = window.TP_CONFIG || {};

export const pushConfigured = () => !!cfg.vapidPublicKey;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
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
  if (!pushConfigured()) throw new Error('not configured');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(cfg.vapidPublicKey) });
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
    if (sub) await store(sub);
  } catch (e) { console.warn('push sync', e); }
}

// Beim Abmelden: keine Nachrichten mehr für die alte Person auf diesem Gerät
export async function forgetDevice() {
  try {
    const sub = await currentSubscription();
    if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch (e) { /* egal */ }
}
