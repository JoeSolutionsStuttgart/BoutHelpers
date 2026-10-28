// Startseite: Neuigkeiten, eigene Einsätze, nächste Events, Teams
import { html } from '../lib/h.js';
import { sb, q, rpc } from '../lib/sb.js';
import { t, fmtDateTime, fmtRange } from '../lib/i18n.js';
import { useStore, isGuest } from '../lib/store.js';
import { Icon, Spinner, Empty, StatusBadge, useAsync, ErrorBox, UnreadBadge } from '../lib/ui.js';
import { MyAnswerButtons, DateBox } from './shared.js';

// Neuigkeiten-Arten: Symbol, Text, Ziel und wo
const NEWS = {
  event_chat: { icon: 'chat', label: 'news.chat', href: (r) => '#/event/' + r.event_id + '/chat', where: (r) => r.event_title },
  group_chat: { icon: 'chat', label: 'news.chat', href: (r) => '#/group/' + r.position_id + '/chat', where: (r) => r.group_name },
  group_tasks: { icon: 'tasks', label: 'news.tasks', href: (r) => '#/group/' + r.position_id + '/tasks', where: (r) => r.group_name },
  event_polls: { icon: 'chart', label: 'news.poll', href: (r) => '#/event/' + r.event_id + '/polls', where: (r) => r.event_title },
  group_polls: { icon: 'chart', label: 'news.poll', href: (r) => '#/group/' + r.position_id + '/polls', where: (r) => r.group_name },
  team_board: { icon: 'flag', label: 'news.board', href: (r) => '#/team/' + r.team_id + '/board', where: (r) => r.team_name },
  event_board: { icon: 'flag', label: 'news.board', href: (r) => '#/event/' + r.event_id + '/board', where: (r) => r.event_title },
  group_board: { icon: 'flag', label: 'news.board', href: (r) => '#/group/' + r.position_id + '/board', where: (r) => r.group_name },
};

function NewsCard() {
  const { user, unread } = useStore();
  const news = useAsync(() => rpc('my_news'), [user.id, unread.total]);
  const rows = (news.data || []).filter((r) => NEWS[r.scope]);
  if (rows.length === 0) return null;
  return html`<div class="card news-card" style="margin-bottom:16px">
    <div class="card-head"><${Icon} name="bell" /><h3 class="grow">${t('news.title')}</h3><${UnreadBadge} n=${unread.total} /></div>
    <div class="list">${rows.map((r) => {
      const d = NEWS[r.scope];
      return html`<a class="list-item news-item" href=${d.href(r)} key=${r.scope + r.event_id + r.team_id + (r.position_id || '')}>
        <span class="news-ico"><${Icon} name=${d.icon} size=${18} /></span>
        <div class="grow"><b>${t(d.label)}</b><div class="small muted">${d.where(r) || ''}</div></div>
        <span class="count">${r.n}</span><${Icon} name="right" />
      </a>`;
    })}</div>
  </div>`;
}

