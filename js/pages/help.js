// Hilfe: erklärt die App an einem Beispiel-Event mit Beispiel-Personen.
// Alles hier ist nur zum Ausprobieren – es wird nichts gespeichert.
import { html, useState } from '../lib/h.js';
import { t, fmtDateTime, fmtRange, fmtRelative } from '../lib/i18n.js';
import { toast } from '../lib/store.js';
import { Icon, Avatar, Person, PersonHover, StatusBadge, Progress, UnreadBadge } from '../lib/ui.js';
import { DateBox } from './shared.js';

// ---------- Beispieldaten ----------
const P = (id, display_name, pronouns, extra = {}) => ({ id: 'demo-' + id, display_name, pronouns, pronouns_custom: '', is_guest: false, ...extra });
const PEOPLE = {
  anna: P('anna', 'Anna Berg', 'she'),
  ben: P('ben', 'Ben Okafor', 'he'),
  cem: P('cem', 'Cem Yılmaz', 'they'),
  dora: P('dora', 'Dora Nowak', 'custom', { pronouns_custom: 'xier/xiem' }),
  emil: P('emil', 'Emil Lund', 'he_they'),
  fatma: P('fatma', 'Fatma Demir', 'she_they'),
};
const day = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const EVENT_START = day(10, 14);
const EVENT_END = day(10, 23);

const SECTIONS = ['team', 'roles', 'prefs', 'event', 'positions', 'availability', 'auto', 'answer', 'groups', 'unread', 'guests', 'profile'];
const ICONS = { team: 'users', roles: 'shield', prefs: 'star', event: 'calendar', positions: 'briefcase', availability: 'clock',
  auto: 'wand', answer: 'check', groups: 'layers', unread: 'bell', guests: 'link', profile: 'user' };

const demoOnly = () => toast(t('help.demo_toast'));

function Demo({ children }) {
  return html`<div class="demo"><span class="demo-tag"><${Icon} name="eye" size=${14} />${t('help.demo')}</span>${children}</div>`;
}

function Section({ id, children, text }) {
  return html`<section class="card help-sec" id=${'help-' + id}>
    <div class="card-head"><span class="help-ico"><${Icon} name=${ICONS[id]} /></span><h2 class="grow" style="margin:0">${t('help.' + id + '_title')}</h2></div>
    ${text !== false && html`<p class="muted" style="margin-top:0">${t('help.' + id + '_text')}</p>`}
    ${children}
  </section>`;
}

// ---------- Die einzelnen Beispiele ----------
function TeamDemo() {
  const [accepted, setAccepted] = useState(null);
  return html`<${Demo}>
    <div class="small muted" style="margin-bottom:6px">${t('invite.link')}</div>
    <div class="copy"><code>…/#/invite/Xk7pQ2aB</code><button class="btn small" onClick=${demoOnly}><${Icon} name="copy" size=${16} />${t('common.copy')}</button></div>
    <div class="small faint" style="margin-top:4px">${t('invite.expires', { when: fmtDateTime(day(1, 18)) })}</div>
    <div class="label" style="margin-top:16px">${t('members.requests')}</div>
    ${accepted === null
      ? html`<div class="list-item" style="flex-wrap:wrap">
          <div style="flex:1 1 220px;min-width:0"><${Person} profile=${PEOPLE.emil} sub=${'„' + t('help.demo_request') + '“'} /></div>
          <div class="row" style="gap:8px">
            <button class="btn small success" onClick=${() => setAccepted(true)}><${Icon} name="check" size=${16} />${t('members.approve')}</button>
            <button class="btn small ghost" onClick=${() => setAccepted(false)}>${t('members.decline')}</button>
          </div></div>`
      : html`<div class=${'notice ' + (accepted ? 'ok' : '')}>${accepted ? t('members.approved', { name: PEOPLE.emil.display_name }) : t('members.no_requests')}</div>`}
  <//>`;
}

