// Team gründen und Teams finden (Beitrittsanfrage)
import { html, useState, useEffect } from '../lib/h.js';
import { sb, q, rpc, PERMISSIONS } from '../lib/sb.js';
import { t, fmtDateTime } from '../lib/i18n.js';
import { toast, toastError, promptDialog, confirmDialog, loadTeams, isGuest, useStore } from '../lib/store.js';
import { Icon, Field, Swatches, Empty, Spinner, PALETTE, go, useAsync, UnreadBadge } from '../lib/ui.js';

export function NewTeamPage() {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  if (isGuest()) return html`<div class="card"><${Empty} icon="lock" title=${t('err.guest_not_allowed')} /></div>`;
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      // Standard-Rollen in der aktuellen Sprache (alle Namen sind später änderbar)
      const roles = [
        { name: t('role.default_admin'), color: '#7c5cff', permissions: PERMISSIONS, mine: true },
        { name: t('role.default_orga'), color: '#ff9f2e', permissions: ['events.manage', 'positions.manage', 'guests.manage', 'invites.create', 'chat.moderate'] },
        { name: t('role.default_member'), color: '#12b8a6', permissions: [] },
      ];
      const id = await rpc('create_team', { p_name: name.trim(), p_description: desc.trim(), p_color: color, p_roles: roles });
      await loadTeams();
      toast(t('team.created'));
      go('/team/' + id + '/positions');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return html`<div style="max-width:640px">
    <div class="hero" style=${{ '--hero': color }}>
      <h1>${t('team.new_title')}</h1>
      <p class="muted" style="margin:0">${t('team.new_text')}</p>
    </div>
    <form class="card stack" onSubmit=${submit}>
      <${Field} label=${t('team.name')}><input class="input" required maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <${Field} label=${t('team.description')}><textarea class="input" maxlength="2000" value=${desc} onInput=${(e) => setDesc(e.target.value)}></textarea><//>
      <div class="field"><span class="label">${t('team.color')}</span><${Swatches} value=${color} onChange=${setColor} /></div>
      <div class="row"><button class="btn primary" disabled=${busy}><${Icon} name="check" />${t('team.create')}</button></div>
    </form>
  </div>`;
}

export function FindTeamPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const mine = useAsync(() => rpc('my_join_requests'), []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return undefined; }
    const h = setTimeout(async () => {
      setBusy(true);
      try { setResults(await rpc('search_teams', { q: query })); } catch (e) { toastError(e); } finally { setBusy(false); }
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  if (isGuest()) return html`<div class="card"><${Empty} icon="lock" title=${t('err.guest_not_allowed')} /></div>`;

  const request = async (team) => {
    const msg = await promptDialog({ title: t('join.request_title', { team: team.name }), label: t('join.message_optional'), multiline: true, maxLength: 500, ok: t('join.request') });
    if (msg === null) return;
    try {
      await rpc('request_join', { t: team.id, msg });
      toast(t('join.requested'));
      setResults((r) => r.map((x) => (x.id === team.id ? { ...x, requested: true } : x)));
      mine.reload(true);
    } catch (e) { toastError(e); }
  };

  const withdraw = async (r) => {
    if (!(await confirmDialog({ title: t('join.withdraw'), text: t('join.withdraw_text', { team: r.team_name }), danger: true, ok: t('join.withdraw') }))) return;
    try {
      await q(sb.from('join_requests').delete().eq('id', r.id));
      mine.reload(true);
      setResults((rs) => rs && rs.map((x) => (x.id === r.team_id ? { ...x, requested: false } : x)));
    } catch (e) { toastError(e); }
  };

  return html`<div>
    <div class="hero" style=${{ '--hero': 'var(--teal)' }}>
      <h1>${t('join.find_title')}</h1>
      <p class="muted" style="margin:0">${t('join.find_text')}</p>
    </div>
    <div class="card stack">
      <label class="row nowrap"><${Icon} name="search" /><input class="input" type="search" placeholder=${t('join.search_placeholder')} value=${query} onInput=${(e) => setQuery(e.target.value)} /></label>
      ${busy && html`<${Spinner} small />`}
      ${results && results.length === 0 && html`<${Empty} icon="search" title=${t('join.no_results')} />`}
      ${results && results.length > 0 && html`<div class="list">${results.map((r) => html`
        <div class="list-item" key=${r.id}>
          <span class="dot" style=${{ background: r.color, width: '14px', height: '14px' }}></span>
          <div class="grow"><b>${r.name}</b><div class="small muted">${t('team.members_count', { n: r.member_count })}${r.description ? ' · ' + r.description.slice(0, 120) : ''}</div></div>
          ${r.is_member
            ? html`<a class="btn small" href=${'#/team/' + r.id}>${t('join.open_team')}</a>`
            : r.requested
              ? html`<span class="badge st-waitlist">${t('join.pending')}</span>`
              : html`<button class="btn small primary" onClick=${() => request(r)}><${Icon} name="userPlus" size=${16} />${t('join.request')}</button>`}
        </div>`)}</div>`}
    </div>

    ${mine.data && mine.data.length > 0 && html`
      <div class="section-title"><h2>${t('join.my_requests')}</h2></div>
      <div class="card"><div class="list">${mine.data.map((r) => html`
        <div class="list-item" key=${r.id}>
          <span class="dot" style=${{ background: r.team_color }}></span>
          <div class="grow"><b>${r.team_name}</b><div class="small faint">${fmtDateTime(r.created_at)}</div></div>
          <span class="badge st-waitlist">${t('join.pending')}</span>
          <button class="btn small ghost" onClick=${() => withdraw(r)}>${t('join.withdraw')}</button>
        </div>`)}</div></div>`}

    <p class="muted small" style="margin-top:16px"><${Icon} name="link" size=${14} /> ${t('join.have_link')}</p>
  </div>`;
}

// Liste der eigenen Teams (vor allem für die Navigation am Handy)
export function TeamsListPage() {
  const { teams, unread } = useStore();
  if (isGuest()) return html`<div class="card"><${Empty} icon="lock" title=${t('err.guest_not_allowed')} /></div>`;
  return html`<div>
    <div class="section-title" style="margin-top:0"><h2>${t('home.my_teams')}</h2></div>
    <div class="toolbar">
      <a class="btn primary" href="#/teams/new"><${Icon} name="plus" />${t('nav.new_team')}</a>
      <a class="btn" href="#/teams/find"><${Icon} name="search" />${t('nav.find_team')}</a>
    </div>
    ${teams.length === 0
      ? html`<div class="card"><${Empty} icon="users" title=${t('home.no_teams')} text=${t('home.no_teams_text')} /></div>`
      : html`<div class="grid">${teams.map((m) => html`
          <a class=${'card team-card' + (unread.byTeam[m.team_id] ? ' has-unread' : '')} href=${'#/team/' + m.team_id} key=${m.team_id}>
            <span class="stripe" style=${{ background: m.teams.color }}></span>
            <div class="row"><h3 class="grow" style="margin:0">${m.teams.name}</h3>${m.is_owner && html`<span class="chip">${t('team.owner')}</span>`}<${UnreadBadge} n=${unread.byTeam[m.team_id]} /></div>
            ${m.teams.description && html`<div class="small muted">${m.teams.description}</div>`}
          </a>`)}</div>`}
  </div>`;
}
