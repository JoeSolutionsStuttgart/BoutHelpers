#!/usr/bin/env node
/*
  Campi · liest quellen.json und gibt Claude genau diese Seiten frei.

  node scripts/quellen.mjs            Quellen und freigegebene Domains anzeigen
  node scripts/quellen.mjs --github   claude_args für den Workflow in $GITHUB_OUTPUT schreiben
*/
import {readFileSync, appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const IST_SKRIPT = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

export function ladeQuellen(){
  const q = JSON.parse(readFileSync(new URL('../quellen.json', import.meta.url), 'utf8'));
  const ok = x => x && typeof x === 'object' && typeof x.url === 'string' && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"<>]*)?$/i.test(x.url);
  const hochschule = (Array.isArray(q.hochschule) ? q.hochschule : []).filter(ok);
  const stadt = (Array.isArray(q.stadt) ? q.stadt : []).filter(x => ok(x) && ['Esslingen', 'Göppingen'].includes(x.stadt));
  return {hochschule, stadt};
}
/* "www.dieselstrasse.de" -> "dieselstrasse.de"; Unterseiten wie stadtbuecherei.esslingen.de bleiben, wie sie sind */
export function domain(u){ return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); }
export function domains(q){
  const set = new Set(['hs-esslingen.de', 'studierendenwerk-stuttgart.de']);
  [...q.hochschule, ...q.stadt].forEach(x => set.add(domain(x.url)));
  return [...set].sort();
}
/* gehört eine Adresse zu einer freigegebenen Domain? (auch Unterdomains, z. B. www.) */
export function erlaubt(u, liste){
  try { const h = new URL(u).hostname.toLowerCase(); return liste.some(d => h === d || h.endsWith('.' + d)); } catch(e){ return false; }
}

if(IST_SKRIPT){
  const q = ladeQuellen(), ds = domains(q);
  if(process.argv.includes('--github')){
    const modell = process.env.MODELL || 'claude-sonnet-5-5';
    const tools = ['Read', 'Glob', 'Grep', 'Edit(/daten.json)', 'WebSearch']
      .concat(ds.flatMap(d => [`WebFetch(domain:${d})`, `WebFetch(domain:*.${d})`]))
      .concat(['Bash(node scripts/daten-pruefen.mjs)']);
    const args = `--model ${modell} --max-turns 90 --allowedTools "${tools.join(',')}"`;
    appendFileSync(process.env.GITHUB_OUTPUT, `claude_args=${args}\n`);
    console.log(`${q.hochschule.length} Seiten der Hochschule, ${q.stadt.length} Seiten der Städte, freigegeben: ${ds.join(', ')}`);
  } else {
    console.log('Hochschule:'); q.hochschule.forEach(x => console.log(`  ${x.name}: ${x.url}`));
    console.log('Städte:'); q.stadt.forEach(x => console.log(`  ${x.stadt} · ${x.name}: ${x.url}`));
    console.log('Freigegebene Domains: ' + ds.join(', '));
  }
}