const ROLES = [
  { key: 'admin', color: '#7c5cff', perms: ['team.edit', 'members.manage', 'invites.create', 'roles.manage', 'positions.manage', 'events.manage', 'guests.manage', 'chat.moderate'] },
  { key: 'orga', color: '#ff4f8b', perms: ['invites.create', 'events.manage', 'guests.manage', 'chat.moderate'] },
  { key: 'member', color: '#12b8a6', perms: [] },
];
const ALL_PERMS = ROLES[0].perms;

function RolesDemo() {
  const [sel, setSel] = useState('orga');
  const role = ROLES.find((r) => r.key === sel);
  return html`<${Demo}>
    <div class="row" style="gap:8px;margin-bottom:12px">
      ${ROLES.map((r) => html`<button class=${'btn small' + (r.key === sel ? ' primary' : '')} onClick=${() => setSel(r.key)}>
        <span class="dot" style=${{ background: r.color }}></span>${t('help.demo_role_' + r.key)}</button>`)}
    </div>
    <div class="grid-perms">
      ${ALL_PERMS.map((p) => html`<label class="check" key=${p}><input type="checkbox" checked=${role.perms.includes(p)} onChange=${demoOnly} />
        <span><b>${t('perm.' + p)}</b><span class="small faint" style="display:block">${t('perm.' + p + '.desc')}</span></span></label>`)}
    </div>
  <//>`;
}

function PrefsDemo() {
  const [ranks, setRanks] = useState({ catering: 1, deko: 1, einlass: 2 });
  const order = Object.keys(ranks).sort((a, b) => ranks[a] - ranks[b]);
  return html`<${Demo}>
    ${order.map((k) => html`<div class="list-item" key=${k}>
      <span class="chip" style="min-width:34px;justify-content:center">★${ranks[k]}</span>
      <b class="grow">${t('help.demo_' + k)}</b>
      <select class="input" style="width:auto" value=${ranks[k]} onChange=${(e) => setRanks({ ...ranks, [k]: Number(e.target.value) })}>
        ${[1, 2, 3].map((n) => html`<option value=${n}>${n}</option>`)}
      </select>
    </div>`)}
  <//>`;
}

function EventDemo() {
  return html`
    <ol class="help-steps">${[1, 2, 3, 4].map((n) => html`<li key=${n}>${t('help.event_step' + n)}</li>`)}</ol>
    <${Demo}>
      <div class="grid-2" style="gap:12px">
        <label class="field"><span class="label">${t('event.title')}</span><input class="input" value=${t('help.demo_event')} readonly /></label>
        <label class="field"><span class="label">${t('event.location')}</span><input class="input" value=${t('help.demo_location')} readonly /></label>
        <label class="field"><span class="label">${t('event.starts')}</span><input class="input" value=${fmtDateTime(EVENT_START)} readonly /></label>
        <label class="field"><span class="label">${t('event.ends')}</span><input class="input" value=${fmtDateTime(EVENT_END)} readonly /></label>
      </div>
      <div class="label" style="margin-top:12px">${t('event.positions_from_types')}</div>
      ${[['catering', 3, 1], ['deko', 2, 1], ['einlass', 2, 2]].map(([k, slots, shifts]) => html`<div class="list-item" key=${k}>
        <b class="grow">${t('help.demo_' + k)}</b>
        <span class="chip">${slots} ${t('event.slots')}</span>
        ${shifts > 1 && html`<span class="chip">${t('shift.count', { n: shifts })}</span>`}
      </div>`)}
      <div class="row" style="margin-top:12px"><button class="btn primary" onClick=${demoOnly}><${Icon} name="plus" />${t('event.create')}</button></div>
    <//>`;
}

