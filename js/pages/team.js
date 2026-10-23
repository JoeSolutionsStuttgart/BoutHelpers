// Team-Seite: Events, Mitglieder, Rollen, Positionen & Wünsche, Einladungen, Einstellungen
import { html, useState } from '../lib/h.js';
import { sb, q, rpc, PERMISSIONS, appLink, flushMail } from '../lib/sb.js';
import { t, fmtDateTime, fmtRelative, fromLocalInput } from '../lib/i18n.js';
import { useStore, toast, toastError, confirmDialog, loadTeams } from '../lib/store.js';
import {
  Icon, Spinner, Empty, ErrorBox, Field, Modal, Swatches, Person, Avatar, EditableText, CopyField, Tabs,
  useAsync, go, PALETTE, UnreadBadge,
} from '../lib/ui.js';
import { DateBox } from './shared.js';

export function TeamPage({ id, tab }) {
  const { user } = useStore();
  const d = useAsync(async () => {
    const [teams, perms, members, roles, memberRoles, types, prefs, requests, guests] = await Promise.all([
      q(sb.from('teams').select('*').eq('id', id)),
      rpc('my_permissions', { t: id }),
      q(sb.from('team_members').select('user_id, is_owner, joined_at, profiles(id, display_name, pronouns, pronouns_custom, is_guest)').eq('team_id', id)),
      q(sb.from('roles').select('*').eq('team_id', id).order('sort').order('created_at')),
      q(sb.from('member_roles').select('user_id, role_id').eq('team_id', id)),
      q(sb.from('position_types').select('*').eq('team_id', id).order('sort').order('name')),
      q(sb.from('preferences').select('user_id, position_type_id, rank').eq('team_id', id)),
      q(sb.from('join_requests').select('id, message, created_at, user_id, profiles(id, display_name, pronouns, pronouns_custom)').eq('team_id', id).order('created_at')),
      q(sb.from('event_guests').select('user_id, event_id, profiles(id, display_name, pronouns, pronouns_custom, is_guest), events!inner(id, title, team_id)').eq('events.team_id', id)),
    ]);
    if (!teams[0]) return null;
    members.sort((a, b) => String(a.profiles && a.profiles.display_name).localeCompare(String(b.profiles && b.profiles.display_name)));
    return { team: teams[0], perms: new Set(perms || []), members, roles, memberRoles, types, prefs, requests, guests };
  }, [id]);

  if (d.loading && !d.data) return html`<${Spinner} />`;
  if (d.error) return html`<${ErrorBox} error=${d.error} onRetry=${d.reload} />`;
  if (!d.data) return html`<div class="card"><${Empty} icon="lock" title=${t('team.no_access')} text=${t('team.no_access_text')}><a class="btn" href="#/teams/find">${t('nav.find_team')}</a><//></div>`;

  const ctx = { ...d.data, me: user.id, reload: () => d.reload(true), can: (p) => d.data.perms.has(p) };
  const { team } = ctx;
  const saveTeam = async (patch) => {
    try { await q(sb.from('teams').update(patch).eq('id', id)); await ctx.reload(); loadTeams(); toast(t('common.saved')); } catch (e) { toastError(e); throw e; }
  };
  const myRoles = ctx.roles.filter((r) => ctx.memberRoles.some((m) => m.user_id === user.id && m.role_id === r.id));
  const isOwner = ctx.members.some((m) => m.user_id === user.id && m.is_owner);

  return html`<div>
    <div class="hero" style=${{ '--hero': team.color }}>
      <h1><${EditableText} value=${team.name} canEdit=${ctx.can('team.edit')} maxLength=${80} onSave=${(v) => saveTeam({ name: v })} /></h1>
      <${EditableText} as="p" className="muted" value=${team.description} placeholder=${t('team.add_description')} multiline required=${false} maxLength=${2000}
        canEdit=${ctx.can('team.edit')} onSave=${(v) => saveTeam({ description: v })} />
      <div class="hero-meta">
        <span><${Icon} name="users" size=${18} />${t('team.members_count', { n: ctx.members.length })}</span>
        ${isOwner && html`<span class="chip">${t('team.owner')}</span>`}
        ${myRoles.map((r) => html`<span class="chip">${r.name}</span>`)}
      </div>
    </div>

    <${Tabs} base=${'/team/' + id} active=${tab} items=${[
      { key: 'events', label: t('team.tab_events'), icon: 'calendar' },
      { key: 'members', label: t('team.tab_members'), icon: 'users', count: ctx.can('members.manage') ? ctx.requests.length : 0 },
      { key: 'roles', label: t('team.tab_roles'), icon: 'shield' },
      { key: 'positions', label: t('team.tab_positions'), icon: 'briefcase' },
      { key: 'invite', label: t('team.tab_invite'), icon: 'userPlus', hidden: !ctx.can('invites.create') },
      { key: 'settings', label: t('team.tab_settings'), icon: 'settings' },
    ]} />

    ${tab === 'events' && html`<${EventsTab} ctx=${ctx} />`}
    ${tab === 'members' && html`<${MembersTab} ctx=${ctx} />`}
    ${tab === 'roles' && html`<${RolesTab} ctx=${ctx} />`}
    ${tab === 'positions' && html`<${PositionsTab} ctx=${ctx} />`}
    ${tab === 'invite' && html`<${InviteTab} ctx=${ctx} />`}
    ${tab === 'settings' && html`<${SettingsTab} ctx=${ctx} saveTeam=${saveTeam} isOwner=${isOwner} />`}
  </div>`;
}

