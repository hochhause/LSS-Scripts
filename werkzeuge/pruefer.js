#!/usr/bin/env node
/* Statische Durchsicht des Userscripts.
   Sucht die Fehlerarten, die beim Lesen durchrutschen, weil sie nichts
   umwerfen: ein vergessenes Argument, ein Rest von gestern, ein Aufruf ins
   Leere. Reine Textprüfung — kein Ersatz für `test-planung.js`, sondern die
   Stufe davor.

   Aufruf:  node pruefer.js [datei]                                        */

const fs   = require('fs');
const path = require('path');

/* Ohne Argument wird der Planer im Nachbarordner geprueft. Der Pfad haengt
   am Ort dieser Datei, nicht am Arbeitsverzeichnis — sonst laeuft der
   Aufruf aus dem Wurzelverzeichnis ins Leere. */
const STANDARD = path.join(__dirname, '..', 'userscripts', 'lss-planer.user.js');
const datei = process.argv[2] || STANDARD;
const src = fs.readFileSync(datei, 'utf8');

/* Kommentare und Zeichenketten entfernen, sonst zählt jedes Beispiel im
   Kommentar als Aufruf — genau daran ist die erste Fassung gescheitert. */
const rein = src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

const zeileVon = i => src.slice(0, i).split('\n').length;
let funde = 0;
const melde = (art, zeile, text) => { funde++; console.log(`  ${art}  Zeile ${zeile}: ${text}`); };

/* ── 1. Funktionen und ihre Pflichtparameter ──────────────────────────── */
const fns = new Map();
for (const m of rein.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([\w$]+)\s*\(([^)]*)\)/g)) {
  const params = m[2].split(',').map(x => x.trim()).filter(Boolean);
  fns.set(m[1], params.filter(p => !p.includes('=') && !p.startsWith('...')).length);
}

console.log(`\n${fns.size} Funktionen, ${src.split('\n').length} Zeilen\n`);

console.log('Aufrufe mit zu wenigen Argumenten');
const argZahl = txt => {
  let t = 0, d = 0;
  for (const c of txt) {
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ',' && d === 0) t++;
  }
  return txt.trim() ? t + 1 : 0;
};
for (const [name, pflicht] of fns) {
  if (!pflicht) continue;
  for (const c of rein.matchAll(new RegExp(`(?<![.\\w])${name}\\(`, 'g'))) {
    let d = 1, i = c.index + name.length + 1;
    const start = i;
    while (i < rein.length && d > 0) {
      const ch = rein[i];
      if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch)) d--;
      i++;
    }
    const n = argZahl(rein.slice(start, i - 1));
    if (n < pflicht) melde('!', zeileVon(c.index), `${name}(…) erwartet ${pflicht}, bekommt ${n}`);
  }
}

/* ── 2. Doppelte und tote Funktionen ──────────────────────────────────── */
console.log('\nDoppelt deklariert oder nie benutzt');
const gezaehlt = {};
for (const m of rein.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([\w$]+)/g))
  gezaehlt[m[1]] = (gezaehlt[m[1]] || 0) + 1;
for (const [n, z] of Object.entries(gezaehlt))
  if (z > 1) melde('!', zeileVon(rein.indexOf(`function ${n}`)), `${n} ist ${z}× deklariert`);
for (const n of fns.keys()) {
  const treffer = [...rein.matchAll(new RegExp(`(?<![.\\w])${n}\\b`, 'g'))].length;
  if (treffer <= 1) melde('?', zeileVon(rein.indexOf(`function ${n}`)), `${n} wird nie aufgerufen`);
}

/* ── 3. Speicherstellen ohne Verwendung ───────────────────────────────── */
console.log('\nSpeicherschlüssel');
for (const m of rein.matchAll(/const (KEY_\w+)\s*=/g)) {
  const treffer = [...rein.matchAll(new RegExp(`\\b${m[1]}\\b`, 'g'))].length;
  if (treffer <= 1) melde('?', zeileVon(m.index), `${m[1]} wird nirgends gelesen`);
}

/* ── 4. Fallen, die still danebengehen ────────────────────────────────── */
console.log('\nStille Fallen');
for (const m of rein.matchAll(/const (\w+)\s*=\s*(?:new RegExp\([^;]*['"][a-z]*g[a-z]*['"]\s*\)|\/(?:[^\/\\\n]|\\.)+\/[a-z]*g[a-z]*)/g)) {
  const n = m[1];
  const testStellen = [...rein.matchAll(new RegExp(`${n}\\.test\\(`, 'g'))];
  for (const t of testStellen) {
    const vorher = rein.slice(Math.max(0, t.index - 120), t.index);
    if (!vorher.includes(`${n}.lastIndex`))
      melde('!', zeileVon(t.index), `${n} ist global und wird mit .test() benutzt — lastIndex wandert`);
  }
}
/* Ein catch mit erklärendem Kommentar ist eine Entscheidung, ein leeres ist
   ein Versehen. Da die Kommentare oben zu Leerzeichen wurden, wird im
   Urtext nachgesehen. */
for (const m of rein.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
  const echt = src.slice(m.index, m.index + 200);
  if (!/catch\s*(?:\([^)]*\))?\s*\{\s*\/[/*]/.test(echt))
    melde('?', zeileVon(m.index), 'leerer catch-Block verschluckt den Fehler');
}
for (const m of rein.matchAll(/(?<![.\w])(TODO|FIXME|XXX)/g))
  melde('?', zeileVon(m.index), `offene Marke ${m[1]}`);

/* ── 5. Fassung ───────────────────────────────────────────────────────── */
console.log('\nFassung');
const kopf = (src.match(/@version\s+([\d.]+)/) || [])[1];
const konst = (src.match(/const VERSION = '([\d.]+)'/) || [])[1];
if (kopf !== konst) melde('!', 1, `@version ${kopf} ≠ const VERSION ${konst}`);
else console.log(`  ok  ${kopf} an beiden Stellen`);

console.log(funde ? `\n${funde} Fundstellen\n` : '\nnichts zu beanstanden\n');
process.exit(0);
