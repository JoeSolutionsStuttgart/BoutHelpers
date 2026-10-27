// Gruppe (= Position eines Events): Deadline, offene Punkte, Mitglieder, Chat
import { html, useState, useEffect } from '../lib/h.js';
import { sb, q, rpc, ACTIVE } from '../lib/sb.js';
import { t, fmtDateTime, fmtRange, fmtTimeRange, fmtRelative, toLocalInput, fromLocalInput } from '../lib/i18n.js';
import { useStore, toast, toastError, confirmDialog } from '../lib/store.js';
import {
  Icon, Spinner, Empty, ErrorBox, Field, Modal, Person, Avatar, PersonHover, EditableText, StatusBadge, Progress, Tabs,
  useAsync, useRealtime,
} from '../lib/ui.js';
import { useSeen } from '../lib/unread.js';
import { Chat } from './chat.js';
import { Polls } from './polls.js';
import { NoticeBoard } from './notices.js';
import { shiftLabel, shiftTimesSummary } from './event.js';

const PROFILE = 'profiles(id, display_name, pronouns, pronouns_custom, is_guest, bio)';

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
  const { user, unread } = useStore();
  const mobile = useMobile();
  const [dlOpen, setDlOpen] = useState(false);
  const d = useAsync(async () => {
    const pos = await q(sb.from('positions').select('*, events(id, title, starts_at, ends_at, team_id, teams(color))').eq('id', id));
    if (!pos[0]) return null;
    const p = pos[0];
    const [allowed, perms, tasks, members, guests, shifts, pollCount] = await Promise.all([
      rpc('can_see_group', { pos: id }),
      rpc('my_permissions', { t: p.team_id }),
      q(sb.from('tasks').select('*, done_by_profile:profiles!tasks_done_by_fkey(display_name), assignee_profile:profiles!tasks_assignee_fkey(id, display_name, pronouns, pronouns_custom, is_guest)').eq('position_id', id).order('sort').order('created_at')),
      q(sb.from('assignments').select('id, status, note, user_id, shift_id, ' + PROFILE).eq('position_id', id).in('status', ACTIVE)),
      q(sb.from('event_guests').select('id, user_id, ' + PROFILE).eq('position_id', id)),
      q(sb.from('shifts').select('*').eq('position_id', id).order('sort').order('starts_at', { nullsFirst: true }).order('created_at')),
      q(sb.from('polls').select('id').eq('position_id', id)),
    ]);
    return { pos: p, allowed, perms: new Set(perms || []), tasks, members, guests, shifts, pollCount: (pollCount || []).length };
  }, [id]);

  useRealtime(d.data && d.data.allowed ? 'group-' + id : null, ['tasks'], 'position_id=eq.' + id, () => d.reload(true));
  useRealtime(d.data && d.data.allowed ? 'grouppos-' + id : null, ['positions'], 'id=eq.' + id, () => d.reload(true));
  useRealtime(d.data && d.data.allowed ? 'groupass-' + id : null, ['assignments', 'shifts'], 'position_id=eq.' + id, () => d.reload(true));

  // Aufgaben gelten als gesehen, sobald sie sichtbar sind (am Computer immer, am Handy im Reiter "Aufgaben")
  const tasksVisible = !!(d.data && d.data.allowed) && (!mobile || !tab || tab === 'tasks');
  useSeen('group_tasks', tasksVisible ? id : null, [d.data && d.data.tasks]);

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
    polls: html`<${Polls} eventId=${ev.id} positionId=${id} teamId=${pos.team_id} me=${ctx.me} canModerate=${ctx.perms.has('events.manage') || ctx.perms.has('chat.moderate')} />`,
    board: html`<${NoticeBoard} teamId=${pos.team_id} eventId=${ev.id} positionId=${id} me=${ctx.me} canPost=${true} canModerate=${ctx.perms.has('events.manage') || ctx.perms.has('chat.moderate')} />`,
    chat: html`<${Chat} eventId=${ev.id} positionId=${id} title=${t('chat.group_title', { name: pos.name })} canModerate=${ctx.perms.has('chat.moderate')} />`,
  };

  return html`<div>
    <div class="hero" style=${{ '--hero': ev.teams ? ev.teams.color : undefined }}>
      <a href=${'#/event/' + ev.id} class="chip" style="text-decoration:none;margin-bottom:10px"><${Icon} name="left" size=${14} />${ev.title}</a>
      <h1>${pos.name}</h1>
      <div class="hero-meta">
        ${(() => { const tm = shiftTimesSummary(ctx.shifts, ev); return html`<span><${Icon} name="calendar" size=${18} />${tm || fmtRange(ev.starts_at, ev.ends_at)}</span>`; })()}
        <span><${Icon} name="users" size=${18} />${t('groups.members_n', { n: new Set(ctx.members.map((a) => a.user_id)).size + ctx.guests.length })}</span>
        ${ctx.shifts.length > 1 && html`<span><${Icon} name="clock" size=${18} />${t('shift.count', { n: ctx.shifts.length })}</span>`}
      </div>
      ${pos.description && html`<p class="muted pre" style="margin:10px 0 0">${pos.description}</p>`}
    </div>

    ${mobile
      ? html`<${Tabs} base=${'/group/' + id} active=${tab} items=${[
          { key: 'tasks', label: t('group.tab_tasks'), icon: 'tasks', unread: unread.groupTasks[id] },
          { key: 'chat', label: t('group.tab_chat'), icon: 'chat', unread: unread.groupChat[id] },
          { key: 'polls', label: t('group.tab_polls'), icon: 'chart', count: ctx.pollCount },
          { key: 'board', label: t('group.tab_board'), icon: 'flag' },
          { key: 'members', label: t('group.tab_members'), icon: 'users' },
        ]} />
        ${sections[tab] || sections.tasks}`
      : html`<div class="grid-2">
          <div class="stack">${sections.tasks}${sections.polls}${sections.board}${sections.members}</div>
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
            ${(() => {
              const r = pos.remind_at || (pos.deadline ? new Date(new Date(pos.deadline).getTime() - (pos.reminder_hours || 48) * 3600000).toISOString() : null);
              return r && html`<span class="row nowrap"><${Icon} name="bell" size=${15} />${t('group.remind_on', { when: fmtDateTime(r) })}</span>`;
            })()}
            ${pos.reminder_sent_at && html`<span class="row nowrap"><${Icon} name="check" size=${15} />${t('group.reminder_sent', { when: fmtDateTime(pos.reminder_sent_at) })}</span>`}
            ${over && open > 0 && html`<span class="badge st-declined">${t('group.overdue', { n: open })}</span>`}
          </div>
        </div>`
      : html`<p class="muted" style="margin:0">${t('group.no_deadline')}</p>`}
  </div>`;
}

