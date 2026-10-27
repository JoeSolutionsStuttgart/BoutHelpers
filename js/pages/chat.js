// Chatraum für ein Event (positionId = null) oder eine Gruppe – mit @Erwähnungen
import { html, useState, useEffect, useRef } from '../lib/h.js';
import { sb, q, rpc, flushMail } from '../lib/sb.js';
import { t, fmtTime, fmtLongDay } from '../lib/i18n.js';
import { useStore, toastError, confirmDialog } from '../lib/store.js';
import { Icon, Avatar, Spinner, Empty, PersonHover } from '../lib/ui.js';
import { useSeen } from '../lib/unread.js';

const PROFILE_COLS = 'id, display_name, pronouns, pronouns_custom, is_guest';
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Textstück mit hervorgehobenen @Erwähnungen in Teile zerlegen
function mentionParts(body, names, people, me) {
  if (!names.length) return [body];
  const re = new RegExp('@(' + names.map((n) => escRe(n.name)).join('|') + ')', 'g');
  const parts = [];
  let last = 0;
  body.replace(re, (m, name, idx) => {
    if (idx > last) parts.push(body.slice(last, idx));
    const hit = names.find((n) => n.name === name);
    parts.push(html`<${PersonHover} profile=${people[hit.id]}><span class=${'mention' + (hit.id === me ? ' me' : '')}>@${name}</span><//>`);
    last = idx + m.length;
    return m;
  });
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

// Nachrichtentext mit @Erwähnungen und Verweisen auf Abstimmungen ([[poll:id]])
function MessageText({ body, mentions, people, me, polls, pollHref }) {
  const names = (mentions || []).map((id) => people[id]).filter(Boolean)
    .map((p) => ({ id: p.id, name: p.display_name })).sort((a, b) => b.name.length - a.name.length);
  const tok = /\[\[poll:([\w-]+)\]\]/g;
  const out = [];
  let last = 0; let m;
  while ((m = tok.exec(body)) !== null) {
    if (m.index > last) out.push(...mentionParts(body.slice(last, m.index), names, people, me));
    const title = (polls && polls[m[1]]) || t('polls.heading');
    out.push(html`<a class="poll-ref" href=${pollHref}><${Icon} name="chart" size=${14} />${title}</a>`);
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(...mentionParts(body.slice(last), names, people, me));
  return html`<div class="txt">${out}</div>`;
}

export function Chat({ eventId, positionId, title, canModerate }) {
  const { user } = useStore();
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const [polls, setPolls] = useState([]); // Abstimmungen im Raum (zum Verlinken)
  const [pollPick, setPollPick] = useState(false);
  const [suggest, setSuggest] = useState(null); // { query, start, items, index }
  const picked = useRef({}); // Name -> id der ausgewählten Erwähnungen
  const scroller = useRef();
  const input = useRef();
  const stick = useRef(true);
  const profiles = useRef({});
  const room = positionId || null;
  // Solange der Chat offen ist, gilt alles als gelesen
  useSeen(room ? 'group_chat' : 'event_chat', room || eventId, [msgs && msgs.length]);

  const upsert = (row) => setMsgs((m) => {
    if (!m) return m;
    const i = m.findIndex((x) => x.id === row.id);
    if (i >= 0) { const c = [...m]; c[i] = { ...c[i], ...row }; return c; }
    return [...m, row].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  useEffect(() => {
    let alive = true;
    rpc('room_members', { ev: eventId, pos: room }).then((list) => {
      if (!alive) return;
      (list || []).forEach((p) => { profiles.current[p.id] = profiles.current[p.id] || p; });
      setMembers(list || []);
    }).catch(() => {});
    (async () => {
      let b = sb.from('messages').select('*, profiles(' + PROFILE_COLS + ')').eq('event_id', eventId)
        .order('created_at', { ascending: false }).limit(300);
      b = room ? b.eq('position_id', room) : b.is('position_id', null);
      const rows = await q(b);
      rows.reverse();
      rows.forEach((r) => { if (r.profiles) profiles.current[r.user_id] = r.profiles; });
      if (alive) setMsgs(rows);
    })().catch((e) => { toastError(e); if (alive) setMsgs([]); });
    (async () => {
      let pb = sb.from('polls').select('id, question').eq('event_id', eventId);
      pb = room ? pb.eq('position_id', room) : pb.is('position_id', null);
      const pr = await q(pb).catch(() => []);
      if (alive) setPolls(pr || []);
    })();

    const ch = sb.channel('chat-' + eventId + '-' + (room || 'event') + '-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'event_id=eq.' + eventId }, async (pl) => {
        if (pl.eventType === 'DELETE') {
          const oldId = pl.old && pl.old.id;
          if (oldId) setMsgs((m) => m && m.filter((x) => x.id !== oldId));
          return;
        }
        const row = pl.new;
        if (!row || (row.position_id || null) !== room) return;
        let prof = profiles.current[row.user_id];
        if (!prof) {
          const r = await q(sb.from('profiles').select(PROFILE_COLS).eq('id', row.user_id)).catch(() => []);
          prof = r[0] || { id: row.user_id, display_name: '?' };
          profiles.current[row.user_id] = prof;
        }
        upsert({ ...row, profiles: prof });
      })
      .subscribe();
    return () => { alive = false; sb.removeChannel(ch); };
  }, [eventId, room]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const onScroll = () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // @-Vorschläge beim Tippen
  const updateSuggest = (value, caret) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
    if (!m) return setSuggest(null);
    const query = m[2].toLowerCase();
    const items = members.filter((p) => p.id !== user.id && p.display_name.toLowerCase().includes(query)).slice(0, 6);
    if (!items.length) return setSuggest(null);
    setSuggest({ start: caret - m[2].length - 1, caret, items, index: 0 });
  };
  const choose = (p) => {
    const s = suggest;
    if (!s) return;
    const next = text.slice(0, s.start) + '@' + p.display_name + ' ' + text.slice(s.caret);
    picked.current[p.display_name] = p.id;
    setText(next);
    setSuggest(null);
    const pos = s.start + p.display_name.length + 2;
    setTimeout(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(pos, pos); } }, 0);
  };

  // Verweis auf eine Abstimmung in den Text einfügen
  const insertPoll = (p) => {
    setText((prev) => prev + (prev && !/\s$/.test(prev) ? ' ' : '') + '[[poll:' + p.id + ']] ');
    setPollPick(false);
    setTimeout(() => { if (input.current) input.current.focus(); }, 0);
  };

  const send = async (e) => {
    e && e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (editing) {
        const rows = await q(sb.from('messages').update({ body }).eq('id', editing.id).select('*'));
        if (rows[0]) upsert(rows[0]);
        setEditing(null);
      } else {
        // Erwähnt ist, wessen "@Name" noch im Text steht
        const mentions = [...new Set(Object.entries(picked.current)
          .filter(([name]) => body.includes('@' + name)).map(([, id]) => id))];
        const rows = await q(sb.from('messages').insert({ event_id: eventId, position_id: room, user_id: user.id, body, mentions })
          .select('*, profiles(' + PROFILE_COLS + ')'));
        if (rows[0]) { profiles.current[user.id] = rows[0].profiles; stick.current = true; upsert(rows[0]); }
        if (mentions.length) flushMail();
      }
      picked.current = {};
      setText('');
    } catch (err) { toastError(err); } finally { setBusy(false); }
  };

  const del = async (m) => {
    if (!(await confirmDialog({ title: t('chat.delete'), text: t('chat.delete_text'), danger: true, ok: t('common.delete') }))) return;
    try { await q(sb.from('messages').delete().eq('id', m.id)); setMsgs((all) => all.filter((x) => x.id !== m.id)); } catch (e) { toastError(e); }
  };

  const startEdit = (m) => { setEditing(m); setText(m.body); };

  const onKey = (e) => {
    if (suggest) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index + 1) % suggest.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSuggest({ ...suggest, index: (suggest.index + suggest.items.length - 1) % suggest.items.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggest.items[suggest.index]); return; }
      if (e.key === 'Escape') { setSuggest(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && editing) { setEditing(null); setText(''); }
  };

  const pollMap = {};
  polls.forEach((p) => { pollMap[p.id] = p.question; });
  const pollHref = '#/' + (room ? 'group/' + room : 'event/' + eventId) + '/polls';
  let lastDay = '';
  let lastUser = '';
  let lastTime = 0;
  return html`<div class="card chat">
    <div class="chat-head"><${Icon} name="chat" /><h3>${title}</h3></div>
    <div class="chat-scroll" ref=${scroller} onScroll=${onScroll}>
      ${msgs === null && html`<${Spinner} />`}
      ${msgs && msgs.length === 0 && html`<${Empty} icon="chat" title=${t('chat.empty')} text=${t('chat.empty_text')} />`}
      ${(msgs || []).map((m) => {
        const day = new Date(m.created_at).toDateString();
        const ts = new Date(m.created_at).getTime();
        const showDay = day !== lastDay;
        const grouped = !showDay && lastUser === m.user_id && ts - lastTime < 5 * 60000;
        lastDay = day; lastUser = m.user_id; lastTime = ts;
        const mine = m.user_id === user.id;
        const p = m.profiles || {};
        const mentionsMe = (m.mentions || []).includes(user.id);
        return html`
          ${showDay && html`<div class="chat-day" key=${'d' + day}>${fmtLongDay(m.created_at)}</div>`}
          <div class=${'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (mentionsMe && !mine ? ' pinged' : '')} key=${m.id}>
            ${!mine && (grouped ? html`<span style="width:28px;flex:none"></span>` : html`<${PersonHover} profile=${p}><${Avatar} profile=${p} size="sm" /><//>`)}
            <div class="bubble">
              ${!grouped && html`<div class="meta">${!mine && html`<${PersonHover} profile=${p}><span>${p.display_name}</span><//>`}<span>${fmtTime(m.created_at)}</span></div>`}
              <${MessageText} body=${m.body} mentions=${m.mentions} people=${profiles.current} me=${user.id} polls=${pollMap} pollHref=${pollHref} />
              ${m.edited_at && html`<div class="meta">${t('chat.edited')}</div>`}
            </div>
            <div class="tools">
              ${mine && html`<button class="btn icon" aria-label=${t('common.edit')} title=${t('common.edit')} onClick=${() => startEdit(m)}><${Icon} name="edit" size=${15} /></button>`}
              ${(mine || canModerate) && html`<button class="btn icon" aria-label=${t('common.delete')} title=${t('common.delete')} onClick=${() => del(m)}><${Icon} name="trash" size=${15} /></button>`}
            </div>
          </div>`;
      })}
    </div>
    ${editing && html`<div class="row small" style="padding:6px 14px;background:var(--surface-2)"><${Icon} name="edit" size=${14} /><span class="grow">${t('chat.editing')}</span>
      <button class="btn small ghost" onClick=${() => { setEditing(null); setText(''); }}>${t('common.cancel')}</button></div>`}
    <form class="chat-input" onSubmit=${send}>
      ${suggest && html`<div class="mention-list" role="listbox">${suggest.items.map((p, i) => html`
        <button type="button" role="option" aria-selected=${i === suggest.index} class=${i === suggest.index ? 'on' : ''}
          onMouseDown=${(e) => { e.preventDefault(); choose(p); }}><${Avatar} profile=${p} size="sm" />${p.display_name}</button>`)}</div>`}
      ${pollPick && polls.length > 0 && html`<div class="poll-picker" role="listbox">${polls.map((p) => html`
        <button type="button" key=${p.id} onMouseDown=${(e) => { e.preventDefault(); insertPoll(p); }}><${Icon} name="chart" size=${16} />${p.question}</button>`)}</div>`}
      ${polls.length > 0 && html`<button type="button" class="btn icon" aria-label=${t('chat.link_poll')} title=${t('chat.link_poll')} onClick=${() => setPollPick((v) => !v)}><${Icon} name="chart" /></button>`}
      <textarea class="input" rows="1" maxlength="4000" placeholder=${t('chat.placeholder')} value=${text} ref=${input}
        onInput=${(e) => { setText(e.target.value); updateSuggest(e.target.value, e.target.selectionStart); e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }}
        onKeyDown=${onKey} onBlur=${() => setTimeout(() => setSuggest(null), 150)}></textarea>
      <button class="btn primary" disabled=${busy || !text.trim()} aria-label=${t('chat.send')}><${Icon} name="send" /></button>
    </form>
    <div class="chat-hint small faint">${t('chat.mention_hint')}</div>
  </div>`;
}