// Gemeinsames Beispiel-Event für die Positionen
const SHIFTS = [
  { pos: 'catering', label: '', start: day(10, 14), end: day(10, 18), slots: 3,
    people: [['anna', 'confirmed'], ['ben', 'proposed']], waitlist: [] },
  { pos: 'einlass', label: 1, start: day(10, 17), end: day(10, 20), slots: 2,
    people: [['cem', 'uncertain', 'help.demo_note'], ['dora', 'confirmed']], waitlist: [] },
  { pos: 'einlass', label: 2, start: day(10, 20), end: day(10, 23), slots: 1,
    people: [['emil', 'confirmed']], waitlist: ['fatma'] },
];

function ShiftDemo({ s }) {
  const free = s.slots - s.people.length;
  return html`<div class=${'shift' + (s.label ? ' multi' : '')}>
    ${s.label && html`<div class="shift-head"><div class="grow"><b>${t('shift.n', { n: s.label })}</b>
      <div class="small muted line"><${Icon} name="clock" size=${14} /><span>${fmtRange(s.start, s.end)}</span></div></div></div>`}
    <div class="slot-line"><${Progress} value=${s.people.length} max=${s.slots} /><b class="small">${s.people.length}/${s.slots}</b></div>
    ${s.people.map(([k, st, note]) => html`<div class="pos-person" key=${k}>
      <div class="grow"><${Person} profile=${PEOPLE[k]} /></div><${StatusBadge} status=${st} />
      ${note && html`<div class="note">„${t(note)}“</div>`}
    </div>`)}
    ${Array.from({ length: Math.max(0, free) }).map((_, i) => html`<div class="slot-empty" key=${i}><span class="avatar sm">?</span>${t('pos.free_slot')}
      <button class="btn small" style="margin-left:auto" onClick=${demoOnly}>${t('pos.signup')}</button></div>`)}
    ${s.waitlist.length > 0 && html`<div class="small muted" style="margin-top:8px">${t('pos.waitlist', { n: s.waitlist.length })}</div>
      ${s.waitlist.map((k, i) => html`<div class="pos-person" key=${k}><b class="faint" style="width:18px">${i + 1}.</b><div class="grow"><${Person} profile=${PEOPLE[k]} /></div><${StatusBadge} status="waitlist" /></div>`)}`}
  </div>`;
}

function PositionsDemo() {
  return html`<${Demo}>
    <div class="legend">${['proposed', 'confirmed', 'uncertain', 'waitlist', 'declined'].map((s) => html`<span class=${'badge st-' + s} title=${t('status.' + s + '.desc')}>${t('status.' + s)}</span>`)}</div>
    <div class="pos-grid">
      <div class="card pos-card" style="--c:#ff8a3d">
        <div class="card-head" style="margin-bottom:4px"><h3 class="grow">${t('help.demo_catering')}</h3><span class="btn icon"><${Icon} name="layers" /></span></div>
        <${ShiftDemo} s=${SHIFTS[0]} />
      </div>
      <div class="card pos-card" style="--c:#2f9bff">
        <div class="card-head" style="margin-bottom:4px"><h3 class="grow">${t('help.demo_einlass')}</h3><span class="btn icon"><${Icon} name="layers" /></span></div>
        <div class="row" style="gap:6px"><span class="chip">${t('shift.count', { n: 2 })}</span></div>
        <${ShiftDemo} s=${SHIFTS[1]} />
        <${ShiftDemo} s=${SHIFTS[2]} />
      </div>
    </div>
  <//>`;
}

function AvailabilityDemo() {
  const rows = [['anna', 'yes'], ['ben', 'yes'], ['cem', 'partly', 'help.demo_note'], ['dora', 'no']];
  return html`<${Demo}>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <span class="chip"><span class="dot av-yes"></span>2</span><span class="chip"><span class="dot av-partly"></span>1</span><span class="chip"><span class="dot av-no"></span>1</span>
    </div>
    ${rows.map(([k, st, note]) => html`<div class="list-item" key=${k}>
      <div class="grow"><${Person} profile=${PEOPLE[k]} sub=${note ? '„' + t(note) + '“' : ''} /></div>
      <span class="chip"><span class=${'dot av-' + st}></span>${t('avail.' + st)}</span>
    </div>`)}
  <//>`;
}

