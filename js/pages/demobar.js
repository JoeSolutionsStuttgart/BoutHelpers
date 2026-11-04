// Demo-Leiste: Person wechseln, alles umbenennen, zurücksetzen, Demo verlassen.
import { html, useState } from '../lib/h.js';
import { t } from '../lib/i18n.js';
import { useStore, confirmDialog } from '../lib/store.js';
import { Icon, Modal, Field } from '../lib/ui.js';
import { demoViewer, demoPeople, setViewer, demoTeamsAndGroups, renameEntity, resetDemo, disableDemo } from '../lib/demo.js';

export function DemoBar() {
  const { profile } = useStore();
  const [renaming, setRenaming] = useState(false);
  const people = demoPeople();
  const me = demoViewer();
  const reset = async () => {
    if (await confirmDialog({ title: t('demo.reset'), text: t('demo.reset_text'), danger: true, ok: t('demo.reset') })) resetDemo();
  };
  const leave = async () => {
    if (await confirmDialog({ title: t('demo.leave'), text: t('demo.leave_text'), ok: t('demo.leave') })) { disableDemo(); location.hash = '#/login'; location.reload(); }
  };
  return html`<div class="demobar">
    <span class="demobar-tag"><${Icon} name="eye" size=${15} />${t('demo.badge')}</span>
    <label class="demobar-as">
      <span class="small">${t('demo.view_as')}</span>
      <select class="input" value=${me} onChange=${(e) => setViewer(e.target.value)}>
        ${people.map((p) => html`<option value=${p.id} key=${p.id}>${p.name}</option>`)}
      </select>
    </label>
    <span class="grow"></span>
    <button class="btn small" onClick=${() => setRenaming(true)}><${Icon} name="edit" size=${15} />${t('demo.rename')}</button>
    <button class="btn small ghost" onClick=${reset}><${Icon} name="refresh" size=${15} />${t('demo.reset')}</button>
    <button class="btn small ghost" onClick=${leave}><${Icon} name="logout" size=${15} />${t('demo.leave')}</button>
    ${renaming && html`<${RenameModal} onClose=${() => setRenaming(false)} />`}
  </div>`;
}

function RenameModal({ onClose }) {
  const data = demoTeamsAndGroups();
  const [edits, setEdits] = useState({});
  const set = (kind, id) => (e) => setEdits((p) => ({ ...p, [kind + ':' + id]: e.target.value }));
  const val = (kind, id, name) => (edits[kind + ':' + id] != null ? edits[kind + ':' + id] : name);
  const save = () => {
    Object.entries(edits).forEach(([key, name]) => {
      const [kind, id] = key.split(':');
      if (name != null && name.trim()) renameEntity(kind, id, name.trim());
    });
    location.reload();
  };
  const section = (title, kind, items, sub) => html`<div class="field">
    <span class="label">${title}</span>
    <div class="rename-grid">${items.map((it) => html`<div class="rename-row" key=${it.id}>
      <input class="input" value=${val(kind, it.id, it.name)} onInput=${set(kind, it.id)} />
      ${sub && sub(it) && html`<span class="small faint">${sub(it)}</span>`}
    </div>`)}</div>
  </div>`;
  return html`<${Modal} wide title=${t('demo.rename_title')} onClose=${onClose} footer=${html`
    <button class="btn ghost" onClick=${onClose}>${t('common.cancel')}</button>
    <button class="btn primary" onClick=${save}><${Icon} name="check" />${t('demo.rename_save')}</button>`}>
    <div class="stack">
      <p class="small muted" style="margin:0">${t('demo.rename_hint')}</p>
      ${section(t('demo.teams'), 'team', data.teams)}
      ${section(t('demo.groups'), 'group', data.groups, (g) => g.event)}
      ${section(t('demo.people'), 'person', data.people, (p) => (p.guest ? t('common.guest') : ''))}
    </div>
  <//>`;
}
