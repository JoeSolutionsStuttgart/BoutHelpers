// E-Mails abbestellen (Link aus der Fußzeile jeder Mail) – funktioniert auch ohne Anmeldung
import { html, useState } from '../lib/h.js';
import { sb } from '../lib/sb.js';
import { t } from '../lib/i18n.js';
import { useStore, loadProfile, isGuest } from '../lib/store.js';
import { Icon, Empty } from '../lib/ui.js';
import { AuthShell } from './auth.js';

const KINDS = ['assignment', 'deadline'];

export function UnsubscribePage({ u, c, s }) {
  const { session } = useStore();
  const [state, setSt] = useState('ask'); // ask | busy | done | error
  const valid = /^[0-9a-f-]{36}$/i.test(u || '') && KINDS.includes(c) && !!s;

  const run = async () => {
    setSt('busy');
    try {
      const qs = `unsub=1&u=${encodeURIComponent(u)}&c=${encodeURIComponent(c)}&s=${encodeURIComponent(s)}`;
      const { data, error } = await sb.functions.invoke('mailer?' + qs, { body: { unsubscribe: true } });
      if (error || !data || !data.ok) throw error || new Error('unsub');
      setSt('done');
      if (session && !isGuest()) loadProfile().catch(() => {});
    } catch (e) {
      console.warn('unsubscribe', e);
      setSt('error');
    }
  };

  let body;
  if (!valid || state === 'error') {
    body = html`<${Empty} icon="alert" title=${t('unsub.invalid')} text=${t('unsub.settings_hint')} />`;
  } else if (state === 'done') {
    body = html`<div class="stack">
      <div class="notice ok"><${Icon} name="check" /> ${t('unsub.done')}</div>
      <p class="small muted">${t('unsub.settings_hint')}</p>
      ${session && !isGuest() && html`<a class="btn" href="#/profile"><${Icon} name="user" />${t('mailpref.title')}</a>`}
    </div>`;
  } else {
    body = html`<div class="stack">
      <p>${t('unsub.text', { kind: t('mailpref.' + c) })}</p>
      <p class="small muted">${t('mailpref.' + c + '.desc')}</p>
      <div class="row">
        <button class="btn primary" disabled=${state === 'busy'} onClick=${run}><${Icon} name="bellOff" />${t('unsub.button')}</button>
        <a class="btn ghost" href="#/">${t('common.cancel')}</a>
      </div>
    </div>`;
  }

  if (!session) return html`<${AuthShell} title=${t('unsub.title')}>${body}<//>`;
  return html`<div class="card" style="max-width:560px;margin:0 auto"><h2>${t('unsub.title')}</h2>${body}</div>`;
}