// ---------------- Events ----------------
function EventsTab({ ctx }) {
  const [creating, setCreating] = useState(false);
  const ev = useAsync(() => q(sb.from('events').select('id, title, starts_at, ends_at, location').eq('team_id', ctx.team.id).order('starts_at')), [ctx.team.id]);
  const now = Date.now() - 86400000;
  const list = ev.data || [];
  const upcoming = list.filter((e) => new Date(e.ends_at || e.starts_at).getTime() >= now);
  const past = list.filter((e) => new Date(e.ends_at || e.starts_at).getTime() < now).reverse();
  const { unread } = useStore();
  const row = (e) => html`<a class=${'event-card' + (unread.byEvent[e.id] ? ' has-unread' : '')} href=${'#/event/' + e.id} key=${e.id}>
    <${DateBox} date=${e.starts_at} color=${ctx.team.color} />
    <div class="grow"><b>${e.title}</b><div class="small muted">${fmtDateTime(e.starts_at)}${e.location ? ' · ' + e.location : ''}</div></div>
    <${UnreadBadge} n=${unread.byEvent[e.id]} />
    <${Icon} name="right" />
  </a>`;
  return html`<div>
    <div class="toolbar">
      <h2 class="grow" style="margin:0">${t('team.upcoming_events')}</h2>
      ${ctx.can('events.manage') && html`<button class="btn primary" onClick=${() => setCreating(true)}><${Icon} name="plus" />${t('event.new')}</button>`}
    </div>
    ${ev.loading && html`<${Spinner} />`}
    ${ev.data && html`<div class="card" style="padding:6px">
      ${upcoming.length ? upcoming.map(row) : html`<${Empty} icon="calendar" title=${t('team.no_events')} text=${ctx.can('events.manage') ? t('team.no_events_text') : ''} />`}
    </div>
    ${past.length > 0 && html`<details style="margin-top:18px"><summary class="muted" style="cursor:pointer;font-weight:750">${t('team.past_events', { n: past.length })}</summary>
      <div class="card" style="padding:6px;margin-top:10px">${past.map(row)}</div></details>`}`}
    ${creating && html`<${EventCreateModal} ctx=${ctx} onClose=${() => setCreating(false)} />`}
  </div>`;
}

