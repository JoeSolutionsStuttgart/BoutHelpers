// Event-Seite: Positionen mit Schichten, Verfügbarkeit, Chat, Gruppen, Gästelinks
import { html, useState, useMemo } from '../lib/h.js';
import { sb, q, rpc, appLink, flushMail, ACTIVE } from '../lib/sb.js';
import { t, fmtRange, fmtDateTime, fmtTime, fmtTimeRange, toLocalInput, fromLocalInput, localDatePart, localTimePart, combineDateTime } from '../lib/i18n.js';
import { useStore, toast, toastError, confirmDialog, promptDialog, getState } from '../lib/store.js';
import {
  Icon, Spinner, Empty, ErrorBox, Field, Modal, Person, EditableText, CopyField, Tabs, StatusBadge, Progress,
  useAsync, useRealtime, go, UnreadBadge,
} from '../lib/ui.js';
import { autoAssign } from '../lib/assign.js';
import { MyAnswerButtons } from './shared.js';
import { Chat } from './chat.js';

const PROFILE = 'profiles(id, display_name, pronouns, pronouns_custom, is_guest)';
const STATUS_ORDER = { confirmed: 0, uncertain: 1, proposed: 2, waitlist: 3, declined: 4 };

// Bezeichnung einer Schicht: eigener Name, sonst "Schicht 2", bei nur einer Schicht leer
export function shiftLabel(s, idx, count) {
  if (s.name) return s.name;
  return count > 1 ? t('shift.n', { n: idx + 1 }) : '';
}

// Zeitraum einer Schicht (oder des Events, wenn die Schicht keine Zeiten hat)
function shiftRange(s, ev) {
  return s.starts_at ? [s.starts_at, s.ends_at || s.starts_at] : [ev.starts_at, ev.ends_at || ev.starts_at];
}

// Zeiten einer Gruppe (= Position): die eingetragenen Schichtzeiten, sonst leer.
// Eine Schicht ohne Zeit → nichts; mehrere → Gesamtspanne (früheste Start, späteste Ende).
export function shiftTimesSummary(shifts, ev) {
  const timed = (shifts || []).filter((s) => s.starts_at);
  if (!timed.length) return '';
  if (timed.length === 1) return fmtTimeRange(timed[0].starts_at, timed[0].ends_at);
  const starts = timed.map((s) => new Date(s.starts_at).getTime());
  const ends = timed.map((s) => new Date(s.ends_at || s.starts_at).getTime());
  return fmtTimeRange(new Date(Math.min(...starts)).toISOString(), new Date(Math.max(...ends)).toISOString());
}

// Passt die Verfügbarkeit einer Person zur Schicht?
export function availabilityFits(av, s, ev) {
  if (!av) return null; // keine Angabe
  if (av.status === 'no') return false;
  if (av.status === 'yes') return true;
  if (!s.starts_at) return true;
  const [a, b] = shiftRange(s, ev).map((x) => new Date(x).getTime());
  return (av.windows || []).some((w) => new Date(w.from).getTime() <= a && new Date(w.to).getTime() >= b);
}

export function EventPage({ id, tab }) {
  const { user, unread } = useStore();
  const [editing, setEditing] = useState(false);
  const d = useAsync(async () => {
    const evs = await q(sb.from('events').select('*, teams(id, name, color)').eq('id', id));
    if (!evs[0]) return null;
    const ev = evs[0];
    const [perms, positions, shifts, assignments, guests, types, availability] = await Promise.all([
      rpc('my_permissions', { t: ev.team_id }),
      q(sb.from('positions').select('*').eq('event_id', id).order('sort').order('created_at')),
      q(sb.from('shifts').select('*').eq('event_id', id).order('sort').order('starts_at', { nullsFirst: true }).order('created_at')),
      q(sb.from('assignments').select('*, ' + PROFILE).eq('event_id', id).order('created_at')),
      q(sb.from('event_guests').select('*, ' + PROFILE).eq('event_id', id)),
      q(sb.from('position_types').select('*').eq('team_id', ev.team_id).order('sort').order('name')),
      q(sb.from('availability').select('*, ' + PROFILE).eq('event_id', id)),
    ]);
    const permSet = new Set(perms || []);
    // Mitgliederliste für alle Team-Mitglieder laden (für Wunschpartner & Übersicht); Gäste sehen per RLS nichts.
    const members = await q(sb.from('team_members').select('user_id, ' + PROFILE).eq('team_id', ev.team_id));
    return { ev, perms: permSet, positions, shifts, assignments, guests, members, types, availability };
  }, [id]);

  useRealtime(d.data ? 'event-' + id : null, ['assignments', 'positions', 'shifts', 'availability'], 'event_id=eq.' + id, () => d.reload(true));

  if (d.loading && !d.data) return html`<${Spinner} />`;
  if (d.error) return html`<${ErrorBox} error=${d.error} onRetry=${d.reload} />`;
  if (!d.data) return html`<div class="card"><${Empty} icon="lock" title=${t('event.no_access')} /></div>`;

  const { ev } = d.data;
  const isMember = getState().teams.some((m) => m.team_id === ev.team_id);
  const ctx = {
    ...d.data, me: user.id, isMember,
    can: (p) => d.data.perms.has(p),
    reload: () => d.reload(true),
    shiftsOf: (pid) => d.data.shifts.filter((s) => s.position_id === pid),
    avOf: (uid) => d.data.availability.find((a) => a.user_id === uid),
  };
  const manage = ctx.can('events.manage');
  const totalSlots = ctx.shifts.reduce((s, x) => s + x.slots, 0);
  const filled = ctx.assignments.filter((a) => ACTIVE.includes(a.status)).length;
  const confirmed = ctx.assignments.filter((a) => a.status === 'confirmed').length;
  const myAv = ctx.avOf(user.id);

  const saveEvent = async (patch) => {
    try { await q(sb.from('events').update(patch).eq('id', id)); ctx.reload(); toast(t('common.saved')); } catch (e) { toastError(e); throw e; }
  };

  return html`<div>
    <div class="hero" style=${{ '--hero': ev.teams ? ev.teams.color : undefined }}>
      ${isMember && ev.teams && html`<a href=${'#/team/' + ev.team_id} class="chip" style="text-decoration:none;margin-bottom:10px"><${Icon} name="left" size=${14} />${ev.teams.name}</a>`}
      <h1><${EditableText} value=${ev.title} canEdit=${manage} maxLength=${120} onSave=${(v) => saveEvent({ title: v })} /></h1>
      <div class="hero-meta">
        <span><${Icon} name="calendar" size=${18} />${fmtRange(ev.starts_at, ev.ends_at)}</span>
        ${(ev.location || manage) && html`<span><${Icon} name="pin" size=${18} /><${EditableText} value=${ev.location} canEdit=${manage} required=${false} maxLength=${300} placeholder=${t('event.add_location')} onSave=${(v) => saveEvent({ location: v })} /></span>`}
        <span><${Icon} name="users" size=${18} />${t('event.filled', { n: filled, total: totalSlots })} · ${t('event.confirmed_n', { n: confirmed })}</span>
        ${ev.respond_by && html`<span><${Icon} name="flag" size=${18} />${t('event.respond_by_on', { when: fmtDateTime(ev.respond_by) })}</span>`}
        ${ev.binding && html`<span class="chip"><${Icon} name="lock" size=${14} />${t('event.binding_badge')}</span>`}
      </div>
      <div style="margin-top:10px">
        <${EditableText} as="p" className="muted" value=${ev.description} canEdit=${manage} multiline required=${false} maxLength=${5000} placeholder=${t('event.add_description')} onSave=${(v) => saveEvent({ description: v })} />
      </div>
      <div class="row" style="margin-top:8px">
        <a class="btn small" href=${'#/event/' + id + '/availability'}><${Icon} name="clock" size=${16} />${myAv ? t('avail.mine_' + myAv.status) : t('avail.enter')}</a>
        ${manage && html`<button class="btn small" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} />${t('event.edit')}</button>`}
      </div>
    </div>

    <${Tabs} base=${'/event/' + id} active=${tab} items=${[
      { key: 'positions', label: t('event.tab_positions'), icon: 'briefcase' },
      { key: 'availability', label: t('event.tab_availability'), icon: 'clock' },
      { key: 'chat', label: t('event.tab_chat'), icon: 'chat', unread: unread.eventChat[id] },
      { key: 'groups', label: t('event.tab_groups'), icon: 'layers', unread: unread.groupsOfEvent[id] },
      { key: 'guests', label: t('event.tab_guests'), icon: 'link', hidden: !ctx.can('guests.manage') },
    ]} />

    ${tab === 'positions' && html`<${PositionsBoard} ctx=${ctx} />`}
    ${tab === 'availability' && html`<${AvailabilityTab} ctx=${ctx} />`}
    ${tab === 'chat' && html`<${Chat} eventId=${id} positionId=${null} title=${t('chat.event_title', { name: ev.title })} canModerate=${ctx.can('chat.moderate')} />`}
    ${tab === 'groups' && html`<${GroupsList} ctx=${ctx} />`}
    ${tab === 'guests' && ctx.can('guests.manage') && html`<${GuestLinks} ctx=${ctx} />`}
    ${editing && html`<${EventEditModal} ev=${ev} onClose=${() => setEditing(false)} onSaved=${ctx.reload} />`}
  </div>`;
}

