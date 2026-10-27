#!/usr/bin/env node
/*
  Campi · holt den Speiseplan der Mensen Stadtmitte und Flandernstraße (Studierendenwerk Stuttgart über OpenMensa)
  und schreibt ihn zusammen mit den bisherigen Fristen und Veranstaltungen in daten.json.

  node scripts/daten-holen.mjs             Speiseplan holen und daten.json neu schreiben
  node scripts/daten-holen.mjs --anwenden  nur die Übersetzungen und Korrekturen aus daten.json auf die Gerichte übertragen (ohne Internet)

  Umgebungsvariablen (nur für Tests): OPENMENSA_BASE, DATEN_DATEI, HEUTE (JJJJ-MM-TT), TAGE
*/
import {readFile, writeFile} from 'node:fs/promises';

const DATEI = process.env.DATEN_DATEI || 'daten.json';
const BASE = (process.env.OPENMENSA_BASE || 'https://openmensa.org/api/v2').replace(/\/+$/, '');
const TAGE = Math.min(Math.max(parseInt(process.env.TAGE || '14', 10) || 14, 1), 21);
const MENSEN = {SM: 396, FL: 397};
const SPRACHEN = ['en', 'es', 'it', 'fr', 'tr'];
const TYPEN = ['vegan', 'vegetarisch', 'fleisch', 'fisch'];
const NUR_ANWENDEN = process.argv.includes('--anwenden');