function DeadlineModal({ ctx, onClose }) {
  const pos = ctx.pos;
  const eventStart = pos.events ? pos.events.starts_at : null;
  const [dl, setDl] = useState(toLocalInput(pos.deadline));
  // Erinnerung: entweder Vorlaufzeit (Tage + Stunden vorher) oder fester Zeitpunkt
  const initLead = pos.reminder_hours || 48;
  const [mode, setMode] = useState(pos.remind_at ? 'at' : 'lead');
  const [days, setDays] = useState(pos.remind_at ? 0 : Math.floor(initLead / 24));
  const [hrs, setHrs] = useState(pos.remind_at ? 0 : initLead % 24);
  const [at, setAt] = useState(toLocalInput(pos.remind_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const remindIso = () => {
    const dlMs = dl ? new Date(fromLocalInput(dl)).getTime() : null;
    if (mode === 'at') return fromLocalInput(at);
    if (dlMs == null) return null;
    const lead = (Math.max(0, Number(days) || 0) * 24 + Math.max(0, Number(hrs) || 0)) * 3600000;
    return new Date(dlMs - lead).toISOString();
  };

  const save = async (clear) => {
    setErr('');
    if (!clear) {
      const r = remindIso();
      const now = Date.now();
      const rMs = r ? new Date(r).getTime() : null;
      const dlMs = dl ? new Date(fromLocalInput(dl)).getTime() : null;
      if (rMs != null) {
        // Zeitpunkt muss zwischen jetzt und Event (und vor der Deadline) liegen
        if (rMs < now - 60000 || (dlMs != null && rMs >= dlMs) || (eventStart && rMs > new Date(eventStart).getTime() + 60000)) {
          return setErr(t('group.remind_invalid'));
        }
      }
      setBusy(true);
      try {
        await rpc('set_group_deadline', { pos: pos.id, dl: fromLocalInput(dl), remind: r });
        toast(t('common.saved')); ctx.reload(); onClose();
      } catch (e) { toastError(e); } finally { setBusy(false); }
    } else {
      setBusy(true);
      try { await rpc('set_group_deadline', { pos: pos.id, dl: null, remind: null }); toast(t('common.saved')); ctx.reload(); onClose(); }
      catch (e) { toastError(e); } finally { setBusy(false); }
    }
  };

  const preview = (() => { const r = remindIso(); return r ? fmtDateTime(r) : ''; })();

  return html`<${Modal} title=${t('group.deadline')} onClose=${onClose} footer=${html`
    ${pos.deadline && html`<button class="btn danger" style="margin-right:auto" onClick=${() => save(true)}>${t('group.remove_deadline')}</button>`}
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy || !dl} onClick=${() => save(false)}>${t('common.save')}</button>`}>
    <div class="stack">
      <${Field} label=${t('group.deadline')}><input class="input" type="datetime-local" value=${dl} onInput=${(e) => setDl(e.target.value)} /><//>
      <div class="field"><span class="label">${t('group.reminder')}</span>
        <div class="seg" role="group">
          <button type="button" class=${mode === 'lead' ? 'on' : ''} onClick=${() => setMode('lead')}>${t('group.remind_mode_lead')}</button>
          <button type="button" class=${mode === 'at' ? 'on' : ''} onClick=${() => setMode('at')}>${t('group.remind_mode_at')}</button>
        </div>
        ${mode === 'lead'
          ? html`<div class="row" style="margin-top:8px;align-items:flex-end">
              <label class="field" style="flex:1"><span class="small muted">${t('group.remind_days')}</span><input class="input" type="number" min="0" max="60" value=${days} onInput=${(e) => setDays(e.target.value)} /></label>
              <label class="field" style="flex:1"><span class="small muted">${t('group.remind_hours')}</span><input class="input" type="number" min="0" max="23" value=${hrs} onInput=${(e) => setHrs(e.target.value)} /></label>
              <span class="small muted" style="padding-bottom:12px">${t('group.remind_vorher')}</span>
            </div>`
          : html`<div style="margin-top:8px"><input class="input" type="datetime-local" value=${at}
              min=${toLocalInput(new Date().toISOString())} max=${eventStart ? toLocalInput(eventStart) : undefined}
              onInput=${(e) => setAt(e.target.value)} /></div>`}
        <span class="hint">${t('group.reminder_hint')}${preview ? ' · ' + t('group.remind_on', { when: preview }) : ''}</span>
      </div>
      ${err && html`<div class="notice error">${err}</div>`}
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
  // Personen für die Zuweisung (Mitglieder und Gäste der Gruppe, ohne Doppelte)
  const people = [];
  const seen = new Set();
  (ctx.members || []).forEach((a) => { if (a.profiles && !seen.has(a.user_id)) { seen.add(a.user_id); people.push(a.profiles); } });
  (ctx.guests || []).forEach((g) => { if (g.profiles && !seen.has(g.user_id)) { seen.add(g.user_id); people.push(g.profiles); } });

  return html`<div class="card">
    <div class="card-head"><${Icon} name="tasks" /><h3 class="grow">${t('tasks.title')}</h3><span class="small muted">${t('tasks.progress', { n: done, total: ctx.tasks.length })}</span></div>
    ${ctx.tasks.length > 0 && html`<div style="margin-bottom:8px"><${Progress} value=${done} max=${ctx.tasks.length} /></div>`}
    ${ctx.tasks.length === 0 && html`<p class="muted">${t('tasks.none')}</p>`}
    ${tasks.map((x) => html`<div class=${'task' + (x.done ? ' done' : '')} key=${x.id}>
      <input type="checkbox" checked=${x.done} aria-label=${x.title} onChange=${(e) => upd(x, { done: e.target.checked }).catch(() => {})} />
      <div class="grow">
        <div class="task-title"><${EditableText} value=${x.title} canEdit=${true} maxLength=${200} onSave=${(v) => upd(x, { title: v })} /></div>
        <div class="small muted line"><${Icon} name="edit" size=${13} /><${EditableText} value=${x.details} canEdit=${true} multiline required=${false} maxLength=${2000} placeholder=${t('tasks.add_details')} onSave=${(v) => upd(x, { details: v })} /></div>
        <div class="task-foot">
          ${x.assignee_profile
            ? html`<span class="chip"><${PersonHover} profile=${x.assignee_profile}><${Avatar} profile=${x.assignee_profile} size="sm" /><//>${x.assignee_profile.display_name}</span>`
            : html`<span class="small faint">${t('tasks.unassigned')}</span>`}
          <label class="assign-pick"><${Icon} name="users" size=${14} />
            <select class="input small" aria-label=${t('tasks.assign')} value=${x.assignee || ''} onChange=${(e) => upd(x, { assignee: e.target.value || null })}>
              <option value="">${t('tasks.no_assignee')}</option>
              ${people.map((p) => html`<option value=${p.id} key=${p.id}>${p.display_name}</option>`)}
            </select>
          </label>
        </div>
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
          ${s.starts_at && html`<span class="small muted">${fmtTimeRange(s.starts_at, s.ends_at)}</span>`}
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
