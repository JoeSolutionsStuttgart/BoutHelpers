// Abstimmungen: Team (eventId null), Event (positionId null) oder Gruppe
import { html, useState } from '../lib/h.js';
import { sb, q, rpc } from '../lib/sb.js';
import { t, fmtDateTime, fmtRelative, toLocalInput, fromLocalInput } from '../lib/i18n.js';
import { toast, toastError, confirmDialog } from '../lib/store.js';
import { Icon, Spinner, Empty, ErrorBox, Field, Modal, useAsync, useRealtime } from '../lib/ui.js';
import { useSeen } from '../lib/unread.js';

const PROFILE = 'profiles(id, display_name)';
const isClosed = (p) => p.closed || (p.closes_at && new Date(p.closes_at) < new Date());

export function Polls({ eventId, positionId, teamId, me, canModerate }) {
  const scope = positionId || null;
  const [creating, setCreating] = useState(false);
  const d = useAsync(async () => {
    let qb = sb.from('polls').select('*, poll_options(*, poll_votes(user_id, voter:' + PROFILE + '))')
      .order('created_at', { ascending: false });
    if (scope) qb = qb.eq('position_id', scope);
    else if (eventId) qb = qb.eq('event_id', eventId).is('position_id', null);
    else qb = qb.eq('team_id', teamId).is('event_id', null).is('position_id', null);
    return q(qb);
  }, [eventId, positionId, teamId]);
  useRealtime(teamId ? 'polls-' + (scope || eventId || teamId) : null, ['polls', 'poll_options', 'poll_votes'], 'team_id=eq.' + teamId, () => d.reload(true));
  useSeen(scope ? 'group_polls' : eventId ? 'event_polls' : 'team_polls', scope || eventId || teamId, [d.data && d.data.length]);

  const polls = d.data || [];
  return html`<div class="stack">
    <div class="toolbar">
      <h2 class="grow row" style="margin:0;gap:8px"><${Icon} name="chart" />${t('polls.heading')}${polls.length ? html`<span class="chip">${polls.length}</span>` : ''}</h2>
      <button class="btn primary" onClick=${() => setCreating(true)}><${Icon} name="plus" />${t('polls.new')}</button>
    </div>
    <p class="muted small" style="margin:-6px 0 0">${t('polls.intro')}</p>
    ${d.loading && !d.data && html`<${Spinner} />`}
    ${d.error && html`<${ErrorBox} error=${d.error} onRetry=${() => d.reload(true)} />`}
    ${d.data && polls.length === 0 && html`<div class="card"><${Empty} icon="chart" title=${t('polls.none')} text=${t('polls.none_text')} /></div>`}
    ${polls.map((p) => html`<${PollCard} key=${p.id} poll=${p} me=${me} canModerate=${canModerate} onChange=${() => d.reload(true)} />`)}
    ${creating && html`<${PollModal} eventId=${eventId} positionId=${scope} teamId=${teamId} onClose=${() => setCreating(false)} onSaved=${() => d.reload(true)} />`}
  </div>`;
}

function PollCard({ poll, me, canModerate, onChange }) {
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState(false);
  const options = (poll.poll_options || []).slice().sort((a, b) => a.sort - b.sort);
  const voters = new Set();
  options.forEach((o) => (o.poll_votes || []).forEach((v) => voters.add(v.user_id)));
  const maxCount = Math.max(1, ...options.map((o) => (o.poll_votes || []).length));
  const canEdit = poll.created_by === me || canModerate;
  const closed = isClosed(poll);

  const vote = async (optId) => {
    try { await rpc('poll_vote', { opt: optId }); onChange(); } catch (e) { toastError(e); }
  };
  const addOption = async (e) => {
    e && e.preventDefault();
    if (!adding.trim()) return;
    try { await rpc('add_poll_option', { p: poll.id, otext: adding.trim() }); setAdding(''); onChange(); } catch (err) { toastError(err); }
  };
  const removeOption = async (o) => {
    try { await rpc('remove_poll_option', { opt: o.id }); onChange(); } catch (err) { toastError(err); }
  };
  const toggleClosed = async () => {
    try { await rpc('set_poll_closed', { p: poll.id, c: !poll.closed }); onChange(); } catch (e) { toastError(e); }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: t('polls.delete'), text: t('polls.delete_confirm'), danger: true, ok: t('common.delete') }))) return;
    try { await rpc('delete_poll', { p: poll.id }); toast(t('common.saved')); onChange(); } catch (e) { toastError(e); }
  };

  return html`<div class="card stack-sm">
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <h3 style="margin:0">${poll.question}</h3>
        <div class="small faint">${poll.multiple ? t('polls.multiple') : t('polls.single')}${closed ? ' · ' + t('polls.closed') : ''} · ${t('polls.votes_n', { n: voters.size })}</div>
        ${poll.closes_at && html`<div class="small" style=${{ color: closed ? 'var(--st-declined)' : 'var(--muted)' }}><${Icon} name="clock" size=${13} /> ${closed ? t('polls.ended_on', { when: fmtDateTime(poll.closes_at) }) : t('polls.ends_in', { when: fmtRelative(poll.closes_at) })}</div>`}
      </div>
      ${canEdit && html`<button class="btn small ghost" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${15} />${t('common.edit')}</button>
        <button class="btn small ghost" onClick=${toggleClosed}><${Icon} name=${poll.closed ? 'refresh' : 'lock'} size=${15} />${poll.closed ? t('polls.reopen') : t('polls.close')}</button>
        <button class="btn icon" aria-label=${t('polls.delete')} onClick=${del}><${Icon} name="trash" size=${16} /></button>`}
    </div>
    <div class="poll-opts">${options.map((o) => {
      const votes = o.poll_votes || [];
      const mine = votes.some((v) => v.user_id === me);
      const names = votes.map((v) => v.voter && v.voter.display_name).filter(Boolean);
      return html`<div class="poll-opt-row" key=${o.id}>
        <button class=${'poll-opt grow' + (mine ? ' mine' : '')} disabled=${closed} onClick=${() => vote(o.id)}>
          <span class="poll-bar" style=${{ width: (votes.length / maxCount * 100) + '%' }}></span>
          <span class="poll-opt-main">
            <${Icon} name=${mine ? 'check' : (poll.multiple ? 'square' : 'circle')} size=${16} />
            <span class="grow">${o.text}</span>
            <b>${votes.length}</b>
          </span>
          ${names.length > 0 && html`<span class="poll-voters">${names.join(', ')}</span>`}
        </button>
        ${canEdit && html`<button class="btn icon" aria-label=${t('common.remove')} title=${t('polls.remove_option')} onClick=${() => removeOption(o)}><${Icon} name="x" size=${15} /></button>`}
      </div>`;
    })}</div>
    ${poll.allow_add && !closed && html`<form class="row" onSubmit=${addOption}>
      <input class="input grow" maxlength="200" placeholder=${t('polls.add_option_ph')} value=${adding} onInput=${(e) => setAdding(e.target.value)} />
      <button class="btn" disabled=${!adding.trim()}><${Icon} name="plus" size=${16} />${t('polls.add_option')}</button>
    </form>`}
    ${editing && html`<${PollModal} poll=${poll} onClose=${() => setEditing(false)} onSaved=${onChange} />`}
  </div>`;
}