/* ---------- Datum in deutscher Zeit ---------- */
function berlinTeile(d = new Date()){
  const f = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset'});
  const t = {}; f.formatToParts(d).forEach(p => { t[p.type] = p.value; });
  const off = (t.timeZoneName || 'GMT+01:00').replace('GMT', '') || '+00:00';
  return {datum: `${t.year}-${t.month}-${t.day}`, iso: `${t.year}-${t.month}-${t.day}T${t.hour}:${t.minute}:${t.second}${off.length === 6 ? off : '+00:00'}`};
}
const HEUTE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.HEUTE || '') ? process.env.HEUTE : berlinTeile().datum;
function plusTage(iso, n){ const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const BIS = plusTage(HEUTE, TAGE);
/* Montag dieser Woche: frühere Tage der laufenden Woche bleiben aus dem letzten Lauf erhalten (die App zeigt Mo–Fr) */
const MONTAG = plusTage(HEUTE, -((new Date(HEUTE + 'T12:00:00Z').getUTCDay() + 6) % 7));

/* ---------- Texte ---------- */
function sauber(s, max){
  if(typeof s !== 'string') return '';
  return s.replace(/[<>]/g, '')
    .replace(/\s*\((?:\s*[0-9A-Za-zÄÖÜäöü]{1,3}\s*,)*\s*[0-9A-Za-zÄÖÜäöü]{1,3}\s*\)/g, '')   /* Kennzeichnungen wie (1,2,Gl,Ei) */
    .replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim().slice(0, max);
}

/* ---------- Allergene und Art aus den OpenMensa-Hinweisen ---------- */
const ALLERGENE = [
  ['Erdnuss', /erdn(u|ü)ss/i],
  ['Nuesse', /schalenfr(u|ü)cht|(^|[^d])n(u|ü)ss|mandel|cashew|pistazie|macadamia|pekan|paran(u|ü)ss/i],
  ['Gluten', /gluten|weizen|roggen|gerste|hafer|dinkel|kamut/i],
  ['Krebstiere', /krebs|krusten/i],
  ['Weichtiere', /weichtier|mollus/i],
  ['Milch', /milch|lakto|lacto|laktose/i],
  ['Ei', /(^|[^a-zäöü])eier?([^a-zäöü]|$)|h(u|ü)hnerei/i],
  ['Fisch', /(^|[^a-zäöü])fisch/i],
  ['Senf', /senf/i],
  ['Sellerie', /sellerie/i],
  ['Soja', /soja/i],
  ['Sesam', /sesam/i],
  ['Sulfite', /sulfit|schwefel/i],
  ['Lupine', /lupine/i]
];
const FISCH = /fisch|lachs|seelachs|thunfisch|forelle|kabeljau|zander|pangasius|hering|makrele|scholle|dorsch|garnele|shrimp|scampi|calamar|tintenfisch|meeresfr/i;
const FLEISCH = /fleisch|schwein|rind|kalb|lamm|hähnchen|haehnchen|huhn|hühn|geflügel|gefluegel|pute|truthahn|(^|[^a-zäöü])ente|hirsch|wildragout|hack|speck|schinken|wurst|würst|salami|bacon|gyros|döner|doener|leberkäse|schnitzel|frikadelle|bolognese|chicken|maultasche/i;
const VEGAN_FALSCH = /(nicht|kein)\s+vegan/i;

function allergeneAus(notes){
  const out = [];
  (Array.isArray(notes) ? notes : []).forEach(n => {
    if(typeof n !== 'string') return;
    ALLERGENE.forEach(([k, re]) => { if(re.test(n) && !out.includes(k)) out.push(k); });
  });
  return out;
}
function typAus(name, kategorie, notes){
  const hinweise = (Array.isArray(notes) ? notes : []).filter(n => typeof n === 'string').join(' | ');
  const alles = `${name} | ${kategorie} | ${hinweise}`, kopf = `${name} | ${kategorie}`;
  if(/vegan/i.test(alles) && !VEGAN_FALSCH.test(alles)) return 'vegan';
  if(/vegetari|fleischlos|veggie/i.test(alles)) return 'vegetarisch';
  /* "Fisch" als Allergen allein macht ein Gericht noch nicht zum Fischgericht */
  if(FISCH.test(kopf) || /meeresfr/i.test(hinweise)) return 'fisch';
  if(FLEISCH.test(kopf) || /schwein|rind|geflügel|gefluegel|lamm|kalb|wild|fleisch/i.test(hinweise)) return 'fleisch';
  return null;
}
function preis(v){ const n = Number(v); return Number.isFinite(n) && n > 0 && n < 50 ? Math.round(n * 100) / 100 : null; }

/* ---------- OpenMensa ---------- */
async function holeJson(pfad){
  const r = await fetch(BASE + pfad, {headers: {'Accept': 'application/json', 'User-Agent': 'Campi-Prototyp/1 (GitHub Actions; daten-holen.mjs)'},
    signal: AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`${r.status} bei ${pfad}`);
  return r.json();
}
async function holeMensa(id){
  const tage = await holeJson(`/canteens/${id}/days`);
  if(!Array.isArray(tage)) throw new Error('unerwartete Antwort bei /days');
  const out = [];
  for(const t of tage.filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date >= HEUTE && t.date <= BIS).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 15)){
    if(t.closed){ out.push({datum: t.date, geschlossen: true, gerichte: []}); continue; }
    let essen;
    try { essen = await holeJson(`/canteens/${id}/days/${t.date}/meals`); }
    catch(e){ out.push({datum: t.date, fehler: String(e.message || e)}); continue; }
    const gerichte = (Array.isArray(essen) ? essen : []).slice(0, 24).map(m => {
      const name = sauber(m && m.name, 160); if(!name) return null;
      const kategorie = sauber(m.category, 60);
      const p = m.prices || {};
      return {name: {de: name}, kategorie: kategorie ? {de: kategorie} : null, typ: typAus(name, kategorie, m.notes),
        preis: preis(p.students), preis_bedienstete: preis(p.employees), allergene: allergeneAus(m.notes)};
    }).filter(Boolean);
    out.push({datum: t.date, geschlossen: false, gerichte});
  }
  return out;
}

/* ---------- Übersetzungen und Korrekturen übertragen ---------- */
function vollstaendig(u){ return u && typeof u === 'object' && SPRACHEN.every(l => typeof u[l] === 'string' && u[l].trim()); }
function mitUebersetzung(x, cache, max){
  if(!x || typeof x.de !== 'string') return x;
  const de = x.de, u = cache[de], out = {de};
  SPRACHEN.forEach(l => { if(u && typeof u[l] === 'string' && u[l].trim()) out[l] = sauber(u[l], max); });
  return out;
}
function anwenden(d){
  const cache = d.uebersetzungen && typeof d.uebersetzungen === 'object' ? d.uebersetzungen : {};
  const typen = d.typen && typeof d.typen === 'object' ? d.typen : {};
  const fehlend = new Set(), genutzt = new Set();
  Object.values(d.mensa || {}).forEach(m => (m.tage || []).forEach(t => (t.gerichte || []).forEach(g => {
    g.name = mitUebersetzung(g.name, cache, 160); genutzt.add(g.name.de);
    if(!vollstaendig(cache[g.name.de])) fehlend.add(g.name.de);
    if(g.kategorie){ g.kategorie = mitUebersetzung(g.kategorie, cache, 60); genutzt.add(g.kategorie.de); if(!vollstaendig(cache[g.kategorie.de])) fehlend.add(g.kategorie.de); }
    if(TYPEN.includes(typen[g.name.de])) g.typ = typen[g.name.de];
  })));
  /* Zwischenspeicher begrenzen: Einträge, die gerade nicht gebraucht werden, fallen erst bei mehr als 1500 Einträgen weg */
  const keys = Object.keys(cache);
  if(keys.length > 1500) keys.filter(k => !genutzt.has(k)).slice(0, keys.length - 1500).forEach(k => { delete cache[k]; });
  const tk = Object.keys(typen);
  if(tk.length > 1500) tk.filter(k => !genutzt.has(k)).slice(0, tk.length - 1500).forEach(k => { delete typen[k]; });
  d.uebersetzungen = cache; d.typen = typen;
  d.fehlende_uebersetzungen = [...fehlend].slice(0, 200);
  return d;
}

