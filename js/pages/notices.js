// Infotafel: Infos für ein Team (nur teamId), ein Event (eventId) oder eine Gruppe (positionId)
import { html, useState } from '../lib/h.js';
import { sb, q } from '../lib/sb.js';
import { t, fmtRelative } from '../lib/i18n.js';
import { toast, toastError, confirmDialog } from '../lib/store.js';
import { Icon, Spinner, Empty, ErrorBox, Field, Modal, Person, useAsync, useRealtime } from '../lib/ui.js';

const PROFILE = 'profiles(id, display_name, pronouns, pronouns_custom, is_guest, bio)';

export function NoticeBoard({ teamId, eventId, positionId, canPost, canModerate, me }) {
  const [editing, setEditing] = useState(null); // {} = neu, Notiz = bearbeiten
  const d = useAsync(async () => {
    let qb = sb.from('notices').select('*, author:' + PROFILE)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false });
    if (positionId) qb = qb.eq('position_id', positionId);
    else if (eventId) qb = qb.eq('event_id', eventId).is('position_id', null);
    else qb = qb.eq('team_id', teamId).is('event_id', null).is('position_id', null);
    return q(qb);
  }, [teamId, eventId, positionId]);
  useRealtime(teamId ? 'notices-' + (positionId || eventId || teamId) : null, ['notices'], 'team_id=eq.' + teamId, () => d.reload(true));

  const notices = d.data || [];
  return html`<div class="stack">
    <div class="toolbar">
      <p class="grow muted" style="margin:0">${t('board.intro')}</p>
      ${canPost && html`<button class="btn primary" onClick=${() => setEditing({})}><${Icon} name="plus" />${t('board.new')}</button>`}
    </div>
    ${d.loading && !d.data && html`<${Spinner} />`}
    ${d.error && html`<${ErrorBox} error=${d.error} onRetry=${() => d.reload(true)} />`}
    ${d.data && notices.length === 0 && html`<div class="card"><${Empty} icon="flag" title=${t('board.none')} text=${canPost ? t('board.none_text') : ''} /></div>`}
    ${notices.map((n) => html`<${NoticeCard} key=${n.id} notice=${n} me=${me} canModerate=${canModerate} onEdit=${() => setEditing(n)} onChange=${() => d.reload(true)} />`)}
    ${editing && html`<${NoticeModal} scope=${{ teamId, eventId, positionId }} canModerate=${canModerate} notice=${editing.id ? editing : null} onClose=${() => setEditing(null)} onSaved=${() => d.reload(true)} />`}
  </div>`;
}

function NoticeCard({ notice, me, canModerate, onEdit, onChange }) {
  const canEdit = notice.created_by === me || canModerate;
  const del = async () => {
    if (!(await confirmDialog({ title: t('board.delete'), text: t('board.delete_confirm'), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('notices').delete().eq('id', notice.id)); toast(t('common.saved')); onChange(); } catch (e) { toastError(e); }
  };
  return html`<div class=${'card stack-sm notice' + (notice.pinned ? ' pinned' : '')}>
    <div class="row" style="align-items:flex-start">
      <div class="grow" style="min-width:0">
        ${notice.pinned && html`<span class="chip"><${Icon} name="star" size=${13} />${t('board.pinned')}</span>`}
        ${notice.title && html`<h3 style="margin:4px 0 0">${notice.title}</h3>`}
      </div>
      ${canEdit && html`<button class="btn icon" aria-label=${t('common.edit')} onClick=${onEdit}><${Icon} name="edit" size=${16} /></button>
        <button class="btn icon" aria-label=${t('common.delete')} onClick=${del}><${Icon} name="trash" size=${16} /></button>`}
    </div>
    <div class="pre">${notice.body}</div>
    <div class="row small faint">
      ${notice.author && html`<${Person} profile=${notice.author} size="sm" />`}
      <span class="grow"></span><span>${fmtRelative(notice.created_at)}</span>
    </div>
  </div>`;
}

function NoticeModal({ scope, notice, canModerate, onClose, onSaved }) {
  const [title, setTitle] = useState(notice ? (notice.title || '') : '');
  const [body, setBody] = useState(notice ? notice.body : '');
  const [pinned, setPinned] = useState(notice ? !!notice.pinned : false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!body.trim()) return toast(t('board.need_body'), 'error');
    setBusy(true);
    try {
      if (notice) {
        await q(sb.from('notices').update({ title: title.trim(), body: body.trim(), pinned }).eq('id', notice.id));
      } else {
        const row = { title: title.trim(), body: body.trim(), pinned };
        if (scope.positionId) row.position_id = scope.positionId;
        else if (scope.eventId) row.event_id = scope.eventId;
        else row.team_id = scope.teamId;
        await q(sb.from('notices').insert(row));
      }
      toast(t('common.saved'));
      onSaved();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${notice ? t('board.edit') : t('board.new')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}><${Icon} name="check" />${t('common.save')}</button>`}>
    <div class="stack">
      <${Field} label=${t('board.title_label')}><input class="input" maxlength="200" value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder=${t('board.title_ph')} /><//>
      <${Field} label=${t('board.body_label')}><textarea class="input" rows="5" maxlength="4000" value=${body} onInput=${(e) => setBody(e.target.value)} placeholder=${t('board.body_ph')}></textarea><//>
      ${canModerate && html`<label class="check"><input type="checkbox" checked=${pinned} onChange=${(e) => setPinned(e.target.checked)} />
        <span><b>${t('board.pin')}</b><span class="small faint" style="display:block">${t('board.pin_hint')}</span></span></label>`}
    </div>
  <//>`;
}
