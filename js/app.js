// Teamplaner — Start, Seitenwahl (Router) und Grundgerüst
import { html, render, useEffect, useState } from './lib/h.js';
import { sb, configured } from './lib/sb.js';
import { setLanguage, t, pickLanguage } from './lib/i18n.js';
import { useStore, setState, getState, loadProfile, loadTeams, applyTheme, isGuest } from './lib/store.js';
import { Icon, BrandMark, Toasts, DialogHost, LangSelect, ThemeSwitch, Avatar, Spinner, appName, UnreadBadge } from './lib/ui.js';
import { LoginPage, SignupPage, ForgotPage, NewPasswordPage } from './pages/auth.js';
import { HomePage } from './pages/home.js';
import { NewTeamPage, FindTeamPage, TeamsListPage } from './pages/teams.js';
import { TeamPage } from './pages/team.js';
import { EventPage } from './pages/event.js';
import { GroupPage } from './pages/group.js';
import { ProfilePage } from './pages/profile.js';
import { InvitePage, GuestPage } from './pages/join.js';
import { UnsubscribePage } from './pages/unsubscribe.js';
import { HelpPage } from './pages/help.js';
import { FeedbackButton } from './pages/feedback.js';
import { AdminPage } from './pages/admin.js';
import { registerServiceWorker, syncPush } from './lib/push.js';
import { startUnread, stopUnread } from './lib/unread.js';

function parseHash() {
  const raw = decodeURIComponent((location.hash || '#/').slice(1));
  const parts = raw.split('?')[0].split('/').filter(Boolean);
  return parts;
}

