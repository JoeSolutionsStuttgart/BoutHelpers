// Nicht-öffentlicher Bereich: nur für die als Inhaber*in hinterlegte E-Mail-Adresse.
// Zeigt das Feedback aus der App. Server-seitig durch is_app_admin() geschützt.
import { html, useState } from '../lib/h.js';
import { rpc } from '../lib/sb.js';
import { t, fmtDateTime } from '../lib/i18n.js';
import { toastError } from '../lib/store.js';
import { Icon, Spinner, Empty, useAsync } from '../lib/ui.js';

export function AdminPage() {
  const allowed = useAsync(() => rpc('is_app_admin'), []);
  if (allowed.loading) return html`<${Spinner} />`;
  if (!allowed.data) return html`<div class="card"><${Empty} icon="lock" title=${t('admin.denied')} text=${t('admin.denied_text')}>
    <a class="btn" href="#/">${t('nav.home')}</a><//></div>`;
  return html`<div>
    <div class="hero"><h1><${Icon} name="shield" size=${28} /> ${t('admin.title')}</h1>
      <p class="muted" style="margin:0">${t('admin.intro')}</p></div>
    <${Feedback} />
  </div>`;
}

function Feedback() {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const d = useAsync(() => rpc('admin_feedback', { only_open: onlyOpen, max_rows: 300 }), [onlyOpen]);
  const mark = async (f, done) => {
    try { await rpc('admin_feedback_done', { f_id: f.id, done }); d.reload(true); } catch (e) { toastError(e); }
  };
  const KIND = { idea: 'st-proposed', problem: 'st-declined', praise: 'st-confirmed', other: '' };
  return html`<div class="stack">
    <label class="check" style="width:auto"><input type="checkbox" checked=${onlyOpen} onChange=${(e) => setOnlyOpen(e.target.checked)} /><span>${t('admin.only_open')}</span></label>
    ${d.loading && html`<${Spinner} />`}
    ${d.data && d.data.length === 0 && html`<div class="card"><${Empty} icon="chat" title=${t('admin.feedback_none')} /></div>`}
    ${d.data && d.data.map((f) => html`<div class=${'card stack-sm' + (f.handled ? ' done-card' : '')} key=${f.id}>
      <div class="row">
        <span class=${'badge ' + (KIND[f.kind] || '')}>${t('feedback.kind_' + f.kind)}</span>
        <span class="grow small muted">${f.who} · ${fmtDateTime(f.created_at)}${f.path ? ' · ' + f.path : ''}</span>
        <button class=${'btn small ' + (f.handled ? 'ghost' : 'primary')} onClick=${() => mark(f, !f.handled)}>
          <${Icon} name=${f.handled ? 'refresh' : 'check'} size=${15} />${f.handled ? t('admin.reopen') : t('admin.mark_done')}</button>
      </div>
      <div class="pre">${f.message}</div>
      ${f.contact && html`<div class="small"><${Icon} name="mail" size=${14} /> <a href=${'mailto:' + f.contact}>${f.contact}</a></div>`}
    </div>`)}
  </div>`;
}