// ---------------- Positionen & Schichten ----------------
function PositionsBoard({ ctx }) {
  const [modal, setModal] = useState(null); // { kind: 'position'|'shift'|'assign'|'auto'|'mail', pos, shift }
  const manage = ctx.can('events.manage');
  const byShift = useMemo(() => {
    const m = {};
    ctx.shifts.forEach((s) => { m[s.id] = []; });
    ctx.assignments.forEach((a) => { (m[a.shift_id] = m[a.shift_id] || []).push(a); });
    return m;
  }, [ctx.assignments, ctx.shifts]);
  const openSlots = ctx.shifts.reduce((s, x) => s + Math.max(0, x.slots - (byShift[x.id] || []).filter((a) => ACTIVE.includes(a.status)).length), 0);

  // Nach Status filtern: Legende anklicken (mehrere möglich); leer = alle zeigen
  const [filter, setFilter] = useState(() => new Set());
  const toggle = (s) => setFilter((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const active = filter.size ? filter : null;
  const countBy = (s) => ctx.assignments.filter((a) => a.status === s).length;

  const matches = (p) => !active || ctx.assignments.some((a) => a.position_id === p.id && active.has(a.status));
  const shown = ctx.positions.filter(matches);

  return html`<div>
    ${manage && html`<div class="toolbar">
      <button class="btn primary" onClick=${() => setModal({ kind: 'position' })}><${Icon} name="plus" />${t('pos.new')}</button>
      <button class="btn" onClick=${() => setModal({ kind: 'auto' })} disabled=${ctx.shifts.length === 0}><${Icon} name="wand" />${t('pos.auto')}${openSlots > 0 ? html`<span class="chip">${openSlots}</span>` : ''}</button>
    </div>`}
    <div class="legend">
      ${['proposed', 'confirmed', 'uncertain', 'waitlist', 'declined'].map((s) => html`
        <button type="button" key=${s} class=${'badge st-' + s + ' filter' + (active && !active.has(s) ? ' off' : '')}
          aria-pressed=${!!(active && active.has(s))} title=${t('status.' + s + '.desc')} onClick=${() => toggle(s)}>
          ${t('status.' + s)}<span class="n">${countBy(s)}</span></button>`)}
      ${active && html`<button type="button" class="badge filter clear" onClick=${() => setFilter(new Set())}><${Icon} name="x" size=${13} />${t('pos.filter_clear')}</button>`}
    </div>

    ${ctx.positions.length === 0 && html`<div class="card"><${Empty} icon="briefcase" title=${t('pos.none')} text=${manage ? t('pos.none_admin') : ''} /></div>`}
    ${ctx.positions.length > 0 && shown.length === 0 && html`<div class="card"><${Empty} icon="search" title=${t('pos.filter_none')} /></div>`}
    <div class="pos-grid">${shown.map((p) => html`<${PositionCard} key=${p.id} ctx=${ctx} pos=${p} byShift=${byShift} onModal=${setModal} filter=${active} />`)}</div>

    ${modal && modal.kind === 'position' && html`<${PositionModal} ctx=${ctx} pos=${modal.pos} onClose=${() => setModal(null)} />`}
    ${modal && modal.kind === 'shift' && html`<${ShiftModal} ctx=${ctx} pos=${modal.pos} shift=${modal.shift} onClose=${() => setModal(null)} />`}
    ${modal && modal.kind === 'assign' && html`<${AssignModal} ctx=${ctx} pos=${modal.pos} shift=${modal.shift} list=${byShift[modal.shift.id] || []} onClose=${() => setModal(null)} />`}
    ${modal && modal.kind === 'auto' && html`<${AutoAssignModal} ctx=${ctx} byShift=${byShift} onClose=${() => setModal(null)} />`}
  </div>`;
}

function PositionCard({ ctx, pos, byShift, onModal, filter }) {
  const manage = ctx.can('events.manage');
  const type = ctx.types.find((x) => x.id === pos.position_type_id);
  const shifts = ctx.shiftsOf(pos.id);
  const mineHere = ctx.assignments.some((a) => a.position_id === pos.id && a.user_id === ctx.me && ACTIVE.includes(a.status));
  const isGroupGuest = ctx.guests.some((g) => g.user_id === ctx.me && g.position_id === pos.id);
  const canGroup = manage || isGroupGuest || mineHere;
  const all = shifts.flatMap((s) => (byShift[s.id] || []).filter((a) => ACTIVE.includes(a.status)));
  const slots = shifts.reduce((n, s) => n + s.slots, 0);

  const delPos = async () => {
    if (!(await confirmDialog({ title: t('pos.delete'), text: t('pos.delete_text', { name: pos.name }), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('positions').delete().eq('id', pos.id)); ctx.reload(); } catch (e) { toastError(e); }
  };

  return html`<div class="card pos-card" style=${{ '--c': type ? type.color : 'var(--orange)' }}>
    <div class="card-head" style="margin-bottom:4px">
      <h3 class="grow">${pos.name}</h3>
      ${canGroup && html`<a class="btn icon" href=${'#/group/' + pos.id} title=${t('group.open')} aria-label=${t('group.open')}><${Icon} name="layers" /></a>`}
      ${manage && html`<button class="btn icon" title=${t('common.edit')} aria-label=${t('common.edit')} onClick=${() => onModal({ kind: 'position', pos })}><${Icon} name="edit" /></button>
        <button class="btn icon" title=${t('common.delete')} aria-label=${t('common.delete')} onClick=${delPos}><${Icon} name="trash" /></button>`}
    </div>
    <div class="row" style="gap:6px">
      ${type && type.name !== pos.name && html`<span class="chip">${type.name}</span>`}
      ${shifts.length > 1 && html`<span class="chip">${t('shift.count', { n: shifts.length })}</span>`}
      <span class="small faint">${all.length}/${slots}</span>
    </div>
    ${pos.description && html`<div class="small muted pre" style="margin-top:4px">${pos.description}</div>`}

    ${shifts.length === 0 && html`<p class="small faint">${t('shift.none')}</p>`}
    ${shifts.map((s, i) => html`<${ShiftBlock} key=${s.id} ctx=${ctx} pos=${pos} shift=${s} label=${shiftLabel(s, i, shifts.length)}
      list=${byShift[s.id] || []} onModal=${onModal} showDelete=${shifts.length > 1} filter=${filter} />`)}

    ${!filter && manage && html`<button class="btn small ghost" style="margin-top:10px" onClick=${() => onModal({ kind: 'shift', pos })}><${Icon} name="plus" size=${16} />${t('shift.add')}</button>`}
  </div>`;
}

function ShiftBlock({ ctx, pos, shift, label, list, onModal, showDelete, filter }) {
  const manage = ctx.can('events.manage');
  const pass = (a) => !filter || filter.has(a.status);
  const active = list.filter((a) => ACTIVE.includes(a.status) && pass(a)).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const waitlist = list.filter((a) => a.status === 'waitlist' && pass(a));
  const declined = list.filter((a) => a.status === 'declined' && pass(a));
  // Beim Filtern Schichten ohne passende Person ausblenden
  if (filter && active.length === 0 && waitlist.length === 0 && declined.length === 0) return null;
  const mine = list.find((a) => a.user_id === ctx.me);
  const activeCount = list.filter((a) => ACTIVE.includes(a.status)).length;
  const free = filter ? 0 : Math.max(0, shift.slots - activeCount);
  const myAv = ctx.avOf(ctx.me);
  const fits = availabilityFits(myAv, shift, ctx.ev);

  const signup = async () => {
    try {
      const st = await rpc('signup_shift', { sh: shift.id });
      toast(st === 'waitlist' ? t('pos.on_waitlist') : t('pos.signed_up'));
      ctx.reload();
    } catch (e) { toastError(e); }
  };
  const setStatus = async (a, status) => {
    try { await q(sb.from('assignments').update({ status }).eq('id', a.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  const remove = async (a) => {
    if (!(await confirmDialog({ title: t('pos.remove_person'), text: t('pos.remove_person_text', { name: a.profiles.display_name, pos: pos.name + (label ? ' · ' + label : '') }), danger: true, ok: t('common.remove') }))) return;
    try { await q(sb.from('assignments').delete().eq('id', a.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  const delShift = async () => {
    if (!(await confirmDialog({ title: t('shift.delete'), text: t('shift.delete_text', { name: label || pos.name }), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('shifts').delete().eq('id', shift.id)); ctx.reload(); } catch (e) { toastError(e); }
  };

  const avBadge = (uid) => {
    if (!manage) return null;
    const f = availabilityFits(ctx.avOf(uid), shift, ctx.ev);
    if (f === false) return html`<span class="badge st-declined" title=${t('avail.not_fitting')}><${Icon} name="clock" size=${12} />!</span>`;
    return null;
  };

  const personRow = (a, idx) => html`<div class="pos-person" key=${a.id}>
    ${idx != null && html`<b class="faint" style="width:18px">${idx + 1}.</b>`}
    <div class="grow"><${Person} profile=${a.profiles} /></div>
    ${avBadge(a.user_id)}
    ${manage
      ? html`<div class="ctl"><select class="input" value=${a.status} aria-label=${t('pos.status')} onChange=${(e) => setStatus(a, e.target.value)}>
          ${['proposed', 'confirmed', 'uncertain', 'waitlist', 'declined'].map((s) => html`<option value=${s}>${t('status.' + s)}</option>`)}
        </select>
        <button class="btn icon" aria-label=${t('common.remove')} title=${t('common.remove')} onClick=${() => remove(a)}><${Icon} name="x" size=${16} /></button></div>`
      : html`<${StatusBadge} status=${a.status} />`}
    ${a.note && html`<div class="note">„${a.note}“</div>`}
  </div>`;

  const tools = manage && html`<button class="btn icon" title=${t('shift.edit')} aria-label=${t('shift.edit')} onClick=${() => onModal({ kind: 'shift', pos, shift })}><${Icon} name="edit" size=${16} /></button>
    ${showDelete && html`<button class="btn icon" title=${t('shift.delete')} aria-label=${t('shift.delete')} onClick=${delShift}><${Icon} name="trash" size=${16} /></button>`}`;
  const hasHead = label || shift.starts_at;
  return html`<div class=${'shift' + (showDelete ? ' multi' : '')}>
    ${hasHead && html`<div class="shift-head">
      <div class="grow" style="min-width:0">
        ${label && html`<b>${label}</b>`}
        ${shift.starts_at && html`<div class="small muted line"><${Icon} name="clock" size=${14} /><span>${fmtTimeRange(shift.starts_at, shift.ends_at)}</span></div>`}
      </div>
      ${tools}
    </div>`}
    <div class="slot-line"><${Progress} value=${activeCount} max=${shift.slots} /><b class="small">${activeCount}/${shift.slots}</b>${!hasHead && tools}</div>

    ${active.map((a) => personRow(a))}
    ${Array.from({ length: free }).map((_, i) => html`<div class="slot-empty" key=${'f' + i}><span class="avatar sm">?</span>${t('pos.free_slot')}</div>`)}

    ${waitlist.length > 0 && html`<div style="margin-top:8px"><b class="small">${t('pos.waitlist', { n: waitlist.length })}</b>${waitlist.map((a, i) => personRow(a, i))}</div>`}
    ${declined.length > 0 && html`<details style="margin-top:6px"><summary class="small faint" style="cursor:pointer">${t('pos.declined_n', { n: declined.length })}</summary>${declined.map((a) => personRow(a))}</details>`}

    <div class="my-actions">
      ${!mine && html`<button class="btn small primary" onClick=${signup}><${Icon} name="userPlus" size=${16} />${free > 0 ? t('pos.signup') : t('pos.join_waitlist')}</button>
        ${fits === false && html`<span class="small" style="color:var(--st-declined)">${t('avail.you_not_available')}</span>`}`}
      ${mine && mine.status === 'declined' && html`<span class="small muted grow">${t('pos.you_declined')}</span><button class="btn small" onClick=${signup}>${t('pos.signup_again')}</button>`}
      ${mine && mine.status === 'waitlist' && html`<span class="small muted grow">${t('pos.your_waitlist_place', { n: waitlist.findIndex((a) => a.id === mine.id) + 1 })}</span>`}
      ${mine && mine.status !== 'declined' && html`<${MyAnswerButtons} a=${mine} locked=${ctx.ev.binding} onDone=${ctx.reload} />`}
      ${manage && html`<button class="btn small ghost" onClick=${() => onModal({ kind: 'assign', pos, shift })}><${Icon} name="plus" size=${16} />${t('pos.assign_person')}</button>`}
    </div>
  </div>`;
}

function PositionModal({ ctx, pos, onClose }) {
  const [f, setF] = useState({
    name: pos ? pos.name : '', type: pos ? pos.position_type_id || '' : '', description: pos ? pos.description : '',
    slots: 1, from: '', to: '', shifts: 1,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickType = (e) => {
    const typeId = e.target.value;
    const ty = ctx.types.find((x) => x.id === typeId);
    setF({ ...f, type: typeId, name: f.name || (ty ? ty.name : ''), description: f.description || (ty ? ty.description : '') });
  };
  const save = async (e) => {
    e && e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    const row = { name: f.name.trim(), position_type_id: f.type || null, description: f.description.trim() };
    try {
      if (pos) {
        await q(sb.from('positions').update(row).eq('id', pos.id));
      } else {
        const created = await q(sb.from('positions').insert({ ...row, event_id: ctx.ev.id, team_id: ctx.ev.team_id, sort: ctx.positions.length }).select('id'));
        const pid = created[0].id;
        // Schichten anlegen: bei mehreren Schichten wird der Zeitraum gleichmäßig aufgeteilt (nur Uhrzeiten)
        const n = Math.max(1, Math.min(20, Number(f.shifts) || 1));
        const evDate = localDatePart(ctx.ev.starts_at);
        const sIso = combineDateTime(evDate, f.from);
        let eIso = combineDateTime(evDate, f.to);
        if (sIso && eIso && new Date(eIso) <= new Date(sIso)) eIso = new Date(new Date(eIso).getTime() + 86400000).toISOString();
        const a = sIso ? new Date(sIso).getTime() : null;
        const b = eIso ? new Date(eIso).getTime() : null;
        const rows = Array.from({ length: n }).map((_, i) => {
          const step = a != null && b != null && b > a ? (b - a) / n : null;
          return {
            position_id: pid, event_id: ctx.ev.id, team_id: ctx.ev.team_id, sort: i, name: '',
            slots: Math.max(1, Math.min(500, Number(f.slots) || 1)),
            starts_at: a == null ? null : new Date(step ? a + step * i : a).toISOString(),
            ends_at: b == null ? null : new Date(step ? a + step * (i + 1) : b).toISOString(),
          };
        });
        await q(sb.from('shifts').insert(rows));
      }
      toast(t('common.saved'));
      ctx.reload();
      onClose();
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${pos ? t('pos.edit') : t('pos.new')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.save')}</button>`}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} label=${t('pos.type')} hint=${t('pos.type_hint')}>
        <select class="input" value=${f.type} onChange=${pickType}>
          <option value="">${t('pos.no_type')}</option>
          ${ctx.types.map((x) => html`<option value=${x.id}>${x.name}</option>`)}
        </select>
      <//>
      <${Field} label=${t('pos.name')} hint=${t('pos.name_hint')}><input class="input" required maxlength="80" value=${f.name} onInput=${set('name')} /><//>
      <${Field} className="full" label=${t('event.description')}><textarea class="input" maxlength="2000" value=${f.description} onInput=${set('description')}></textarea><//>
      ${!pos && html`
        <div class="full"><h3 style="margin:6px 0 0">${t('shift.title')}</h3><p class="small muted" style="margin:4px 0 0">${t('shift.create_hint')}</p></div>
        <${Field} label=${t('shift.how_many')}><input class="input" type="number" min="1" max="20" value=${f.shifts} onInput=${set('shifts')} /><//>
        <${Field} label=${t('shift.slots_each')}><input class="input" type="number" min="1" max="500" value=${f.slots} onInput=${set('slots')} /><//>
        <${Field} label=${t('avail.from')}><input class="input" type="time" value=${f.from} onInput=${set('from')} /><//>
        <${Field} label=${t('avail.to')}><input class="input" type="time" value=${f.to} onInput=${set('to')} /><//>`}
    </form>
  <//>`;
}

function ShiftModal({ ctx, pos, shift, onClose }) {
  const siblings = ctx.shiftsOf(pos.id);
  const last = siblings[siblings.length - 1];
  const evDate = localDatePart(ctx.ev.starts_at); // Datum der Schicht = Datum des Events
  // Neue Schicht: schließt an die letzte an, gleiche Dauer und Plätze. Nur Uhrzeiten.
  const init = () => {
    if (shift) return { name: shift.name, from: localTimePart(shift.starts_at), to: localTimePart(shift.ends_at), slots: shift.slots };
    if (last && last.starts_at && last.ends_at) {
      const dur = new Date(last.ends_at) - new Date(last.starts_at);
      return { name: '', from: localTimePart(last.ends_at), to: localTimePart(new Date(new Date(last.ends_at).getTime() + dur).toISOString()), slots: last.slots };
    }
    return { name: '', from: '', to: '', slots: last ? last.slots : 1 };
  };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e && e.preventDefault();
    setBusy(true);
    let starts = combineDateTime(evDate, f.from);
    let ends = combineDateTime(evDate, f.to);
    if (starts && ends && new Date(ends) <= new Date(starts)) ends = new Date(new Date(ends).getTime() + 86400000).toISOString(); // über Mitternacht
    const row = { name: f.name.trim(), starts_at: starts, ends_at: ends, slots: Math.max(1, Math.min(500, Number(f.slots) || 1)) };
    try {
      if (shift) await q(sb.from('shifts').update(row).eq('id', shift.id));
      else await q(sb.from('shifts').insert({ ...row, position_id: pos.id, event_id: ctx.ev.id, team_id: ctx.ev.team_id, sort: siblings.length }));
      ctx.reload();
      onClose();
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${shift ? t('shift.edit') : t('shift.add')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.save')}</button>`}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} className="full" label=${t('shift.name')} hint=${t('shift.name_hint', { n: siblings.length + (shift ? 0 : 1) })}><input class="input" maxlength="80" value=${f.name} onInput=${set('name')} /><//>
      <${Field} label=${t('avail.from')}><input class="input" type="time" value=${f.from} onInput=${set('from')} /><//>
      <${Field} label=${t('avail.to')}><input class="input" type="time" value=${f.to} onInput=${set('to')} /><//>
      <${Field} label=${t('event.slots')}><input class="input" type="number" min="1" max="500" value=${f.slots} onInput=${set('slots')} /><//>
    </form>
  <//>`;
}

function AssignModal({ ctx, pos, shift, list, onClose }) {
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('proposed');
  const [busy, setBusy] = useState(false);
  const prefs = useAsync(() => (pos.position_type_id
    ? q(sb.from('preferences').select('user_id, rank').eq('position_type_id', pos.position_type_id))
    : Promise.resolve([])), [pos.id]);
  const activeHere = new Set(list.filter((a) => a.status !== 'declined').map((a) => a.user_id));
  const people = new Map();
  ctx.members.forEach((m) => people.set(m.user_id, m.profiles));
  ctx.guests.forEach((g) => people.set(g.user_id, g.profiles));
  const busyIn = (uid) => ctx.assignments.filter((a) => a.user_id === uid && ACTIVE.includes(a.status) && a.shift_id !== shift.id)
    .map((a) => {
      const p = ctx.positions.find((x) => x.id === a.position_id);
      const s = ctx.shifts.find((x) => x.id === a.shift_id);
      return p ? p.name + (s && s.starts_at ? ' ' + fmtTime(s.starts_at) : '') : null;
    }).filter(Boolean);
  const rankOf = (uid) => { const p = (prefs.data || []).find((x) => x.user_id === uid); return p ? p.rank : null; };
  const fitOrder = (uid) => { const f = availabilityFits(ctx.avOf(uid), shift, ctx.ev); return f === true ? 0 : f === null ? 1 : 2; };
  const options = [...people.entries()].filter(([uid]) => !activeHere.has(uid))
    .sort((a, b) => fitOrder(a[0]) - fitOrder(b[0]) || (rankOf(a[0]) || 9) - (rankOf(b[0]) || 9) || String(a[1].display_name).localeCompare(String(b[1].display_name)));

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      // Serverseitig einteilen: Person wird benachrichtigt; bei verbindlichem Event direkt bestätigt
      await rpc('assign_person', { sh: shift.id, uid: userId, want_confirmed: status === 'confirmed' });
      flushMail();
      ctx.reload();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const avChip = (uid) => {
    const f = availabilityFits(ctx.avOf(uid), shift, ctx.ev);
    if (f === true) return html`<span class="badge st-confirmed">${t('avail.fits')}</span>`;
    if (f === false) return html`<span class="badge st-declined">${t('avail.not_fitting')}</span>`;
    return html`<span class="badge" style="background:var(--surface-3);color:var(--text-3)">${t('avail.unknown')}</span>`;
  };
  return html`<${Modal} title=${t('pos.assign_to', { name: pos.name })} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy || !userId} onClick=${save}>${t('pos.assign')}</button>`}>
    <div class="stack">
      ${shift.starts_at && html`<div class="small muted line"><${Icon} name="clock" size=${14} /><span>${fmtRange(shift.starts_at, shift.ends_at)}</span></div>`}
      ${ctx.ev.binding
        ? html`<p class="small muted" style="margin:0"><${Icon} name="lock" size=${14} /> ${t('pos.assign_binding_hint')}</p>`
        : html`<div class="seg">${['proposed', 'confirmed'].map((s) => html`<button type="button" class=${status === s ? 'on' : ''} onClick=${() => setStatus(s)}>${t('status.' + s)}</button>`)}</div>
          <p class="small muted" style="margin:0">${status === 'proposed' ? t('pos.assign_proposed_hint') : t('pos.assign_confirmed_hint')}</p>`}
      ${prefs.loading && html`<${Spinner} small />`}
      <div class="list" style="max-height:50vh;overflow:auto">${options.map(([uid, p]) => {
        const r = rankOf(uid);
        const other = busyIn(uid);
        return html`<label class="list-item check" key=${uid} style="cursor:pointer">
          <input type="radio" name="who" checked=${userId === uid} onChange=${() => setUserId(uid)} />
          <div class="grow"><${Person} profile=${p} sub=${other.length ? t('pos.already_in', { list: other.join(', ') }) : ''} /></div>
          ${avChip(uid)}
          ${r && html`<span class="badge st-waitlist" title=${t('prefs.rank_n', { n: r })}>★ ${r}</span>`}
        </label>`;
      })}</div>
      ${options.length === 0 && html`<p class="muted">${t('pos.nobody_left')}</p>`}
    </div>
  <//>`;
}

function AutoAssignModal({ ctx, byShift, onClose }) {
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null); // Anzahl übernommener Vorschläge
  const plan = useAsync(async () => {
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const [prefs, history] = await Promise.all([
      q(sb.from('preferences').select('user_id, position_type_id, rank').eq('team_id', ctx.ev.team_id)),
      q(sb.from('assignments').select('user_id, event_id, events!inner(starts_at)').eq('team_id', ctx.ev.team_id)
        .in('status', ['confirmed', 'proposed', 'uncertain']).neq('event_id', ctx.ev.id).gte('events.starts_at', since)),
    ]);
    const load = {};
    history.forEach((h) => { load[h.user_id] = (load[h.user_id] || 0) + 1; });
    const busySet = new Set(ctx.assignments.filter((a) => ACTIVE.includes(a.status)).map((a) => a.user_id));
    const taken = new Set(ctx.assignments.map((a) => a.shift_id + ':' + a.user_id));
    const units = ctx.shifts.map((s) => {
      const p = ctx.positions.find((x) => x.id === s.position_id) || {};
      return { id: s.id, typeId: p.position_type_id, open: Math.max(0, s.slots - (byShift[s.id] || []).filter((a) => ACTIVE.includes(a.status)).length) };
    });
    const shiftById = Object.fromEntries(ctx.shifts.map((s) => [s.id, s]));
    const base = {
      positions: units,
      preferences: prefs.map((p) => ({ userId: p.user_id, typeId: p.position_type_id, rank: p.rank })),
      busy: busySet, taken, load,
      // Wer für die Schicht "nicht" verfügbar ist, wird nicht eingeteilt; ohne Angabe nur bei Gleichstand nachrangig
      allowed: (uid, sid) => availabilityFits(ctx.avOf(uid), shiftById[sid], ctx.ev) !== false,
      extraCost: (uid, sid) => (availabilityFits(ctx.avOf(uid), shiftById[sid], ctx.ev) === true ? 0 : 5),
    };
    // Wunschpartner (Feature): wer sich jemanden wünscht, soll möglichst auf dieselbe Position.
    const wishes = new Map(); const wishedBy = new Map();
    ctx.availability.forEach((a) => (a.partners || []).forEach((p) => {
      if (!wishes.has(a.user_id)) wishes.set(a.user_id, new Set());
      wishes.get(a.user_id).add(p);
      if (!wishedBy.has(p)) wishedBy.set(p, new Set());
      wishedBy.get(p).add(a.user_id);
    }));
    // Erster Durchlauf ohne Partner-Bonus; daraus ergibt sich, wer vorläufig wo steht.
    const first = autoAssign(base);
    let result = first;
    if (wishes.size > 0) {
      const placed = {};
      const addP = (posId, uid) => { (placed[posId] = placed[posId] || new Set()).add(uid); };
      ctx.assignments.filter((a) => ACTIVE.includes(a.status)).forEach((a) => addP(a.position_id, a.user_id));
      first.forEach((r) => { const s = shiftById[r.positionId]; if (s) addP(s.position_id, r.userId); });
      const bonus = (uid, sid) => {
        const s = shiftById[sid]; if (!s) return 0;
        const set = placed[s.position_id]; if (!set) return 0;
        const want = wishes.get(uid); const by = wishedBy.get(uid);
        for (const w of set) { if (w !== uid && ((want && want.has(w)) || (by && by.has(w)))) return 300; }
        return 0;
      };
      result = autoAssign({ ...base, bonus });
    }
    return { result, units };
  }, []);

  const nameOf = (uid) => { const m = ctx.members.find((x) => x.user_id === uid); return m ? m.profiles.display_name : '?'; };
  const apply = async () => {
    setBusy(true);
    try {
      const rows = plan.data.result.map((r) => {
        const s = ctx.shifts.find((x) => x.id === r.positionId);
        return { shift_id: s.id, position_id: s.position_id, event_id: ctx.ev.id, team_id: ctx.ev.team_id, user_id: r.userId, status: 'proposed', source: 'auto' };
      });
      if (rows.length) await q(sb.from('assignments').insert(rows));
      toast(t('auto.done', { n: rows.length }));
      setApplied(rows.length);
      ctx.reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const res = plan.data;
  const totalOpen = res ? res.units.reduce((s, p) => s + p.open, 0) : 0;
  const done = applied !== null;
  return html`<${Modal} wide title=${t('pos.auto')} onClose=${onClose} footer=${done
    ? html`<button class="btn primary" onClick=${onClose}>${t('common.close')}</button>`
    : html`<button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
      <button class="btn primary" disabled=${busy || !res || res.result.length === 0} onClick=${apply}><${Icon} name="check" />${t('auto.apply')}</button>`}>
    ${done && html`<div class="stack">
      <div class="notice ok">${t('auto.done', { n: applied })}</div>
      <${EventMailBox} ctx=${ctx} />
    </div>`}
    ${!done && html`<p class="muted">${t('auto.intro')}</p>
    <p class="small muted">${t('auto.availability_note')}</p>`}
    ${!done && plan.loading && html`<${Spinner} />`}
    ${!done && plan.error && html`<div class="notice error">${String(plan.error.message || plan.error)}</div>`}
    ${!done && res && html`<div class="stack">
      ${totalOpen === 0
        ? html`<div class="notice ok">${t('auto.nothing_open')}</div>`
        : html`<div class=${'notice ' + (res.result.length === totalOpen ? 'ok' : 'warn')}>${t('auto.summary', { n: res.result.length, total: totalOpen })}</div>`}
      ${ctx.positions.map((p) => {
        const shifts = ctx.shiftsOf(p.id);
        const rows = shifts.map((s, i) => ({ s, i, open: res.units.find((x) => x.id === s.id).open })).filter((x) => x.open > 0);
        if (!rows.length) return null;
        return html`<div class="card flat" style="padding:14px" key=${p.id}>
          <b>${p.name}</b>
          ${!p.position_type_id && html`<div class="small faint">${t('auto.no_type')}</div>`}
          ${rows.map(({ s, i, open }) => {
            const picks = res.result.filter((r) => r.positionId === s.id);
            const label = shiftLabel(s, i, shifts.length) || (s.starts_at ? fmtRange(s.starts_at, s.ends_at) : '');
            return html`<div class="row" style="margin-top:6px">
              ${label && html`<span class="small muted" style="min-width:90px">${label}</span>`}
              ${picks.map((r) => html`<span class="chip">${nameOf(r.userId)} · ★${r.rank}</span>`)}
              ${picks.length < open && html`<span class="chip" style="background:var(--st-uncertain-bg);color:var(--st-uncertain)">${t('auto.missing', { n: open - picks.length })}</span>`}
            </div>`;
          })}
        </div>`;
      })}
      <${EventMailBox} ctx=${ctx} />
    </div>`}
  <//>`;
}

// E-Mail an alle eingeteilten Personen – wird sofort verschickt, nichts wird für später gespeichert
function EventMailBox({ ctx }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const people = new Set(ctx.assignments.filter((a) => ACTIVE.includes(a.status)).map((a) => a.user_id)).size;
  const send = async () => {
    setBusy(true);
    try {
      const n = await rpc('send_event_mails', { e: ctx.ev.id });
      setSent(n);
      flushMail();
      ctx.reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return html`<div class="card flat mail-box">
    <div class="row" style="align-items:flex-start">
      <${Icon} name="mail" />
      <div class="grow">
        <b>${t('auto.mail_title')}</b>
        <p class="small muted" style="margin:4px 0 0">${t('mail.intro')} ${t('mail.guest_note')}</p>
      </div>
    </div>
    ${sent !== null
      ? html`<div class="notice ok">${t('auto.mail_sent', { n: sent })}</div>`
      : html`<div class="row"><button class="btn primary" disabled=${busy || people === 0} onClick=${send}>
          <${Icon} name="send" />${people ? t('auto.mail_button', { n: people }) : t('auto.mail_none')}</button></div>`}
  </div>`;
}

// ---------------- Verfügbarkeit ----------------
function AvailabilityTab({ ctx }) {
  const mine = ctx.avOf(ctx.me);
  const ev = ctx.ev;
  const defWindow = () => ({ from: toLocalInput(ev.starts_at), to: toLocalInput(ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 4 * 3600000).toISOString()) });
  const [status, setStatus] = useState(mine ? mine.status : '');
  const [windows, setWindows] = useState(mine && mine.windows && mine.windows.length
    ? mine.windows.map((w) => ({ from: toLocalInput(w.from), to: toLocalInput(w.to) })) : [defWindow()]);
  const [note, setNote] = useState(mine ? mine.note : '');
  const [partners, setPartners] = useState(() => new Set((mine && mine.partners) || []));
  const [busy, setBusy] = useState(false);
  // Mögliche Wunschpartner: andere Team-Mitglieder (keine Gäste, nicht man selbst)
  const partnerPeople = ctx.members.filter((m) => m.user_id !== ctx.me && !(m.profiles && m.profiles.is_guest));
  const togglePartner = (uid) => setPartners((prev) => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });

  const save = async () => {
    if (!status) return;
    setBusy(true);
    const row = {
      status, note: note.trim(), updated_at: new Date().toISOString(),
      partners: [...partners].filter((uid) => partnerPeople.some((m) => m.user_id === uid)),
      windows: status === 'partly' ? windows.filter((w) => w.from && w.to && w.to > w.from).map((w) => ({ from: fromLocalInput(w.from), to: fromLocalInput(w.to) })) : [],
    };
    try {
      if (mine) await q(sb.from('availability').update(row).eq('event_id', ev.id).eq('user_id', ctx.me));
      else await q(sb.from('availability').insert({ ...row, event_id: ev.id, user_id: ctx.me }));
      toast(t('common.saved'));
      ctx.reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const setW = (i, k, v) => setWindows(windows.map((w, j) => (j === i ? { ...w, [k]: v } : w)));

  const groups = { yes: [], partly: [], no: [] };
  ctx.availability.forEach((a) => groups[a.status] && groups[a.status].push(a));
  // Wer eingeteilt ist oder sich eingetragen hat, zählt auch ohne eigene Angabe als verfügbar
  // (bestätigt/vorgemerkt → verfügbar, ungewiss → teilweise). Nur wenn keine eigene Angabe da ist.
  const explicit = new Set(ctx.availability.map((a) => a.user_id));
  const rank = { confirmed: 3, proposed: 2, uncertain: 1 };
  const implied = new Map();
  ctx.assignments.forEach((a) => {
    if (!ACTIVE.includes(a.status) || explicit.has(a.user_id)) return;
    const cur = implied.get(a.user_id);
    if (!cur || rank[a.status] > rank[cur.status]) implied.set(a.user_id, { status: a.status, profiles: a.profiles });
  });
  implied.forEach((v, uid) => {
    const k = v.status === 'uncertain' ? 'partly' : 'yes';
    groups[k].push({ user_id: uid, profiles: v.profiles, implied: v.status });
  });
  const answered = new Set([...explicit, ...implied.keys()]);
  const missing = ctx.members.filter((m) => !answered.has(m.user_id));
  const nameOf = (uid) => { const m = ctx.members.find((x) => x.user_id === uid); return m ? m.profiles.display_name : null; };

  return html`<div class="stack">
    <div class="card stack">
      <div class="card-head"><${Icon} name="clock" /><h3 class="grow">${t('avail.mine')}</h3></div>
      <p class="small muted" style="margin:0">${t('avail.intro')}</p>
      <div class="choice3" role="group">${['yes', 'partly', 'no'].map((k) => html`
        <button type="button" class=${'choice av-' + k + (status === k ? ' on' : '')} aria-pressed=${status === k} onClick=${() => setStatus(k)}>
          <span class=${'dot av-' + k}></span>${t('avail.' + k)}</button>`)}</div>
      ${status === 'partly' && html`<div class="stack-sm">
        <span class="small" style="font-weight:750">${t('avail.windows')}</span>
        ${windows.map((w, i) => html`<div class="row" key=${i}>
          <input class="input" style="flex:1;min-width:180px" type="datetime-local" aria-label=${t('avail.from')} value=${w.from} onInput=${(e) => setW(i, 'from', e.target.value)} />
          <span class="faint">–</span>
          <input class="input" style="flex:1;min-width:180px" type="datetime-local" aria-label=${t('avail.to')} value=${w.to} onInput=${(e) => setW(i, 'to', e.target.value)} />
          ${windows.length > 1 && html`<button class="btn icon" aria-label=${t('common.remove')} onClick=${() => setWindows(windows.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>`}
        </div>`)}
        <div><button class="btn small ghost" onClick=${() => setWindows([...windows, defWindow()])}><${Icon} name="plus" size=${16} />${t('avail.add_window')}</button></div>
      </div>`}
      <${Field} label=${t('avail.note')}><input class="input" maxlength="500" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder=${t('avail.note_placeholder')} /><//>
      ${partnerPeople.length > 0 && html`<div class="field">
        <span class="label">${t('avail.partners')}</span>
        <p class="small muted" style="margin:0 0 6px">${t('avail.partners_hint')}</p>
        <div class="partner-pick">${partnerPeople.map((m) => html`<label class=${'chip toggle' + (partners.has(m.user_id) ? ' on' : '')} key=${m.user_id}>
          <input type="checkbox" checked=${partners.has(m.user_id)} onChange=${() => togglePartner(m.user_id)} />${m.profiles.display_name}</label>`)}</div>
      </div>`}
      <div class="row"><button class="btn primary" disabled=${busy || !status} onClick=${save}><${Icon} name="check" />${t('common.save')}</button></div>
    </div>

    <div class="card">
      <div class="card-head"><${Icon} name="users" /><h3 class="grow">${t('avail.overview')}</h3>
        <span class="chip"><span class="dot av-yes"></span>${groups.yes.length}</span>
        <span class="chip"><span class="dot av-partly"></span>${groups.partly.length}</span>
        <span class="chip"><span class="dot av-no"></span>${groups.no.length}</span>
      </div>
      ${['yes', 'partly', 'no'].map((k) => groups[k].length > 0 && html`<div style="margin-bottom:10px">
        <b class="small"><span class=${'dot av-' + k}></span> ${t('avail.' + k)}</b>
        ${groups[k].map((a) => html`<div class="pos-person" key=${a.user_id}>
          <div class="grow"><${Person} profile=${a.profiles} sub=${a.implied ? t('avail.from_assignment') : (k === 'partly' ? (a.windows || []).map((w) => fmtRange(w.from, w.to)).join(' · ') : '')} /></div>
          ${a.implied && html`<span class="chip small" title=${t('avail.from_assignment')}><${Icon} name="briefcase" size=${12} />${t('status.' + a.implied)}</span>`}
          ${a.note && html`<div class="note">„${a.note}“</div>`}
          ${ctx.can('events.manage') && a.partners && a.partners.length > 0 && (() => {
            const names = a.partners.map(nameOf).filter(Boolean);
            return names.length > 0 && html`<div class="note" style="color:var(--text-2)"><${Icon} name="star" size=${12} /> ${t('avail.wants_with', { names: names.join(', ') })}</div>`;
          })()}
        </div>`)}
      </div>`)}
      ${ctx.availability.length === 0 && html`<p class="muted" style="margin:0">${t('avail.none_yet')}</p>`}
      ${missing.length > 0 && html`<details><summary class="small faint" style="cursor:pointer">${t('avail.missing_n', { n: missing.length })}</summary>
        <div class="row" style="margin-top:8px">${missing.map((m) => html`<span class="chip">${m.profiles.display_name}</span>`)}</div></details>`}
    </div>
  </div>`;
}

// ---------------- Gruppen ----------------
function GroupsList({ ctx }) {
  const { unread } = useStore();
  const manage = ctx.can('events.manage');
  return html`<div>
    <p class="muted">${t('groups.intro')}</p>
    <div class="grid">${ctx.positions.map((p) => {
      const members = new Set(ctx.assignments.filter((a) => a.position_id === p.id && ACTIVE.includes(a.status)).map((a) => a.user_id));
      const mine = members.has(ctx.me) || ctx.guests.some((g) => g.user_id === ctx.me && g.position_id === p.id);
      const open = manage || mine;
      const n = ctx.shiftsOf(p.id).length;
      const body = html`
        <div class="row"><h3 class="grow" style="margin:0">${p.name}</h3>${mine ? html`<span class="badge st-confirmed">${t('groups.yours')}</span>` : !open && html`<${Icon} name="lock" size=${18} />`}<${UnreadBadge} n=${unread.byGroup[p.id]} /></div>
        <div class="small muted">${t('groups.members_n', { n: members.size })}${n > 1 ? ' · ' + t('shift.count', { n }) : ''}</div>
        ${(() => { const tm = shiftTimesSummary(ctx.shiftsOf(p.id), ctx.ev); return tm && html`<div class="small row"><${Icon} name="clock" size=${15} />${tm}</div>`; })()}
        ${p.deadline && html`<div class="small row"><${Icon} name="flag" size=${15} />${t('group.deadline')}: ${fmtDateTime(p.deadline)}</div>`}
        ${!open && html`<div class="small faint">${t('groups.locked')}</div>`}`;
      return open
        ? html`<a class=${'card team-card' + (unread.byGroup[p.id] ? ' has-unread' : '')} href=${'#/group/' + p.id} key=${p.id}>${body}</a>`
        : html`<div class="card" key=${p.id} style="opacity:0.75">${body}</div>`;
    })}</div>
    ${ctx.positions.length === 0 && html`<div class="card"><${Empty} icon="layers" title=${t('pos.none')} /></div>`}
  </div>`;
}

function EventEditModal({ ev, onClose, onSaved }) {
  const [f, setF] = useState({
    title: ev.title, starts: toLocalInput(ev.starts_at), ends: toLocalInput(ev.ends_at), location: ev.location, description: ev.description,
    binding: !!ev.binding, respondBy: toLocalInput(ev.respond_by),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e && e.preventDefault();
    if (!f.title.trim() || !f.starts) return;
    setBusy(true);
    try {
      await q(sb.from('events').update({
        title: f.title.trim(), starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends), location: f.location.trim(), description: f.description.trim(),
        binding: f.binding, respond_by: fromLocalInput(f.respondBy),
      }).eq('id', ev.id));
      toast(t('common.saved'));
      onSaved();
      onClose();
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: t('event.delete'), text: t('event.delete_text', { name: ev.title }), danger: true, ok: t('event.delete') }))) return;
    try { await q(sb.from('events').delete().eq('id', ev.id)); onClose(); go('/team/' + ev.team_id); } catch (err) { toastError(err); }
  };
  return html`<${Modal} title=${t('event.edit')} onClose=${onClose} footer=${html`
    <button class="btn danger" style="margin-right:auto" onClick=${del}><${Icon} name="trash" size=${16} />${t('event.delete')}</button>
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.save')}</button>`}>
    <form class="form-grid" onSubmit=${save}>
      <${Field} className="full" label=${t('event.title')}><input class="input" required maxlength="120" value=${f.title} onInput=${set('title')} /><//>
      <${Field} label=${t('event.starts')}><input class="input" type="datetime-local" required value=${f.starts} onInput=${set('starts')} /><//>
      <${Field} label=${t('event.ends')}><input class="input" type="datetime-local" value=${f.ends} onInput=${set('ends')} /><//>
      <${Field} className="full" label=${t('event.location')}><input class="input" maxlength="300" value=${f.location} onInput=${set('location')} /><//>
      <${Field} className="full" label=${t('event.description')}><textarea class="input" maxlength="5000" value=${f.description} onInput=${set('description')}></textarea><//>
      <${Field} className="full" label=${t('event.respond_by')} hint=${t('event.respond_by_hint')}>
        <input class="input" type="datetime-local" value=${f.respondBy} onInput=${set('respondBy')} /><//>
      <label class="check full"><input type="checkbox" checked=${f.binding} onChange=${(e) => setF({ ...f, binding: e.target.checked })} />
        <span><b>${t('event.binding')}</b><span class="small faint" style="display:block">${t('event.binding_hint')}</span></span></label>
    </form>
  <//>`;
}



// ---------------- Gästelinks ----------------
const SYL = ['ka', 'lo', 'mi', 'su', 'te', 'ra', 'no', 'vi', 'pe', 'du', 'fa', 'ze', 'bo', 'li', 'ma', 'to'];
export function randomPassword() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return SYL[r[0] % 16] + SYL[r[1] % 16] + '-' + SYL[r[2] % 16] + SYL[r[3] % 16] + '-' + String(10 + (r[4] % 90));
}
const randomToken = () => crypto.randomUUID().replace(/-/g, '');
const SLUG = /^[a-z0-9][a-z0-9-]{3,63}$/;

function GuestLinks({ ctx }) {
  const [creating, setCreating] = useState(false);
  const links = useAsync(() => q(sb.from('guest_links').select('*').eq('event_id', ctx.ev.id).order('created_at')), [ctx.ev.id]);
  const posName = (pid) => (pid ? (ctx.positions.find((p) => p.id === pid) || {}).name : null);

  const upd = async (l, patch) => {
    try { await q(sb.from('guest_links').update(patch).eq('id', l.id)); links.reload(true); toast(t('common.saved')); } catch (e) { toastError(e); throw e; }
  };
  const changePassword = async (l) => {
    const pw = await promptDialog({ title: t('guest.change_password'), label: t('guest.password'), value: randomPassword(), maxLength: 64, required: true, ok: t('common.save') });
    if (pw === null) return;
    if (pw.trim().length < 4) return toast(t('guest.password_short'), 'error');
    upd(l, { password: pw.trim() }).catch(() => {});
  };
  const changeLink = async (l) => {
    const v = await promptDialog({ title: t('guest.change_link'), text: t('guest.change_link_text'), label: t('guest.link_text'), value: l.token, maxLength: 64, ok: t('common.save') });
    if (v === null) return;
    const tok = v.trim().toLowerCase() || randomToken();
    if (!SLUG.test(tok)) return toast(t('guest.slug_invalid'), 'error');
    upd(l, { token: tok }).catch(() => {});
  };
  const del = async (l) => {
    if (!(await confirmDialog({ title: t('guest.delete'), text: t('guest.delete_text'), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('guest_links').delete().eq('id', l.id)); links.reload(true); ctx.reload(); } catch (e) { toastError(e); }
  };
  const kick = async (g) => {
    if (!(await confirmDialog({ title: t('guest.remove'), text: t('guest.remove_text', { name: g.profiles.display_name }), danger: true, ok: t('common.remove') }))) return;
    try { await q(sb.from('event_guests').delete().eq('id', g.id)); ctx.reload(); } catch (e) { toastError(e); }
  };

  return html`<div class="stack">
    <div class="toolbar"><p class="grow muted" style="margin:0">${t('guest.intro')}</p>
      <button class="btn primary" onClick=${() => setCreating(true)}><${Icon} name="plus" />${t('guest.new')}</button></div>
    ${links.loading && html`<${Spinner} />`}
    ${links.data && links.data.length === 0 && html`<div class="card"><${Empty} icon="link" title=${t('guest.none')} /></div>`}
    ${(links.data || []).map((l) => {
      const joined = ctx.guests.filter((g) => g.link_id === l.id);
      return html`<div class="card stack-sm" key=${l.id} style=${{ opacity: l.active ? 1 : 0.7 }}>
        <div class="row">
          <h3 class="grow" style="margin:0"><${EditableText} value=${l.label} canEdit=${true} required=${false} maxLength=${100} placeholder=${t('guest.add_label')} onSave=${(v) => upd(l, { label: v })} /></h3>
          <span class="chip">${l.position_id ? t('guest.for_group', { name: posName(l.position_id) }) : t('guest.for_event')}</span>
          <label class="row nowrap small"><input type="checkbox" checked=${l.active} onChange=${(e) => upd(l, { active: e.target.checked }).catch(() => {})} style="width:20px;height:20px;accent-color:var(--primary)" />${l.active ? t('guest.active') : t('guest.inactive')}</label>
        </div>
        <${CopyField} value=${appLink('/g/' + l.token)} />
        <div class="row small">
          <${Icon} name="key" size=${16} /><span>${t('guest.password')}: <code>${l.password}</code></span>
          <button class="btn small ghost" onClick=${() => changePassword(l)}>${t('guest.change_password')}</button>
          <button class="btn small ghost" onClick=${() => changeLink(l)}>${t('guest.change_link')}</button>
          <button class="btn small ghost" onClick=${() => upd(l, { token: randomToken() }).catch(() => {})}><${Icon} name="refresh" size=${14} />${t('guest.new_random_link')}</button>
          <span class="grow"></span>
          <button class="btn small danger" onClick=${() => del(l)}><${Icon} name="trash" size=${14} />${t('common.delete')}</button>
        </div>
        ${joined.length > 0 && html`<details><summary class="small muted" style="cursor:pointer">${t('guest.joined_n', { n: joined.length })}</summary>
          ${joined.map((g) => html`<div class="pos-person" key=${g.id}><div class="grow"><${Person} profile=${g.profiles} guest /></div>
            <button class="btn icon" aria-label=${t('common.remove')} onClick=${() => kick(g)}><${Icon} name="x" size=${16} /></button></div>`)}
        </details>`}
      </div>`;
    })}
    ${creating && html`<${GuestLinkModal} ctx=${ctx} onClose=${() => setCreating(false)} onSaved=${() => links.reload(true)} />`}
  </div>`;
}

function GuestLinkModal({ ctx, onClose, onSaved }) {
  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState(randomPassword());
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e && e.preventDefault();
    if (password.trim().length < 4) return toast(t('guest.password_short'), 'error');
    const tok = slug.trim().toLowerCase();
    if (tok && !SLUG.test(tok)) return toast(t('guest.slug_invalid'), 'error');
    setBusy(true);
    try {
      const row = { event_id: ctx.ev.id, team_id: ctx.ev.team_id, position_id: target || null, label: label.trim(), password: password.trim() };
      if (tok) row.token = tok;
      await q(sb.from('guest_links').insert(row));
      onSaved();
      onClose();
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('guest.new')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.create')}</button>`}>
    <form class="stack" onSubmit=${save}>
      <${Field} label=${t('guest.target')}>
        <select class="input" value=${target} onChange=${(e) => setTarget(e.target.value)}>
          <option value="">${t('guest.for_event')}</option>
          ${ctx.positions.map((p) => html`<option value=${p.id}>${t('guest.for_group', { name: p.name })}</option>`)}
        </select>
      <//>
      <${Field} label=${t('guest.label')} hint=${t('guest.label_hint')}><input class="input" maxlength="100" value=${label} onInput=${(e) => setLabel(e.target.value)} /><//>
      <${Field} label=${t('guest.password')} hint=${t('guest.password_hint')}>
        <div class="row nowrap"><input class="input" maxlength="64" required value=${password} onInput=${(e) => setPassword(e.target.value)} />
          <button type="button" class="btn icon" aria-label=${t('guest.new_random')} onClick=${() => setPassword(randomPassword())}><${Icon} name="refresh" /></button></div>
      <//>
      <${Field} label=${t('guest.link_text_optional')} hint=${t('guest.change_link_text')}><input class="input" maxlength="64" placeholder="sommerfest-catering" value=${slug} onInput=${(e) => setSlug(e.target.value)} /><//>
    </form>
  <//>`;
}