function AutoDemo() {
  const [step, setStep] = useState(0); // 0 Vorschau, 1 übernommen, 2 Mail verschickt
  const picks = [['catering', ['anna · ★1', 'ben · ★1', 'fatma · ★2']], ['deko', ['emil · ★1', 'cem · ★2']]];
  const name = (s) => { const [k, r] = s.split(' · '); return PEOPLE[k].display_name.split(' ')[0] + ' · ' + r; };
  return html`<${Demo}>
    ${step === 0 && html`<div class="stack">
      <div class="notice ok">${t('auto.summary', { n: 5, total: 5 })}</div>
      ${picks.map(([k, list]) => html`<div class="card flat" style="padding:12px" key=${k}><b>${t('help.demo_' + k)}</b>
        <div class="row" style="margin-top:6px">${list.map((x) => html`<span class="chip" key=${x}>${name(x)}</span>`)}</div></div>`)}
      <div class="row"><button class="btn primary" onClick=${() => setStep(1)}><${Icon} name="check" />${t('auto.apply')}</button></div>
    </div>`}
    ${step > 0 && html`<div class="stack">
      <div class="notice ok">${t('auto.done', { n: 5 })}</div>
      <div class="card flat mail-box">
        <div class="row" style="align-items:flex-start"><${Icon} name="mail" /><div class="grow"><b>${t('auto.mail_title')}</b>
          <p class="small muted" style="margin:4px 0 0">${t('mail.intro')}</p></div></div>
        ${step === 1
          ? html`<div class="row"><button class="btn primary" onClick=${() => setStep(2)}><${Icon} name="send" />${t('auto.mail_button', { n: 5 })}</button></div>`
          : html`<div class="notice ok">${t('auto.mail_sent', { n: 5 })}</div>`}
      </div>
      <div class="row"><button class="btn small ghost" onClick=${() => setStep(0)}><${Icon} name="refresh" size=${16} />${t('help.demo_again')}</button></div>
    </div>`}
  <//>`;
}

function AnswerDemo() {
  const [st, setSt] = useState('proposed');
  return html`<${Demo}>
    <div class="card stack-sm" style="max-width:420px">
      <div class="row"><b class="grow">${t('help.demo_event')}</b><${StatusBadge} status=${st} /></div>
      <div class="line small muted"><${Icon} name="briefcase" size=${16} /><b>${t('help.demo_einlass')} · ${t('shift.n', { n: 1 })}</b></div>
      <div class="line small muted"><${Icon} name="calendar" size=${16} /><span>${fmtRange(SHIFTS[1].start, SHIFTS[1].end)}</span></div>
      <div class="line small muted"><${Icon} name="pin" size=${16} /><span>${t('help.demo_location')}</span></div>
      ${st === 'uncertain' && html`<div class="small faint">„${t('help.demo_note')}“</div>`}
      <div class="row" style="margin-top:6px">
        ${st !== 'confirmed' && html`<button class="btn small success" onClick=${() => setSt('confirmed')}><${Icon} name="check" size=${16} />${t('assign.confirm')}</button>`}
        <button class="btn small warn" onClick=${() => setSt('uncertain')}><${Icon} name="help" size=${16} />${t('status.uncertain')}</button>
        <button class="btn small danger" onClick=${() => setSt('declined')}><${Icon} name="x" size=${16} />${t('assign.decline')}</button>
      </div>
      ${st === 'declined' && html`<div class="small muted">${t('help.demo_declined')}</div>`}
    </div>
  <//>`;
}