function EventCreateModal({ ctx, onClose }) {
  const [f, setF] = useState({ title: '', starts: '', ends: '', location: '', description: '' });
  const [slots, setSlots] = useState(() => Object.fromEntries(ctx.types.map((x) => [x.id, 0])));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e && e.preventDefault();
    if (!f.title.trim() || !f.starts) return toast(t('event.need_title_date'), 'error');
    setBusy(true);
    try {
      const rows = await q(sb.from('events').insert({
        team_id: ctx.team.id, title: f.title.trim(), starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
        location: f.location.trim(), description: f.description.trim(), created_by: ctx.me,
      }).select('id'));
      const evId = rows[0].id;
      const chosen = ctx.types.filter((x) => Number(slots[x.id]) > 0);
      const pos = chosen.map((x, i) => ({
        event_id: evId, team_id: ctx.team.id, position_type_id: x.id, name: x.name, description: x.description, sort: i,
      }));
      if (pos.length) {
        const created = await q(sb.from('positions').insert(pos).select('id, position_type_id'));
        await q(sb.from('shifts').insert(created.map((c) => ({
          position_id: c.id, event_id: evId, team_id: ctx.team.id, name: '',
          slots: Math.min(500, Number(slots[c.position_type_id]) || 1),
        }))));
      }
      toast(t('event.created'));
      go('/event/' + evId);
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('event.new')} onClose=${onClose} wide footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}><${Icon} name="check" />${t('event.create')}</button>`}>
    <form class="stack" onSubmit=${save}>
      <div class="form-grid">
        <${Field} className="full" label=${t('event.title')}><input class="input" required maxlength="120" value=${f.title} onInput=${set('title')} /><//>
        <${Field} label=${t('event.starts')}><input class="input" type="datetime-local" required value=${f.starts} onInput=${set('starts')} /><//>
        <${Field} label=${t('event.ends')}><input class="input" type="datetime-local" value=${f.ends} onInput=${set('ends')} /><//>
        <${Field} className="full" label=${t('event.location')}><input class="input" maxlength="300" value=${f.location} onInput=${set('location')} /><//>
        <${Field} className="full" label=${t('event.description')}><textarea class="input" maxlength="5000" value=${f.description} onInput=${set('description')}></textarea><//>
      </div>
      <div>
        <h3>${t('event.positions_from_types')}</h3>
        <p class="small muted">${t('event.positions_from_types_hint')}</p>
        ${ctx.types.length === 0 && html`<div class="notice">${t('event.no_types')}</div>`}
        ${ctx.types.map((x) => html`<div class="rank-row" key=${x.id}>
          <span class="dot" style=${{ background: x.color }}></span><b class="grow">${x.name}</b>
          <label class="row nowrap small">${t('event.slots')}
            <input class="input" type="number" min="0" max="500" style="width:90px" value=${slots[x.id]} onInput=${(e) => setSlots({ ...slots, [x.id]: e.target.value })} />
          </label>
        </div>`)}
      </div>
    </form>
  <//>`;
}