/* ---------- Hauptprogramm ---------- */
async function main(){
  let alt = {};
  try { alt = JSON.parse(await readFile(DATEI, 'utf8')); } catch(e){ alt = {}; }
  if(!alt || typeof alt !== 'object' || Array.isArray(alt)) alt = {};

  if(NUR_ANWENDEN){
    if(alt.version !== 1){ console.error('daten.json fehlt oder ist ungültig'); process.exit(1); }
    await writeFile(DATEI, JSON.stringify(anwenden(alt), null, 1) + '\n');
    console.log(`Übersetzungen übertragen, noch offen: ${alt.fehlende_uebersetzungen.length}`);
    return;
  }

  const status = {};
  const mensa = {};
  for(const [k, id] of Object.entries(MENSEN)){
    const vorher = alt.mensa && alt.mensa[k] && typeof alt.mensa[k] === 'object' ? alt.mensa[k] : {};
    const vorherTage = (Array.isArray(vorher.tage) ? vorher.tage : []).filter(t => t && t.datum >= MONTAG);
    let tage;
    try {
      tage = await holeMensa(id);
      /* einzelne Tage, die nicht geladen werden konnten: alten Stand behalten */
      tage = tage.map(t => t.fehler ? (vorherTage.find(v => v.datum === t.datum) || null) : t).filter(Boolean);
      /* vergangene Tage dieser Woche aus dem letzten Lauf davor setzen */
      tage = vorherTage.filter(v => v.datum < HEUTE && !tage.some(t => t.datum === v.datum)).concat(tage);
      status[k] = tage.length ? 'aktuell' : 'kein Speiseplan veröffentlicht';
      console.log(`Mensa ${k} (OpenMensa ${id}): ${tage.length} Tage, ${tage.reduce((s, t) => s + t.gerichte.length, 0)} Gerichte`);
    } catch(e){
      tage = vorherTage;
      status[k] = 'nicht erreichbar, alter Stand';
      console.warn(`::warning::Mensa ${k}: ${e.message || e} – behalte ${tage.length} Tage vom letzten Lauf`);
    }
    const eintrag = {openmensa_id: id, tage};
    ['oeffnungszeiten', 'essensausgabe', 'geschlossen'].forEach(f => { if(typeof vorher[f] === 'string') eintrag[f] = vorher[f]; });
    mensa[k] = eintrag;
  }

  const termine = (Array.isArray(alt.termine) ? alt.termine : []).filter(t => t && typeof t.datum === 'string' && t.datum >= HEUTE);
  const neu = {
    version: 1,
    stand: berlinTeile().iso,
    quelle: 'Speiseplan: Studierendenwerk Stuttgart über OpenMensa · Fristen: hs-esslingen.de · Veranstaltungen: Hochschule, Esslingen und Göppingen (quellen.json)',
    status,
    mensa,
    fristen: Array.isArray(alt.fristen) ? alt.fristen : [],
    termine,
    uebersetzungen: alt.uebersetzungen && typeof alt.uebersetzungen === 'object' && !Array.isArray(alt.uebersetzungen) ? alt.uebersetzungen : {},
    typen: alt.typen && typeof alt.typen === 'object' && !Array.isArray(alt.typen) ? alt.typen : {},
    fehlende_uebersetzungen: []
  };
  anwenden(neu);
  await writeFile(DATEI, JSON.stringify(neu, null, 1) + '\n');
  console.log(`daten.json geschrieben (Stand ${neu.stand}), fehlende Übersetzungen: ${neu.fehlende_uebersetzungen.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
