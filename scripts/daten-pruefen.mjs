#!/usr/bin/env node
/*
  Campi · prüft daten.json, bevor der Workflow sie veröffentlicht.
  node scripts/daten-pruefen.mjs [datei]   → "OK" oder eine Liste der Fehler (Exit-Code 1)
*/
import {readFile, stat} from 'node:fs/promises';

const DATEI = process.argv[2] || process.env.DATEN_DATEI || 'daten.json';
const SPRACHEN = ['de', 'en', 'es', 'it', 'fr', 'tr'];
const TYPEN = ['vegan', 'vegetarisch', 'fleisch', 'fisch'];
const ALLERGENE = ['Gluten', 'Milch', 'Ei', 'Senf', 'Sellerie', 'Soja', 'Sesam', 'Fisch', 'Krebstiere', 'Nuesse', 'Erdnuss', 'Sulfite', 'Lupine', 'Weichtiere'];
const CAMPUS = ['SM', 'FL', 'GP'];
const OBERSTE = ['version', 'stand', 'quelle', 'status', 'mensa', 'fristen', 'termine', 'uebersetzungen', 'typen', 'fehlende_uebersetzungen', 'hinweis'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fehler = [];
const f = (pfad, text) => { if(fehler.length < 60) fehler.push(`${pfad}: ${text}`); };

function istDatum(s){ return typeof s === 'string' && ISO.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s; }
function text(pfad, s, max, pflicht){
  if(s === undefined || s === null){ if(pflicht) f(pfad, 'fehlt'); return; }
  if(typeof s !== 'string'){ f(pfad, 'muss Text sein'); return; }
  if(pflicht && !s.trim()) f(pfad, 'ist leer');
  if(s.length > max) f(pfad, `ist länger als ${max} Zeichen`);
  if(/[<>]/.test(s)) f(pfad, 'enthält < oder >');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) f(pfad, 'enthält Steuerzeichen');
}
function mehrsprachig(pfad, o, max, pflicht){
  if(o === undefined || o === null){ if(pflicht) f(pfad, 'fehlt'); return; }
  if(typeof o !== 'object' || Array.isArray(o)){ f(pfad, 'muss ein Objekt {"de": …, "en": …} sein'); return; }
  text(pfad + '.de', o.de, max, true);
  Object.keys(o).forEach(k => { if(!SPRACHEN.includes(k)) f(pfad, `unbekannte Sprache "${k}"`); else if(k !== 'de') text(`${pfad}.${k}`, o[k], max, false); });
}
function url(pfad, u){
  if(u === undefined || u === null) return;
  if(typeof u !== 'string' || !/^https:\/\/[^\s"<>]+$/.test(u) || u.length >= 300) f(pfad, 'muss eine https-Adresse sein');
}

async function main(){
  let roh;
  try {
    if((await stat(DATEI)).size > 512 * 1024) f(DATEI, 'ist größer als 512 KB');
    roh = await readFile(DATEI, 'utf8');
  } catch(e){ console.error(`${DATEI} nicht gefunden`); process.exit(1); }
  let d;
  try { d = JSON.parse(roh); } catch(e){ console.error(`${DATEI} ist kein gültiges JSON: ${e.message}`); process.exit(1); }
  if(!d || typeof d !== 'object' || Array.isArray(d)){ console.error('daten.json muss ein Objekt sein'); process.exit(1); }

  Object.keys(d).forEach(k => { if(!OBERSTE.includes(k)) f(k, 'unbekanntes Feld'); });
  if(d.version !== 1) f('version', 'muss 1 sein');
  if(typeof d.stand !== 'string' || isNaN(Date.parse(d.stand)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.stand)) f('stand', 'muss Datum und Uhrzeit sein, z. B. 2026-10-16T01:02:03+02:00');
  else if(Date.parse(d.stand) > Date.now() + 36e5) f('stand', 'liegt in der Zukunft');
  text('quelle', d.quelle, 200, false);
  text('hinweis', d.hinweis, 300, false);
  if(d.status !== undefined && (typeof d.status !== 'object' || Array.isArray(d.status) || Object.values(d.status).some(v => typeof v !== 'string' || v.length > 80))) f('status', 'muss ein Objekt mit kurzen Texten sein');

  /* Speiseplan */
  if(d.mensa !== undefined){
    if(typeof d.mensa !== 'object' || Array.isArray(d.mensa)) f('mensa', 'muss ein Objekt sein');
    else Object.entries(d.mensa).forEach(([k, m]) => {
      const p = `mensa.${k}`;
      if(!['SM', 'FL'].includes(k)){ f(p, 'nur SM und FL haben eine Mensa'); return; }
      if(!m || typeof m !== 'object'){ f(p, 'muss ein Objekt sein'); return; }
      ['oeffnungszeiten', 'essensausgabe', 'geschlossen'].forEach(x => text(`${p}.${x}`, m[x], 120, false));
      if(!Array.isArray(m.tage)){ f(`${p}.tage`, 'muss eine Liste sein'); return; }
      if(m.tage.length > 21) f(`${p}.tage`, 'höchstens 21 Tage');
      const gesehen = new Set();
      m.tage.forEach((t, i) => {
        const pt = `${p}.tage[${i}]`;
        if(!t || typeof t !== 'object'){ f(pt, 'muss ein Objekt sein'); return; }
        if(!istDatum(t.datum)) f(`${pt}.datum`, 'muss JJJJ-MM-TT sein');
        else if(gesehen.has(t.datum)) f(`${pt}.datum`, 'doppelt'); else gesehen.add(t.datum);
        if(typeof t.geschlossen !== 'boolean') f(`${pt}.geschlossen`, 'muss true oder false sein');
        if(!Array.isArray(t.gerichte)){ f(`${pt}.gerichte`, 'muss eine Liste sein'); return; }
        if(t.gerichte.length > 24) f(`${pt}.gerichte`, 'höchstens 24 Gerichte');
        t.gerichte.forEach((g, j) => {
          const pg = `${pt}.gerichte[${j}]`;
          if(!g || typeof g !== 'object'){ f(pg, 'muss ein Objekt sein'); return; }
          mehrsprachig(`${pg}.name`, g.name, 160, true);
          mehrsprachig(`${pg}.kategorie`, g.kategorie, 60, false);
          if(g.typ !== null && g.typ !== undefined && !TYPEN.includes(g.typ)) f(`${pg}.typ`, `muss ${TYPEN.join(', ')} oder null sein`);
          ['preis', 'preis_bedienstete'].forEach(x => { if(g[x] !== null && g[x] !== undefined && !(typeof g[x] === 'number' && g[x] > 0 && g[x] < 50)) f(`${pg}.${x}`, 'muss eine Zahl zwischen 0 und 50 oder null sein'); });
          if(!Array.isArray(g.allergene) || g.allergene.some(a => !ALLERGENE.includes(a))) f(`${pg}.allergene`, `nur ${ALLERGENE.join(', ')}`);
        });
      });
    });
  }

  /* Fristen */
  const grenzeAlt = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10), grenzeNeu = new Date(Date.now() + 800 * 864e5).toISOString().slice(0, 10);
  if(d.fristen !== undefined){
    if(!Array.isArray(d.fristen)) f('fristen', 'muss eine Liste sein');
    else {
      if(d.fristen.length > 12) f('fristen', 'höchstens 12 Einträge');
      const keys = new Set();
      d.fristen.forEach((x, i) => {
        const p = `fristen[${i}]`;
        if(!x || typeof x !== 'object'){ f(p, 'muss ein Objekt sein'); return; }
        if(typeof x.key !== 'string' || !/^[a-z_]{2,40}$/.test(x.key)) f(`${p}.key`, 'nur Kleinbuchstaben und _');
        else if(keys.has(x.key)) f(`${p}.key`, 'doppelt'); else keys.add(x.key);
        if(x.von !== undefined && x.von !== null && !istDatum(x.von)) f(`${p}.von`, 'muss JJJJ-MM-TT sein');
        if(x.bis !== undefined && x.bis !== null && !istDatum(x.bis)) f(`${p}.bis`, 'muss JJJJ-MM-TT sein');
        if(!x.von && !x.bis) f(p, 'braucht von oder bis');
        if(istDatum(x.von) && istDatum(x.bis) && x.bis < x.von) f(p, 'bis liegt vor von');
        [x.von, x.bis].filter(istDatum).forEach(v => { if(v < grenzeAlt || v > grenzeNeu) f(p, `Datum ${v} ist unplausibel`); });
        mehrsprachig(`${p}.titel`, x.titel, 120, true);
        mehrsprachig(`${p}.hinweis`, x.hinweis, 160, false);
        url(`${p}.quelle`, x.quelle);
        if(x.quelle && !/^https:\/\/([a-z0-9-]+\.)*hs-esslingen\.de(\/|$)/i.test(x.quelle)) f(`${p}.quelle`, 'Fristen nur mit Quelle auf hs-esslingen.de');
      });
    }
  }

  /* Veranstaltungen */
  if(d.termine !== undefined){
    if(!Array.isArray(d.termine)) f('termine', 'muss eine Liste sein');
    else {
      if(d.termine.length > 16) f('termine', 'höchstens 16 Einträge');
      d.termine.forEach((x, i) => {
        const p = `termine[${i}]`;
        if(!x || typeof x !== 'object'){ f(p, 'muss ein Objekt sein'); return; }
        if(!istDatum(x.datum)) f(`${p}.datum`, 'muss JJJJ-MM-TT sein');
        else if(x.datum > grenzeNeu) f(`${p}.datum`, 'liegt zu weit in der Zukunft');
        if(x.zeit !== undefined && x.zeit !== null && x.zeit !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(x.zeit)) f(`${p}.zeit`, 'muss HH:MM sein');
        if(x.campus !== undefined && x.campus !== null && !CAMPUS.includes(x.campus)) f(`${p}.campus`, 'muss SM, FL, GP oder null sein');
        mehrsprachig(`${p}.titel`, x.titel, 120, true);
        mehrsprachig(`${p}.ort`, x.ort, 160, false);
        url(`${p}.url`, x.url);
      });
    }
  }

  /* Zwischenspeicher */
  if(d.uebersetzungen !== undefined){
    if(!d.uebersetzungen || typeof d.uebersetzungen !== 'object' || Array.isArray(d.uebersetzungen)) f('uebersetzungen', 'muss ein Objekt sein');
    else {
      const e = Object.entries(d.uebersetzungen);
      if(e.length > 2000) f('uebersetzungen', 'höchstens 2000 Einträge');
      e.forEach(([de, u]) => {
        const p = `uebersetzungen["${de.slice(0, 40)}"]`;
        if(!u || typeof u !== 'object' || Array.isArray(u)){ f(p, 'muss ein Objekt {"en": …, "es": …} sein'); return; }
        Object.keys(u).forEach(k => { if(!SPRACHEN.includes(k) || k === 'de') f(p, `unbekannte Sprache "${k}"`); else text(`${p}.${k}`, u[k], 160, false); });
      });
    }
  }
  if(d.typen !== undefined){
    if(!d.typen || typeof d.typen !== 'object' || Array.isArray(d.typen)) f('typen', 'muss ein Objekt sein');
    else Object.entries(d.typen).forEach(([k, v]) => { if(!TYPEN.includes(v)) f(`typen["${k.slice(0, 40)}"]`, `muss ${TYPEN.join(', ')} sein`); });
  }
  if(d.fehlende_uebersetzungen !== undefined && (!Array.isArray(d.fehlende_uebersetzungen) || d.fehlende_uebersetzungen.some(x => typeof x !== 'string'))) f('fehlende_uebersetzungen', 'muss eine Liste von Texten sein');

  if(fehler.length){
    console.error(`${DATEI} hat ${fehler.length}${fehler.length >= 60 ? '+' : ''} Fehler:`);
    fehler.forEach(x => console.error('  - ' + x));
    process.exit(1);
  }
  const n = Object.values(d.mensa || {}).reduce((s, m) => s + (m.tage || []).reduce((a, t) => a + t.gerichte.length, 0), 0);
  console.log(`OK · ${n} Gerichte, ${(d.fristen || []).length} Fristen, ${(d.termine || []).length} Veranstaltungen, ${(d.fehlende_uebersetzungen || []).length} Texte ohne Übersetzung`);
}
main();