function GroupsDemo() {
  const [tasks, setTasks] = useState([
    { k: 'task1', done: true, by: 'anna' }, { k: 'task2', done: false }, { k: 'task3', done: false },
  ]);
  const done = tasks.filter((x) => x.done).length;
  return html`<${Demo}>
    <div class="grid-2" style="gap:14px;align-items:start">
      <div class="stack">
        <div class="card flat" style="padding:14px">
          <div class="card-head"><${Icon} name="flag" /><h3 class="grow">${t('group.deadline')}</h3></div>
          <div class="deadline-card" style="flex-wrap:wrap;gap:8px"><div style="flex:1 1 160px"><div class="deadline-big">${fmtRelative(day(8, 18))}</div><div class="muted">${fmtDateTime(day(8, 18))}</div></div>
            <div class="small muted"><span class="row nowrap"><${Icon} name="bell" size=${15} />${t('group.reminder_before', { n: 48 })}</span></div></div>
        </div>
        <div class="card flat" style="padding:14px">
          <div class="card-head"><${Icon} name="tasks" /><h3 class="grow">${t('tasks.title')}</h3><span class="small muted">${t('tasks.progress', { n: done, total: tasks.length })}</span></div>
          <${Progress} value=${done} max=${tasks.length} />
          ${tasks.map((x, i) => html`<div class=${'task' + (x.done ? ' done' : '')} key=${x.k}>
            <input type="checkbox" checked=${x.done} onChange=${(e) => setTasks(tasks.map((y, j) => (j === i ? { ...y, done: e.target.checked, by: 'me' } : y)))} />
            <div class="grow"><div class="task-title">${t('help.demo_' + x.k)}</div>
              ${x.done && x.by === 'anna' && html`<div class="small faint">${t('tasks.done_by', { name: PEOPLE.anna.display_name, when: fmtDateTime(day(-1, 19)) })}</div>`}</div>
          </div>`)}
        </div>
      </div>
      <div class="card flat chat-demo" style="padding:14px">
        <div class="card-head"><${Icon} name="chat" /><h3 class="grow">${t('chat.group_title', { name: t('help.demo_catering') })}</h3></div>
        <div class="msg"><${PersonHover} profile=${PEOPLE.ben}><${Avatar} profile=${PEOPLE.ben} size="sm" /><//>
          <div class="bubble"><div class="meta"><span>${PEOPLE.ben.display_name}</span><span>18:02</span></div><div class="txt">${t('help.demo_msg1')}</div></div></div>
        <div class="msg pinged"><${PersonHover} profile=${PEOPLE.anna}><${Avatar} profile=${PEOPLE.anna} size="sm" /><//>
          <div class="bubble"><div class="meta"><span>${PEOPLE.anna.display_name}</span><span>18:05</span></div>
            <div class="txt"><${PersonHover} profile=${PEOPLE.ben}><span class="mention me">@${PEOPLE.ben.display_name}</span><//> ${t('help.demo_msg2')}</div></div></div>
        <div class="chat-hint small faint">${t('chat.mention_hint')}</div>
      </div>
    </div>
  <//>`;
}

function UnreadDemo() {
  const [seen, setSeen] = useState({});
  const items = [
    { k: 'chat', icon: 'chat', label: t('event.tab_chat'), n: 3 },
    { k: 'tasks', icon: 'tasks', label: t('group.tab_tasks'), n: 1 },
  ];
  const total = items.filter((x) => !seen[x.k]).reduce((s, x) => s + x.n, 0);
  return html`<${Demo}>
    <a class=${'event-card' + (total ? ' has-unread' : '')} onClick=${(e) => e.preventDefault()} href="#/help">
      <${DateBox} date=${EVENT_START} color="#ff4f8b" />
      <div class="grow"><b>${t('help.demo_event')}</b><div class="small muted">${fmtDateTime(EVENT_START)} · ${t('help.demo_location')}</div></div>
      <${UnreadBadge} n=${total} />
    </a>
    <nav class="tabs" style="margin-top:12px">
      ${items.map((x) => html`<a href="#/help" class="tab" key=${x.k} onClick=${(e) => { e.preventDefault(); setSeen({ ...seen, [x.k]: true }); }}>
        <${Icon} name=${x.icon} size=${18} />${x.label}<${UnreadBadge} n=${seen[x.k] ? 0 : x.n} /></a>`)}
    </nav>
    <p class="small faint" style="margin:8px 0 0">${t('help.demo_unread_hint')}</p>
  <//>`;
}

