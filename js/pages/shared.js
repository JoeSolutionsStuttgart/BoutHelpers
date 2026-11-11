// Gemeinsame Aktionen für Einsätze
import { html } from '../lib/h.js';
import { rpc } from '../lib/sb.js';
import { t, combineDateTime } from '../lib/i18n.js';
import { toast, toastError, promptDialog, confirmDialog } from '../lib/store.js';
import { Icon } from '../lib/ui.js';

// Auf die eigene Einteilung antworten (bestätigen / ungewiss / absagen)
export async function respond(a, status) {
  let note = '';
  if (status === 'uncertain') {
    const r = await promptDialog({
      title: t('assign.uncertain_title'), text: t('assign.uncertain_text'), label: t('assign.reason_optional'),
      multiline: true, value: a.status === 'uncertain' ? a.note : '', maxLength: 500, ok: t('status.uncertain'),
    });
    if (r === null) return false;
    note = r.trim();
  }
  if (status === 'declined') {
    const r = await promptDialog({
      title: t('assign.decline_title'), text: t('assign.decline_text'), label: t('assign.reason_optional'),
      multiline: true, maxLength: 500, ok: t('assign.decline'),
    });
    if (r === null) return false;
    note = r.trim();
  }
  try {
    await rpc('respond_assignment', { a: a.id, new_status: status, msg: note });
    toast(t('assign.saved_' + status));
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function leaveWaitlist(a) {
  if (!(await confirmDialog({ title: t('assign.leave_waitlist'), text: t('assign.leave_waitlist_text'), danger: true, ok: t('assign.leave_waitlist') }))) return false;
  try {
    await rpc('respond_assignment', { a: a.id, new_status: 'declined', msg: '' });
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

// Knöpfe für die eigene Antwort. locked = verbindliche Zuteilung: kein Annehmen/Ablehnen.
export function MyAnswerButtons({ a, onDone, locked }) {
  const act = async (st) => { if (await respond(a, st)) onDone && onDone(); };
  if (locked && a.status !== 'waitlist') {
    return html`<span class="chip"><${Icon} name="lock" size=${14} />${t('assign.binding')}</span>`;
  }
  if (a.status === 'waitlist') {
    return html`<button class="btn small ghost" onClick=${async () => { if (await leaveWaitlist(a)) onDone && onDone(); }}><${Icon} name="x" size=${16} />${t('assign.leave_waitlist')}</button>`;
  }
  return html`
    ${a.status !== 'confirmed' && html`<button class="btn small success" onClick=${() => act('confirmed')}><${Icon} name="check" size=${16} />${t('assign.confirm')}</button>`}
    <button class="btn small warn" onClick=${() => act('uncertain')}><${Icon} name="help" size=${16} />${a.status === 'uncertain' ? t('assign.edit_reason') : t('status.uncertain')}</button>
    <button class="btn small danger" onClick=${() => act('declined')}><${Icon} name="x" size=${16} />${t('assign.decline')}</button>`;
}

export function DateBox({ date, color }) {
  const d = new Date(date);
  return html`<div class="datebox" style=${{ '--c': color || 'var(--violet)' }}>
    <b>${new Intl.DateTimeFormat(document.documentElement.lang || 'de', { day: 'numeric' }).format(d)}</b>
    <span>${new Intl.DateTimeFormat(document.documentElement.lang || 'de', { month: 'short' }).format(d)}</span>
  </div>`;
}

// ---------- Schichten: Vorlagen, Editor & Positions-Planer (Event-Erstellung + nachträglich) ----------
export const tmplId = () => 's' + Math.random().toString(36).slice(2, 9);

// Schicht-Vorlagen einer Positionsart robust einlesen (altes Format ohne Spalte = keine)
export function normalizeTemplates(x) {
  if (!Array.isArray(x)) return [];
  return x.map((r) => ({ id: String(r && r.id || ''), name: String(r && r.name || ''), from: String(r && r.from || ''), to: String(r && r.to || ''), slots: Math.max(1, Math.min(500, Number(r && r.slots) || 1)) }));
}

// Kurzname einer Schicht-Vorlage (Name oder Uhrzeit oder „Schicht n")
export function tmplLabel(tpl, i) {
  if (tpl.name) return tpl.name;
  if (tpl.from) return tpl.from + (tpl.to ? '–' + tpl.to : '');
  return t('shift.n', { n: i + 1 });
}

// Schicht-Zeilen bereinigen (ohne Vorlagen-id → neue, unabhängige Schichten)
export function cleanShiftRows(rows) {
  return (rows || []).map((r) => ({ name: String(r && r.name || ''), from: String(r && r.from || ''), to: String(r && r.to || ''), slots: Math.max(1, Math.min(500, Number(r && r.slots) || 1)) }));
}

// Editor für eine Liste von Schichten (Name, Uhrzeit von/bis, Plätze).
// sources (optional): [{label, rows}] – „Schichten übernehmen von …" als Shortcut.
export function ShiftRowsEditor({ rows, setRows, sources }) {
  const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => { const last = rows[rows.length - 1]; setRows([...rows, { name: '', from: last ? last.to : '', to: '', slots: last ? last.slots : 1 }]); };
  const del = (i) => setRows(rows.filter((_, j) => j !== i));
  const pick = (e) => { const i = Number(e.target.value); e.target.value = ''; if (!Number.isNaN(i) && sources[i]) setRows(cleanShiftRows(sources[i].rows)); };
  return html`<div class="stack-sm">
    ${sources && sources.length > 0 && html`<label class="row nowrap" style="gap:6px">
      <span class="small faint">${t('shift.take_from')}</span>
      <select class="input" style="width:auto;max-width:100%" onChange=${pick}>
        <option value="">${t('shift.take_choose')}</option>
        ${sources.map((s, i) => html`<option value=${i} key=${i}>${s.label}</option>`)}
      </select>
    </label>`}
    ${rows.length === 0 && html`<p class="small faint" style="margin:0">${t('shift.none')}</p>`}
    ${rows.map((r, i) => html`<div class="shift-row" key=${i}>
      <input class="input" placeholder=${t('shift.name')} maxlength="80" value=${r.name} onInput=${(e) => upd(i, 'name', e.target.value)} />
      <input class="input" type="time" aria-label=${t('avail.from')} value=${r.from} onInput=${(e) => upd(i, 'from', e.target.value)} />
      <input class="input" type="time" aria-label=${t('avail.to')} value=${r.to} onInput=${(e) => upd(i, 'to', e.target.value)} />
      <input class="input" type="number" min="1" max="500" aria-label=${t('event.slots')} value=${r.slots} onInput=${(e) => upd(i, 'slots', e.target.value)} />
      <button type="button" class="btn icon" aria-label=${t('common.remove')} onClick=${() => del(i)}><${Icon} name="trash" size=${16} /></button>
    </div>`)}
    <button type="button" class="btn small" onClick=${add}><${Icon} name="plus" size=${16} />${t('shift.add')}</button>
  </div>`;
}

// Anfangszustand des Planers: je Positionsart aus/an + Schichten (aus den Vorlagen)
export function makePlan(types) {
  return Object.fromEntries((types || []).map((x) => [x.id, { on: false, shifts: normalizeTemplates(x.shift_templates) }]));
}

// Positionsarten auswählen und je Position die Schichten festlegen (vorbefüllt aus Vorlagen).
// existing(typeId) kann true liefern, wenn die Position im Event schon existiert (nur Hinweis).
// locked(typeId): Position ist bereits im Event. Dann: Häkchen = behalten, abhaken = entfernen,
// kein Schicht-Editor (Schichten werden direkt am Event bearbeitet). Sonst: anhaken legt neu an.
export function PositionPlanner({ types, plan, setPlan, existing, info, locked, shiftSources }) {
  const toggle = (id) => setPlan((p) => {
    const cur = p[id]; const on = !cur.on;
    const lk = locked && locked(id);
    const shifts = !lk && on && cur.shifts.length === 0 ? [{ name: '', from: '', to: '', slots: 1 }] : cur.shifts;
    return { ...p, [id]: { ...cur, on, shifts } };
  });
  const setShifts = (id) => (rows) => setPlan((p) => ({ ...p, [id]: { ...p[id], shifts: rows } }));
  // „Schichten übernehmen von …": Vorlagen anderer Positionsarten + bereits gesetzte Positionen + Bestand
  const sourcesFor = (typeId) => {
    const out = []; const seen = new Set();
    const push = (label, rows) => { if (label && rows && rows.length && !seen.has(label)) { seen.add(label); out.push({ label, rows }); } };
    (types || []).forEach((y) => push(t('shift.from_template', { name: y.name }), normalizeTemplates(y.shift_templates)));
    (types || []).forEach((y) => { if (y.id !== typeId) { const pr = plan[y.id]; if (pr && pr.on) push(t('shift.from_position', { name: y.name }), pr.shifts); } });
    (shiftSources || []).forEach((s) => push(s.label, s.rows));
    return out;
  };
  return html`<div>${(types || []).map((x) => {
    const p = plan[x.id] || { on: false, shifts: [] };
    const lk = locked && locked(x.id);
    const has = existing && existing(x.id);
    return html`<div class="pos-plan" key=${x.id}>
      <label class="row nowrap" style="gap:8px;cursor:pointer">
        <input type="checkbox" checked=${p.on} onChange=${() => toggle(x.id)} />
        <span class="dot" style=${{ background: x.color }}></span><b class="grow">${x.name}</b>
        ${lk && p.on && html`<span class="small faint">${t('pos.already_on_event')}</span>`}
        ${lk && !p.on && html`<span class="small" style="color:var(--st-declined)">${t('pos.will_remove')}</span>`}
        ${!lk && has && html`<span class="small faint">${t('pos.already_on_event')}</span>`}
        ${!lk && !p.on && p.shifts.length > 0 && html`<span class="small faint">${t('shift.count', { n: p.shifts.length })}</span>`}
      </label>
      ${info && info(x)}
      ${!lk && p.on && html`<div style="margin:8px 0 2px 26px"><${ShiftRowsEditor} rows=${p.shifts} setRows=${setShifts(x.id)} sources=${sourcesFor(x.id)} /></div>`}
    </div>`;
  })}</div>`;
}

// Zeigt, wer eine Positionsart wünscht (Rang + gewünschte Schichten) – für den Hinzufügen-Dialog
export function WishSummary({ prefs, typeId, members, templates }) {
  const nameOf = (uid) => { const m = (members || []).find((x) => x.user_id === uid); return m && m.profiles ? m.profiles.display_name : '?'; };
  const list = (prefs || []).filter((p) => p.position_type_id === typeId && p.rank > 0).sort((a, b) => a.rank - b.rank);
  if (!list.length) return null;
  return html`<div class="shift-wish sm" style="margin-left:26px">
    <span class="small faint">${t('prefs.wants')}</span>
    ${list.map((p) => {
      const ws = (Array.isArray(p.shifts) ? p.shifts : []).map((id) => { const i = (templates || []).findIndex((s) => s.id === id); return i >= 0 ? tmplLabel(templates[i], i) : null; }).filter(Boolean);
      return html`<span class="chip" key=${p.user_id} title=${t('prefs.rank_n', { n: p.rank })}>${nameOf(p.user_id)}${ws.length ? ' · ' + ws.join(', ') : ''}</span>`;
    })}
  </div>`;
}

// Welche Personen auf welche neu erzeugte Schicht vorgemerkt werden sollen (aus den Schicht-Wünschen).
// createdShifts in Einfüge-Reihenfolge, tmplIds[i] = Vorlagen-id der i-ten Schicht ('' = keine).
export function wishAssignments({ prefs, typeId, createdShifts, tmplIds }) {
  const out = [];
  (createdShifts || []).forEach((sh, i) => {
    const tid = (tmplIds || [])[i];
    if (!tid) return;
    (prefs || []).forEach((p) => {
      if (p.position_type_id === typeId && Array.isArray(p.shifts) && p.shifts.includes(tid)) out.push({ sh: sh.id, uid: p.user_id });
    });
  });
  return out;
}

// Schicht-Zeilen des Editors in DB-Datensätze umwandeln (Event-Datum + Uhrzeit, über Mitternacht)
export function buildShiftRows(shifts, { evDate, eventId, teamId, positionId }) {
  return (shifts || []).map((r, i) => {
    let s = combineDateTime(evDate, r.from); let en = combineDateTime(evDate, r.to);
    if (s && en && new Date(en) <= new Date(s)) en = new Date(new Date(en).getTime() + 86400000).toISOString();
    return { position_id: positionId, event_id: eventId, team_id: teamId, name: (r.name || '').trim(), slots: Math.max(1, Math.min(500, Number(r.slots) || 1)), starts_at: s, ends_at: en, sort: i };
  });
}
