// Einladungslink (Team) und Gästelink (Event / Gruppe)
import { html, useState } from '../lib/h.js';
import { sb, rpc } from '../lib/sb.js';
import { t, lang, fmtDateTime, fmtRelative } from '../lib/i18n.js';
import { useStore, toast, errText, loadTeams, loadProfile, isGuest } from '../lib/store.js';
import { Icon, Field, Spinner, Empty, useAsync, go } from '../lib/ui.js';
import { AuthShell } from './auth.js';

function remember(path) {
  try { localStorage.setItem('tp.after', '#' + path); } catch (e) { /* ohne Speicher */ }
}

export function InvitePage({ token }) {
  const { session } = useStore();
  const [busy, setBusy] = useState(false);
  const info = useAsync(async () => (await rpc('invite_info', { tok: token }))[0] || null, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const teamId = await rpc('accept_invite', { tok: token });
      await loadTeams();
      toast(t('invite.joined'));
      go('/team/' + teamId);
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  const body = () => {
    if (info.loading) return html`<${Spinner} />`;
    const i = info.data;
    if (!i || !i.valid) return html`<${Empty} icon="alert" title=${t('err.invite_invalid')} text=${t('invite.invalid_text')} />`;
    return html`<div class="stack">
      <div class="notice" style=${{ borderLeft: '6px solid ' + i.team_color }}>${t('invite.you_are_invited', { team: i.team_name })}</div>
      <p class="small muted">${t('invite.valid_until', { when: fmtDateTime(i.expires_at), rel: fmtRelative(i.expires_at) })}</p>
      ${!session && html`<p>${t('invite.login_first')}</p>
        <div class="row">
          <a class="btn primary" href="#/login" onClick=${() => remember('/invite/' + token)}><${Icon} name="login" />${t('auth.login')}</a>
          <a class="btn" href="#/signup" onClick=${() => remember('/invite/' + token)}><${Icon} name="userPlus" />${t('auth.signup')}</a>
        </div>`}
      ${session && isGuest() && html`<div class="notice warn">${t('invite.guest_cannot')}</div>
        <button class="btn" onClick=${async () => { remember('/invite/' + token); await sb.auth.signOut(); go('/signup'); }}>${t('auth.signup')}</button>`}
      ${session && !isGuest() && html`<button class="btn primary" disabled=${busy} onClick=${accept}><${Icon} name="check" />${t('invite.join_team', { team: i.team_name })}</button>`}
    </div>`;
  };

  if (!session) return html`<${AuthShell} title=${t('invite.title')}>${body()}<//>`;
  return html`<div class="card" style="max-width:560px;margin:0 auto"><h2>${t('invite.title')}</h2>${body()}</div>`;
}

export function GuestPage({ token }) {
  const { session } = useStore();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const info = useAsync(async () => (await rpc('guest_link_info', { tok: token }))[0] || null, [token]);
  const needName = !session || isGuest();

  const submit = async (e) => {
    e.preventDefault();
    if (needName && !name.trim()) return setErr(t('auth.name_required'));
    setBusy(true); setErr('');
    try {
      if (!session) {
        const { error } = await sb.auth.signInAnonymously({ options: { data: { display_name: name.trim(), language: lang() } } });
        if (error) throw error;
      }
      const res = (await rpc('redeem_guest_link', { tok: token, pw, nm: name.trim() }))[0];
      if (!res || !res.ok) { setErr(t('guest.wrong_password')); return; }
      await loadProfile();
      toast(t('guest.welcome'));
      go(res.pos ? '/group/' + res.pos : '/event/' + res.ev);
    } catch (e2) {
      setErr(/removed/.test(String(e2 && e2.message)) ? t('guest.removed') : errText(e2));
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (info.loading) return html`<${Spinner} />`;
    const i = info.data;
    if (!i || !i.active) return html`<${Empty} icon="alert" title=${t('err.link_invalid')} text=${t('guest.invalid_text')} />`;
    return html`<form class="stack" onSubmit=${submit}>
      <div class="notice">
        ${i.kind === 'group' ? t('guest.invited_group', { group: i.group_name, event: i.event_title }) : t('guest.invited_event', { event: i.event_title })}
        <div class="small muted" style="margin-top:4px">${i.team_name} · ${fmtDateTime(i.event_start)}</div>
      </div>
      ${needName && html`<${Field} label=${t('profile.name')} hint=${t('guest.name_hint')}><input class="input" required maxlength="60" value=${name} onInput=${(e) => setName(e.target.value)} /><//>`}
      <${Field} label=${t('guest.password')}><input class="input" required autocomplete="off" value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      ${err && html`<div class="notice error">${err}</div>`}
      <button class="btn primary block" disabled=${busy}><${Icon} name="login" />${t('guest.enter')}</button>
      ${!session && html`<p class="small faint">${t('guest.no_account_needed')} <a href="#/login" onClick=${() => remember('/g/' + token)}>${t('guest.have_account')}</a></p>`}
    </form>`;
  };

  if (!session) return html`<${AuthShell} title=${t('guest.title')}>${body()}<//>`;
  return html`<div class="card" style="max-width:560px;margin:0 auto"><h2>${t('guest.title')}</h2>${body()}</div>`;
}
