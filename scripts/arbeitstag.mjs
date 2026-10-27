#!/usr/bin/env node
/*
  Campi · Ist heute ein Tag, an dem die Daten aktualisiert werden?
  Nein an Samstagen, Sonntagen, gesetzlichen Feiertagen in Baden-Württemberg und an den Tagen unter
  "freie_tage" in quellen.json.

  node scripts/arbeitstag.mjs                 heute (deutsche Zeit)
  node scripts/arbeitstag.mjs 2026-12-25      ein bestimmter Tag
  node scripts/arbeitstag.mjs --ja-nein       gibt nur "ja" oder "nein" aus (die Begründung steht auf stderr)
  node scripts/arbeitstag.mjs --liste 2027    alle Feiertage eines Jahres
*/
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const IST_SKRIPT = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function heuteBerlin(){ return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date()); }
function plusTage(iso, n){ const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/* Ostersonntag (gregorianisch, Algorithmus nach Gauß/Anonymus) */
function ostern(j){
  const a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${j}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}
/* gesetzliche Feiertage in Baden-Württemberg */
export function feiertage(j){
  const o = ostern(j);
  return [
    [`${j}-01-01`, 'Neujahr'], [`${j}-01-06`, 'Heilige Drei Könige'], [plusTage(o, -2), 'Karfreitag'], [plusTage(o, 1), 'Ostermontag'],
    [`${j}-05-01`, 'Tag der Arbeit'], [plusTage(o, 39), 'Christi Himmelfahrt'], [plusTage(o, 50), 'Pfingstmontag'], [plusTage(o, 60), 'Fronleichnam'],
    [`${j}-10-03`, 'Tag der Deutschen Einheit'], [`${j}-11-01`, 'Allerheiligen'], [`${j}-12-25`, '1. Weihnachtstag'], [`${j}-12-26`, '2. Weihnachtstag']
  ].sort((x, y) => x[0].localeCompare(y[0]));
}
function freieTage(){
  try {
    const q = JSON.parse(readFileSync(new URL('../quellen.json', import.meta.url), 'utf8'));
    return (Array.isArray(q.freie_tage) ? q.freie_tage : []).filter(x => typeof x === 'string' && ISO.test(x));
  } catch(e){ return []; }
}
export function pruefe(iso){
  const wt = new Date(iso + 'T12:00:00Z').getUTCDay();
  if(wt === 6) return {arbeitstag: false, grund: 'Samstag'};
  if(wt === 0) return {arbeitstag: false, grund: 'Sonntag'};
  const ft = feiertage(+iso.slice(0, 4)).find(x => x[0] === iso);
  if(ft) return {arbeitstag: false, grund: ft[1] + ' (Feiertag in Baden-Württemberg)'};
  if(freieTage().includes(iso)) return {arbeitstag: false, grund: 'freier Tag laut quellen.json'};
  return {arbeitstag: true, grund: 'Werktag'};
}

const args = process.argv.slice(2);
if(IST_SKRIPT){
  if(args.includes('--liste')){
    const j = parseInt(args[args.indexOf('--liste') + 1], 10) || +heuteBerlin().slice(0, 4);
    feiertage(j).forEach(([d, n]) => console.log(d + '  ' + n));
  } else {
    const iso = args.find(a => ISO.test(a)) || heuteBerlin();
    const r = pruefe(iso);
    const text = `${iso}: ${r.arbeitstag ? 'Werktag, Daten werden aktualisiert' : 'keine Aktualisierung (' + r.grund + ')'}`;
    if(args.includes('--ja-nein')){ console.error(text); console.log(r.arbeitstag ? 'ja' : 'nein'); }
    else console.log(text);
  }
}
