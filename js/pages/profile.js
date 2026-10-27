// Eigenes Profil: Name, Pronomen, Sprache, Darstellung, Passwort
import { html, useState, useEffect } from '../lib/h.js';
import { sb, q, rpc } from '../lib/sb.js';
import { pushSupported, isIOS, isStandalone, currentSubscription, enablePush, disablePush, forgetDevice, callPushFunction } from '../lib/push.js';
import { t, PRONOUNS, pronounText } from '../lib/i18n.js';
import { useStore, setState, toast, toastError, errText, isGuest, confirmDialog } from '../lib/store.js';
import { Icon, Field, PasswordInput, Avatar, LangSelect, ThemeSwitch } from '../lib/ui.js';

export function ProfilePage() {
  const { user, profile } = useStore();
  const [name, setName] = useState(profile ? profile.display_name : '');
  const [pron, setPron] = useState(profile ? profile.pronouns : '');
  const [custom, setCustom] = useState(profile ? profile.pronouns_custom : '');
  const [bio, setBio] = useState(profile ? (profile.bio || '') : '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  const preview = { ...profile, display_name: name, pronouns: pron, pronouns_custom: custom, bio };
  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast(t('auth.name_required'), 'error');
    setBusy(true);
    try {
      const patch = { display_name: name.trim(), pronouns: pron, pronouns_custom: pron === 'custom' ? custom.trim() : '', bio: bio.trim() };
      await q(sb.from('profiles').update(patch).eq('id', user.id));
      setState({ profile: { ...profile, ...patch } });
      toast(t('common.saved'));
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };
  const changePw = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast(t('err.password'), 'error');
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toastError(error);
    setPw('');
    toast(t('auth.password_changed'));
  };
  const logout = async () => {
    if (isGuest() && !(await confirmDialog({ title: t('profile.logout'), text: t('profile.guest_logout_warning'), danger: true, ok: t('profile.logout') }))) return;
    await forgetDevice();
    await sb.auth.signOut();
    location.hash = '#/login';
  };

  return html`<div style="max-width:720px" class="stack">
    <div class="hero">
      <div class="row nowrap">
        <${Avatar} profile=${preview} size="lg" />
        <div class="grow">
          <h1 style="margin:0">${name || '…'}</h1>
          ${pronounText(preview) && html`<div class="muted">${pronounText(preview)}</div>`}
          ${isGuest() && html`<span class="chip" style="margin-top:6px">${t('common.guest')}</span>`}
        </div>
      </div>
      ${bio.trim() && html`<p class="muted pre" style="margin:12px 0 0">${bio}</p>`}
    </div>

    <form class="card stack" onSubmit=${save}>
      <h3>${t('profile.title')}</h3>
      <${Field} label=${t('profile.name')} hint=${t('profile.name_hint')}><input class="input" required maxlength="60" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <${Field} label=${t('profile.pronouns')} hint=${t('profile.pronouns_hint')}>
        <select class="input" value=${pron} onChange=${(e) => setPron(e.target.value)}>
          <option value="">${t('profile.pronouns_none')}</option>
          ${PRONOUNS.map((k) => html`<option value=${k}>${pronounText({ pronouns: k })}</option>`)}
          <option value="custom">${t('profile.pronouns_custom')}</option>
        </select>
      <//>
      ${pron === 'custom' && html`<${Field} label=${t('profile.pronouns_custom_label')}><input class="input" maxlength="40" value=${custom} onInput=${(e) => setCustom(e.target.value)} placeholder="xier/xiem" /><//>`}
      <${Field} label=${t('profile.about')} hint=${t('profile.about_hint')}><textarea class="input" maxlength="500" rows="3" value=${bio} onInput=${(e) => setBio(e.target.value)} placeholder=${t('profile.about_ph')}></textarea><//>
      <div class="row"><button class="btn primary" disabled=${busy}><${Icon} name="check" />${t('common.save')}</button></div>
    </form>

    <div class="card stack">
      <h3>${t('profile.display')}</h3>
      <div class="field"><span class="label">${t('profile.language')}</span><${LangSelect} /></div>
      <div class="field"><span class="label">${t('profile.theme')}</span><${ThemeSwitch} /></div>
    </div>

    ${!isGuest() && html`<form class="card stack" onSubmit=${changePw}>
      <h3>${t('profile.account')}</h3>
      <div class="muted"><${Icon} name="mail" size=${16} /> ${user.email}</div>
      <${Field} label=${t('auth.new_password')} hint=${t('auth.password_hint')}><${PasswordInput} autocomplete="new-password" minlength=${8} value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      <div class="row"><button class="btn" disabled=${pw.length < 8}><${Icon} name="key" />${t('auth.change_password')}</button></div>
    </form>`}

    <${NotificationSettings} />
    <${PushSettings} />

    ${isGuest() && html`<div class="notice">${t('profile.guest_info')}</div>`}

    ${!isGuest() && html`<${AdminLink} />`}
    <div class="row"><button class="btn danger" onClick=${logout}><${Icon} name="logout" />${t('profile.logout')}</button></div>
  </div>`;
}

// Zugang zum nicht-öffentlichen Bereich – erscheint nur bei der hinterlegten Inhaber*in.
function AdminLink() {
  const [isAdmin, setAdmin] = useState(false);
  useEffect(() => { rpc('is_app_admin').then((v) => setAdmin(!!v)).catch(() => {}); }, []);
  if (!isAdmin) return null;
  return html`<div class="row"><a class="btn ghost" href="#/admin"><${Icon} name="shield" size=${16} />${t('admin.title')}</a></div>`;
}

// Pro Info-Art wählbar: Push, E-Mail oder beides. E-Mail gibt es nur für Einteilung und Deadline.
const NOTIF_TYPES = [
  { k: 'assignment', mail: true },
  { k: 'deadline', mail: true },
  { k: 'shift', mail: false },
  { k: 'mention', mail: false },
];

function NotificationSettings() {
  const { user, profile } = useStore();
  const guest = isGuest();
  const push = { assignment: true, shift: true, deadline: true, mention: true, ...(profile.push_prefs || {}) };
  const mail = { assignment: true, deadline: true, ...(profile.mail_prefs || {}) };
  const setPush = async (k, v) => {
    const next = { ...push, [k]: v };
    try { await q(sb.from('profiles').update({ push_prefs: next }).eq('id', user.id)); setState({ profile: { ...profile, push_prefs: next } }); } catch (e) { toastError(e); }
  };
  const setMail = async (k, v) => {
    const next = { ...mail, [k]: v };
    try { await q(sb.from('profiles').update({ mail_prefs: next }).eq('id', user.id)); setState({ profile: { ...profile, mail_prefs: next } }); } catch (e) { toastError(e); }
  };
  return html`<div class="card stack">
    <h3>${t('notif.title')}</h3>
    <p class="small muted" style="margin:0">${t('notif.intro')}</p>
    <div class="notif-grid">
      <div class="notif-head"><span class="grow"></span><span class="notif-col">${t('notif.push')}</span>${!guest ? html`<span class="notif-col">${t('notif.mail')}</span>` : ''}</div>
      ${NOTIF_TYPES.map((row) => html`<div class="notif-row" key=${row.k}>
        <div class="grow"><b>${t('push.kind_' + row.k)}</b><span class="small faint" style="display:block">${t('push.kind_' + row.k + '.desc')}</span></div>
        <label class="notif-col"><input type="checkbox" aria-label=${t('notif.push')} checked=${push[row.k] !== false} onChange=${(e) => setPush(row.k, e.target.checked)} /></label>
        ${!guest ? (row.mail
          ? html`<label class="notif-col"><input type="checkbox" aria-label=${t('notif.mail')} checked=${mail[row.k] !== false} onChange=${(e) => setMail(row.k, e.target.checked)} /></label>`
          : html`<span class="notif-col faint">–</span>`) : ''}
      </div>`)}
    </div>
    ${guest && html`<p class="small faint" style="margin:0">${t('notif.guest_hint')}</p>`}
  </div>`;
}

function PushSettings() {
  const { user, profile } = useStore();
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);   // letzte Fehlermeldung (bleibt sichtbar)
  const [help, setHelp] = useState(false); // Hilfe/Infos anzeigen
  const loadStatus = () => rpc('push_status').then(setStatus).catch(() => setStatus(null));
  const recheck = () => {
    currentSubscription().then((s) => setOn(!!s)).catch(() => setOn(false));
    loadStatus();
  };
  useEffect(() => { recheck(); }, []);

  const toggleDevice = async () => {
    setBusy(true); setErr(null);
    try {
      if (on) { await disablePush(); setOn(false); toast(t('push.off_done')); }
      else { await enablePush(); setOn(true); toast(t('push.on_done')); }
    } catch (e) {
      const m = String(e && e.message);
      setErr(m === 'denied' ? t('push.denied') : m === 'unsupported' ? t('push.unsupported')
        : m === 'function missing' ? t('push.no_function') : m === 'not configured' ? t('push.no_function')
        : t('err.generic') + ' (' + m + ')');
      if (m === 'denied' || m === 'unsupported') setHelp(true);
    } finally { setBusy(false); loadStatus(); }
  };
  // Test: sofort senden; Fehler bleibt sichtbar (mit Reset)
  const test = async () => {
    setBusy(true); setErr(null);
    try {
      if (!(await rpc('queue_test_push'))) { setErr(t('push.device_missing')); return; }
      const res = await callPushFunction({});
      if (res.missing) setErr(t('push.no_function'));
      else if (res.error) setErr(t('push.send_failed', { error: res.error }));
      else if (res.devices > 0) toast(t('push.sent_to', { n: res.devices }));
      else setErr(t('push.send_failed', { error: (res.errors && res.errors[0]) || '–' }));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); loadStatus(); }
  };
  // Zurücksetzen: dieses Gerät abmelden, Fehler löschen, neu prüfen
  const reset = async () => {
    setBusy(true);
    try { await forgetDevice(); } catch (e) { /* egal */ }
    setOn(false); setErr(null);
    recheck();
    toast(t('push.reset_done'));
    setBusy(false);
  };

  const supported = pushSupported();
  const iosNeedsInstall = isIOS() && !isStandalone();
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const cron = status && status.cron_status;
  const checks = status ? [
    ['server', status.key ? 'ok' : 'open'],
    ['permission', perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : 'open'],
    ['device', on && status.devices > 0 ? 'ok' : 'open'],
    ['cron', cron >= 200 && cron < 300 ? 'ok' : cron === 401 || cron === 403 ? 'bad' : 'open'],
  ] : [];
  const mark = { ok: '✅', open: '⚪', bad: '⚠️' };
  const helpText = isIOS() ? t('push.help_ios') : t('push.help_steps');
  const showHelp = help || perm === 'denied' || iosNeedsInstall || !supported;

  const resetBtns = html`<div class="row" style="margin-top:8px">
    <button class="btn small" disabled=${busy} onClick=${reset}><${Icon} name="refresh" size=${15} />${t('push.reset')}</button>
    <button class="btn small ghost" disabled=${busy} onClick=${recheck}><${Icon} name="check" size=${15} />${t('push.recheck')}</button>
  </div>`;

  return html`<div class="card stack">
    <h3>${t('push.title')}</h3>
    <p class="small muted" style="margin:0">${t('push.intro')}</p>

    ${err && html`<div class="notice error">${err}${resetBtns}</div>`}

    ${!supported && html`<div class="notice warn">${iosNeedsInstall ? t('push.ios_hint') : t('push.unsupported')}</div>`}

    ${supported && html`<div class="row">
      <button class=${'btn ' + (on ? 'ghost' : 'primary')} disabled=${busy || on === null || perm === 'denied'} onClick=${toggleDevice}>
        <${Icon} name="bell" />${on ? t('push.disable') : t('push.enable')}</button>
      ${on && html`<button class="btn small ghost" disabled=${busy} onClick=${test}>${t('push.test')}</button>`}
      ${(perm === 'denied' || err) && html`<button class="btn small" disabled=${busy} onClick=${reset}><${Icon} name="refresh" size=${15} />${t('push.reset')}</button>`}
      ${on && html`<span class="small faint" style="width:100%">${t('push.test_hint')}</span>`}
    </div>`}

    ${checks.length > 0 && html`<div class="push-checks small">
      <span class="label">${t('push.check_title')}</span>
      ${checks.map(([k, v]) => html`<button type="button" key=${k} class=${'push-check ' + v} onClick=${() => setHelp(true)}>
        <span>${mark[v]}</span> ${t('push.check_' + k)}</button>`)}
      ${(cron === 401 || cron === 403) && html`<div class="notice warn">${t('push.cron_jwt')}</div>`}
    </div>`}

    ${showHelp && html`<div class="notice push-help">
      <b><${Icon} name="help" size=${16} /> ${t('push.help_title')}</b>
      <p style="margin:6px 0 0">${helpText}</p>
      <div class="row" style="margin-top:8px"><button class="btn small" disabled=${busy} onClick=${recheck}><${Icon} name="check" size=${15} />${t('push.recheck')}</button></div>
    </div>`}
    ${!showHelp && html`<div><button class="btn small ghost" onClick=${() => setHelp(true)}><${Icon} name="help" size=${15} />${t('push.help_title')}</button></div>`}
  </div>`;
}