function PollModal({ eventId, positionId, teamId, poll, onClose, onSaved }) {
  const edit = !!poll;
  const [question, setQuestion] = useState(poll ? poll.question : '');
  const [multiple, setMultiple] = useState(poll ? !!poll.multiple : false);
  const [allowAdd, setAllowAdd] = useState(poll ? !!poll.allow_add : false);
  const [closes, setCloses] = useState(poll ? toLocalInput(poll.closes_at) : '');
  const [opts, setOpts] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const setOpt = (i, v) => setOpts(opts.map((o, j) => (j === i ? v : o)));
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  const save = async () => {
    if (!question.trim()) return toast(t('polls.need_question'), 'error');
    if (!edit && clean.length < 2 && !allowAdd) return toast(t('polls.need_options'), 'error');
    setBusy(true);
    try {
      if (edit) {
        await rpc('edit_poll', { p: poll.id, question: question.trim(), multiple, allow_add: allowAdd, closes: fromLocalInput(closes) });
      } else {
        const args = { question: question.trim(), multiple, allow_add: allowAdd, options: clean, closes: fromLocalInput(closes) };
        if (positionId) args.pos = positionId; else if (eventId) args.ev = eventId; else args.team = teamId;
        await rpc('create_poll', args);
      }
      toast(t('common.saved'));
      onSaved();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${edit ? t('polls.edit') : t('polls.new')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" disabled=${busy} onClick=${save}><${Icon} name="check" />${edit ? t('common.save') : t('polls.create')}</button>`}>
    <div class="stack">
      <${Field} label=${t('polls.question')}><input class="input" maxlength="300" value=${question} onInput=${(e) => setQuestion(e.target.value)} placeholder=${t('polls.question_ph')} /><//>
      ${!edit && html`<div class="field"><span class="label">${t('polls.options')}</span>
        <div class="stack-sm">${opts.map((o, i) => html`<div class="row" key=${i}>
          <input class="input grow" maxlength="200" value=${o} placeholder=${t('polls.option_ph', { n: i + 1 })} onInput=${(e) => setOpt(i, e.target.value)} />
          ${opts.length > 1 && html`<button class="btn icon" type="button" aria-label=${t('common.remove')} onClick=${() => setOpts(opts.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>`}
        </div>`)}</div>
        <div><button class="btn small ghost" type="button" onClick=${() => setOpts([...opts, ''])}><${Icon} name="plus" size=${16} />${t('polls.add_option')}</button></div>
      </div>`}
      ${edit && html`<p class="small faint" style="margin:0">${t('polls.edit_options_hint')}</p>`}
      <div class="field"><span class="label">${t('polls.answer_type')}</span>
        <div class="seg" role="group">
          <button type="button" class=${!multiple ? 'on' : ''} onClick=${() => setMultiple(false)}>${t('polls.single')}</button>
          <button type="button" class=${multiple ? 'on' : ''} onClick=${() => setMultiple(true)}>${t('polls.multiple')}</button>
        </div>
      </div>
      <${Field} label=${t('polls.deadline')} hint=${t('polls.deadline_hint')}><input class="input" type="datetime-local" value=${closes} onInput=${(e) => setCloses(e.target.value)} /><//>
      <label class="check"><input type="checkbox" checked=${allowAdd} onChange=${(e) => setAllowAdd(e.target.checked)} />
        <span><b>${t('polls.allow_add')}</b><span class="small faint" style="display:block">${t('polls.allow_add_hint')}</span></span></label>
    </div>
  <//>`;
}