function GuestsDemo() {
  const [active, setActive] = useState(true);
  return html`<${Demo}>
    <div class="card flat stack-sm" style="padding:14px;max-width:520px">
      <div class="row"><b class="grow">${t('help.demo_guest_label')}</b><span class=${'badge ' + (active ? 'st-confirmed' : 'st-declined')}>${active ? t('guest.active') : t('guest.inactive')}</span></div>
      <div class="small muted">${t('guest.for_group', { name: t('help.demo_deko') })}</div>
      <div class="copy"><code>…/#/g/sommerfest-deko</code><button class="btn small" onClick=${demoOnly}><${Icon} name="copy" size=${16} />${t('common.copy')}</button></div>
      <div class="row small"><${Icon} name="key" size=${16} />${t('guest.password')}: <code>Sonnenblume24</code></div>
      <div class="row" style="margin-top:6px">
        <button class="btn small" onClick=${demoOnly}><${Icon} name="refresh" size=${16} />${t('guest.change_link')}</button>
        <button class="btn small" onClick=${demoOnly}><${Icon} name="key" size=${16} />${t('guest.change_password')}</button>
        <button class="btn small ghost" onClick=${() => setActive(!active)}>${active ? t('help.demo_deactivate') : t('help.demo_activate')}</button>
      </div>
    </div>
  <//>`;
}

function ProfileDemo() {
  const [push, setPush] = useState(false);
  return html`<${Demo}>
    <div class="row" style="gap:18px;flex-wrap:wrap">
      ${['anna', 'cem', 'dora'].map((k) => html`<div key=${k}><${Person} profile=${PEOPLE[k]} /></div>`)}
    </div>
    <p class="small faint" style="margin:10px 0 0">${t('help.demo_hover_hint')}</p>
    <div class="row" style="margin-top:12px">
      <button class=${'btn ' + (push ? 'ghost' : 'primary')} onClick=${() => { setPush(!push); toast(push ? t('push.off_done') : t('push.on_done')); }}>
        <${Icon} name="bell" />${push ? t('push.disable') : t('push.enable')}</button>
    </div>
  <//>`;
}

const DEMOS = {
  team: TeamDemo, roles: RolesDemo, prefs: PrefsDemo, event: EventDemo, positions: PositionsDemo, availability: AvailabilityDemo,
  auto: AutoDemo, answer: AnswerDemo, groups: GroupsDemo, unread: UnreadDemo, guests: GuestsDemo, profile: ProfileDemo,
};

export function HelpPage() {
  const jump = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById('help-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return html`<div class="help">
    <div class="hero">
      <h1><${Icon} name="help" size=${30} /> ${t('help.title')}</h1>
      <p class="muted" style="margin:0">${t('help.intro')}</p>
    </div>
    <nav class="help-toc" aria-label=${t('help.toc')}>
      ${SECTIONS.map((id) => html`<a class="chip" href=${'#/help'} key=${id} onClick=${jump(id)}><${Icon} name=${ICONS[id]} size=${14} />${t('help.' + id + '_title')}</a>`)}
    </nav>
    <div class="stack">
      ${SECTIONS.map((id) => {
        const D = DEMOS[id];
        return html`<${Section} id=${id} key=${id} text=${id === 'event' ? true : undefined}><${D} /><//>`;
      })}
      <section class="card help-sec">
        <h2 style="margin-top:0">${t('help.more_title')}</h2>
        <p class="muted" style="margin:0">${t('help.more_text')}</p>
      </section>
    </div>
  </div>`;
}