function useRoute() {
  const [parts, setParts] = useState(parseHash());
  useEffect(() => {
    const on = () => { setParts(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

const PUBLIC = ['login', 'signup', 'forgot', 'invite', 'g', 'guest', 'unsubscribe'];
const ALWAYS = ['invite', 'g', 'guest', 'unsubscribe']; // auch angemeldet erreichbar

function Page({ parts }) {
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return html`<${HomePage} />`;
    case 'teams': return b === 'new' ? html`<${NewTeamPage} />` : b === 'find' ? html`<${FindTeamPage} />` : html`<${TeamsListPage} />`;
    case 'team': return html`<${TeamPage} id=${b} tab=${c || 'events'} key=${b} />`;
    case 'event': return html`<${EventPage} id=${b} tab=${c || 'positions'} key=${b} />`;
    case 'group': return html`<${GroupPage} id=${b} tab=${c || 'tasks'} key=${b} />`;
    case 'profile': return html`<${ProfilePage} />`;
    case 'help': return html`<${HelpPage} topic=${b} />`;
    case 'admin': return html`<${AdminPage} tab=${b} />`;
    case 'new-password': return html`<${NewPasswordPage} />`;
    case 'invite': return html`<${InvitePage} token=${b} />`;
    case 'unsubscribe': return html`<${UnsubscribePage} u=${b} c=${c} s=${parts[3]} />`;
    case 'g': case 'guest': return html`<${GuestPage} token=${b} />`;
    default: return html`<div class="card"><h2>${t('err.not_found')}</h2><a href="#/">${t('nav.home')}</a></div>`;
  }
}

// Welche Ebene ist offen? (für die klare grafische Trennung)
function levelOf(parts) {
  const a = parts[0];
  if (!a) return 'home';
  if (a === 'team' || a === 'teams') return 'team';
  if (a === 'event') return 'event';
  if (a === 'group') return 'group';
  return null;
}
function LevelBar({ level }) {
  if (!level) return null;
  const map = { home: ['home', t('level.home')], team: ['users', t('level.team')], event: ['calendar', t('level.event')], group: ['layers', t('level.group')] };
  const [ic, label] = map[level];
  return html`<div class="levelbar"><span class="level-pill"><${Icon} name=${ic} size=${15} />${label}</span></div>`;
}

function Sidebar({ parts }) {
  const { teams, profile, unread } = useStore();
  const at = (p) => (parts[0] === p || (!parts[0] && p === '') ? ' active' : '');
  return html`<aside class="sidebar">
    <a class="brand" href="#/"><${BrandMark} />${appName()}</a>
    <a class=${'nav-item' + at('')} href="#/"><${Icon} name="home" /><span class="grow">${t('nav.home')}</span>${isGuest() && html`<${UnreadBadge} n=${unread.total} />`}</a>
    ${!isGuest() && html`
      <div class="nav-label">${t('nav.teams')}</div>
      ${teams.map((m) => html`<a class=${'nav-item' + (parts[0] === 'team' && parts[1] === m.team_id ? ' active' : '')} href=${'#/team/' + m.team_id}>
        <span class="dot" style=${{ background: m.teams.color }}></span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.teams.name}</span><${UnreadBadge} n=${unread.byTeam[m.team_id]} /></a>`)}
      <a class=${'nav-item' + (parts[0] === 'teams' && parts[1] === 'new' ? ' active' : '')} href="#/teams/new"><${Icon} name="plus" />${t('nav.new_team')}</a>
      <a class=${'nav-item' + (parts[0] === 'teams' && parts[1] !== 'new' ? ' active' : '')} href="#/teams/find"><${Icon} name="search" />${t('nav.find_team')}</a>`}
    <div class="nav-label">${t('nav.you')}</div>
    <a class=${'nav-item' + at('profile')} href="#/profile"><${Avatar} profile=${profile} size="sm" />${(profile && profile.display_name) || t('nav.profile')}</a>
    <a class=${'nav-item' + at('help')} href="#/help"><${Icon} name="help" />${t('nav.help')}</a>
    <div class="sidebar-foot">
      <${LangSelect} />
      <${ThemeSwitch} iconsOnly />
    </div>
  </aside>`;
}

function TopBar({ level }) {
  const { profile } = useStore();
  return html`<header class="topbar">
    <a class="brand" href="#/"><${BrandMark} size=${18} />${appName()}</a>
    ${level && html`<span class="level-tag">${t('level.' + level)}</span>`}
    <span class="spacer"></span>
    <${ThemeSwitch} compact />
    <a href="#/profile" aria-label=${t('nav.profile')}><${Avatar} profile=${profile} size="sm" /></a>
  </header>`;
}

function BottomNav({ parts }) {
  const { unread } = useStore();
  const items = [
    ['', 'home', t('nav.home'), isGuest() ? unread.total : 0],
    ...(isGuest() ? [] : [['teams', 'users', t('nav.teams'), unread.total]]),
    ['help', 'help', t('nav.help'), 0],
    ['profile', 'user', t('nav.profile'), 0],
  ];
  const active = (k) => (k === '' ? !parts[0] : k === 'teams' ? ['teams', 'team', 'event', 'group'].includes(parts[0]) : parts[0] === k);
  return html`<nav class="bottomnav">${items.map(([k, ic, label, n]) => html`
    <a href=${'#/' + k} class=${active(k) ? 'active' : ''}><span class="nav-ico"><${Icon} name=${ic} size=${22} /><${UnreadBadge} n=${n} /></span>${label}</a>`)}</nav>`;
}

function Setup() {
  return html`<div class="auth-wrap"><div class="card auth-card stack">
    <div class="auth-logo"><${BrandMark} size=${34} /><h1>${appName()}</h1></div>
    <div class="notice warn">${t('setup.missing')}</div>
    <p class="muted">${t('setup.howto')}</p>
  </div></div>`;
}

function App() {
  const s = useStore();
  const parts = useRoute();
  const key = 'v' + s.langVersion;

  if (!configured) return html`<${Setup} key=${key} />`;
  if (!s.ready) return html`<div class="boot"><${Spinner} /></div>`;

  const isPublic = PUBLIC.includes(parts[0]);
  if (!s.session) {
    let page;
    if (parts[0] === 'signup') page = html`<${SignupPage} />`;
    else if (parts[0] === 'forgot') page = html`<${ForgotPage} />`;
    else if (parts[0] === 'invite') page = html`<${InvitePage} token=${parts[1]} />`;
    else if (parts[0] === 'g' || parts[0] === 'guest') page = html`<${GuestPage} token=${parts[1]} />`;
    else if (parts[0] === 'unsubscribe') page = html`<${UnsubscribePage} u=${parts[1]} c=${parts[2]} s=${parts[3]} />`;
    else page = html`<${LoginPage} />`;
    return html`<div key=${key}>${page}<${Toasts} /><${DialogHost} /></div>`;
  }
  if (isPublic && !ALWAYS.includes(parts[0])) {
    location.hash = '#/';
    return null;
  }

  const level = levelOf(parts);
  return html`<div class=${'shell' + (level ? ' lvl-' + level : '')} key=${key}>
    <${Sidebar} parts=${parts} />
    <div class="grow" style="min-width:0">
      <${TopBar} level=${level} />
      <main class="main"><div class="container"><${LevelBar} level=${level} /><${Page} parts=${parts} /></div></main>
    </div>
    <${BottomNav} parts=${parts} />
    <${FeedbackButton} />
    <${Toasts} />
    <${DialogHost} />
  </div>`;
}

// ---------- Start ----------
async function onSession(session) {
  setState({ session, user: session ? session.user : null });
  if (!session) { stopUnread(); return setState({ profile: null, teams: [] }); }
  try {
    const p = await loadProfile();
    if (p) {
      const stored = (() => { try { return localStorage.getItem('tp.lang'); } catch (e) { return null; } })();
      if (p.language && p.language !== stored) {
        await setLanguage(p.language);
        setState({ langVersion: getState().langVersion + 1 });
      }
      if (p.theme) applyTheme(p.theme);
    }
    await loadTeams();
    startUnread();
    syncPush();
  } catch (e) {
    console.error(e);
  }
  // Nach der Anmeldung zu einer gemerkten Einladung zurückkehren
  try {
    const back = localStorage.getItem('tp.after');
    if (back && !(session.user && session.user.is_anonymous)) {
      localStorage.removeItem('tp.after');
      location.hash = back;
    }
  } catch (e) { /* ohne Speicher */ }
}

async function boot() {
  let stored = null;
  try { stored = localStorage.getItem('tp.lang'); applyTheme(localStorage.getItem('tp.theme') || 'system'); } catch (e) { /* ohne Speicher */ }
  await setLanguage(pickLanguage(stored));
  document.title = appName();
  render(html`<${App} />`, document.getElementById('app'));
  if (!configured) return;
  registerServiceWorker();

  const flow = new URLSearchParams(location.search).get('flow');
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  if (flow === 'reset' && data.session) location.hash = '#/new-password';
  setState({ ready: true });

  let lastUser = data.session ? data.session.user.id : null;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') location.hash = '#/new-password';
    const uid = session ? session.user.id : null;
    if (uid !== lastUser || event === 'USER_UPDATED') {
      lastUser = uid;
      setTimeout(() => onSession(session), 0);
    } else {
      setState({ session, user: session ? session.user : null });
    }
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(document.documentElement.dataset.theme));
}

boot();
