// Gemeinsame Aktionen für Einsätze
import { html } from '../lib/h.js';
import { rpc } from '../lib/sb.js';
import { t } from '../lib/i18n.js';
import { toast, toastError, promptDialog, confirmDialog } from '../lib/store.js';
import { Icon } from '../lib/ui.js';

// Auf die eigene Einteilung antworten (bestätigen / ungewiss / absagen)
export async function respond(a, status) {
  let note = '';
  if (status === 'uncertain') {
    const r = await promptDialog({
      title: t('assign.uncertain_title'), text: t('assign.uncertain_text'), label: t('assign.reason_optional'),
      multiline: true, value: a.status === 'uncertain' ? a.note : '', maxLength: 500, ok: t('status.uncertain'),
    });
    if (r === null) return false;
    note = r.trim();
  }
  if (status === 'declined') {
    const r = await promptDialog({
      title: t('assign.decline_title'), text: t('assign.decline_text'), label: t('assign.reason_optional'),
      multiline: true, maxLength: 500, ok: t('assign.decline'),
    });
    if (r === null) return false;
    note = r.trim();
  }
  try {
    await rpc('respond_assignment', { a: a.id, new_status: status, msg: note });
    toast(t('assign.saved_' + status));
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function leaveWaitlist(a) {
  if (!(await confirmDialog({ title: t('assign.leave_waitlist'), text: t('assign.leave_waitlist_text'), danger: true, ok: t('assign.leave_waitlist') }))) return false;
  try {
    await rpc('respond_assignment', { a: a.id, new_status: 'declined', msg: '' });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// Knöpfe für die eigene Antwort
export function MyAnswerButtons({ a, onDone }) {
  const act = async (st) => { if (await respond(a, st)) onDone && onDone(); };
  if (a.status === 'waitlist') {
    return html`<button class="btn small ghost" onClick=${async () => { if (await leaveWaitlist(a)) onDone && onDone(); }}><${Icon} name="x" size=${16} />${t('assign.leave_waitlist')}</button>`;
  }
  return html`
    ${a.status !== 'confirmed' && html`<button class="btn small success" onClick=${() => act('confirmed')}><${Icon} name="check" size=${16} />${t('assign.confirm')}</button>`}
    <button class="btn small warn" onClick=${() => act('uncertain')}><${Icon} name="help" size=${16} />${a.status === 'uncertain' ? t('assign.edit_reason') : t('status.uncertain')}</button>
    <button class="btn small danger" onClick=${() => act('declined')}><${Icon} name="x" size=${16} />${t('assign.decline')}</button>`;
}

export function DateBox({ date, color }) {
  const d = new Date(date);
  return html`<div class="datebox" style=${{ '--c': color || 'var(--violet)' }}>
    <b>${new Intl.DateTimeFormat(document.documentElement.lang || 'de', { day: 'numeric' }).format(d)}</b>
    <span>${new Intl.DateTimeFormat(document.documentElement.lang || 'de', { month: 'short' }).format(d)}</span>
  </div>`;
}
