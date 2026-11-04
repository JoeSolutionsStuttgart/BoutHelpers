// Anmelden, Registrieren, Passwort vergessen / neu setzen
import { html, useState } from '../lib/h.js';
import { sb, appBase } from '../lib/sb.js';
import { t, lang } from '../lib/i18n.js';
import { toast, errText } from '../lib/store.js';
import { Icon, BrandMark, Field, PasswordInput, LangSelect, ThemeSwitch, appName, go } from '../lib/ui.js';

export function AuthShell({ children, title, sub }) {
  return html`<div class="auth-wrap">
    <div class="auth-top"><${LangSelect} /><${ThemeSwitch} compact /></div>
    <div class="auth-card">
      <div class="auth-logo">
        <${BrandMark} size=${34} />
        <h1>${appName()}</h1>
        <div class="confetti">${['--pink', '--orange', '--sun', '--teal', '--sky', '--violet'].map((c) => html`<i style=${{ background: `var(${c})` }}></i>`)}</div>
        ${sub && html`<p class="muted" style="margin-top:10px">${sub}</p>`}
      </div>
      <div class="card stack">
        ${title && html`<h2>${title}</h2>`}
        ${children}
      </div>
    </div>
  </div>`;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(errText(error));
  };
  return html`<${AuthShell} title=${t('auth.login')} sub=${t('auth.tagline')}>
    <form class="stack" onSubmit=${submit}>
      <${Field} label=${t('auth.email')}><input class="input" type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
      <${Field} label=${t('auth.password')}><${PasswordInput} autocomplete="current-password" required=${true} value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      ${err && html`<div class="notice error">${err}</div>`}
      <button class="btn primary block" disabled=${busy}><${Icon} name="login" />${t('auth.login')}</button>
    </form>
    <div class="row between small">
      <a href="#/forgot">${t('auth.forgot')}</a>
      <a href="#/signup">${t('auth.to_signup')}</a>
    </div>
  <//>`;
}

export function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr(t('auth.name_required'));
    if (pw.length < 8) return setErr(t('err.password'));
    setBusy(true); setErr('');
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password: pw,
      options: { data: { display_name: name.trim(), language: lang() }, emailRedirectTo: appBase() + '?flow=signup' },
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    if (!data.session) setDone(true);
  };
  if (done) {
    return html`<${AuthShell} title=${t('auth.check_mail_title')}>
      <div class="notice ok">${t('auth.check_mail', { email })}</div>
      <a class="btn ghost" href="#/login">${t('auth.back_to_login')}</a>
    <//>`;
  }
  return html`<${AuthShell} title=${t('auth.signup')} sub=${t('auth.tagline')}>
    <form class="stack" onSubmit=${submit}>
      <${Field} label=${t('profile.name')} hint=${t('profile.name_hint')}><input class="input" required maxlength="60" autocomplete="nickname" value=${name} onInput=${(e) => setName(e.target.value)} /><//>
      <${Field} label=${t('auth.email')}><input class="input" type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
      <${Field} label=${t('auth.password')} hint=${t('auth.password_hint')}><${PasswordInput} autocomplete="new-password" minlength=${8} required=${true} value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      ${err && html`<div class="notice error">${err}</div>`}
      <button class="btn primary block" disabled=${busy}><${Icon} name="userPlus" />${t('auth.signup')}</button>
    </form>
    <div class="small"><a href="#/login">${t('auth.to_login')}</a></div>
  <//>`;
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appBase() + '?flow=reset' });
    setBusy(false);
    if (error) setErr(errText(error)); else setSent(true);
  };
  return html`<${AuthShell} title=${t('auth.forgot')}>
    ${sent
      ? html`<div class="notice ok">${t('auth.reset_sent')}</div>`
      : html`<form class="stack" onSubmit=${submit}>
          <p class="muted">${t('auth.forgot_text')}</p>
          <${Field} label=${t('auth.email')}><input class="input" type="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
          ${err && html`<div class="notice error">${err}</div>`}
          <button class="btn primary block" disabled=${busy}><${Icon} name="mail" />${t('auth.send_link')}</button>
        </form>`}
    <div class="small"><a href="#/login">${t('auth.back_to_login')}</a></div>
  <//>`;
}

export function NewPasswordPage() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return setErr(t('err.password'));
    setBusy(true); setErr('');
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(errText(error));
    toast(t('auth.password_changed'));
    go('/');
  };
  return html`<div class="card" style="max-width:480px;margin:0 auto">
    <h2>${t('auth.new_password')}</h2>
    <form class="stack" onSubmit=${submit}>
      <${Field} label=${t('auth.password')} hint=${t('auth.password_hint')}><${PasswordInput} autocomplete="new-password" minlength=${8} required=${true} value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      ${err && html`<div class="notice error">${err}</div>`}
      <button class="btn primary" disabled=${busy}><${Icon} name="key" />${t('common.save')}</button>
    </form>
  </div>`;
}
