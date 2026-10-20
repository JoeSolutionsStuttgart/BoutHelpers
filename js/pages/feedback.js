// Feedback: überall erreichbarer Knopf unten rechts, öffnet ein kleines Fenster.
import { html, useState } from '../lib/h.js';
import { rpc } from '../lib/sb.js';
import { t } from '../lib/i18n.js';
import { useStore, toast, toastError } from '../lib/store.js';
import { Icon, Field, Modal } from '../lib/ui.js';

const KINDS = ['idea', 'problem', 'praise', 'other'];

export function FeedbackButton() {
  const { user } = useStore();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return html`
    <button class="fab-feedback" title=${t('feedback.button')} aria-label=${t('feedback.button')} onClick=${() => setOpen(true)}>
      <${Icon} name="chat" size=${20} /><span class="fab-label">${t('feedback.button')}</span>
    </button>
    ${open && html`<${FeedbackModal} onClose=${() => setOpen(false)} />`}`;
}

function FeedbackModal({ onClose }) {
  const [kind, setKind] = useState('idea');
  const [msg, setMsg] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!msg.trim()) return toast(t('feedback.empty'), 'error');
    setBusy(true);
    try {
      // Pfad mit :id statt echter IDs, damit nichts Persönliches mitgeht
      const path = (location.hash || '').replace(/^#/, '').replace(/[0-9a-f-]{16,}/gi, ':id').slice(0, 200);
      await rpc('send_feedback', { p_kind: kind, p_message: msg.trim(), p_path: path, p_contact: contact.trim() });
      toast(t('feedback.sent'));
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };

  return html`<${Modal} title=${t('feedback.title')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${send}><${Icon} name="send" />${t('feedback.send')}</button>`}>
    <div class="stack">
      <p class="muted" style="margin:0">${t('feedback.intro')}</p>
      <${Field} label=${t('feedback.kind')}>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${KINDS.map((k) => html`<button type="button" key=${k} class=${'btn small' + (k === kind ? ' primary' : '')} onClick=${() => setKind(k)}>${t('feedback.kind_' + k)}</button>`)}
        </div>
      </${Field}>
      <${Field} label=${t('feedback.message')}>
        <textarea class="input" rows="5" maxlength="4000" placeholder=${t('feedback.placeholder')} value=${msg} onInput=${(e) => setMsg(e.target.value)}></textarea>
      </${Field}>
      <${Field} label=${t('feedback.contact')} hint=${t('feedback.contact_hint')}>
        <input class="input" type="email" maxlength="200" value=${contact} onInput=${(e) => setContact(e.target.value)} />
      </${Field}>
    </div>
  <//>`;
}
