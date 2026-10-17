// Teamplaner — Start, Seitenwahl (Router) und Grundgerüst
import { html, render, useEffect, useState } from './lib/h.js';
import { sb, configured } from './lib/sb.js';
import { setLanguage, t, pickLanguage } from './lib/i18n.js';
import { useStore, setState, getState, loadProfile, loadTeams, applyTheme, isGuest } from './lib/store.js';
import { Icon, BrandMark, Toasts, DialogHost, LangSelect, ThemeSwitch, Avatar, Spinner, appName } from './lib/ui.js';
import { LoginPage, SignupPage, ForgotPage, NewPasswordPage } from './pages/auth.js';
import { HomePage } from './pages/home.js';
import { NewTeamPage, FindTeamPage, TeamsListPage } from './pages/teams.js';
import { TeamPage } from './pages/team.js';
import { EventPage } from './pages/event.js';
import { GroupPage } from './pages/group.js';
import { ProfilePage } from './pages/profile.js';
import { InvitePage, GuestPage } from './pages/join.js';
import { registerServiceWorker, syncPush } from './lib/push.js';

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

const PUBLIC = ['login', 'signup', 'forgot', 'invite', 'g', 'guest'];

function Page({ parts }) {
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return html`<${HomePage} />`;
    case 'teams': return b === 'new' ? html`<${NewTeamPage} />` : b === 'find' ? html`<${FindTeamPage} />` : html`<${TeamsListPage} />`;
    case 'team': return html`<${TeamPage} id=${b} tab=${c || 'events'} key=${b} />`;
    case 'event': return html`<${EventPage} id=${b} tab=${c || 'positions'} key=${b} />`;
    case 'group': return html`<${GroupPage} id=${b} tab=${c || 'tasks'} key=${b} />`;
    case 'profile': return html`<${ProfilePage} />`;
    case 'new-password': return html`<${NewPasswordPage} />`;
    case 'invite': return html`<${InvitePage} token=${b} />`;
    case 'g': case 'guest': return html`<${GuestPage} token=${b} />`;
    default: return html`<div class="card"><h2>${t('err.not_found')}</h2><a href="#/">${t('nav.home')}</a></div>`;
  }
}

function Sidebar({ parts }) {
  const { teams, profile } = useStore();
  const at = (p) => (parts[0] === p || (!parts[0] && p === '') ? ' active' : '');
  return html`<aside class="sidebar">
    <a class="brand" href="#/"><${BrandMark} />${appName()}</a>
    <a class=${'nav-item' + at('')} href="#/"><${Icon} name="home" />${t('nav.home')}</a>
    ${!isGuest() && html`
      <div class="nav-label">${t('nav.teams')}</div>
      ${teams.map((m) => html`<a class=${'nav-item' + (parts[0] === 'team' && parts[1] === m.team_id ? ' active' : '')} href=${'#/team/' + m.team_id}>
        <span class="dot" style=${{ background: m.teams.color }}></span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.teams.name}</span></a>`)}
      <a class=${'nav-item' + (parts[0] === 'teams' && parts[1] === 'new' ? ' active' : '')} href="#/teams/new"><${Icon} name="plus" />${t('nav.new_team')}</a>
      <a class=${'nav-item' + (parts[0] === 'teams' && parts[1] !== 'new' ? ' active' : '')} href="#/teams/find"><${Icon} name="search" />${t('nav.find_team')}</a>`}
    <div class="nav-label">${t('nav.you')}</div>
    <a class=${'nav-item' + at('profile')} href="#/profile"><${Avatar} profile=${profile} size="sm" />${(profile && profile.display_name) || t('nav.profile')}</a>
    <div class="sidebar-foot">
      <${LangSelect} />
      <${ThemeSwitch} iconsOnly />
    </div>
  </aside>`;
}

function TopBar() {
  const { profile } = useStore();
  return html`<header class="topbar">
    <a class="brand" href="#/"><${BrandMark} size=${18} />${appName()}</a>
    <span class="spacer"></span>
    <${ThemeSwitch} compact />
    <a href="#/profile" aria-label=${t('nav.profile')}><${Avatar} profile=${profile} size="sm" /></a>
  </header>`;
}

function BottomNav({ parts }) {
  const items = [
    ['', 'home', t('nav.home')],
    ...(isGuest() ? [] : [['teams', 'users', t('nav.teams')]]),
    ['profile', 'user', t('nav.profile')],
  ];
  const active = (k) => (k === '' ? !parts[0] : k === 'teams' ? ['teams', 'team', 'event', 'group'].includes(parts[0]) : parts[0] === k);
  return html`<nav class="bottomnav">${items.map(([k, ic, label]) => html`
    <a href=${'#/' + k} class=${active(k) ? 'active' : ''}><${Icon} name=${ic} size=${22} />${label}</a>`)}</nav>`;
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
    else page = html`<${LoginPage} />`;
    return html`<div key=${key}>${page}<${Toasts} /><${DialogHost} /></div>`;
  }
  if (isPublic && parts[0] !== 'invite' && parts[0] !== 'g' && parts[0] !== 'guest') {
    location.hash = '#/';
    return null;
  }

  return html`<div class="shell" key=${key}>
    <${Sidebar} parts=${parts} />
    <div class="grow" style="min-width:0">
      <${TopBar} />
      <main class="main"><div class="container"><${Page} parts=${parts} /></div></main>
    </div>
    <${BottomNav} parts=${parts} />
    <${Toasts} />
    <${DialogHost} />
  </div>`;
}

// ---------- Start ----------
async function onSession(session) {
  setState({ session, user: session ? session.user : null });
  if (!session) return setState({ profile: null, teams: [] });
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