// ---------------- Mitglieder ----------------
function MembersTab({ ctx }) {
  const [editRoles, setEditRoles] = useState(null);
  const approve = async (r) => {
    try { await rpc('approve_join_request', { req: r.id }); toast(t('members.approved', { name: r.profiles.display_name })); flushMail(); ctx.reload(); loadTeams(); } catch (e) { toastError(e); }
  };
  const decline = async (r) => {
    if (!(await confirmDialog({ title: t('members.decline'), text: t('members.decline_text', { name: r.profiles.display_name }), danger: true, ok: t('members.decline') }))) return;
    try { await q(sb.from('join_requests').delete().eq('id', r.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  const remove = async (m) => {
    if (!(await confirmDialog({ title: t('members.remove'), text: t('members.remove_text', { name: m.profiles.display_name }), danger: true, ok: t('members.remove') }))) return;
    try { await q(sb.from('team_members').delete().eq('team_id', ctx.team.id).eq('user_id', m.user_id)); toast(t('common.saved')); ctx.reload(); } catch (e) { toastError(e); }
  };
  const makeOwner = async (m) => {
    if (!(await confirmDialog({ title: t('members.make_owner'), text: t('members.make_owner_text', { name: m.profiles.display_name }), ok: t('members.make_owner') }))) return;
    try { await rpc('transfer_ownership', { t: ctx.team.id, new_owner: m.user_id }); toast(t('common.saved')); ctx.reload(); loadTeams(); } catch (e) { toastError(e); }
  };
  const removeGuest = async (g) => {
    if (!(await confirmDialog({ title: t('members.remove_guest'), text: t('members.remove_guest_text', { name: g.profiles.display_name }), danger: true, ok: t('common.remove') }))) return;
    try { await rpc('remove_guest', { t: ctx.team.id, uid: g.profiles.id }); toast(t('common.saved')); ctx.reload(); } catch (e) { toastError(e); }
  };
  const isOwner = ctx.members.some((m) => m.user_id === ctx.me && m.is_owner);
  const rolesOf = (uid) => ctx.roles.filter((r) => ctx.memberRoles.some((m) => m.user_id === uid && m.role_id === r.id));
  const countForRole = (rid) => ctx.memberRoles.filter((m) => m.role_id === rid).length;
  const noRoleCount = ctx.members.filter((m) => !m.is_owner && rolesOf(m.user_id).length === 0).length;
  // Gäste des Teams (über alle Events), nach Person zusammengefasst
  const guestMap = new Map();
  (ctx.guests || []).forEach((g) => {
    if (!g.profiles) return;
    const cur = guestMap.get(g.user_id) || { profiles: g.profiles, events: new Set() };
    if (g.events && g.events.title) cur.events.add(g.events.title);
    guestMap.set(g.user_id, cur);
  });
  const guestList = [...guestMap.values()].sort((a, b) => String(a.profiles.display_name).localeCompare(String(b.profiles.display_name)));

  return html`<div class="stack">
    <div class="card">
      <div class="card-head"><${Icon} name="users" /><h3 class="grow">${t('members.overview')}</h3></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <span class="chip colored" style="background:var(--violet)">${t('team.owner')}: ${ctx.members.filter((m) => m.is_owner).length}</span>
        ${ctx.roles.map((r) => html`<span class="chip colored" key=${r.id} style=${{ background: r.color }}>${r.name}: ${countForRole(r.id)}</span>`)}
        <span class="chip">${t('members.no_role')}: ${noRoleCount}</span>
        ${guestList.length > 0 && html`<span class="chip"><${Icon} name="user" size=${13} />${t('members.guests')}: ${guestList.length}</span>`}
      </div>
    </div>

    ${ctx.can('members.manage') && html`<div class="card">
      <div class="card-head"><${Icon} name="bell" /><h3 class="grow">${t('members.requests')}</h3><span class="chip">${ctx.requests.length}</span></div>
      ${ctx.requests.length === 0
        ? html`<p class="muted" style="margin:0">${t('members.no_requests')}</p>`
        : html`<div class="list">${ctx.requests.map((r) => html`<div class="list-item" key=${r.id}>
            <div class="grow"><${Person} profile=${r.profiles} sub=${fmtDateTime(r.created_at)} />
              ${r.message && html`<div class="small muted pre" style="margin:6px 0 0 38px">„${r.message}“</div>`}</div>
            <button class="btn small success" onClick=${() => approve(r)}><${Icon} name="check" size=${16} />${t('members.approve')}</button>
            <button class="btn small danger" onClick=${() => decline(r)}><${Icon} name="x" size=${16} />${t('members.decline')}</button>
          </div>`)}</div>`}
    </div>`}

    <div class="card">
      <div class="card-head"><${Icon} name="users" /><h3 class="grow">${t('team.tab_members')}</h3>
        ${ctx.can('invites.create') && html`<a class="btn small" href=${'#/team/' + ctx.team.id + '/invite'}><${Icon} name="userPlus" size=${16} />${t('team.tab_invite')}</a>`}
      </div>
      <div class="list">${ctx.members.map((m) => html`<div class="list-item" key=${m.user_id}>
        <div class="grow" style="min-width:180px"><${Person} profile=${m.profiles} size="" /></div>
        <div class="row" style="gap:6px">
          ${m.is_owner && html`<span class="chip colored" style="background:var(--violet)">${t('team.owner')}</span>`}
          ${rolesOf(m.user_id).map((r) => html`<span class="chip colored" style=${{ background: r.color }}>${r.name}</span>`)}
          ${!m.is_owner && rolesOf(m.user_id).length === 0 && html`<span class="chip faint">${t('members.no_role')}</span>`}
        </div>
        <div class="row" style="gap:4px">
          ${ctx.can('roles.manage') && html`<button class="btn small ghost" onClick=${() => setEditRoles(m)}><${Icon} name="shield" size=${16} />${t('members.roles')}</button>`}
          ${isOwner && !m.is_owner && m.user_id !== ctx.me && html`<button class="btn icon" title=${t('members.make_owner')} aria-label=${t('members.make_owner')} onClick=${() => makeOwner(m)}><${Icon} name="star" size=${18} /></button>`}
          ${ctx.can('members.manage') && !m.is_owner && m.user_id !== ctx.me && html`<button class="btn icon" title=${t('members.remove')} aria-label=${t('members.remove')} onClick=${() => remove(m)}><${Icon} name="trash" size=${18} /></button>`}
        </div>
      </div>`)}</div>
    </div>

    ${guestList.length > 0 && html`<div class="card">
      <div class="card-head"><${Icon} name="user" /><h3 class="grow">${t('members.guests')}</h3><span class="chip">${guestList.length}</span></div>
      <p class="muted small" style="margin:0 0 6px">${t('members.guests_hint')}</p>
      <div class="list">${guestList.map((g) => html`<div class="list-item" key=${g.profiles.id}>
        <div class="grow" style="min-width:160px"><${Person} profile=${g.profiles} guest /></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${[...g.events].slice(0, 6).map((title) => html`<span class="chip">${title}</span>`)}</div>
        ${ctx.can('guests.manage') && html`<button class="btn icon" title=${t('members.remove_guest')} aria-label=${t('members.remove_guest')} onClick=${() => removeGuest(g)}><${Icon} name="trash" size=${18} /></button>`}
      </div>`)}</div>
    </div>`}
    ${editRoles && html`<${MemberRolesModal} ctx=${ctx} member=${editRoles} onClose=${() => setEditRoles(null)} />`}
  </div>`;
}

function MemberRolesModal({ ctx, member, onClose }) {
  const initial = new Set(ctx.memberRoles.filter((m) => m.user_id === member.user_id).map((m) => m.role_id));
  const [sel, setSel] = useState(new Set(initial));
  const [busy, setBusy] = useState(false);
  const toggle = (rid) => { const s = new Set(sel); s.has(rid) ? s.delete(rid) : s.add(rid); setSel(s); };
  const save = async () => {
    setBusy(true);
    try {
      const add = [...sel].filter((r) => !initial.has(r)).map((role_id) => ({ team_id: ctx.team.id, user_id: member.user_id, role_id }));
      const del = [...initial].filter((r) => !sel.has(r));
      if (add.length) await q(sb.from('member_roles').insert(add));
      if (del.length) await q(sb.from('member_roles').delete().eq('user_id', member.user_id).in('role_id', del));
      toast(t('common.saved'));
      ctx.reload();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('members.roles_of', { name: member.profiles.display_name })} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.save')}</button>`}>
    ${ctx.roles.length === 0 && html`<p class="muted">${t('roles.none')}</p>`}
    ${ctx.roles.map((r) => html`<label class="check" key=${r.id}>
      <input type="checkbox" checked=${sel.has(r.id)} onChange=${() => toggle(r.id)} />
      <span><span class="chip colored" style=${{ background: r.color }}>${r.name}</span>
        <span class="small faint" style="display:block;margin-top:2px">${r.permissions.length ? r.permissions.map((p) => t('perm.' + p)).join(', ') : t('roles.no_permissions')}</span></span>
    </label>`)}
  <//>`;
}

// ---------------- Rollen ----------------
function RolesTab({ ctx }) {
  const [creating, setCreating] = useState(false);
  const can = ctx.can('roles.manage');
  const update = async (role, patch) => {
    try { await q(sb.from('roles').update(patch).eq('id', role.id)); ctx.reload(); toast(t('common.saved')); } catch (e) { toastError(e); throw e; }
  };
  const togglePerm = (role, p) => {
    const has = role.permissions.includes(p);
    update(role, { permissions: has ? role.permissions.filter((x) => x !== p) : [...role.permissions, p] }).catch(() => {});
  };
  const remove = async (role) => {
    if (!(await confirmDialog({ title: t('roles.delete'), text: t('roles.delete_text', { name: role.name }), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('roles').delete().eq('id', role.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  return html`<div class="stack">
    <div class="toolbar">
      <p class="grow muted" style="margin:0">${t('roles.intro')}</p>
      ${can && html`<button class="btn primary" onClick=${() => setCreating(true)}><${Icon} name="plus" />${t('roles.new')}</button>`}
    </div>
    ${ctx.roles.length === 0 && html`<div class="card"><${Empty} icon="shield" title=${t('roles.none')} /></div>`}
    ${ctx.roles.map((r) => {
      const holders = ctx.members.filter((m) => ctx.memberRoles.some((x) => x.role_id === r.id && x.user_id === m.user_id));
      return html`<div class="card" key=${r.id} style=${{ borderTop: '6px solid ' + r.color }}>
        <div class="card-head">
          <h3 class="grow"><${EditableText} value=${r.name} canEdit=${can} maxLength=${60} onSave=${(v) => update(r, { name: v })} /></h3>
          ${can && html`<button class="btn icon" aria-label=${t('common.delete')} onClick=${() => remove(r)}><${Icon} name="trash" /></button>`}
        </div>
        ${can && html`<details class="color-pick" style="margin-bottom:12px"><summary><span class="dot" style=${{ background: r.color }}></span>${t('team.color')}</summary><${Swatches} value=${r.color} onChange=${(c) => update(r, { color: c }).catch(() => {})} /></details>`}
        <div class="perm-list">${PERMISSIONS.map((p) => html`<label class="check" key=${p}>
          <input type="checkbox" checked=${r.permissions.includes(p)} disabled=${!can} onChange=${() => togglePerm(r, p)} />
          <span><b>${t('perm.' + p)}</b><span class="small faint" style="display:block">${t('perm.' + p + '.desc')}</span></span>
        </label>`)}</div>
        <div class="row" style="margin-top:12px;gap:6px">
          <span class="small faint">${t('roles.holders', { n: holders.length })}</span>
          ${holders.slice(0, 12).map((m) => html`<${Avatar} profile=${m.profiles} size="sm" />`)}
        </div>
      </div>`;
    })}
    <p class="small faint">${t('roles.owner_note')}</p>
    ${creating && html`<${RoleCreateModal} ctx=${ctx} onClose=${() => setCreating(false)} />`}
  </div>`;
}

function RoleCreateModal({ ctx, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[5]);
  const [perms, setPerms] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (p) => { const s = new Set(perms); s.has(p) ? s.delete(p) : s.add(p); setPerms(s); };
  const save = async (e) => {
    e && e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await q(sb.from('roles').insert({ team_id: ctx.team.id, name: name.trim(), color, permissions: [...perms], sort: ctx.roles.length }));
      ctx.reload();
      onClose();
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('roles.new')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}>${t('common.create')}</button>`}>
    <form class="stack" onSubmit=${save}>
      <${Field} label=${t('roles.name')}><input class="input" required maxlength="60" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <div class="field"><span class="label">${t('team.color')}</span><${Swatches} value=${color} onChange=${setColor} /></div>
      <div class="field"><span class="label">${t('roles.permissions')}</span>
        ${PERMISSIONS.map((p) => html`<label class="check" key=${p}><input type="checkbox" checked=${perms.has(p)} onChange=${() => toggle(p)} />
          <span><b>${t('perm.' + p)}</b><span class="small faint" style="display:block">${t('perm.' + p + '.desc')}</span></span></label>`)}
      </div>
    </form>
  <//>`;
}

// ---------------- Positionen & Wünsche ----------------
function PositionsTab({ ctx }) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[2]);
  const canTypes = ctx.can('positions.manage');
  const canSeeAll = ctx.can('events.manage') || canTypes;
  const myRank = (typeId) => {
    const p = ctx.prefs.find((x) => x.user_id === ctx.me && x.position_type_id === typeId);
    return p ? p.rank : 0;
  };
  const setRank = async (typeId, rank) => {
    try {
      const mine = sb.from('preferences');
      if (!rank) await q(mine.delete().eq('user_id', ctx.me).eq('position_type_id', typeId));
      else if (myRank(typeId)) await q(mine.update({ rank, updated_at: new Date().toISOString() }).eq('user_id', ctx.me).eq('position_type_id', typeId));
      else await q(mine.insert({ team_id: ctx.team.id, user_id: ctx.me, position_type_id: typeId, rank }));
      ctx.reload();
    } catch (e) { toastError(e); }
  };
  const addType = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await q(sb.from('position_types').insert({ team_id: ctx.team.id, name: newName.trim(), color: newColor, sort: ctx.types.length }));
      setNewName('');
      ctx.reload();
    } catch (err) { toastError(err); }
  };
  const updType = async (x, patch) => {
    try { await q(sb.from('position_types').update(patch).eq('id', x.id)); ctx.reload(); toast(t('common.saved')); } catch (e) { toastError(e); throw e; }
  };
  const delType = async (x) => {
    if (!(await confirmDialog({ title: t('types.delete'), text: t('types.delete_text', { name: x.name }), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('position_types').delete().eq('id', x.id)); ctx.reload(); } catch (e) { toastError(e); }
  };
  const nameOf = (uid) => { const m = ctx.members.find((x) => x.user_id === uid); return m ? m.profiles : { id: uid, display_name: '?' }; };

  return html`<div class="stack">
    <div class="card">
      <div class="card-head"><${Icon} name="star" /><h3 class="grow">${t('prefs.mine')}</h3></div>
      <p class="muted small">${t('prefs.intro')}</p>
      ${ctx.types.length === 0 && html`<${Empty} icon="briefcase" title=${t('types.none')} text=${canTypes ? t('types.none_admin') : t('types.none_member')} />`}
      ${ctx.types.map((x) => {
        const r = myRank(x.id);
        return html`<div class="rank-row" key=${x.id}>
          <span class="dot" style=${{ background: x.color }}></span>
          <div class="grow" style="min-width:140px"><b>${x.name}</b>${x.description && html`<div class="small faint">${x.description}</div>`}</div>
          <div class="rank-pick" role="group" aria-label=${t('prefs.rank_for', { name: x.name })}>
            <button class=${'off' + (r === 0 ? ' on' : '')} title=${t('prefs.no_interest')} aria-pressed=${r === 0} onClick=${() => setRank(x.id, 0)}>–</button>
            ${[1, 2, 3, 4, 5].map((n) => html`<button class=${r === n ? 'on' : ''} aria-pressed=${r === n} title=${t('prefs.rank_n', { n })} onClick=${() => setRank(x.id, n)}>${n}</button>`)}
          </div>
        </div>`;
      })}
    </div>

    ${(canTypes || ctx.types.length > 0) && html`<div class="card">
      <div class="card-head"><${Icon} name="briefcase" /><h3 class="grow">${t('types.title')}</h3></div>
      <p class="muted small">${t('types.intro')}</p>
      <div class="list">${ctx.types.map((x) => html`<div class="list-item" key=${x.id}>
        <span class="dot" style=${{ background: x.color, width: '14px', height: '14px' }}></span>
        <div class="grow" style="min-width:180px">
          <b><${EditableText} value=${x.name} canEdit=${canTypes} maxLength=${60} onSave=${(v) => updType(x, { name: v })} /></b>
          <div class="small muted"><${EditableText} value=${x.description} canEdit=${canTypes} multiline required=${false} maxLength=${1000} placeholder=${t('types.add_description')} onSave=${(v) => updType(x, { description: v })} /></div>
          ${canTypes && html`<details class="color-pick" style="margin-top:6px"><summary><span class="dot" style=${{ background: x.color }}></span>${t('team.color')}</summary><${Swatches} value=${x.color} onChange=${(c) => updType(x, { color: c }).catch(() => {})} /></details>`}
        </div>
        ${canTypes && html`<button class="btn icon" aria-label=${t('common.delete')} onClick=${() => delType(x)}><${Icon} name="trash" /></button>`}
      </div>`)}</div>
      ${canTypes && html`<form class="row" style="margin-top:12px" onSubmit=${addType}>
        <input class="input grow" style="min-width:180px" maxlength="60" placeholder=${t('types.new_placeholder')} value=${newName} onInput=${(e) => setNewName(e.target.value)} />
        <${Swatches} value=${newColor} onChange=${setNewColor} />
        <button class="btn primary"><${Icon} name="plus" />${t('common.add')}</button>
      </form>`}
    </div>`}

    ${canSeeAll && ctx.types.length > 0 && html`<div class="card">
      <div class="card-head"><${Icon} name="users" /><h3 class="grow">${t('prefs.overview')}</h3></div>
      <div class="grid">${ctx.types.map((x) => {
        const list = ctx.prefs.filter((p) => p.position_type_id === x.id).sort((a, b) => a.rank - b.rank);
        return html`<div class="card flat" key=${x.id} style=${{ borderTop: '4px solid ' + x.color, padding: '14px' }}>
          <b>${x.name}</b> <span class="small faint">(${list.length})</span>
          <div class="stack-sm" style="margin-top:8px">${list.length === 0 ? html`<span class="small faint">${t('prefs.nobody')}</span>` : list.map((p) => html`
            <div class="row nowrap"><span class="badge st-waitlist">${p.rank}</span><span class="grow">${nameOf(p.user_id).display_name}</span></div>`)}</div>
        </div>`;
      })}</div>
    </div>`}
  </div>`;
}

// ---------------- Einladen ----------------
function InviteTab({ ctx }) {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null);
  const inv = useAsync(() => q(sb.from('invites').select('*').eq('team_id', ctx.team.id).order('created_at', { ascending: false })), [ctx.team.id]);
  const active = (inv.data || []).filter((i) => !i.revoked && new Date(i.expires_at) > new Date());

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const rows = await q(sb.from('invites').insert({ team_id: ctx.team.id, email: email.trim(), note: note.trim() }).select('*'));
      const i = rows[0];
      if (i.email) {
        await rpc('send_invite_mail', { inv: i.id });
        flushMail();
        toast(t('invite.mail_sent', { email: i.email }));
      }
      setFresh(i);
      setEmail(''); setNote('');
      inv.reload(true);
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  const revoke = async (i) => {
    try { await q(sb.from('invites').update({ revoked: true }).eq('id', i.id)); inv.reload(true); if (fresh && fresh.id === i.id) setFresh(null); } catch (e) { toastError(e); }
  };

  return html`<div class="stack">
    <div class="card">
      <div class="card-head"><${Icon} name="userPlus" /><h3 class="grow">${t('invite.create')}</h3></div>
      <p class="muted small">${t('invite.intro')}</p>
      <form class="form-grid" onSubmit=${create}>
        <${Field} label=${t('invite.email_optional')} hint=${t('invite.email_hint')}><input class="input" type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
        <${Field} label=${t('invite.note_optional')}><input class="input" maxlength="200" value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
        <div class="full"><button class="btn primary" disabled=${busy}><${Icon} name="link" />${email.trim() ? t('invite.create_send') : t('invite.create_link')}</button></div>
      </form>
      ${fresh && html`<div class="notice ok" style="margin-top:14px"><div style="margin-bottom:8px">${t('invite.ready')}</div><${CopyField} value=${appLink('/invite/' + fresh.token)} /></div>`}
    </div>

    <div class="card">
      <div class="card-head"><${Icon} name="clock" /><h3 class="grow">${t('invite.active')}</h3></div>
      ${inv.loading && html`<${Spinner} />`}
      ${!inv.loading && active.length === 0 && html`<p class="muted" style="margin:0">${t('invite.none')}</p>`}
      <div class="list">${active.map((i) => html`<div class="list-item" key=${i.id} style="display:block">
        <div class="row" style="margin-bottom:8px">
          <b class="grow">${i.email || i.note || t('invite.link')}</b>
          <span class="chip"><${Icon} name="clock" size=${14} />${t('invite.expires', { when: fmtRelative(i.expires_at) })}</span>
          <span class="chip">${t('invite.uses', { n: i.uses })}</span>
          <button class="btn small danger" onClick=${() => revoke(i)}>${t('invite.revoke')}</button>
        </div>
        <${CopyField} value=${appLink('/invite/' + i.token)} />
      </div>`)}</div>
    </div>
    <p class="small faint"><${Icon} name="search" size=${14} /> ${ctx.team.discoverable ? t('invite.discoverable_on') : t('invite.discoverable_off')}</p>
  </div>`;
}

// ---------------- Einstellungen ----------------
function SettingsTab({ ctx, saveTeam, isOwner }) {
  const can = ctx.can('team.edit');
  const leave = async () => {
    if (!(await confirmDialog({ title: t('team.leave'), text: t('team.leave_text', { name: ctx.team.name }), danger: true, ok: t('team.leave') }))) return;
    try { await q(sb.from('team_members').delete().eq('team_id', ctx.team.id).eq('user_id', ctx.me)); await loadTeams(); go('/'); } catch (e) { toastError(e); }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: t('team.delete'), text: t('team.delete_text', { name: ctx.team.name }), danger: true, ok: t('team.delete') }))) return;
    try { await q(sb.from('teams').delete().eq('id', ctx.team.id)); await loadTeams(); toast(t('team.deleted')); go('/'); } catch (e) { toastError(e); }
  };
  return html`<div class="stack">
    <div class="card stack">
      <h3>${t('team.tab_settings')}</h3>
      <div class="field"><span class="label">${t('team.name')}</span><${EditableText} value=${ctx.team.name} canEdit=${can} maxLength=${80} onSave=${(v) => saveTeam({ name: v })} /></div>
      <div class="field"><span class="label">${t('team.description')}</span><${EditableText} value=${ctx.team.description} canEdit=${can} multiline required=${false} maxLength=${2000} placeholder=${t('team.add_description')} onSave=${(v) => saveTeam({ description: v })} /></div>
      ${can && html`<div class="field"><span class="label">${t('team.color')}</span><${Swatches} value=${ctx.team.color} onChange=${(c) => saveTeam({ color: c }).catch(() => {})} /></div>`}
      <label class="check"><input type="checkbox" checked=${ctx.team.discoverable} disabled=${!can} onChange=${(e) => saveTeam({ discoverable: e.target.checked }).catch(() => {})} />
        <span><b>${t('team.discoverable')}</b><span class="small faint" style="display:block">${t('team.discoverable_hint')}</span></span></label>
    </div>
    <div class="card stack">
      <h3>${t('team.danger_zone')}</h3>
      ${!isOwner && html`<div class="row"><span class="grow muted">${t('team.leave_hint')}</span><button class="btn danger" onClick=${leave}><${Icon} name="logout" />${t('team.leave')}</button></div>`}
      ${isOwner && html`<div class="row"><span class="grow muted">${t('team.delete_hint')}</span><button class="btn danger" onClick=${del}><${Icon} name="trash" />${t('team.delete')}</button></div>`}
    </div>
  </div>`;
}

