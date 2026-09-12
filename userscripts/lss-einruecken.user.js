// ==UserScript==
// @name         LSS Einrücken — alles zurück zur Wache
// @namespace    https://leitstellenspiel.de/
// @version      0.3.0
// @description  Ruft Fahrzeuge über den Einsatz zurück: alle Einsätze auf einmal oder nur die, an denen zu lange etwas steht
// @match        https://www.leitstellenspiel.de/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/hochhause/LSS-Scripts
// @supportURL   https://github.com/hochhause/LSS-Scripts/issues
// @downloadURL  https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-einruecken.user.js
// @updateURL    https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-einruecken.user.js
// ==/UserScript==

(function () {
'use strict';
const VERSION = '0.3.0';   // im Fensterkopf sichtbar, damit der Stand erkennbar ist

// Gebäude- und Einsatzseiten öffnet das Spiel in einer Lightbox, also in einem
// Iframe. Dort darf das Fenster nicht ein zweites Mal erscheinen.
if (window.top !== window.self) return;

/* ═══════════════════════════════════════════════════════════════════
   Der Weg zurück führt über den Einsatz, nicht über das Fahrzeug

   Das Spiel bietet auf jeder Einsatzseite den Verweis „Alle eigenen
   Fahrzeuge rückalarmieren". Ein Aufruf holt alles zurück, was dort steht —
   ein Abruf statt einem je Fahrzeug, und der Weg, den das Spiel selbst
   vorsieht.

   Daß dabei der ganze Einsatz zurückkommt, ist kein Nebenwirkung, sondern der
   Zweck des Verweises. Alarmiert wird ohnehin schubweise: steht eines der
   Fahrzeuge lange, stehen die anderen genauso lange. Die Zeile nennt trotzdem
   die Zahl der Fahrzeuge, damit vorher zu sehen ist, was zurückkommt.

   Fahrzeuge ohne Einsatz — auf Rückfahrt, im Krankenhaus, Sprechwunsch —
   sind auf diesem Weg **nicht** zu erreichen. Sie werden gezählt und mit
   Grund gemeldet, nicht stillschweigend übergangen.
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   Grundlagen: Rate-Limit, Abrufe, Speicher
   Fester Mindestabstand wie im Planer — 150 ms lesen, 350 ms schreiben.
   ═══════════════════════════════════════════════════════════════════ */
const READ_DELAY = 150, WRITE_DELAY = 350;
const KEY_WATCH = 'lssrecall.watch';   // seit wann steht welches Fahrzeug an welchem Einsatz
const KEY_OPTS  = 'lssrecall.opts';
const KEY_UI    = 'lssrecall.ui';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let chain = Promise.resolve();
/** Serialisiert alle Anfragen und hält den Mindestabstand ein. */
function queued(fn, delay) {
  // Nach einem Fehlschlag muss die Kette weiterlaufen, sonst erbt jeder
  // folgende Aufruf die alte Ablehnung und wird nie ausgeführt.
  const task = chain.catch(() => {}).then(async () => {
    try { return await fn(); } finally { await sleep(delay); }
  });
  chain = task.catch(() => {});
  return task;
}

const apiGet = path => queued(async () => {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}, READ_DELAY);

const getText = path => queued(async () => {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.text();
}, READ_DELAY);

/* Der Rückalarm ist ein reiner GET-Verweis ohne `data-method` — Rails-UJS
   baut daraus nichts um, ein Aufruf genügt. Er zählt trotzdem als Tat und
   bekommt deshalb den Schreibabstand. */
const getAction = path => queued(async () => {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.text();
}, WRITE_DELAY);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};

/* FMS-Bedeutung, soweit für uns relevant.
   2 = frei auf Wache, 6 = nicht einsatzbereit. Alles andere ist unterwegs. */
const AUF_WACHE = new Set([2, 6]);
const AM_EINSATZ = new Set([3, 4, 7, 8]);
const fmsText = f => ({ 1: 'frei Funk', 2: 'auf Wache', 3: 'Anfahrt', 4: 'am Einsatzort',
  5: 'Sprechwunsch', 6: 'nicht bereit', 7: 'Patient an Bord', 8: 'am Transportziel', 9: 'Sonstiges' }[f] || ('FMS ' + f));

/* ═══════════════════════════════════════════════════════════════════
   Standzeit
   Die v2-API liefert je Fahrzeug „updated_iso" — den Zeitpunkt der letzten
   Statusänderung. Daraus ergibt sich unmittelbar, wie lange es schon so
   dasteht. Nur falls das Feld fehlt, greift ein eigenes Gedächtnis.
   ═══════════════════════════════════════════════════════════════════ */
let watch = store.get(KEY_WATCH, {});
let fahrzeuge = [];

const amEinsatz = v => AM_EINSATZ.has(v.fms_real) && v.target_type === 'mission' && v.target_id;

async function ladeFahrzeuge() {
  const alle = [];
  let url = '/api/v2/vehicles?limit=10000';
  for (let seite = 0; seite < 6 && url; seite++) {
    const r = await apiGet(url);
    alle.push(...(r.result || r));
    url = r.paging?.next_page || null;
  }
  fahrzeuge = alle;
  merken();
  return alle;
}

/** Führt das Gedächtnis nach: neue Einsätze eintragen, beendete löschen. */
function merken() {
  const jetzt = Date.now();
  const gesehen = new Set();
  for (const v of fahrzeuge) {
    if (!amEinsatz(v) || v.updated_iso) continue;   // nur wo der Zeitstempel fehlt
    gesehen.add(String(v.id));
    const e = watch[v.id];
    if (!e || e.m !== v.target_id) watch[v.id] = { m: v.target_id, seit: jetzt };
  }
  for (const id of Object.keys(watch)) if (!gesehen.has(id)) delete watch[id];
  store.set(KEY_WATCH, watch);
}

/** Wie lange steht das Fahrzeug schon in diesem Status. */
const dauer = v => {
  if (v.updated_iso) {
    const t = Date.parse(v.updated_iso);
    if (Number.isFinite(t)) return Math.max(0, Date.now() - t);
  }
  const e = watch[v.id];
  return e ? Date.now() - e.seit : null;
};
const dauerText = ms => {
  if (ms == null) return 'unbekannt';
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};

/* ═══════════════════════════════════════════════════════════════════
   Auswahl — gezählt wird in Einsätzen
   ═══════════════════════════════════════════════════════════════════ */
const nichtDaheim = () => fahrzeuge.filter(v => !AUF_WACHE.has(v.fms_real));
/* Unterwegs, aber keinem Einsatz zugeordnet: Rückfahrt, Krankenhaus,
   Sprechwunsch. Über den Einsatz nicht erreichbar — deshalb eigens gezählt. */
const ohneEinsatz = () => nichtDaheim().filter(v => !amEinsatz(v));

/** Alle Einsätze mit eigenen Fahrzeugen, längste Standzeit zuerst. */
function einsaetze() {
  const karte = new Map();
  for (const v of fahrzeuge) {
    if (!amEinsatz(v)) continue;
    const id = String(v.target_id);
    if (!karte.has(id)) karte.set(id, { id, fahrzeuge: [] });
    karte.get(id).fahrzeuge.push(v);
  }
  for (const e of karte.values()) {
    const d = e.fahrzeuge.map(dauer).filter(x => x != null);
    e.laengste = d.length ? Math.max(...d) : null;
  }
  return [...karte.values()].sort((a, b) => (b.laengste ?? -1) - (a.laengste ?? -1));
}

/* Ein Einsatz gilt als festhängend, sobald **ein** Fahrzeug die Schwelle
   reißt — nicht erst, wenn alle sie reißen. Sonst hielte ein einzelnes
   nachalarmiertes Fahrzeug den ganzen Einsatz für immer unter der Schwelle. */
function festhaengend(minutenSchwelle) {
  const grenze = minutenSchwelle * 60000;
  return einsaetze().filter(e => e.laengste != null && e.laengste >= grenze);
}

/** Liest den Rückalarm-Verweis von der Einsatzseite.
    Gebaut wird die Adresse ausdrücklich **nicht**: der Verweis trägt
    Parameter (`?ifp=ne&ift=kt_al&sd=a&sk=cr`), deren Bedeutung nicht
    nachgemessen ist. Ob sie die Auswahl beeinflussen, weiß niemand — also
    wird genommen, was dasteht, statt eine Adresse zu erfinden. Fehlt der
    Verweis, wird der Einsatz gemeldet und übersprungen. */
async function rueckalarmVerweis(missionId) {
  const html = await getText(`/missions/${missionId}`);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('a[href*="backalarmAll"]')?.getAttribute('href') || null;
}

/* ═══════════════════════════════════════════════════════════════════
   Oberfläche
   ═══════════════════════════════════════════════════════════════════ */
const css = `
#lssr-btn{position:fixed;right:16px;bottom:74px;z-index:99996;background:#5b7fa6;color:#fff;
 border:0;border-radius:3px;padding:9px 15px;font:600 14px/1 sans-serif;cursor:pointer;letter-spacing:.05em}
#lssr{position:fixed;right:16px;bottom:118px;width:470px;max-height:74vh;z-index:99997;display:none;
 background:#1b232c;color:#e6ebf0;border:1px solid #2e3a47;border-radius:4px;
 font:13px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);flex-direction:column}
#lssr.on{display:flex}
#lssr.full{left:0!important;top:0!important;right:0!important;bottom:0!important;width:auto!important;max-height:none;border-radius:0}
#lssr header{padding:10px 14px;border-bottom:1px solid #2e3a47;display:flex;align-items:center;gap:10px;cursor:grab;touch-action:none}
#lssr.full header{cursor:default}
#lssr header .ico{background:none;border:0;color:#8b9aa9;font:600 15px/1 sans-serif;cursor:pointer;padding:3px 7px;border-radius:3px}
#lssr header .ico:hover{background:#232d38;color:#e6ebf0}
#lssr .body{padding:12px 14px;overflow-y:auto;flex:1}
#lssr .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
#lssr button.act{background:#232d38;color:#e6ebf0;border:1px solid #2e3a47;border-radius:3px;
 padding:6px 12px;cursor:pointer;font:600 12px sans-serif}
#lssr button.act:hover{border-color:#6f8fb5}
#lssr button.go{background:#5b7fa6;border-color:#5b7fa6;color:#fff}
#lssr button.danger{border-color:#d8674f;color:#d8674f}
#lssr select{background:#141a21;color:#e6ebf0;border:1px solid #2e3a47;border-radius:3px;padding:5px 8px;font:12px monospace}
#lssr .list{border:1px solid #2e3a47;border-radius:3px;max-height:240px;overflow-y:auto;margin-bottom:10px}
#lssr .list div.z{display:flex;gap:2px 8px;flex-wrap:wrap;padding:5px 9px;border-bottom:1px solid rgba(46,58,71,.5)}
#lssr .list div.z:last-child{border-bottom:0}
#lssr .list .r{margin-left:auto;font:11px monospace;color:#8b9aa9}
#lssr .list .sub{flex-basis:100%;color:#5d6c7b;font-size:11px}
#lssr pre{background:#0e1319;border:1px solid #2e3a47;border-radius:3px;padding:9px;margin:10px 0 0;
 font:11px/1.6 monospace;white-space:pre-wrap;max-height:220px;overflow-y:auto;color:#c3d0dc}
#lssr .hint{color:#8b9aa9;font-size:12px;margin:0 0 10px}
#lssr .warn{color:#e0a33c}#lssr .err{color:#d8674f}#lssr .good{color:#4fb79b}
`;

let el, busy = false, log0 = [];
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/** Zeichnet das Protokoll neu — auch nach einem `render()`, das den Kasten ersetzt hat. */
function logZeichnen() {
  const pre = el?.querySelector('#lssr-log');
  if (!pre) return;
  pre.innerHTML = log0.slice(-300).map(l => `<span class="${l.k}">${esc(l.t)}</span>`).join('\n');
  pre.scrollTop = pre.scrollHeight;
}
function log(t, k = '') { log0.push({ t, k }); logZeichnen(); }

const opts = store.get(KEY_OPTS, { minuten: 60, dry: true });

function render() {
  if (!el) return;
  const b = el.querySelector('.body');
  const stufen = [];
  for (let m = 30; m <= 480; m += 30) stufen.push(m);

  const alle = einsaetze();
  const fest = festhaengend(opts.minuten);
  const gebunden = fahrzeuge.filter(amEinsatz).length;
  const frei = ohneEinsatz();
  const freiStatus = [...new Set(frei.map(v => fmsText(v.fms_real)))].join(', ');
  const ohneZeit = fahrzeuge.filter(v => amEinsatz(v) && dauer(v) == null).length;

  b.innerHTML = `
    <p class="hint">Ruft Fahrzeuge <b>über den Einsatz</b> zurück — mit dem Verweis „Alle eigenen
      Fahrzeuge rückalarmieren", den das Spiel auf jeder Einsatzseite anbietet.
      <b>Nichts wird abgeschickt</b>, solange „Nur Vorschau" angehakt ist — die Vorschau öffnet nur
      die Einsatzseiten und sieht nach, ob der Verweis dort steht.</p>

    <div class="row">
      <button class="act" id="lssr-refresh">Bestand aktualisieren</button>
      <span style="color:#5d6c7b;font-size:12px">${fahrzeuge.length} Fahrzeuge ·
        ${nichtDaheim().length} nicht auf Wache · ${gebunden} an ${alle.length} Einsätzen</span>
    </div>

    <div class="row" style="border-top:1px solid #2e3a47;padding-top:10px">
      <button class="act danger" id="lssr-all">Alle Einsätze einrücken (${alle.length})</button>
      <span class="hint" style="margin:0;flex:1">Holt ${gebunden} Fahrzeuge von ${alle.length} Einsätzen zurück.</span>
    </div>

    <div class="row">
      <label style="color:#8b9aa9">Steht länger als</label>
      <select id="lssr-min">${stufen.map(m => `<option value="${m}" ${m === opts.minuten ? 'selected' : ''}>
        ${dauerText(m * 60000)}</option>`).join('')}</select>
      <button class="act go" id="lssr-stuck">Festhängende einrücken (${fest.length})</button>
    </div>

    ${frei.length ? `<p class="hint">${frei.length} Fahrzeuge sind unterwegs, hängen aber an keinem
      Einsatz (${esc(freiStatus)}) — über den Einsatz sind sie nicht zu erreichen
      und bleiben stehen.</p>` : ''}

    ${gebunden && !alle.length ? `<p class="hint warn">Kein Fahrzeug nennt ein Einsatzziel
      (<code>target_type</code>/<code>target_id</code>) — ohne das ist kein Einsatz zuzuordnen.</p>` : ''}

    ${ohneZeit ? `<p class="hint warn">Bei ${ohneZeit} Fahrzeugen fehlt der Zeitstempel des Spiels —
      ihre Standzeit wird erst ab diesem Seitenaufruf gemessen.</p>` : ''}

    ${fest.length ? `<div class="list">${fest.slice(0, 60).map(e => `<div class="z">
        <span>Einsatz ${esc(e.id)}</span>
        <span class="r">${e.fahrzeuge.length} Fz · längste ${dauerText(e.laengste)}</span>
        <span class="sub">${esc(e.fahrzeuge.slice(0, 6).map(v => v.caption || v.id).join(', '))}${
          e.fahrzeuge.length > 6 ? ` … +${e.fahrzeuge.length - 6}` : ''}</span></div>`).join('')}
      ${fest.length > 60 ? `<div class="z"><span class="r">… und ${fest.length - 60} weitere</span></div>` : ''}
      </div>` : ''}

    <div class="row">
      <label style="color:#8b9aa9"><input type="checkbox" id="lssr-dry" ${opts.dry ? 'checked' : ''}> Nur Vorschau</label>
    </div>
    <pre id="lssr-log"></pre>`;

  b.querySelector('#lssr-min').onchange = e => { opts.minuten = Number(e.target.value); store.set(KEY_OPTS, opts); render(); };
  b.querySelector('#lssr-dry').onchange = e => { opts.dry = e.target.checked; store.set(KEY_OPTS, opts); };
  b.querySelector('#lssr-refresh').onclick = async () => {
    if (busy) return; busy = true; log0 = [];
    log('Lade Fahrzeuge…');
    try { await ladeFahrzeuge(); log(`${fahrzeuge.length} Fahrzeuge, ${einsaetze().length} Einsätze mit eigenen Fahrzeugen`, 'good'); }
    catch (e) { log('Fehler: ' + e.message, 'err'); }
    busy = false; render();
  };
  b.querySelector('#lssr-all').onclick   = () => einruecken(einsaetze(), 'Alle Einsätze einrücken');
  b.querySelector('#lssr-stuck').onclick = () => einruecken(festhaengend(opts.minuten),
    `Festhängende einrücken (über ${dauerText(opts.minuten * 60000)})`);
  logZeichnen();
}

async function einruecken(liste, titel) {
  if (busy) return;
  if (!liste.length) return log('Nichts zu tun — kein Einsatz mit eigenen Fahrzeugen in der Auswahl.', 'warn');
  const dry = opts.dry;
  const anzahl = liste.reduce((s, e) => s + e.fahrzeuge.length, 0);
  if (!dry && !confirm(`${titel}: ${liste.length} Einsätze zurückrufen?\n\n`
    + `${anzahl} eigene Fahrzeuge rücken ein. Die Einsätze laufen ohne sie weiter.`)) return;

  busy = true; log0 = [];
  log(dry ? `── Vorschau: ${titel} ──` : `── ${titel} ──`, 'good');
  let ok = 0, fehler = 0, ohneVerweis = 0;
  for (const e of liste) {
    log(`Einsatz ${e.id} — ${e.fahrzeuge.length} Fahrzeuge, längste Standzeit ${dauerText(e.laengste)}`);
    for (const v of e.fahrzeuge) log(`   ${v.caption || v.id} — ${fmsText(v.fms_real)}, ${dauerText(dauer(v))}`);
    try {
      /* Auch die Vorschau sieht auf der Einsatzseite nach: nur so ist vorher zu
         sehen, ob der Verweis überhaupt dasteht. Gelesen wird die Seite, der
         Verweis selbst wird nicht aufgerufen — er *ist* die Tat. */
      const verweis = await rueckalarmVerweis(e.id);
      if (!verweis) {
        log('   kein Rückalarm-Verweis auf der Einsatzseite — übersprungen', 'warn');
        ohneVerweis++; continue;
      }
      if (dry) { log(`   würde aufrufen: ${verweis}`); ok++; continue; }
      await getAction(verweis);
      ok++;
    } catch (err) { log(`   fehlgeschlagen: ${err.message}`, 'err'); fehler++; }
  }
  // „Nichts passiert" und „nichts zu tun" müssen unterscheidbar bleiben: die
  // Vorschau sagt deshalb, was sie gefunden hat, und daß sie nichts geschickt hat.
  const schwanz = (ohneVerweis ? `, ${ohneVerweis} ohne Verweis` : '') + (fehler ? `, ${fehler} Fehler` : '');
  log((dry ? `Vorschau: bei ${ok} von ${liste.length} Einsätzen steht der Verweis — abgeschickt wurde nichts`
           : `Fertig: ${ok} Einsätze zurückgerufen`) + schwanz,
    fehler || ohneVerweis ? 'warn' : 'good');
  busy = false;
  if (!dry) {
    /* Nach dem Rückalarm stimmt der Bestand nicht mehr. Das Spiel liefert
       `/api/v2/vehicles` mit `max-age=60` — die eben zurückgerufenen Fahrzeuge
       können also noch eine Minute lang am Einsatz stehen. Lieber sagen als
       erklären lassen, warum die Liste unverändert aussieht. */
    try {
      await ladeFahrzeuge();
      log('Bestand neu geladen — das Spiel gibt ihn bis zu eine Minute lang zwischengespeichert heraus.');
    } catch (err) { log('Bestand nicht neu geladen: ' + err.message, 'warn'); }
  }
  render();
}

/* ═══════════════════════════════════════════════════════════════════
   Aufbau
   ═══════════════════════════════════════════════════════════════════ */
function mount() {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const btn = document.createElement('button'); btn.id = 'lssr-btn'; btn.textContent = 'Einrücken';
  el = document.createElement('div'); el.id = 'lssr';
  el.innerHTML = `<header><b>Einrücken</b><span style="color:#5d6c7b;font-size:11px">v${VERSION}</span>
      <span style="flex:1"></span>
      <button class="ico" id="lssr-full" title="Vollbild">⛶</button>
      <button class="ico" id="lssr-close" title="Schließen">×</button></header>
    <div class="body"></div>`;
  document.body.append(btn, el);

  btn.onclick = async () => {
    el.classList.toggle('on');
    if (el.classList.contains('on') && !fahrzeuge.length) {
      el.querySelector('.body').innerHTML = '<p class="hint">Lade Fahrzeuge…</p>';
      try { await ladeFahrzeuge(); } catch (e) { log('Fehler: ' + e.message, 'err'); }
    }
    render();
  };
  el.querySelector('#lssr-close').onclick = () => el.classList.remove('on');

  const ui = store.get(KEY_UI, {});
  const fullBtn = el.querySelector('#lssr-full');
  const place = () => {
    // Das Zeichen des Knopfs gehört hierher, nicht in den Klick: sonst zeigt
    // ein im Vollbild gespeichertes Fenster nach dem Neuladen „⛶".
    fullBtn.textContent = ui.full ? '🗗' : '⛶';
    if (ui.full) return el.classList.add('full');
    el.classList.remove('full');
    if (typeof ui.x === 'number') Object.assign(el.style,
      { left: Math.min(ui.x, innerWidth - 120) + 'px', top: Math.min(ui.y, innerHeight - 60) + 'px', right: 'auto', bottom: 'auto' });
  };
  fullBtn.onclick = () => { ui.full = !ui.full; store.set(KEY_UI, ui); place(); };

  let drag = null;
  el.querySelector('header').addEventListener('pointerdown', ev => {
    if (ui.full || ev.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    el.setPointerCapture?.(ev.pointerId); ev.preventDefault();
  });
  addEventListener('pointermove', ev => {
    if (!drag) return;
    ui.x = Math.max(0, Math.min(ev.clientX - drag.dx, innerWidth - 120));
    ui.y = Math.max(0, Math.min(ev.clientY - drag.dy, innerHeight - 60));
    Object.assign(el.style, { left: ui.x + 'px', top: ui.y + 'px', right: 'auto', bottom: 'auto' });
  });
  addEventListener('pointerup', () => { if (drag) { drag = null; store.set(KEY_UI, ui); } });
  place();

  // Standzeiten im Hintergrund mitschreiben, damit die Schwelle Sinn ergibt.
  // Offen gebliebene Fenster zeigen sonst Zahlen von vor einer Stunde.
  setInterval(async () => {
    if (busy) return;
    try { await ladeFahrzeuge(); } catch { /* Abruf gescheitert: der alte Bestand bleibt stehen */ }
    if (el.classList.contains('on') && !busy) render();
  }, 5 * 60 * 1000);
  ladeFahrzeuge().catch(() => { /* beim Seitenaufbau still: das Fenster lädt beim Öffnen erneut */ });
}

mount();
})();
