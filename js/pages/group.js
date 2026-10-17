// Gruppe (= Position eines Events): Deadline, offene Punkte, Mitglieder, Chat
import { html, useState, useEffect } from '../lib/h.js';
import { sb, q, rpc, ACTIVE } from '../lib/sb.js';
import { t, fmtDateTime, fmtRange, fmtRelative, toLocalInput, fromLocalInput } from '../lib/i18n.js';
import { useStore, toast, toastError, confirmDialog } from '../lib/store.js';
import {
  Icon, Spinner, Empty, ErrorBox, Field, Modal, Person, EditableText, StatusBadge, Progress, Tabs,
  useAsync, useRealtime,
} from '../lib/ui.js';
import { Chat } from './chat.js';
import { shiftLabel } from './event.js';

const PROFILE = 'profiles(id, display_name, pronouns, pronouns_custom, is_guest)';

function useMobile() {
  const mq = window.matchMedia('(max-width: 899px)');
  const [m, setM] = useState(mq.matches);
  useEffect(() => {
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

export function GroupPage({ id, tab }) {
  const { user } = useStore();
  const mobile = useMobile();
  const [dlOpen, setDlOpen] = useState(false);
  const d = useAsync(async () => {
    const pos = await q(sb.from('positions').select('*, events(id, title, starts_at, ends_at, team_id, teams(color))').eq('id', id));
    if (!pos[0]) return null;
    const p = pos[0];
    const [allowed, perms, tasks, members, guests, shifts] = await Promise.all([
      rpc('can_see_group', { pos: id }),
      rpc('my_permissions', { t: p.team_id }),
      q(sb.from('tasks').select('*, done_by_profile:profiles!tasks_done_by_fkey(display_name)').eq('position_id', id).order('sort').order('created_at')),
      q(sb.from('assignments').select('id, status, note, user_id, shift_id, ' + PROFILE).eq('position_id', id).in('status', ACTIVE)),
      q(sb.from('event_guests').select('id, user_id, ' + PROFILE).eq('position_id', id)),
      q(sb.from('shifts').select('*').eq('position_id', id).order('sort').order('starts_at', { nullsFirst: true }).order('created_at')),
    ]);
    return { pos: p, allowed, perms: new Set(perms || []), tasks, members, guests, shifts };
  }, [id]);

  useRealtime(d.data && d.data.allowed ? 'group-' + id : null, ['tasks'], 'position_id=eq.' + id, () => d.reload(true));
  useRealtime(d.data && d.data.allowed ? 'grouppos-' + id : null, ['positions'], 'id=eq.' + id, () => d.reload(true));
  useRealtime(d.data && d.data.allowed ? 'groupass-' + id : null, ['assignments', 'shifts'], 'position_id=eq.' + id, () => d.reload(true));

  if (d.loading && !d.data) return html`<${Spinner} />`;
  if (d.error) return html`<${ErrorBox} error=${d.error} onRetry=${d.reload} />`;
  if (!d.data) return html`<div class="card"><${Empty} icon="lock" title=${t('group.no_access')} /></div>`;
  const { pos, allowed } = d.data;
  const ev = pos.events;
  if (!allowed) {
    return html`<div class="card"><${Empty} icon="lock" title=${t('group.no_access')} text=${t('group.no_access_text')}>
      <a class="btn" href=${'#/event/' + ev.id}>${t('group.back_to_event')}</a><//></div>`;
  }
  const ctx = { ...d.data, me: user.id, reload: () => d.reload(true) };

  const sections = {
    tasks: html`<div class="stack">
      <${DeadlineCard} ctx=${ctx} onEdit=${() => setDlOpen(true)} />
      <${TaskList} ctx=${ctx} />
    </div>`,
    members: html`<${MemberList} ctx=${ctx} />`,
    chat: html`<${Chat} eventId=${ev.id} positionId=${id} title=${t('chat.group_title', { name: pos.name })} canModerate=${ctx.perms.has('chat.moderate')} />`,
  };

  return html`<div>
    <div class="hero" style=${{ '--hero': ev.teams ? ev.teams.color : undefined }}>
      <a href=${'#/event/' + ev.id} class="chip" style="text-decoration:none;margin-bottom:10px"><${Icon} name="left" size=${14} />${ev.title}</a>
      <h1>${pos.name}</h1>
      <div class="hero-meta">
        <span><${Icon} name="calendar" size=${18} />${fmtRange(ev.starts_at, ev.ends_at)}</span>
        <span><${Icon} name="users" size=${18} />${t('groups.members_n', { n: new Set(ctx.members.map((a) => a.user_id)).size + ctx.guests.length })}</span>
        ${ctx.shifts.length > 1 && html`<span><${Icon} name="clock" size=${18} />${t('shift.count', { n: ctx.shifts.length })}</span>`}
      </div>
      ${pos.description && html`<p class="muted pre" style="margin:10px 0 0">${pos.description}</p>`}
    </div>

    ${mobile
      ? html`<${Tabs} base=${'/group/' + id} active=${tab} items=${[
          { key: 'tasks', label: t('group.tab_tasks'), icon: 'tasks' },
          { key: 'chat', label: t('group.tab_chat'), icon: 'chat' },
          { key: 'members', label: t('group.tab_members'), icon: 'users' },
        ]} />
        ${sections[tab] || sections.tasks}`
      : html`<div class="grid-2">
          <div class="stack">${sections.tasks}${sections.members}</div>
          <div>${sections.chat}</div>
        </div>`}
    ${dlOpen && html`<${DeadlineModal} ctx=${ctx} onClose=${() => setDlOpen(false)} />`}
  </div>`;
}

function DeadlineCard({ ctx, onEdit }) {
  const { pos, tasks } = ctx;
  const open = tasks.filter((x) => !x.done).length;
  const over = pos.deadline && new Date(pos.deadline) < new Date();
  return html`<div class="card">
    <div class="card-head"><${Icon} name="flag" /><h3 class="grow">${t('group.deadline')}</h3>
      <button class="btn small ghost" onClick=${onEdit}><${Icon} name="edit" size=${16} />${pos.deadline ? t('common.edit') : t('group.set_deadline')}</button></div>
    ${pos.deadline
      ? html`<div class=${'deadline-card' + (over ? ' over' : '')}>
          <div class="grow">
            <div class="deadline-big">${fmtRelative(pos.deadline)}</div>
            <div class="muted">${fmtDateTime(pos.deadline)}</div>
          </div>
          <div class="small muted stack-sm" style="gap:4px">
            <span class="row nowrap"><${Icon} name="bell" size=${15} />${t('group.reminder_before', { n: pos.reminder_hours })}</span>
            ${pos.reminder_sent_at && html`<span class="row nowrap"><${Icon} name="check" size=${15} />${t('group.reminder_sent', { when: fmtDateTime(pos.reminder_sent_at) })}</span>`}
            ${over && open > 0 && html`<span class="badge st-declined">${t('group.overdue', { n: open })}</span>`}
          </div>
        </div>`
      : html`<p class="muted" style="margin:0">${t('group.no_deadline')}</p>`}
  </div>`;
}

function DeadlineModal({ ctx, onClose }) {
  const [dl, setDl] = useState(toLocalInput(ctx.pos.deadline));
  const [hours, setHours] = useState(ctx.pos.reminder_hours || 48);
  const [busy, setBusy] = useState(false);
  const save = async (clear) => {
    setBusy(true);
    try {
      await rpc('set_group_deadline', { pos: ctx.pos.id, dl: clear ? null : fromLocalInput(dl), hours: Number(hours) });
      toast(t('common.saved'));
      ctx.reload();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('group.deadline')} onClose=${onClose} footer=${html`
    ${ctx.pos.deadline && html`<button class="btn danger" style="margin-right:auto" onClick=${() => save(true)}>${t('group.remove_deadline')}</button>`}
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy || !dl} onClick=${() => save(false)}>${t('common.save')}</button>`}>
    <div class="stack">
      <${Field} label=${t('group.deadline')}><input class="input" type="datetime-local" value=${dl} onInput=${(e) => setDl(e.target.value)} /><//>
      <${Field} label=${t('group.reminder')} hint=${t('group.reminder_hint')}>
        <select class="input" value=${hours} onChange=${(e) => setHours(e.target.value)}>
          ${[6, 12, 24, 48, 72, 168].map((h) => html`<option value=${h}>${t('group.reminder_before', { n: h })}</option>`)}
        </select>
      <//>
    </div>
  <//>`;
}

function TaskList({ ctx }) {
  const [title, setTitle] = useState('');
  const tasks = [...ctx.tasks].sort((a, b) => Number(a.done) - Number(b.done) || a.sort - b.sort || new Date(a.created_at) - new Date(b.created_at));
  const done = ctx.tasks.filter((x) => x.done).length;
  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await q(sb.from('tasks').insert({ position_id: ctx.pos.id, event_id: ctx.pos.event_id, title: title.trim(), sort: ctx.tasks.length }));
      setTitle('');
      ctx.reload();
    } catch (err) { toastError(err); }
  };
  const upd = async (x, patch) => {
    try { await q(sb.from('tasks').update(patch).eq('id', x.id)); ctx.reload(); } catch (e) { toastError(e); throw e; }
  };
  const del = async (x) => {
    if (!(await confirmDialog({ title: t('tasks.delete'), text: t('tasks.delete_text', { name: x.title }), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('tasks').delete().eq('id', x.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  return html`<div class="card">
    <div class="card-head"><${Icon} name="tasks" /><h3 class="grow">${t('tasks.title')}</h3><span class="small muted">${t('tasks.progress', { n: done, total: ctx.tasks.length })}</span></div>
    ${ctx.tasks.length > 0 && html`<div style="margin-bottom:8px"><${Progress} value=${done} max=${ctx.tasks.length} /></div>`}
    ${ctx.tasks.length === 0 && html`<p class="muted">${t('tasks.none')}</p>`}
    ${tasks.map((x) => html`<div class=${'task' + (x.done ? ' done' : '')} key=${x.id}>
      <input type="checkbox" checked=${x.done} aria-label=${x.title} onChange=${(e) => upd(x, { done: e.target.checked }).catch(() => {})} />
      <div class="grow">
        <div class="task-title"><${EditableText} value=${x.title} canEdit=${true} maxLength=${200} onSave=${(v) => upd(x, { title: v })} /></div>
        <div class="small muted"><${EditableText} value=${x.details} canEdit=${true} multiline required=${false} maxLength=${2000} placeholder=${t('tasks.add_details')} onSave=${(v) => upd(x, { details: v })} /></div>
        ${x.done && x.done_by_profile && html`<div class="small faint">${t('tasks.done_by', { name: x.done_by_profile.display_name, when: fmtDateTime(x.done_at) })}</div>`}
      </div>
      <button class="btn icon" aria-label=${t('common.delete')} onClick=${() => del(x)}><${Icon} name="trash" size=${18} /></button>
    </div>`)}
    <form class="row nowrap" style="margin-top:12px" onSubmit=${add}>
      <input class="input" maxlength="200" placeholder=${t('tasks.new_placeholder')} value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <button class="btn primary" aria-label=${t('common.add')}><${Icon} name="plus" /></button>
    </form>
  </div>`;
}

function MemberList({ ctx }) {
  // Alle Schichten sind eine Gruppe – die Mitglieder werden nach Schicht sortiert gezeigt
  const many = ctx.shifts.length > 1;
  const row = (a) => html`<div class="list-item" key=${a.id}><div class="grow"><${Person} profile=${a.profiles} /></div><${StatusBadge} status=${a.status} />
    ${a.note && html`<div class="small muted pre" style="width:100%;padding-left:38px">„${a.note}“</div>`}</div>`;
  return html`<div class="card">
    <div class="card-head"><${Icon} name="users" /><h3 class="grow">${t('group.tab_members')}</h3></div>
    ${ctx.members.length + ctx.guests.length === 0 && html`<p class="muted">${t('group.no_members')}</p>`}
    ${ctx.shifts.map((s, i) => {
      const list = ctx.members.filter((a) => a.shift_id === s.id);
      const label = shiftLabel(s, i, ctx.shifts.length);
      return html`<div key=${s.id} style=${{ marginBottom: many ? '12px' : 0 }}>
        ${(many || s.starts_at) && html`<div class="shift-title">
          ${label && html`<b>${label}</b>`}
          ${s.starts_at && html`<span class="small muted">${fmtRange(s.starts_at, s.ends_at)}</span>`}
          <span class="small faint">${list.length}/${s.slots}</span>
        </div>`}
        <div class="list">${list.map(row)}</div>
        ${list.length === 0 && many && html`<p class="small faint" style="margin:4px 0">${t('shift.empty')}</p>`}
      </div>`;
    })}
    ${ctx.guests.length > 0 && html`<div class="shift-title"><b>${t('group.guests')}</b></div>
      <div class="list">${ctx.guests.map((g) => html`<div class="list-item" key=${g.id}><div class="grow"><${Person} profile=${g.profiles} guest /></div></div>`)}</div>`}
  </div>`;
}
