// Nicht-öffentlicher Bereich: nur für die als Inhaber*in hinterlegte E-Mail-Adresse.
// Zeigt Feedback und Nutzungszahlen. Server-seitig durch is_app_admin() geschützt.
import { html, useState } from '../lib/h.js';
import { rpc } from '../lib/sb.js';
import { t, fmtDateTime } from '../lib/i18n.js';
import { toast, toastError } from '../lib/store.js';
import { Icon, Spinner, Empty, Tabs, useAsync, go } from '../lib/ui.js';

export function AdminPage({ tab }) {
  const allowed = useAsync(() => rpc('is_app_admin'), []);
  if (allowed.loading) return html`<${Spinner} />`;
  if (!allowed.data) return html`<div class="card"><${Empty} icon="lock" title=${t('admin.denied')} text=${t('admin.denied_text')}>
    <a class="btn" href="#/">${t('nav.home')}</a><//></div>`;
  const active = tab || 'feedback';
  return html`<div>
    <div class="hero"><h1><${Icon} name="shield" size=${28} /> ${t('admin.title')}</h1>
      <p class="muted" style="margin:0">${t('admin.intro')}</p></div>
    <${Tabs} base="/admin" active=${active} items=${[
      { key: 'feedback', label: t('admin.tab_feedback'), icon: 'chat' },
      { key: 'usage', label: t('admin.tab_usage'), icon: 'wand' },
    ]} />
    ${active === 'usage' ? html`<${Usage} />` : html`<${Feedback} />`}
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

function Usage() {
  const [days, setDays] = useState(7);
  const d = useAsync(() => rpc('admin_stats', { days }), [days]);
  const s = d.data;
  const tile = (label, value) => html`<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div></div>`;
  const maxDay = s && s.per_day && s.per_day.length ? Math.max(1, ...s.per_day.map((x) => x.views)) : 1;
  return html`<div class="stack">
    <div class="row" style="gap:8px">
      ${[[1, t('admin.today')], [7, t('admin.last7')], [30, t('admin.last30')]].map(([n, l]) => html`
        <button key=${n} class=${'btn small' + (days === n ? ' primary' : '')} onClick=${() => setDays(n)}>${l}</button>`)}
      <button class="btn small ghost" onClick=${() => d.reload()}><${Icon} name="refresh" size=${15} />${t('admin.refresh')}</button>
    </div>
    ${d.loading && !s && html`<${Spinner} />`}
    ${s && html`<div class="stack">
      <div class="stat-row">
        ${tile(t('admin.users'), s.users)}
        ${tile(t('admin.sessions'), s.sessions)}
        ${tile(t('admin.views'), s.views)}
        ${tile(t('admin.clicks'), s.clicks)}
        ${tile(t('admin.avg_session'), fmtDur(s.avg_session_s))}
        ${tile(t('admin.feedback_open'), s.feedback_open)}
      </div>
      <div class="card">
        <div class="card-head"><${Icon} name="calendar" /><h3 class="grow">${t('admin.per_day')}</h3></div>
        <div class="bars">${(s.per_day || []).map((x) => html`<div class="bar" key=${x.day} title=${x.day + ': ' + x.views}>
          <div class="bar-fill" style=${{ height: Math.round((x.views / maxDay) * 100) + '%' }}></div>
          <span class="bar-x">${x.day.slice(5)}</span></div>`)}
          ${(!s.per_day || !s.per_day.length) && html`<p class="muted">${t('admin.no_data')}</p>`}</div>
      </div>
      <div class="grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head"><${Icon} name="eye" /><h3 class="grow">${t('admin.top_pages')}</h3></div>
          ${(s.top_pages || []).length === 0 && html`<p class="muted">${t('admin.no_data')}</p>`}
          ${(s.top_pages || []).map((p) => html`<div class="list-item" key=${p.path}>
            <code class="grow">${p.path}</code><span class="chip">${p.views}×</span><span class="small muted">⌀ ${p.avg_s}s</span></div>`)}
        </div>
        <div class="card">
          <div class="card-head"><${Icon} name="wand" /><h3 class="grow">${t('admin.top_clicks')}</h3></div>
          ${(s.top_clicks || []).length === 0 && html`<p class="muted">${t('admin.no_data')}</p>`}
          ${(s.top_clicks || []).map((c) => html`<div class="list-item" key=${c.target}>
            <span class="grow small">${c.target}</span><span class="chip">${c.n}×</span></div>`)}
        </div>
      </div>
    </div>`}
  </div>`;
}

function fmtDur(sec) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  return m > 0 ? m + 'm ' + (sec % 60) + 's' : sec + 's';
}