export function HomePage() {
  const { user, profile, teams, unread } = useStore();
  const since = new Date(Date.now() - 86400000).toISOString();

  const data = useAsync(async () => {
    const [mine, events] = await Promise.all([
      q(sb.from('assignments')
        .select('id, status, note, position_id, event_id, shifts(name, starts_at, ends_at), positions(name), events(title, starts_at, ends_at, location, binding)')
        .eq('user_id', user.id).neq('status', 'declined')),
      q(sb.from('events').select('id, title, starts_at, ends_at, location, team_id, teams(name, color)')
        .gte('starts_at', since).order('starts_at').limit(30)),
    ]);
    const upcoming = mine.filter((a) => a.events && new Date(a.events.ends_at || a.events.starts_at) >= new Date(since));
    upcoming.sort((a, b) => new Date(a.events.starts_at) - new Date(b.events.starts_at));
    return { mine: upcoming, events };
  }, [user.id]);

  const open = data.data ? data.data.mine.filter((a) => a.status === 'proposed' || a.status === 'uncertain').length : 0;

  return html`<div>
    <div class="hero">
      <h1>${t('home.hello', { name: profile ? profile.display_name : '' })} <span style="font-size:0.6em">👋</span></h1>
      <p class="muted" style="margin:0">${open ? t('home.open_answers', { n: open }) : t('home.all_good')}</p>
    </div>

    ${isGuest() && html`<div class="notice" style="margin-bottom:16px"><${Icon} name="user" size=${18} /> ${t('home.guest_hint')}</div>`}

    <${NewsCard} />

    ${data.loading && html`<${Spinner} />`}
    ${data.error && html`<${ErrorBox} error=${data.error} onRetry=${data.reload} />`}
    ${data.data && html`
      <div class="section-title"><h2>${t('home.my_shifts')}</h2></div>
      ${data.data.mine.length === 0
        ? html`<div class="card"><${Empty} icon="briefcase" title=${t('home.no_shifts')} text=${t('home.no_shifts_text')} /></div>`
        : html`<div class="grid">${data.data.mine.map((a) => html`
            <div class=${'card stack-sm' + (unread.byGroup[a.position_id] ? ' has-unread' : '')} key=${a.id}>
              <div class="row"><a class="grow" href=${'#/event/' + a.event_id}><b>${a.events.title}</b></a><${StatusBadge} status=${a.status} /></div>
              <div class="line small muted"><${Icon} name="briefcase" size=${16} /><b>${a.positions.name}${a.shifts && a.shifts.name ? ' · ' + a.shifts.name : ''}</b></div>
              <div class="line small muted"><${Icon} name="calendar" size=${16} /><span>${a.shifts && a.shifts.starts_at ? fmtRange(a.shifts.starts_at, a.shifts.ends_at) : fmtRange(a.events.starts_at, a.events.ends_at)}</span></div>
              ${a.events.location && html`<div class="line small muted"><${Icon} name="pin" size=${16} /><span>${a.events.location}</span></div>`}
              ${a.note && html`<div class="small faint pre">„${a.note}“</div>`}
              <div class="row" style="margin-top:6px">
                <${MyAnswerButtons} a=${a} locked=${a.events && a.events.binding} onDone=${() => data.reload(true)} />
                ${a.status !== 'waitlist' && html`<a class="btn small ghost" href=${'#/group/' + a.position_id}><${Icon} name="layers" size=${16} />${t('group.open')}<${UnreadBadge} n=${unread.byGroup[a.position_id]} /></a>`}
              </div>
            </div>`)}</div>`}

      <div class="section-title"><h2>${t('home.upcoming')}</h2></div>
      <div class="card" style="padding:6px">
        ${data.data.events.length === 0
          ? html`<${Empty} icon="calendar" title=${t('home.no_events')} />`
          : data.data.events.map((e) => html`<a class=${'event-card' + (unread.byEvent[e.id] ? ' has-unread' : '')} href=${'#/event/' + e.id} key=${e.id}>
              <${DateBox} date=${e.starts_at} color=${e.teams && e.teams.color} />
              <div class="grow">
                <b>${e.title}</b>
                <div class="small muted">${fmtDateTime(e.starts_at)}${e.location ? ' · ' + e.location : ''}</div>
                ${e.teams && html`<span class="chip" style="margin-top:4px"><span class="dot" style=${{ background: e.teams.color }}></span>${e.teams.name}</span>`}
              </div>
              <${UnreadBadge} n=${unread.byEvent[e.id]} />
              <${Icon} name="right" />
            </a>`)}
      </div>`}

    ${!isGuest() && html`
      <div class="section-title"><h2>${t('home.my_teams')}</h2>
        <a class="btn small ghost" href="#/teams/find"><${Icon} name="search" size=${16} />${t('nav.find_team')}</a>
        <a class="btn small primary" href="#/teams/new"><${Icon} name="plus" size=${16} />${t('nav.new_team')}</a>
      </div>
      ${teams.length === 0
        ? html`<div class="card"><${Empty} icon="users" title=${t('home.no_teams')} text=${t('home.no_teams_text')}>
            <div class="row" style="justify-content:center">
              <a class="btn primary" href="#/teams/new"><${Icon} name="plus" />${t('nav.new_team')}</a>
              <a class="btn" href="#/teams/find"><${Icon} name="search" />${t('nav.find_team')}</a>
            </div><//></div>`
        : html`<div class="grid">${teams.map((m) => html`
            <a class=${'card team-card' + (unread.byTeam[m.team_id] ? ' has-unread' : '')} href=${'#/team/' + m.team_id} key=${m.team_id}>
              <span class="stripe" style=${{ background: m.teams.color }}></span>
              <div class="row"><h3 class="grow" style="margin:0">${m.teams.name}</h3>${m.is_owner && html`<span class="chip">${t('team.owner')}</span>`}<${UnreadBadge} n=${unread.byTeam[m.team_id]} /></div>
              ${m.teams.description && html`<div class="small muted" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${m.teams.description}</div>`}
            </a>`)}</div>`}`}
  </div>`;
}
