// ==UserScript==
// @name         LSS Planer — Soll/Ist Umsetzung
// @namespace    https://leitstellenspiel.de/
// @version      0.50.0
// @description  Setzt den exportierten Soll-Plan um: Ausbauten, Fahrzeuge, Anhänger, Personal, Lehrgänge
// @match        https://www.leitstellenspiel.de/*
// @match        https://polizei.leitstellenspiel.de/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/hochhause/LSS-Scripts
// @supportURL   https://github.com/hochhause/LSS-Scripts/issues
// @downloadURL  https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-planer.user.js
// @updateURL    https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-planer.user.js
// ==/UserScript==

(function () {
'use strict';
const VERSION = '0.50.0';   // im Fensterkopf sichtbar, damit der Stand erkennbar ist
// Gebäudeseiten öffnet das Spiel in einer Lightbox, also in einem Iframe.
// Das schwebende Panel darf dort nicht nochmal erscheinen, das Modul für die
// Lehrgangsseite muss aber gerade dort laufen.
const inFrame = window.top !== window.self;

/* ═══════════════════════════════════════════════════════════════════
   Grundlagen: Rate-Limit, Requests, Speicher
   Fair-Use laut Forum: nächste Anfrage erst wenn die vorherige durch
   ist, mindestens 100 ms. Schreibende Aktionen bekommen mehr Abstand.
   ═══════════════════════════════════════════════════════════════════ */
const READ_DELAY  = 150;
const WRITE_DELAY = 350;
const KEY_PLAN    = 'lssplaner.plan';
const KEY_OPTS    = 'lssplaner.opts';
const KEY_COURSE  = 'lssplaner.courseMap';   // interner Schlüssel → Klartext
const KEY_DATA    = 'lssplaner.data';        // zwischengespeicherter Bestand
const KEY_QUAL    = 'lssplaner.quals';       // Ausgebildete je Wache und Kurs
const KEY_UI      = 'lssplaner.ui';          // Fensterposition und Vollbild
const KEY_INAUS   = 'lssplaner.inAusbildung'; // laufende Ausbildungen je Wache und Kurs
const KEY_EDUPFAD = 'lssplaner.eduPfadIdx';  // welcher Pfad zur Kursauswahl führt
const KEY_MODELL  = 'lssplaner.modell';      // Wunschbild je Gebäudetyp
const KEY_ZUORD   = 'lssplaner.zuordnung';   // Wache → Profil
const KEY_KAUFBAR = 'lssplaner.kaufbar';     // Gebäudetyp → kaufbare Fahrzeugtypen
const KEY_SCHULE  = 'lssplaner.schulkurse';  // Schultyp → angebotene Lehrgänge
const KEY_EXTCAT  = 'lssplaner.ausbaukatalog'; // Gebäudetyp → Bauplatz-Nummer → Name

const sleep = ms => new Promise(r => setTimeout(r, ms));
let chain = Promise.resolve();

/* Lange Läufe müssen abbrechbar sein: Panel zu, Tab gewechselt, Fehlerserie.
   Ohne das lief eine angefangene Kette über hunderte Wachen weiter. */
let lauf = null;
const laufStarten = () => { lauf?.abort(); lauf = new AbortController(); return lauf.signal; };
/* Der Regler bleibt stehen, auch nachdem abgebrochen wurde. Wer ihn hier auf
   null setzt, löscht die einzige Spur des Abbruchs: `abgebrochen()` meldete
   danach für immer „läuft weiter", und `queued` gab jeder folgenden Anfrage
   gar kein Signal mehr mit. Der Stoppknopf brach dann genau eine Anfrage ab
   und der Lauf schrieb den Rest der Wachen durch. Ersetzt wird der Regler in
   `laufStarten`, nicht hier. */
const laufStoppen = () => { lauf?.abort(); S.busy = false; };
const abgebrochen = () => !!lauf?.signal.aborted;

/* Kurzes Wegklicken soll nichts anhalten. Erst wenn der Tab länger als eine
   Minute im Hintergrund liegt, ruht die Warteschlange, bis er zurückkommt. */
const NACHSICHT = 60000;
let seitWann = document.hidden ? Date.now() : 0;
addEventListener('visibilitychange', () => { seitWann = document.hidden ? Date.now() : 0; });

async function wachAbwarten() {
  while (document.hidden && seitWann && Date.now() - seitWann >= NACHSICHT) {
    await new Promise(r => addEventListener('visibilitychange', r, { once: true }));
  }
}
/** Serialisiert alle Requests und hält den Mindestabstand ein. */
function queued(fn, delay) {
  // Nach einem Fehlschlag muss die Kette weiterlaufen, sonst erbt jeder
  // folgende Aufruf die alte Ablehnung und wird nie ausgeführt.
  const sig = lauf?.signal;
  const task = chain.catch(() => {}).then(async () => {
    if (sig?.aborted) throw new DOMException('abgebrochen', 'AbortError');
    await wachAbwarten();
    if (sig?.aborted) throw new DOMException('abgebrochen', 'AbortError');
    try { return await fn(sig); }
    finally { if (!sig?.aborted) await sleep(delay); }
  });
  chain = task.catch(() => {});
  return task;
}
const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

const cache = new Map();
async function apiGet(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const data = await queued(async sig => {
    const r = await fetch(path, { credentials: 'same-origin', signal: sig });
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return r.json();
  }, READ_DELAY);
  cache.set(path, data);
  return data;
}
const getText = path => queued(async sig => {
  const r = await fetch(path, { credentials: 'same-origin', signal: sig });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.text();
}, READ_DELAY);

function postForm(path, fields = {}) {
  return queued(async sig => {
    const body = new URLSearchParams({ authenticity_token: csrf(), ...fields });
    const r = await fetch(path, {
      method: 'POST', credentials: 'same-origin', body, signal: sig,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return r.text();
  }, WRITE_DELAY);
}
// Kauf-Links sind reine GET-Links ohne data-method
const getAction = path => queued(async sig => {
  const r = await fetch(path, { credentials: 'same-origin', signal: sig });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.text();
}, WRITE_DELAY);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};

/* ═══════════════════════════════════════════════════════════════════
   Bestätigungen
   Das eingebaute confirm() kann kein „nicht mehr fragen“ — es hat keinen
   Platz für ein Ankreuzfeld. Deshalb ein eigener, kleiner Dialog: dieselbe
   Ja/Nein-Antwort, aber mit Gedächtnis je Frage. Abgeschaltet wird nur
   die einzelne Frage, nie alle auf einmal.
   ═══════════════════════════════════════════════════════════════════ */
const KEY_STILL = 'lssplaner.stilleFragen';
const stille = new Set(store.get(KEY_STILL, []));
const stilleLeeren = () => { stille.clear(); store.set(KEY_STILL, []); };

/* `merk` ist wahlfrei: ohne Merkzeichen gibt es kein „nicht mehr fragen“.
   Ausgeschrieben, damit ein Aufruf mit einem Argument nicht wie ein
   vergessenes zweites aussieht — genau diese Verwechslung war D-58. */
function frage(text, merk = '') {
  if (merk && stille.has(merk)) return Promise.resolve(true);
  return new Promise(fertig => {
    const knopf = 'padding:6px 14px;border-radius:3px;border:1px solid var(--lp-rand, #2e3a47);'
      + 'font:600 13px/1 system-ui,sans-serif;cursor:pointer';
    const huelle = document.createElement('div');
    huelle.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);'
      + 'display:flex;align-items:center;justify-content:center;font:13px/1.5 system-ui,sans-serif';
    const kasten = document.createElement('div');
    kasten.style.cssText = 'background:var(--lp-feld, #141a21);color:#dbe4ec;border:1px solid var(--lp-rand, #2e3a47);'
      + 'border-radius:5px;padding:16px 18px;max-width:520px;max-height:70vh;overflow:auto;'
      + 'box-shadow:0 8px 30px rgba(0,0,0,.5)';
    kasten.innerHTML = `<div id="lssp-frage-text" style="white-space:pre-wrap;margin-bottom:12px"></div>
      ${merk ? `<label style="display:block;margin-bottom:12px;color:var(--lp-dim, #8b9aa9)">
        <input type="checkbox" id="lssp-still"> Diese Frage nicht mehr anzeigen</label>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="lssp-nein" style="${knopf};background:#1b2530;color:#dbe4ec">Abbrechen</button>
        <button id="lssp-ja" style="${knopf};background:#2f6f4f;color:#fff;border-color:#2f6f4f">Fortfahren</button>
      </div>`;
    // Der Text kommt als Text hinein, nicht als HTML — er trägt Wachennamen
    kasten.querySelector('#lssp-frage-text').textContent = text;
    huelle.appendChild(kasten);
    // Dorthin, wo das Panel gerade lebt — sonst erscheint die Frage im
    // Spielfenster, während der Mensch auf das gelöste Fenster schaut.
    (el?.ownerDocument || document).body.appendChild(huelle);
    kasten.querySelector('#lssp-ja').focus();

    const schliessen = antwort => {
      if (antwort && merk && kasten.querySelector('#lssp-still')?.checked) {
        stille.add(merk);
        store.set(KEY_STILL, [...stille]);
      }
      fenster.removeEventListener('keydown', taste);
      huelle.remove();
      fertig(antwort);
    };
    const taste = e => {
      if (e.key === 'Escape') schliessen(false);
      if (e.key === 'Enter') schliessen(true);
    };
    const fenster = (el?.ownerDocument || document).defaultView;
    fenster.addEventListener('keydown', taste);
    huelle.onclick = e => { if (e.target === huelle) schliessen(false); };
    kasten.querySelector('#lssp-ja').onclick = () => schliessen(true);
    kasten.querySelector('#lssp-nein').onclick = () => schliessen(false);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Das Wunschbild
   Der importierte Plan trägt zweierlei: Spieldaten, die für jeden gleich
   sind (Stellplatz-Töpfe, Ausbaukatalog, Namen), und das Wunschbild — welche
   Wache wie aussehen soll. Nur das zweite ist eine Meinung, und nur das
   zweite gehört bearbeitet. Es steht deshalb hier, getrennt vom Plan, und
   überlebt jeden Neuimport.

   Aufbau je Gebäudetyp: `profiles` mit Fahrzeugen (Typ → Anzahl), Ausbauten
   (Name → Anzahl) und wahlweise `pools` (Typ → Stellplatz-Topf). Welche Wache
   welches Profil bekommt, steht in der Zuordnung — die hängt an
   Gebäudenummern und ist deshalb bei jedem Spieler eine andere.
   ═══════════════════════════════════════════════════════════════════ */
/* Gebäudearten, an denen es nichts zu planen gibt: Feuerwehr-, Rettungs- und
   Polizeischule, Krankenhaus, Leitstelle. Sie haben keine Fahrzeuge im Sinne
   des Planers. Aus dem Bestand fliegen sie nicht — die Schulen werden zum
   Lesen der Lehrgangsnamen gebraucht. */
const NICHT_PLANEN = new Set([1, 3, 4, 7, 8]);

/* Die Namen der Gebäudearten kamen bisher aus dem importierten Plan. Sie sind
   Spieldaten und für jeden gleich — also gehören sie hierher, damit der Planer
   auch ohne Plan lesbar bleibt. Ein importierter Plan darf sie überschreiben,
   falls das Spiel etwas umbenennt. */
const GEBAEUDE_NAMEN = {
  0: 'Feuerwache', 1: 'Feuerwehrschule', 2: 'Rettungswache', 3: 'Rettungsschule',
  4: 'Krankenhaus', 5: 'Rettungshubschrauber-Station', 6: 'Polizeiwache',
  7: 'Leitstelle', 8: 'Polizeischule', 9: 'THW', 10: 'THW-Bundesschule',
  11: 'Bereitschaftspolizei', 12: 'Schnelleinsatzgruppe (SEG)',
  13: 'Polizeihubschrauberstation', 15: 'Wasserrettung', 17: 'Polizei-Sondereinheiten',
  18: 'Schnelleinsatzgruppe (SEG) Bergwacht', 20: 'Bergrettungswache',
  21: 'Rettungshundestaffel', 24: 'Wasserrettung (Seenot)', 25: 'Bergrettungswache',
  26: 'Seenotrettungswache', 27: 'Seenotrettungs-Hubschrauber',
  28: 'Seenotrettungs-Hubschrauber', 29: 'Autobahnpolizei'
};

/* Stellplätze je Gebäudeart: wie viele Plätze welcher Sorte eine Wache hat.
   `from: 'level'` heißt Stufe + 1, `from: 'fixed'` eine feste Grundzahl, ein
   Ausbauname heißt: so viele Plätze je gebautem Ausbau. `bonus` schlägt
   Ausbauten obendrauf. Damit rechnet sich die Zahl bei jedem Spieler aus
   seinem eigenen Ausbaustand aus, statt eine fremde Wache abzubilden.
   Gebäudearten ohne Eintrag fallen auf „Stufe + 1“ zurück. */
const LAYOUTS_STANDARD = {
  "0": {"pools":[{"key":"normal","label":"Normal","from":"level","bonus":{"Großwache":10}},{"key":"ab","label":"Abrollbehälter","from":"Abrollbehälter-Stellplatz","per":1},{"key":"anh","label":"Anhänger","from":"Anhänger-Stellplatz","per":1},{"key":"drohne","label":"Drohne","from":"Drohneneinheit","per":1},{"key":"vpfl","label":"Verpflegung","from":"Verpflegungsdienst","per":2},{"key":"bahn","label":"Bahnrettung","from":"Bahnrettung","per":1},{"key":"tier","label":"Tierrettung","from":"Tierrettung","per":1},{"key":"nea200","label":"NEA200","from":"Netzersatzanlage 200","per":2}]},
  "2": {"pools":[{"key":"normal","label":"Stellplätze","from":"level","bonus":{"Großwache":10}}]},
  "6": {"pools":[{"key":"normal","label":"Normal","from":"level","bonus":{"Großwache":10}},{"key":"hund","label":"Diensthunde","from":"Diensthundestaffel","per":1},{"key":"dgl","label":"DGL","from":"Dienstgruppenleitung","per":1},{"key":"motorrad","label":"Motorrad","from":"Motorradstaffel","per":2},{"key":"ap","label":"Autobahn","from":"Autobahnpolizei","per":2},{"key":"gefkw","label":"Gewahrsam","from":"Großgewahrsam","per":1}]},
  "9": {"pools":[{"key":"gesamt","label":"Stellplätze","from":"fixed","base":1,"bonus":{"1. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung":2,"1. Technischer Zug: Zugtrupp":1,"2. Technischer Zug - Bergungsgruppe":1,"2. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung":2,"2. Technischer Zug: Zugtrupp":1,"Fachgruppe Räumen":4,"Fachgruppe Wassergefahren":5,"Fachgruppe Ortung":4,"Fachgruppe Wasserschaden/Pumpen":4,"Fachgruppe Schwere Bergung":1,"Fachgruppe Elektroversorgung":2,"Ortsverbands-Mannschaftstransportwagen":2,"Trupp Unbemannte Luftfahrtsysteme":1,"Fachzug Führung und Kommunikation":5,"Fachgruppe Logistik-Verpflegung":3,"Fachgruppe Brückenbau":3}}]},
  "11": {"pools":[{"key":"gesamt","label":"Stellplätze","from":"fixed","base":4,"bonus":{"2. Zug der 1. Hundertschaft":4,"3. Zug der 1. Hundertschaft":5,"Sonderfahrzeug: Gefangenenkraftwagen":1,"Technischer Zug: Wasserwerfer":4,"SEK: 1. Zug":5,"SEK: 2. Zug":5,"MEK: 1. Zug":5,"MEK: 2. Zug":5,"Diensthundestaffel":3,"Reiterstaffel":6,"Sonderfahrzeug: Lautsprecherkraftwagen":1}}]},
  "12": {"pools":[{"key":"gesamt","label":"Stellplätze","from":"fixed","base":1,"bonus":{"Führung":1,"Sanitätsdienst":4,"Wasserrettung":3,"Rettungshundestaffel":2,"SEG Drohne":1,"Betreuungs- und Verpflegungsdienst":10,"Technik und Sicherheit":6}}]},
  "15": {"pools":[{"key":"normal","label":"Stellplätze","from":"level"}]},
  "17": {"pools":[{"key":"gesamt","label":"Stellplätze","from":"fixed","base":0,"bonus":{"SEK: 1. Zug":5,"SEK: 2. Zug":5,"MEK: 1. Zug":5,"MEK: 2. Zug":5,"Diensthundestaffel":3}}]},
  "21": {"pools":[{"key":"normal","label":"Stellplätze","from":"level"}]},
  "25": {"pools":[{"key":"normal","label":"Normal","from":"level"},{"key":"hoehe","label":"Höhenrettung","from":"Höhenrettung","per":2},{"key":"hunde","label":"Hundestaffel","from":"Rettungshundestaffel","per":2}]},
  "26": {"pools":[{"key":"normal","label":"Stellplätze","from":"level"}]},
  "28": {"pools":[{"key":"normal","label":"Landeplatz","from":"fixed","base":1}]},
  "29": {"pools":[{"key":"normal","label":"Stellplätze","from":"level"}]}
};

const MODELL_STANDARD = {
  "0": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"30":6,"2":2,"105":3,"46":2,"34":1,"18":1,"36":1,"12":1,"27":1,"53":1,"57":1,"47":1,"48":1,"49":1,"62":1,"117":1,"119":1,"108":1,"116":1,"169":1,"170":1,"142":1,"164":1,"78":1,"77":1,"111":1,"115":1,"143":1,"168":1,"186":1,"129":1,"139":1,"138":1,"163":1,"185":1},"pools":{"30":"normal","2":"normal","105":"normal","46":"normal","34":"normal","18":"normal","36":"normal","12":"normal","27":"normal","53":"normal","57":"normal","47":"ab","48":"ab","49":"ab","62":"ab","117":"ab","119":"ab","108":"ab","116":"ab","169":"ab","170":"ab","142":"ab","164":"ab","78":"ab","77":"ab","111":"anh","115":"anh","143":"anh","168":"anh","186":"anh","129":"drohne","139":"vpfl","138":"vpfl","163":"bahn","185":"tier"},"extensions":{"Abrollbehälter-Stellplatz":14,"Anhänger-Stellplatz":5,"Netzersatzanlage 50":1,"Großlüfter":1,"Drohneneinheit":1,"Verpflegungsdienst":1,"Bahnrettung":1,"Tierrettung":1}},"standard-groß":{"vehicles":{"30":6,"105":4,"46":3,"2":2,"75":2,"34":1,"18":1,"36":1,"12":1,"27":1,"53":1,"57":1,"33":1,"76":1,"83":1,"84":1,"85":1,"86":1,"47":1,"48":1,"49":1,"62":1,"117":1,"119":1,"108":1,"116":1,"169":1,"170":1,"142":1,"164":1,"78":1,"77":1,"113":1,"180":1,"111":1,"115":1,"143":1,"168":1,"186":1,"129":1,"139":1,"138":1,"163":1,"185":1},"pools":{"30":"normal","105":"normal","46":"normal","2":"normal","75":"normal","34":"normal","18":"normal","36":"normal","12":"normal","27":"normal","53":"normal","57":"normal","33":"normal","76":"normal","83":"normal","84":"normal","85":"normal","86":"normal","47":"ab","48":"ab","49":"ab","62":"ab","117":"ab","119":"ab","108":"ab","116":"ab","169":"ab","170":"ab","142":"ab","164":"ab","78":"ab","77":"ab","113":"nea200","180":"nea200","111":"anh","115":"anh","143":"anh","168":"anh","186":"anh","129":"drohne","139":"vpfl","138":"vpfl","163":"bahn","185":"tier"},"extensions":{"Abrollbehälter-Stellplatz":14,"Anhänger-Stellplatz":5,"Netzersatzanlage 50":1,"Großlüfter":1,"Drohneneinheit":1,"Verpflegungsdienst":1,"Bahnrettung":1,"Tierrettung":1,"Großwache":1,"Flughafenfeuerwehr":1,"Netzersatzanlage 200":1,"Werkfeuerwehr":1}}}},
  "2": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"28":7,"38":2,"29":3,"74":1,"55":1,"56":1},"pools":{"28":"normal","38":"normal","29":"normal","74":"normal","55":"normal","56":"normal"},"extensions":{}},"standard-groß":{"vehicles":{"28":10,"38":4,"29":6,"74":1,"73":1,"97":1,"55":1,"56":1},"pools":{"28":"normal","38":"normal","29":"normal","74":"normal","73":"normal","97":"normal","55":"normal","56":"normal"},"extensions":{"Großwache":1}}}},
  "5": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"31":1,"157":1},"pools":{"31":"normal","157":"normal"},"extensions":{"Windenrettung":1}}}},
  "6": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"32":12,"98":3,"94":1,"103":1,"95":2,"184":2},"pools":{"32":"normal","98":"normal","94":"hund","103":"dgl","95":"motorrad","184":"ap"},"extensions":{"Zelle":10,"Diensthundestaffel":1,"Kriminalpolizei":1,"Dienstgruppenleitung":1,"Motorradstaffel":1,"Autobahnpolizei":1}},"standard-groß":{"vehicles":{"32":20,"98":5,"94":1,"103":1,"95":2,"184":2,"52":1},"pools":{"32":"normal","98":"normal","94":"hund","103":"dgl","95":"motorrad","184":"ap","52":"gefkw"},"extensions":{"Zelle":10,"Diensthundestaffel":1,"Kriminalpolizei":1,"Dienstgruppenleitung":1,"Motorradstaffel":1,"Autobahnpolizei":1,"Großwache":1,"Großgewahrsam":1}}}},
  "9": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"39":2,"41":2,"110":2,"40":2,"124":2,"93":2,"92":2,"45":1,"42":1,"43":1,"44":1,"65":1,"66":1,"67":1,"68":1,"69":1,"100":1,"123":1,"101":1,"102":1,"109":1,"122":1,"112":1,"125":1,"144":1,"145":1,"146":1,"147":1,"148":1,"176":1,"177":1,"178":1,"181":1,"182":1,"183":1},"pools":{"39":"gesamt","41":"gesamt","110":"gesamt","40":"gesamt","124":"gesamt","93":"gesamt","92":"gesamt","45":"gesamt","42":"gesamt","43":"gesamt","44":"gesamt","65":"gesamt","66":"gesamt","67":"gesamt","68":"gesamt","69":"gesamt","100":"gesamt","123":"gesamt","101":"gesamt","102":"gesamt","109":"gesamt","122":"gesamt","112":"gesamt","125":"gesamt","144":"gesamt","145":"gesamt","146":"gesamt","147":"gesamt","148":"gesamt","176":"gesamt","177":"gesamt","178":"gesamt","181":"gesamt","182":"gesamt","183":"gesamt"},"extensions":{"1. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung":1,"1. Technischer Zug: Zugtrupp":1,"2. Technischer Zug - Bergungsgruppe":1,"2. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung":1,"2. Technischer Zug: Zugtrupp":1,"Fachgruppe Räumen":1,"Fachgruppe Wassergefahren":1,"Fachgruppe Ortung":1,"Fachgruppe Wasserschaden/Pumpen":1,"Fachgruppe Schwere Bergung":1,"Fachgruppe Elektroversorgung":1,"Ortsverbands-Mannschaftstransportwagen":1,"Trupp Unbemannte Luftfahrtsysteme":1,"Fachzug Führung und Kommunikation":1,"Fachgruppe Logistik-Verpflegung":1,"Fachgruppe Brückenbau":1}}}},
  "11": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"50":9,"35":4,"51":5,"72":3,"52":1,"80":2,"79":6,"82":2,"81":6,"94":3,"135":3,"137":3,"165":1},"pools":{"50":"gesamt","35":"gesamt","51":"gesamt","72":"gesamt","52":"gesamt","80":"gesamt","79":"gesamt","82":"gesamt","81":"gesamt","94":"gesamt","135":"gesamt","137":"gesamt","165":"gesamt"},"extensions":{"2. Zug der 1. Hundertschaft":1,"3. Zug der 1. Hundertschaft":1,"Sonderfahrzeug: Gefangenenkraftwagen":1,"Technischer Zug: Wasserwerfer":1,"SEK: 1. Zug":1,"SEK: 2. Zug":1,"MEK: 1. Zug":1,"MEK: 2. Zug":1,"Diensthundestaffel":1,"Reiterstaffel":1,"Sonderfahrzeug: Lautsprecherkraftwagen":1}}}},
  "12": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"59":1,"60":1,"28":1,"58":3,"64":1,"63":1,"70":1,"91":2,"127":1,"133":4,"132":1,"130":2,"131":3,"171":3,"173":3},"pools":{"59":"gesamt","60":"gesamt","28":"gesamt","58":"gesamt","64":"gesamt","63":"gesamt","70":"gesamt","91":"gesamt","127":"gesamt","133":"gesamt","132":"gesamt","130":"gesamt","131":"gesamt","171":"gesamt","173":"gesamt"},"extensions":{"Führung":1,"Sanitätsdienst":1,"Wasserrettung":1,"Rettungshundestaffel":1,"SEG Drohne":1,"Betreuungs- und Verpflegungsdienst":1,"Technik und Sicherheit":1}}}},
  "13": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"61":2,"96":1},"pools":{"61":"normal","96":"normal"},"extensions":{"Außenlastbehälter":1,"Windenrettung":1}}}},
  "15": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"64":2,"63":2,"70":2},"pools":{"64":"normal","63":"normal","70":"normal"},"extensions":{}}}},
  "17": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"51":4,"79":6,"80":2,"81":6,"82":2,"94":3},"pools":{"51":"gesamt","79":"gesamt","80":"gesamt","81":"gesamt","82":"gesamt","94":"gesamt"},"extensions":{"SEK: 1. Zug":1,"SEK: 2. Zug":1,"MEK: 1. Zug":1,"MEK: 2. Zug":1,"Diensthundestaffel":1}}}},
  "21": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"91":6},"pools":{"91":"normal"},"extensions":{}}}},
  "25": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"150":5,"149":4,"151":1,"152":3,"154":2,"158":1,"155":1,"153":2},"pools":{"150":"normal","149":"normal","151":"normal","152":"normal","154":"normal","158":"hoehe","155":"hoehe","153":"hunde"},"extensions":{"Höhenrettung":1,"Rettungshundestaffel":1,"Drohneneinheit":1}}}},
  "26": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"159":2,"160":3},"pools":{"159":"normal","160":"normal"},"extensions":{}}}},
  "28": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"161":1},"pools":{"161":"normal"},"extensions":{}}}},
  "29": {"slotBonus":0,"profiles":{"standard":{"vehicles":{"184":10},"pools":{"184":"normal"},"extensions":{"Zelle":10}}}}
};

/* ═══════════════════════════════════════════════════════════════════
   Zustand
   ═══════════════════════════════════════════════════════════════════ */
const S = {
  plan: undefined,          // wird beim ersten Zugriff geladen, siehe unten
  /* Die Freigabe für grüne Objekte wird bewußt nicht wiederhergestellt: sie
     gilt für einen Handgriff. Wer den Browser neu öffnet, fängt geschützt an. */
  opts: { ...store.get(KEY_OPTS, { buffer: 15, dry: true }), gruenFrei: false },
  buildings: [],          // aus /api/buildings
  vehicles: [],           // aus /api/v2/vehicles
  byBuilding: new Map(),  // buildingId -> Fahrzeuge
  byId: new Map(),
  aenderungen: 0,          // lokal fortgeschrieben seit dem letzten Vollabruf
  loaded: false,
  busy: false,
  log: []
};

/* In jeder Gebäude-Lightbox läuft dieses Skript erneut. Den kompletten Plan
   dort ungefragt zu parsen, lag auf dem kritischen Pfad jedes Gebäudeklicks. */
let _plan;
Object.defineProperty(S, 'plan', {
  get() { return _plan !== undefined ? _plan : (_plan = store.get(KEY_PLAN, null)); },
  /* Ein neuer Plan macht alles Gerechnete ungültig: Fahrzeugdaten, Bedarf
     je Wache, Kurstabellen. Ohne standNeu() rechnete der Planer nach dem
     Import mit den Zahlen des alten Plans weiter, bis der Bestand neu geladen
     wurde — sichtbar erst dort, wo die Zahlen plötzlich wieder stimmten. */
  set(v) { _plan = v; _vehCache.clear(); standNeu(); },
  configurable: true
});

/* ═══════════════════════════════════════════════════════════════════
   Fahrzeug-Stammdaten
   Bis v0.18 kamen Sitze und Lehrgänge aus dem importierten Plan. Der Plan
   führt Lehrgänge als Klartext („GW-Taucher Lehrgang“), die Personalplanung
   braucht aber den internen Schlüssel (`gw_taucher`). Die Rückübersetzung
   riet und lag daneben — deshalb steht die destillierte Tabelle jetzt fest
   im Skript und überlebt jede Planänderung.
     c     Kurzname
     min   Personen zum Ausrücken; max Sitze (0 = Anhänger)
     kurse [{k: Schlüssel, art: 'alle'|'min', n: Anzahl}]
           'alle' → jede zugewiesene Person braucht den Kurs
           'min'  → n der Besatzung brauchen ihn; n = 0 heißt, die Zahl steht
                    in est (so führt das Spiel Dekon-P und die Pferdetransporte)
     est   Personal an der Einsatzstelle — beim Anhänger die Zahl, die auf
           dem Zugfahrzeug mitfahren muss
     zug   Fahrzeugtypen, die diesen Anhänger ziehen dürfen
   Was das Spiel neu herausbringt, fehlt hier; dafür greift weiter der Plan,
   erkennbar an `geraten: true`.
   ═══════════════════════════════════════════════════════════════════ */
const PB = {
  "0":{"c":"LF 20","min":1,"max":9},"1":{"c":"LF 10","min":1,"max":9},
  "2":{"c":"DLK 23","min":1,"max":3},"3":{"c":"ELW 1","min":1,"max":3},
  "4":{"c":"RW","min":1,"max":3},"5":{"c":"GW-A","min":1,"max":3},
  "6":{"c":"LF 8/6","min":1,"max":9},"7":{"c":"LF 20/16","min":1,"max":9},
  "8":{"c":"LF 10/6","min":1,"max":9},"9":{"c":"LF 16-TS","min":1,"max":9},
  "10":{"c":"GW-Öl","min":1,"max":3},"11":{"c":"GW-L2-Wasser","min":1,"max":3},
  "12":{"c":"GW-Messtechnik","min":1,"max":3,"kurse":[{"k":"gw_messtechnik","art":"alle","n":null}]},
  "13":{"c":"SW 1000","min":1,"max":3},"14":{"c":"SW 2000","min":1,"max":6},
  "15":{"c":"SW 2000-Tr","min":1,"max":3},"16":{"c":"SW Kats","min":1,"max":3},
  "17":{"c":"TLF 2000","min":1,"max":3},"18":{"c":"TLF 3000","min":1,"max":3},
  "19":{"c":"TLF 8/8","min":1,"max":3},"20":{"c":"TLF 8/18","min":1,"max":3},
  "21":{"c":"TLF 16/24-Tr","min":1,"max":3},"22":{"c":"TLF 16/25","min":1,"max":6},
  "23":{"c":"TLF 16/45","min":1,"max":3},"24":{"c":"TLF 20/40","min":1,"max":3},
  "25":{"c":"TLF 20/40-SL","min":1,"max":3},"26":{"c":"TLF 16","min":1,"max":3},
  "27":{"c":"GW-Gefahrgut","min":1,"max":3,"kurse":[{"k":"gw_gefahrgut","art":"alle","n":null}]},
  "28":{"c":"RTW","min":1,"max":2},
  "29":{"c":"NEF","min":1,"max":2,"kurse":[{"k":"notarzt","art":"alle","n":null}]},
  "30":{"c":"HLF 20","min":1,"max":9},
  "31":{"c":"RTH","min":1,"max":2,"kurse":[{"k":"notarzt","art":"alle","n":null}]},
  "32":{"c":"FuStW","min":1,"max":2},
  "33":{"c":"GW-Höhenrettung","min":1,"max":9,"kurse":[{"k":"gw_hoehenrettung","art":"alle","n":null}]},
  "34":{"c":"ELW 2","min":1,"max":6,"kurse":[{"k":"elw2","art":"alle","n":null}]},
  "35":{"c":"leBefKw","min":1,"max":3,"kurse":[{"k":"police_einsatzleiter","art":"alle","n":null}]},
  "36":{"c":"MTW","min":1,"max":9},"37":{"c":"TSF-W","min":1,"max":6},
  "38":{"c":"KTW","min":1,"max":2},"39":{"c":"GKW","min":1,"max":9},
  "40":{"c":"MTW-TZ","min":1,"max":4,"kurse":[{"k":"thw_zugtrupp","art":"alle","n":null}]},
  "41":{"c":"MzGW (FGr N)","min":1,"max":9},
  "42":{"c":"LKW K 9","min":1,"max":3,"kurse":[{"k":"thw_raumen","art":"alle","n":null}]},
  "43":{"c":"BRmG R","min":0,"max":0,"zug":[42]},
  "44":{"c":"Anh DLE","min":0,"max":0,"zug":[39,40,41,45]},
  "45":{"c":"MLW 5","min":1,"max":6,"kurse":[{"k":"thw_raumen","art":"alle","n":null}]},
  "46":{"c":"WLF","min":1,"max":3,"kurse":[{"k":"wechsellader","art":"alle","n":null}]},
  "47":{"c":"AB-Rüst","min":0,"max":0,"zug":[46]},
  "48":{"c":"AB-Atemschutz","min":0,"max":0,"zug":[46]},
  "49":{"c":"AB-Öl","min":0,"max":0,"zug":[46]},"50":{"c":"GruKw","min":1,"max":9},
  "51":{"c":"FüKW (Polizei)","min":1,"max":3,"kurse":[{"k":"police_fukw","art":"alle","n":null}]},
  "52":{"c":"GefKw","min":1,"max":2},
  "53":{"c":"Dekon-P","min":1,"max":6,"kurse":[{"k":"dekon_p","art":"min","n":0}],"est":6},
  "54":{"c":"AB-Dekon-P","min":0,"max":0,"kurse":[{"k":"dekon_p","art":"alle","n":null}],"est":6,"zug":[46]},
  "55":{"c":"KdoW-LNA","min":1,"max":1,"kurse":[{"k":"lna","art":"alle","n":null}]},
  "56":{"c":"KdoW-OrgL","min":1,"max":1,"kurse":[{"k":"orgl","art":"alle","n":null}]},
  "57":{"c":"FwK","min":1,"max":2,"kurse":[{"k":"fwk","art":"alle","n":null}]},
  "58":{"c":"KTW Typ B","min":1,"max":2},
  "59":{"c":"ELW 1 (SEG)","min":1,"max":2,"kurse":[{"k":"seg_elw","art":"alle","n":null}]},
  "60":{"c":"GW-San","min":6,"max":6,"kurse":[{"k":"seg_gw_san","art":"alle","n":null}]},
  "61":{"c":"Polizeihubschrauber","min":1,"max":3,"kurse":[{"k":"polizeihubschrauber","art":"alle","n":null}]},
  "62":{"c":"AB-Schlauch","min":0,"max":0,"zug":[46]},
  "63":{"c":"GW-Taucher","min":2,"max":2,"kurse":[{"k":"gw_taucher","art":"alle","n":null}]},
  "64":{"c":"GW-Wasserrettung","min":1,"max":6,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}]},
  "65":{"c":"LKW 7 Lkr 19 tm","min":1,"max":2},
  "66":{"c":"Anh MzB","min":0,"max":0,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}],"est":4,"zug":[65]},
  "67":{"c":"Anh SchlB","min":0,"max":0,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}],"est":4,"zug":[65]},
  "68":{"c":"Anh MzAB","min":0,"max":0,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}],"est":4,"zug":[65]},
  "69":{"c":"Tauchkraftwagen","min":1,"max":2,"kurse":[{"k":"gw_taucher","art":"alle","n":null}]},
  "70":{"c":"MZB","min":0,"max":0,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}],"est":4,"zug":[63,64]},
  "71":{"c":"AB-MZB","min":0,"max":0,"kurse":[{"k":"gw_wasserrettung","art":"alle","n":null}],"est":4,"zug":[46]},
  "72":{"c":"WaWe 10","min":5,"max":5,"kurse":[{"k":"police_wasserwerfer","art":"alle","n":null}]},
  "73":{"c":"GRTW","min":6,"max":6,"kurse":[{"k":"notarzt","art":"min","n":1}]},
  "74":{"c":"NAW","min":3,"max":3,"kurse":[{"k":"notarzt","art":"min","n":1}]},
  "75":{"c":"FLF","min":2,"max":3,"kurse":[{"k":"arff","art":"alle","n":null}]},
  "76":{"c":"Rettungstreppe","min":2,"max":2,"kurse":[{"k":"rettungstreppe","art":"alle","n":null}]},
  "77":{"c":"AB-Gefahrgut","min":0,"max":0,"kurse":[{"k":"gw_gefahrgut","art":"alle","n":null}],"est":1,"zug":[46]},
  "78":{"c":"AB-Einsatzleitung","min":0,"max":0,"kurse":[{"k":"elw2","art":"alle","n":null}],"est":1,"zug":[46]},
  "79":{"c":"SEK - ZF","min":3,"max":4,"kurse":[{"k":"police_sek","art":"alle","n":null}]},
  "80":{"c":"SEK - MTF","min":9,"max":9,"kurse":[{"k":"police_sek","art":"alle","n":null}]},
  "81":{"c":"MEK - ZF","min":3,"max":4,"kurse":[{"k":"police_mek","art":"alle","n":null}]},
  "82":{"c":"MEK - MTF","min":9,"max":9,"kurse":[{"k":"police_mek","art":"alle","n":null}]},
  "83":{"c":"GW-Werkfeuerwehr","min":1,"max":9,"kurse":[{"k":"werkfeuerwehr","art":"alle","n":null}]},
  "84":{"c":"ULF mit Löscharm","min":1,"max":3,"kurse":[{"k":"werkfeuerwehr","art":"alle","n":null}]},
  "85":{"c":"TM 50","min":1,"max":3,"kurse":[{"k":"werkfeuerwehr","art":"alle","n":null}]},
  "86":{"c":"Turbolöscher","min":1,"max":3,"kurse":[{"k":"werkfeuerwehr","art":"alle","n":null}]},
  "87":{"c":"TLF 4000","min":1,"max":3},"88":{"c":"KLF","min":1,"max":6},
  "89":{"c":"MLF","min":1,"max":6},"90":{"c":"HLF 10","min":1,"max":9},
  "91":{"c":"Rettungshundefahrzeug","min":4,"max":5,"kurse":[{"k":"seg_rescue_dogs","art":"alle","n":null}]},
  "92":{"c":"Anh Hund","min":0,"max":0,"kurse":[{"k":"thw_rescue_dogs","art":"alle","n":null}],"zug":[93]},
  "93":{"c":"MTW-O","min":4,"max":5},
  "94":{"c":"DHuFüKW","min":1,"max":2,"kurse":[{"k":"k9","art":"alle","n":null}]},
  "95":{"c":"Polizeimotorrad","min":1,"max":1,"kurse":[{"k":"police_motorcycle","art":"alle","n":null}]},
  "96":{"c":"Außenlastbehälter (allgemein)","min":0,"max":0,"kurse":[{"k":"police_firefighting","art":"alle","n":null}],"zug":[61,156]},
  "97":{"c":"ITW","min":3,"max":3,"kurse":[{"k":"intensive_care","art":"min","n":2},{"k":"notarzt","art":"min","n":1}]},
  "98":{"c":"Zivilstreifenwagen","min":1,"max":2,"kurse":[{"k":"criminal_investigation","art":"alle","n":null}]},
  "100":{"c":"MLW 4","min":1,"max":7,"kurse":[{"k":"water_damage_pump","art":"alle","n":null}]},
  "101":{"c":"Anh SwPu","min":0,"max":0,"kurse":[{"k":"water_damage_pump","art":"min","n":1}],"zug":[100,123]},
  "102":{"c":"Anh 7","min":0,"max":0,"kurse":[{"k":"water_damage_pump","art":"min","n":1}],"zug":[100,123]},
  "103":{"c":"FuStW (DGL)","min":1,"max":2,"kurse":[{"k":"police_service_group_leader","art":"min","n":1}]},
  "104":{"c":"GW-L1","min":1,"max":6},"105":{"c":"GW-L2","min":1,"max":6},
  "106":{"c":"MTF-L","min":1,"max":6},"107":{"c":"LF-L","min":1,"max":9},
  "108":{"c":"AB-L","min":0,"max":0,"zug":[46]},
  "109":{"c":"MzGW SB","min":1,"max":9,"kurse":[{"k":"heavy_rescue","art":"alle","n":null}]},
  "110":{"c":"NEA50","min":0,"max":0,"zug":[41]},
  "111":{"c":"NEA50","min":0,"max":0,"zug":[90,4,27,53,104,105,6,8,9,15,16,18,21,22]},
  "112":{"c":"NEA200","min":0,"max":0,"kurse":[{"k":"thw_energy_supply","art":"min","n":1}],"zug":[122]},
  "113":{"c":"NEA200","min":0,"max":0,"kurse":[{"k":"energy_supply","art":"min","n":1}],"zug":[90,4,27,53,104,105,6,8,9,15,16,18,21,22]},
  "114":{"c":"GW-Lüfter","min":1,"max":2},
  "115":{"c":"Anh Lüfter","min":0,"max":0,"zug":[90,4,27,53,104,105,6,8,9,15,16,18,21,22,83,5]},
  "116":{"c":"AB-Lüfter","min":0,"max":0,"zug":[46]},
  "117":{"c":"AB-Tank","min":0,"max":0,"zug":[46]},"118":{"c":"Kleintankwagen","min":1,"max":3},
  "119":{"c":"AB-Lösch","min":0,"max":0,"zug":[46]},"120":{"c":"Tankwagen","min":1,"max":3},
  "121":{"c":"GTLF","min":1,"max":3},"122":{"c":"LKW 7 Lbw (FGr E)","min":1,"max":3},
  "123":{"c":"LKW 7 Lbw (FGr WP)","min":1,"max":3},"124":{"c":"MTW-OV","min":1,"max":7},
  "125":{"c":"MTW-Tr UL","min":4,"max":4,"kurse":[{"k":"thw_drone","art":"alle","n":null}]},
  "126":{"c":"MTF Drohne","min":4,"max":5,"kurse":[{"k":"fire_drone","art":"min","n":4}]},
  "127":{"c":"GW UAS","min":4,"max":4,"kurse":[{"k":"seg_drone","art":"alle","n":null}]},
  "128":{"c":"ELW Drohne","min":4,"max":5,"kurse":[{"k":"fire_drone","art":"alle","n":null}]},
  "129":{"c":"ELW2 Drohne","min":4,"max":6,"kurse":[{"k":"fire_drone","art":"alle","n":null},{"k":"elw2","art":"alle","n":null}]},
  "130":{"c":"GW-Bt","min":3,"max":3,"kurse":[{"k":"care_service","art":"min","n":1},{"k":"care_service_equipment","art":"min","n":2}]},
  "131":{"c":"Bt-Kombi","min":1,"max":9,"kurse":[{"k":"care_service","art":"alle","n":null}]},
  "132":{"c":"FKH","min":0,"max":0,"zug":[133]},
  "133":{"c":"Bt LKW","min":3,"max":3,"kurse":[{"k":"care_service","art":"min","n":1},{"k":"care_service_equipment","art":"min","n":2}]},
  "134":{"c":"Pferdetransporter klein","min":2,"max":4,"kurse":[{"k":"police_horse","art":"min","n":2}]},
  "135":{"c":"Pferdetransporter groß","min":2,"max":2,"kurse":[{"k":"police_horse","art":"min","n":0}],"est":4},
  "136":{"c":"Anh Pferdetransport","min":0,"max":0,"kurse":[{"k":"police_horse","art":"min","n":0}],"est":2,"zug":[134,135,137]},
  "137":{"c":"Zugfahrzeug Pferdetransport","min":1,"max":6},
  "138":{"c":"GW-Verpflegung","min":3,"max":6,"kurse":[{"k":"fire_care_service","art":"min","n":1},{"k":"care_service_equipment","art":"min","n":2}]},
  "139":{"c":"GW-Küche","min":3,"max":3,"kurse":[{"k":"fire_care_service","art":"min","n":1},{"k":"care_service_equipment","art":"min","n":2}]},
  "140":{"c":"MTW-Verpflegung","min":6,"max":6,"kurse":[{"k":"fire_care_service","art":"alle","n":null}]},
  "141":{"c":"FKH","min":0,"max":0,"zug":[138]},"142":{"c":"AB-Küche","min":0,"max":0,"zug":[46]},
  "143":{"c":"Anh Schlauch","min":0,"max":0,"zug":[90,4,27,53,104,105,6,8,9,15,16,18,21,22,36]},
  "144":{"c":"FüKW (THW)","min":1,"max":4,"kurse":[{"k":"thw_command","art":"alle","n":null}]},
  "145":{"c":"FüKomKW","min":1,"max":7,"kurse":[{"k":"thw_command","art":"alle","n":null}]},
  "146":{"c":"Anh FüLa","min":0,"max":0,"zug":[145]},
  "147":{"c":"FmKW","min":1,"max":7,"kurse":[{"k":"thw_command","art":"alle","n":null}]},
  "148":{"c":"MTW-FGr K","min":4,"max":4,"kurse":[{"k":"thw_command","art":"alle","n":null}]},
  "149":{"c":"GW-Bergrettung (NEF)","min":3,"max":6,"kurse":[{"k":"notarzt","art":"min","n":1}]},
  "150":{"c":"GW-Bergrettung","min":3,"max":6},
  "151":{"c":"ELW Bergrettung","min":1,"max":3,"kurse":[{"k":"mountain_command","art":"alle","n":null}]},
  "152":{"c":"ATV","min":1,"max":1},
  "153":{"c":"Hundestaffel (Bergrettung)","min":4,"max":5,"kurse":[{"k":"seg_rescue_dogs","art":"alle","n":null}]},
  "154":{"c":"Schneefahrzeug","min":1,"max":1},
  "155":{"c":"Anh Höhenrettung (Bergrettung)","min":0,"max":0,"kurse":[{"k":"mountain_height_rescue","art":"min","n":4}],"zug":[149,150]},
  "156":{"c":"Polizeihubschrauber mit verbauter Winde","min":1,"max":3,"kurse":[{"k":"polizeihubschrauber","art":"min","n":1},{"k":"police_helicopter_lift","art":"min","n":1}]},
  "157":{"c":"RTH Winde","min":1,"max":2,"kurse":[{"k":"rescue_helicopter_lift","art":"min","n":1},{"k":"notarzt","art":"min","n":1}]},
  "158":{"c":"GW-Höhenrettung (Bergrettung)","min":4,"max":4,"kurse":[{"k":"mountain_height_rescue","art":"alle","n":null}]},
  "159":{"c":"Seenotrettungskreuzer","min":4,"max":9,"kurse":[{"k":"coastal_rescue","art":"alle","n":null}]},
  "160":{"c":"Seenotrettungsboot","min":1,"max":2},
  "161":{"c":"Hubschrauber (Seenotrettung)","min":3,"max":4,"kurse":[{"k":"coastal_helicopter","art":"min","n":1},{"k":"coastal_helicopter_lift","art":"min","n":1},{"k":"emergency_paramedic_water_rescue","art":"min","n":1}]},
  "162":{"c":"RW-Schiene","min":1,"max":3,"kurse":[{"k":"railway_fire","art":"alle","n":null}]},
  "163":{"c":"HLF Schiene","min":1,"max":9,"kurse":[{"k":"railway_fire","art":"alle","n":null}]},
  "164":{"c":"AB-Schiene","min":0,"max":0,"zug":[46]},
  "165":{"c":"LauKw","min":5,"max":5,"kurse":[{"k":"police_speaker_operator","art":"alle","n":null}]},
  "166":{"c":"PTLF 4000","min":1,"max":2},"167":{"c":"SLF","min":1,"max":2},
  "168":{"c":"Anh Sonderlöschmittel","min":0,"max":0,"zug":[90,4,27,53,104,105,6,8,9,15,16,18,21,22,36]},
  "169":{"c":"AB-Sonderlöschmittel","min":0,"max":0,"zug":[46]},
  "170":{"c":"AB-Wasser/Schaum","min":0,"max":0,"zug":[46]},
  "171":{"c":"GW TeSi","min":1,"max":5,"kurse":[{"k":"disaster_response_technology","art":"alle","n":null}]},
  "172":{"c":"LKW Technik (Notstrom)","min":2,"max":6,"kurse":[{"k":"disaster_response_technology","art":"min","n":1}]},
  "173":{"c":"MTW TeSi","min":1,"max":7,"kurse":[{"k":"disaster_response_technology","art":"min","n":1}]},
  "174":{"c":"Anh TeSi","min":0,"max":0,"kurse":[{"k":"disaster_response_technology","art":"min","n":2}],"zug":[171,173]},
  "175":{"c":"NEA50","min":0,"max":0,"kurse":[{"k":"disaster_response_technology","art":"min","n":2}],"zug":[172]},
  "176":{"c":"LKW 7 Lbw (FGr Log-V)","min":3,"max":3,"kurse":[{"k":"thw_care_service","art":"min","n":1},{"k":"care_service_equipment","art":"min","n":2}]},
  "177":{"c":"MTW-FGr Log-V","min":5,"max":5,"kurse":[{"k":"thw_care_service","art":"alle","n":null}]},
  "178":{"c":"Anh 12 Lbw (FGr Log-V)","min":0,"max":0,"zug":[176]},
  "179":{"c":"AB-NEA50","min":0,"max":0,"zug":[46]},
  "180":{"c":"AB-NEA200","min":0,"max":0,"kurse":[{"k":"energy_supply","art":"min","n":1}],"zug":[46]},
  "181":{"c":"MzGW (FGr BrB)","min":6,"max":9,"kurse":[{"k":"thw_bridge_construction","art":"alle","n":null}]},
  "182":{"c":"Mobilkran","min":1,"max":1,"kurse":[{"k":"thw_bridge_construction_crane","art":"alle","n":null}]},
  "183":{"c":"Anh Plattform (FGr BrB)","min":0,"max":0,"kurse":[{"k":"thw_bridge_construction","art":"min","n":6}],"zug":[181]},
  "184":{"c":"FuStW (AP)","min":2,"max":2,"kurse":[{"k":"highway_police","art":"alle","n":null}]},
  "185":{"c":"GW-Tierrettung","min":2,"max":6},
  "186":{"c":"Anh Tierrettung","min":0,"max":0,"zug":[90,4,27,53,104,105,1,5,6,8,9,15,16,18,21,22,36,37,88,89,185]}
};

/* Zusammengeführte Sicht: Stammdaten schlagen den Plan, der Plan liefert
   nur noch den Anzeigenamen und füllt Lücken. */
const _vehCache = new Map();
function vehMeta(id) {
  const k = String(id);
  if (_vehCache.has(k)) return _vehCache.get(k);
  const pb = PB[k] || null;
  const pl = S.plan?.vehicleTypes?.[k] || null;
  let meta = null;
  if (pb) {
    meta = { name: pl?.name || pb.c, min: pb.min, max: pb.max,
             kurse: pb.kurse || [], est: pb.est || 0, zug: pb.zug || null,
             geraten: false };
  } else if (pl) {
    /* Ohne Stammdaten bleibt nur, was der Plan hergibt: Sitzzahlen ja,
       Lehrgänge nein — der Plan führt sie als Klartext, und den wieder in
       Schlüssel zurückzuübersetzen war die Fehlerquelle, die v0.19 beseitigt
       hat. Solche Typen fordern also keine Ausbildung, bis sie in PB stehen. */
    meta = { ...pl, kurse: [], est: pl.est || 0, zug: null, geraten: true };
  }
  _vehCache.set(k, meta);
  return meta;
}

/* Wunschbild und Zuordnung: gelesen wird träge, geschrieben immer sofort —
   an ihnen hängt jede Rechnung, und ein halb gespeichertes Modell wäre
   schlimmer als gar keins. */
let _modell, _zuord;
Object.defineProperty(S, 'modell', {
  get() { return _modell ?? (_modell = store.get(KEY_MODELL, null) || strukturKopie(MODELL_STANDARD)); },
  set(v) { _modell = v; store.set(KEY_MODELL, v); standNeu(); }
});
Object.defineProperty(S, 'zuordnung', {
  get() { return _zuord ?? (_zuord = store.get(KEY_ZUORD, {})); },
  set(v) { _zuord = v; store.set(KEY_ZUORD, v); standNeu(); }
});
const strukturKopie = o => JSON.parse(JSON.stringify(o));
/** Nach Änderungen am Wunschbild: speichern und alles Gerechnete verwerfen. */
function modellGeaendert() { const m = S.modell; S.modell = m; }

/* Wer mit v0.32 schon gespeichert hat, trägt die alten Profilnamen im
   Speicher. Einmalig umbenennen, sonst zeigt die Zuordnung ins Leere und alle
   Wachen fielen auf das erste Profil zurück. */
function profilnamenNachziehen() {
  const um = { crafted: 'standard', 'crafted-big': 'standard-groß' };
  const m = store.get(KEY_MODELL, null);
  if (m) {
    let geaendert = false;
    for (const e of Object.values(m)) {
      for (const [alt2, neu2] of Object.entries(um)) {
        if (e?.profiles?.[alt2] && !e.profiles[neu2]) {
          e.profiles[neu2] = e.profiles[alt2]; delete e.profiles[alt2]; geaendert = true;
        }
      }
      if (e?.profiles?.standard && !Object.keys(e.profiles.standard.vehicles || {}).length
          && Object.keys(e.profiles).length > 1) {
        delete e.profiles.standard; geaendert = true;      // die leere Falle
      }
    }
    if (geaendert) store.set(KEY_MODELL, m);
  }
  const z = store.get(KEY_ZUORD, null);
  if (z) {
    let geaendert = false;
    for (const [bid, p2] of Object.entries(z)) if (um[p2]) { z[bid] = um[p2]; geaendert = true; }
    if (geaendert) store.set(KEY_ZUORD, z);
  }
}

/* ── Der Ausbaukatalog ────────────────────────────────────────────────
   Um einen Ausbau zu bestellen, genügt sein Name nicht — das Spiel will die
   Nummer des Bauplatzes: `/buildings/<id>/extension/credits/<nr>`. Diese
   Zuordnung stand bisher nur im Plan des Artefakts. Sie steht aber im Spiel
   selbst, und zwar an zwei Stellen:

     1. Gebaute Ausbauten nennt bereits `/api/buildings` mit `type_id` und
        Namen — das kostet nichts, der Bestand wird ohnehin geladen.
     2. Die noch leeren Bauplätze stehen auf der Ausbauseite einer Wache, im
        Verweis des Kaufknopfes.

   Beides zusammen ergibt den vollständigen Katalog je Gebäudeart.
   ─────────────────────────────────────────────────────────────────── */
function extCatVon(t) {
  const roh = store.get(KEY_EXTCAT, {})[String(t)];
  if (!roh) return [];
  const aus = [];
  for (const [nr, cap] of Object.entries(roh)) aus[Number(nr)] = cap;
  return aus;
}

function merkeAusbau(btyp, nr, caption) {
  if (btyp == null || !Number.isInteger(nr) || !caption) return false;
  const alle = store.get(KEY_EXTCAT, {});
  const t = (alle[String(btyp)] ||= {});
  if (t[nr] === caption) return false;
  t[nr] = caption;
  store.set(KEY_EXTCAT, alle);
  return true;
}

/** Was der Bestand ohnehin weiß: jeder gebaute Ausbau nennt Nummer und Namen. */
function ausbauAusBestand() {
  let neu = 0;
  for (const b of S.buildings)
    for (const e of (b.extensions || []))
      if (e?.caption != null && Number.isInteger(e.type_id))
        if (merkeAusbau(b.building_type, e.type_id, e.caption)) neu++;
  if (neu) standNeu();
  return neu;
}

/** Und die leeren Bauplätze von der Ausbauseite einer Wache. */
async function ausbauKatalogLesen() {
  /* Ein Abruf für alle Gebäudearten statt einer je Art.
     Vorher holte diese Funktion `/buildings/<wache>/leitstelle-extensions` —
     am Spiel nachgemessen antwortet dieser Pfad auf einer Wache mit HTTP 500.
     Er gehört der Leitstelle, und dort steht er für ALLE eigenen Gebäude auf
     einmal: 890 Zeilen, die Bauplatznummer am Verweis, die Gebäudeart über die
     Gebäude-Id im selben Verweis. Der Katalog konnte also nie gelesen werden,
     und der Reiter „Ausbauten" blieb hinter seiner Übernahmeseite stehen. */
  const leit = S.buildings.find(x => x.leitstelle_building_id)?.leitstelle_building_id;
  if (!leit) throw new Error('Leitstelle nicht bekannt — Bestand neu laden');
  const html = await getText(`/buildings/${leit}/leitstelle-extensions`);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let neu = 0, gesehen = 0;
  const proTyp = new Map();
  for (const tr of doc.querySelectorAll('tr')) {
    const cap = tr.querySelector('b')?.textContent.trim();
    if (!cap) continue;
    const link = [...tr.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .map(h => h.match(/\/buildings\/(\d+)\/extension(?:_ready)?\/(?:credits\/|coins\/)?(\d+)/))
      .find(Boolean);
    if (!link) continue;
    const wache = S.byId.get(Number(link[1]));
    if (!wache) continue;                    // Gebäude nicht im eigenen Bestand
    gesehen++;
    proTyp.set(wache.building_type, (proTyp.get(wache.building_type) || 0) + 1);
    if (merkeAusbau(wache.building_type, Number(link[2]), cap)) neu++;
  }
  if (!gesehen) throw new Error('keine Bauplätze auf der Leitstellenseite gefunden');
  standNeu();
  return { neu, gesehen, proTyp };
}


/* ── Was an einer Wache überhaupt gekauft werden kann ─────────────────
   Der Katalog kennt 186 Fahrzeugtypen, aber an einer Rettungswache steht kein
   Löschboot. Eine vollständige Tabelle „Typ gehört zu Gebäudeart“ habe ich
   nicht, und raten kommt nicht in Frage — also drei Quellen, in dieser
   Reihenfolge:

     1. aus dem Spiel gelesen (Knopf im Plan-Reiter): die Kaufseite einer
        eigenen Wache nennt die Typen selbst
     2. was in den Profilen dieses Gebäudetyps steht — geplant hat es jemand,
        der es kaufen konnte
     3. was auf eigenen Wachen dieses Typs tatsächlich steht

   Reicht das nicht, läßt sich die Beschränkung im Editor abschalten.
   ─────────────────────────────────────────────────────────────────── */
function kaufbareTypen(btyp) {
  const t = String(btyp);
  const gelesen = store.get(KEY_KAUFBAR, {})[t];
  if (gelesen?.length) return new Set(gelesen.map(String));
  const aus = new Set();
  for (const quelle of [S.modell?.[t]?.profiles, MODELL_STANDARD[t]?.profiles]) {
    for (const p of Object.values(quelle || {}))
      for (const id of Object.keys(p.vehicles || {})) aus.add(String(id));
  }
  for (const b of S.buildings) {
    if (String(b.building_type) !== t) continue;
    for (const v of (S.byBuilding.get(b.id) || [])) aus.add(String(v.vehicle_type));
  }
  return aus;
}

/** Liest die kaufbaren Typen einer Wache aus dem Spiel. Die Kaufseite trägt
    je Fahrzeug einen Verweis der Form /vehicle/<wache>/<typ>/credits — genau
    den, den der Planer zum Kaufen benutzt. Findet sich keiner, bleibt alles
    beim Alten statt etwas zu erfinden. */
async function kaufbareLesen(b) {
  /* Die Kaufliste steht nicht auf der Wachenseite, sondern auf der Seite
     „Fahrzeug kaufen". Am Spiel nachgemessen: /buildings/<id> enthält keinen
     einzigen /vehicle/<id>/<typ>/credits-Verweis, /buildings/<id>/vehicles/new
     enthält 99. Der Abruf ging also immer ins Leere und warf „keine Kaufliste
     gefunden" — deshalb blieb `lssplaner.kaufbar` stets leer und die
     Ersatzkette in `kaufbareTypen` trug die ganze Last. */
  const html = await getText(`/buildings/${b.id}/vehicles/new`);
  const ids = new Set();
  const re = new RegExp(`/vehicle/${b.id}/(\\d+)/credits`, 'g');
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  if (!ids.size) throw new Error('keine Kaufliste auf der Kaufseite gefunden');
  const alle = store.get(KEY_KAUFBAR, {});
  alle[String(b.building_type)] = [...ids];
  store.set(KEY_KAUFBAR, alle);
  return ids;
}


const T = {
  veh: id => vehMeta(id),
  vehName: id => vehMeta(id)?.name || `Typ ${id}`,
  btName: t => S.plan?.buildingTypes?.[t] || GEBAEUDE_NAMEN[t] || `Gebäudetyp ${t}`,
  layout: t => S.plan?.layouts?.[t] || LAYOUTS_STANDARD[t] || null,
  extCat: t => S.plan?.extensionCatalog?.[t] || extCatVon(t),
  /** Profile eines Gebäudetyps. Für Schulen, Krankenhäuser und Leitstellen
      gibt es keine — dort steht nichts, was der Planer besetzen, kaufen oder
      benennen könnte, und ein leeres Profil in der Liste ist nur Ballast.
      Die Sperre sitzt hier und nicht bloß in den Daten, damit auch ein
      importierter Plan sie nicht unterläuft. */
  profiles: t => NICHT_PLANEN.has(Number(t)) ? {} : (S.modell?.[t]?.profiles || {}),
  /** Profil einer Wache: eigene Zuordnung, sonst erstes Profil des Typs */
  profileOf(b) {
    const ps = T.profiles(b.building_type);
    const a = S.zuordnung[b.id];
    return (a && ps[a]) ? a : Object.keys(ps)[0] || null;
  },
  target(b) {
    const p = this.profileOf(b);
    return p ? T.profiles(b.building_type)[p] : null;
  }
};

/* ═══════════════════════════════════════════════════════════════════
   Daten laden
   ═══════════════════════════════════════════════════════════════════ */
/* Nur die Felder behalten, die der Planer wirklich braucht — sonst sprengt
   der Bestand den Speicher des Browsers. */
const slimBuilding = b => ({
  id: b.id, caption: b.caption, building_type: b.building_type,
  level: b.level, personal_count: b.personal_count,
  /* Einsatzbereitschaft der Wache. Ohne dieses Feld war `b.enabled` nach jedem
     Laden `undefined`, und `undefined !== soll` ist immer wahr — pflegeAusbauten
     schickte also bei jedem scharfen Personallauf einen Umschalter an jede
     Wache. `/buildings/<id>/active` kennt kein Ziel, es kippt nur; die Hälfte
     dieser Anfragen nahm eine einsatzbereite Wache aus dem Dienst, während das
     Protokoll „einsatzbereit" meldete. Die API liefert das Feld, es wurde beim
     Abmagern nur verworfen. */
  enabled: b.enabled,
  // Für den Ausbaukatalog: die Sammelseite gehört der Leitstelle, nicht der Wache.
  leitstelle_building_id: b.leitstelle_building_id,
  extensions: (b.extensions || []).map(e => ({
    type_id: e.type_id, caption: e.caption,
    available: e.available, enabled: e.enabled, available_at: e.available_at
  }))
});
const slimVehicle = v => ({
  id: v.id, building_id: v.building_id, vehicle_type: v.vehicle_type,
  caption: v.caption, fms_real: v.fms_real,
  // Für den Fortschritt: Besatzung und Anhängerkopplung, ohne Extra-Abruf
  besatzung: v.assigned_personnel_count ?? null,
  zugfahrzeug: v.tractive_vehicle_id ?? null
});

function indexVehicles() {
  S.byId = new Map(S.buildings.map(b => [b.id, b]));
  S.byBuilding = new Map();
  for (const v of S.vehicles) {
    if (!S.byBuilding.has(v.building_id)) S.byBuilding.set(v.building_id, []);
    S.byBuilding.get(v.building_id).push(v);
  }
}

/* Nach einer Aktion den Bestand fortschreiben, statt alles neu zu holen.
   Der Zeitstempel bleibt alt — die Anzeige weist die Zahl der lokalen
   Änderungen aus, damit klar ist, dass hier gerechnet und nicht gemessen wird. */
function merkeAenderung() {
  S.aenderungen++;
  standNeu();
  store.set(KEY_DATA, { ts: S.stamp, aenderungen: S.aenderungen,
                        buildings: S.buildings, vehicles: S.vehicles });
}

function fahrzeugDazu(b, typId, name) {
  /* besatzung 0 ist keine Annahme, sondern eine Tatsache: ein eben gekauftes
     Fahrzeug hat niemanden an Bord. Fehlte das Feld, galt die ganze Wache als
     „nicht beurteilbar“, bis der Bestand neu geladen wurde. */
  /* Eine erfundene, negative Nummer: der Server hat dem eben gekauften
     Fahrzeug längst eine eigene gegeben, die wir erst beim nächsten
     Bestandsladen erfahren. Bis dahin ist der Eintrag ein Platzhalter — er
     zählt für den Fortschritt, darf aber in keiner Anfrage vorkommen. */
  const v = { id: -Date.now() - Math.floor(Math.random() * 1000), building_id: b.id,
              vehicle_type: Number(typId), caption: name + ' (neu)', fms_real: 2,
              besatzung: 0, zugfahrzeug: null, platzhalter: true };
  S.vehicles.push(v);
  if (!S.byBuilding.has(b.id)) S.byBuilding.set(b.id, []);
  S.byBuilding.get(b.id).push(v);
  merkeAenderung();
}

function fahrzeugWeg(b, id) {
  S.vehicles = S.vehicles.filter(v => v.id !== id);
  S.byBuilding.set(b.id, (S.byBuilding.get(b.id) || []).filter(v => v.id !== id));
  merkeAenderung();
}

function ausbauDazu(b, caption, extId) {
  b.extensions = b.extensions || [];
  b.extensions.push({ type_id: extId, caption, available: true, enabled: true, available_at: null });
  merkeAenderung();
}

/** Zwischengespeicherten Bestand übernehmen, falls vorhanden. */
function loadCached() {
  const c = store.get(KEY_DATA, null);
  if (!c || !Array.isArray(c.buildings) || !Array.isArray(c.vehicles)) return false;
  S.buildings = c.buildings; S.vehicles = c.vehicles; S.stamp = c.ts || null;
  S.aenderungen = c.aenderungen || 0;
  indexVehicles(); S.loaded = true; standNeu();
  const neueAusbauten = ausbauAusBestand();
  if (neueAusbauten) log(`${neueAusbauten} Bauplätze aus dem Bestand gelernt.`);
  wachenSeite();                 // jetzt gibt es etwas zu zeigen
  return true;
}

async function loadAll(fresh = false) {
  if (fresh) cache.clear();
  const rawB = await apiGet('/api/buildings', { fresh });
  S.buildings = rawB.map(slimBuilding);
  cache.delete('/api/buildings');          // Rohfassung ist ab hier tot

  const alle = [];
  let url = '/api/v2/vehicles?limit=1000';
  for (let seite = 0; seite < 12 && url; seite++) {
    const r = await apiGet(url, { fresh });
    for (const v of (r.result || r)) alle.push(slimVehicle(v));   // seitenweise abmagern
    cache.delete(url);
    url = r.paging?.next_page || null;
  }
  S.vehicles = alle;
  S.stamp = Date.now();
  S.aenderungen = 0;
  indexVehicles();
  standNeu();
  S.loaded = true;
  if (!store.set(KEY_DATA, { ts: S.stamp, buildings: S.buildings, vehicles: S.vehicles }))
    log('Bestand konnte nicht gespeichert werden — gilt nur für diese Sitzung', 'warn');
}

/** „vor 3 Minuten“ statt Zeitstempel. */
function since(ts) {
  if (!ts) return 'unbekannt';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `vor ${h} h` : `vor ${Math.round(h / 24)} Tagen`;
}

/* Jede Auswertung gilt für einen bestimmten Bestandsstand. Ändert sich
   etwas, wird die Nummer erhöht und alles Gemerkte damit ungültig. */
let stand0 = 0;
const standNeu = () => { stand0++; memoA.clear(); memoG.clear(); memoK.clear(); };
const memoA = new Map(), memoG = new Map(), memoK = new Map();

/* Gebaute Ausbauten je Bezeichnung. Mehrfach baubare zählen hoch. */
function builtExtensions(b) {
  const m = {};
  for (const e of b.extensions || []) {
    if (!e || e.available_at) continue;             // noch im Bau
    if (!(e.available ?? e.enabled ?? true)) continue;
    const cap = e.caption || T.extCat(b.building_type)[e.type_id] || `Ausbau ${e.type_id}`;
    m[cap] = (m[cap] || 0) + 1;
  }
  return m;
}

/* Was einen Bauplatz belegt — gebaut, noch im Bau oder abgeschaltet.
   `builtExtensions` zählt absichtlich nur, was Stellplätze bringt, und
   überspringt deshalb den Bau und das Abgeschaltete. Für die Bestellung ist
   genau das falsch: ein Platz, auf dem schon etwas steht oder entsteht, darf
   kein zweites Mal gekauft werden. Beide Sichten werden gebraucht, deshalb
   zwei Funktionen statt eines Schalters.
   `nummern` sind Bauplatznummern (der Index im Katalog), nicht Stückzahlen. */
function belegteAusbauten(b) {
  const proName = {}, nummern = new Set();
  for (const e of b.extensions || []) {
    if (!e) continue;
    const cap = e.caption || T.extCat(b.building_type)[e.type_id] || `Ausbau ${e.type_id}`;
    proName[cap] = (proName[cap] || 0) + 1;
    if (e.type_id != null) nummern.add(Number(e.type_id));
  }
  return { proName, nummern };
}

/* Welche Ausbauten bringen Stellplätze? Aus den Pool-Definitionen des Layouts. */
function slotGivingCaptions(bt) {
  const hit = memoG.get(bt);
  if (hit && hit.g === stand0) return hit.v;
  const v = slotGivingIntern(bt);
  memoG.set(bt, { g: stand0, v });
  return v;
}
function slotGivingIntern(bt) {
  const lay = T.layout(bt); if (!lay) return new Set();
  const out = new Set();
  for (const p of lay.pools || []) {
    if (p.from && p.from !== 'level' && p.from !== 'fixed') out.add(p.from);
    for (const c of Object.keys(p.bonus || {})) out.add(c);
  }
  return out;
}

/** Stellplätze je Topf: Kapazität aus Stufe und gebauten Ausbauten,
    Belegung aus dem tatsächlichen Bestand. */
function poolsOf(b) {
  const lay = T.layout(b.building_type);
  const tgt = T.target(b);
  const pmap = tgt?.pools || {};
  const built = builtExtensions(b);
  const caps = {};
  if (lay?.pools?.length) {
    for (const p of lay.pools) {
      let cap;
      if (p.from === 'level' || p.from === 'fixed') {
        cap = p.from === 'level' ? (b.level || 0) + 1 : (p.base || 0);
        for (const [c, add] of Object.entries(p.bonus || {})) cap += (built[c] || 0) * add;
      } else cap = (built[p.from] || 0) * (p.per || 1);
      caps[p.key] = { label: p.label, cap, belegt: 0 };
    }
  } else {
    caps.normal = { label: 'Stellplätze', cap: (b.level || 0) + 1, belegt: 0 };
  }
  const first = Object.keys(caps)[0];
  const bucket = t => (pmap[t] && caps[pmap[t]]) ? pmap[t] : first;
  for (const v of (S.byBuilding.get(b.id) || [])) {
    const k = bucket(v.vehicle_type); if (caps[k]) caps[k].belegt++;
  }
  return { caps, bucket };
}

/** Was einem Kauf im Weg steht: fehlende Stellplatz-Ausbauten, überzählige
    Fahrzeuge, zu niedrige Stufe. */
function blockers(b) {
  const a = analyse(b);
  const giving = slotGivingCaptions(b.building_type);
  const out = [];
  const fehlendeSP = a.extMissing.filter(e => giving.has(e.caption));
  if (fehlendeSP.length)
    out.push(`${fehlendeSP.reduce((s2, e) => s2 + e.n, 0)} Stellplatz-Ausbauten fehlen `
      + `(${fehlendeSP.map(e => e.caption).join(', ')})`);
  if (a.vehSurplus.length)
    out.push(`${a.vehSurplus.reduce((s2, x) => s2 + x.n, 0)} überzählige Fahrzeuge belegen Plätze `
      + `(${a.vehSurplus.map(x => x.name).join(', ')})`);
  const lay = T.layout(b.building_type);
  const maxLvl = lay?.maxLevel;
  if (maxLvl != null && (b.level || 0) < maxLvl)
    out.push(`Stufe ${b.level} von ${maxLvl}`);
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   Soll/Ist je Wache
   ═══════════════════════════════════════════════════════════════════ */
function analyse(b) {
  const hit = memoA.get(b.id);
  if (hit && hit.g === stand0) return hit.v;
  const v = analyseIntern(b);
  memoA.set(b.id, { g: stand0, v });
  return v;
}
function analyseIntern(b) {
  const tgt = T.target(b);
  const res = { building: b, profile: T.profileOf(b), vehMissing: [], vehSurplus: [],
                extMissing: [], staffNeed: 0, blocked: [] };
  if (!tgt) return res;

  const have = {};
  for (const v of (S.byBuilding.get(b.id) || [])) have[v.vehicle_type] = (have[v.vehicle_type] || 0) + 1;

  for (const [id, n] of Object.entries(tgt.vehicles || {})) {
    const d = (Number(n) || 0) - (have[id] || 0);
    if (d > 0) res.vehMissing.push({ id, n: d, name: T.vehName(id) });
    res.staffNeed += (T.veh(id)?.max || 0) * (Number(n) || 0);
  }
  for (const [id, n] of Object.entries(have)) {
    const soll = Number((tgt.vehicles || {})[id]) || 0;
    if (n > soll) res.vehSurplus.push({ id, n: n - soll, name: T.vehName(id) });
  }

  const cat = T.extCat(b.building_type), giving = slotGivingCaptions(b.building_type);
  const repeatable = {};
  cat.forEach(c => { if (c) repeatable[c] = (repeatable[c] || 0) + 1; });
  const belegt = belegteAusbauten(b);
  for (const [cap, n] of Object.entries(tgt.extensions || {})) {
    /* Gegen das Belegte rechnen, nicht gegen das Fertige: sonst wird ein
       Ausbau, der gerade gebaut wird, eine Stunde später ein zweites Mal
       bestellt — bezahlt und nicht rückholbar. */
    const d = (Number(n) || 0) - (belegt.proName[cap] || 0);
    if (d <= 0) continue;
    /* Die Liste hieß „free" und war es nicht: sie enthielt jede Katalogstelle
       mit dieser Bezeichnung, auch die längst bebauten. buildExtensions nimmt
       davon die ersten `n` — also wurde auf besetzte Plätze gekauft.
       Mehrfach baubare Ausbauten (die „Zelle" 10×) teilen sich EINE
       Katalognummer; dort darf nicht gefiltert werden, sonst bleibt keine
       Stelle übrig. Gefiltert wird deshalb nur, wo eine Bezeichnung mehrere
       eigene Plätze hat. */
    const stellen = cat.map((c, i) => [c, i]).filter(([c]) => c === cap).map(([, i]) => i);
    const frei = stellen.length > 1 ? stellen.filter(i => !belegt.nummern.has(i)) : stellen;
    if (!frei.length) continue;                       // alles belegt, nichts zu bestellen
    res.extMissing.push({
      caption: cap, n: d, ids: frei,
      rank: repeatable[cap] > 1 ? 2 : (giving.has(cap) ? 0 : 1)   // Stellplatz → sonstige → wiederholbar
    });
  }
  res.extMissing.sort((a, b2) => a.rank - b2.rank || a.caption.localeCompare(b2.caption, 'de'));

  const soll = Math.ceil(res.staffNeed * (1 + (S.opts.buffer || 0) / 100));
  res.staffSoll = soll;
  res.staffIst = b.personal_count || 0;
  res.hire = res.staffIst < soll;
  return res;
}

/* ═══════════════════════════════════════════════════════════════════
   Fortschritt — was ist an einer Wache fertig, was nicht
   Nichts davon wird gemerkt: alles ergibt sich aus Plan und Bestand und
   ist damit immer aktuell. Anders als Notizen im Namen veraltet es nicht.
   ═══════════════════════════════════════════════════════════════════ */
const KEY_RUHT = 'lssplaner.ruht';    // von Hand stillgelegte Wachen
const ruht = new Set(store.get(KEY_RUHT, []));
const ruhtUm = id => {
  ruht.has(id) ? ruht.delete(id) : ruht.add(id);
  store.set(KEY_RUHT, [...ruht]); standNeu();
};

/** Einzelne Bereiche einer Wache: fertig, offen oder unbekannt. */
function fortschritt(b) {
  const a = analyse(b);
  const fz = S.byBuilding.get(b.id) || [];

  const ausbau = a.extMissing.reduce((s2, x) => s2 + x.n, 0);
  const kauf   = a.vehMissing.reduce((s2, x) => s2 + x.n, 0);
  const weg    = a.vehSurplus.reduce((s2, x) => s2 + x.n, 0);

  /* Personal: gegen die Mindestbesatzung samt Anhängern. Ob die Leute auch
     den nötigen Lehrgang haben, steht im Bestand nicht — verlangt ein
     Fahrzeug einen Kurs, bleibt das ohne Zuweisungslauf ungewiss. */
  let personal = 0, personalUnklar = 0;
  for (const v of fz) {
    const meta = T.veh(v.vehicle_type);
    if (!meta || meta.max === 0) continue;
    if (v.besatzung == null) { personalUnklar++; continue; }
    if (v.besatzung < mindestBedarf(v)) personal++;
  }

  // Anhänger ohne Zugfahrzeug — ohne eines ist er unbrauchbar
  const anhaenger = fz.filter(v => T.veh(v.vehicle_type)?.max === 0 && !v.zugfahrzeug).length;

  // Lehrgänge: nur wenn der Ausbildungsstand dieser Wache vorliegt
  let lehrgang = 0, lehrgangUnklar = !quals.by[b.id];
  if (!lehrgangUnklar) {
    for (const [key, soll] of Object.entries(courseNeed(b))) {
      const da = (quals.by[b.id][key] || 0) + laufendeAusbildung(key, b.id);
      lehrgang += Math.max(0, soll - da);
    }
  }

  const offen = ausbau + kauf + weg + personal + anhaenger + lehrgang;
  return {
    ausbau, kauf, weg, personal, personalUnklar, anhaenger, lehrgang, lehrgangUnklar,
    offen,
    unklar: personalUnklar > 0 || lehrgangUnklar,
    fertig: offen === 0 && personalUnklar === 0 && !lehrgangUnklar
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Haken im Namen
   Die alte Handarbeit, nur selbsttätig: Wachen, die von A bis Z fertig
   sind, tragen ein Häkchen im Namen; sobald etwas offen ist, fällt es weg.
   ═══════════════════════════════════════════════════════════════════ */
/* Der Punkt steht vorn: so sammeln sich die fertigen Fahrzeuge in den Listen
   des Spiels an einem Block. Einfärben ginge nicht — der Name liegt als Text
   auf dem Server und wird maskiert ausgegeben. Was ohne Userscript sichtbar
   bleiben soll, muß im Namen selbst stehen. */
const HAKEN = '🟢';          // setzt der Planer selbst: hier ist alles erledigt
/* Der rote Punkt ist das Gegenstück und wird **nie** vom Skript gesetzt. Wer
   ihn von Hand in einen Wachennamen schreibt, nimmt diese Wache vollständig
   aus dem Planer heraus: sie erscheint in keiner Liste, keiner Zählung, keinem
   Lauf. Gedacht für Wachen, die man bewußt anders führt als den Plan.
   Er wird auch nicht aus Namen entfernt — sonst wäre er nach dem ersten
   Umbenennen weg. */
const AUSSCHLUSS = '🔴';
const ausgeschlossen = b => String(b?.caption || '').includes(AUSSCHLUSS);
/** Wachen, mit denen der Planer überhaupt arbeiten darf. */
const planWachen = () => S.buildings.filter(b => !ausgeschlossen(b));
/* Erkannt wird auch das alte Häkchen, damit es beim nächsten Lauf verschwindet —
   vorn wie hinten, denn bis v0.25 stand die Markierung am Ende. \uFE0F gehört in
   die Liste: ✔️ war nie ein Zeichen, sondern zwei — U+2714 plus ein unsichtbarer
   Variantenwähler, der sonst im Namen hängen bliebe. */
const HAKEN_ZEICHEN = '\\u2705\\u2714\\u2713\\uFE0F\\u{1F7E2}';
/* Entfernt wird überall, nicht nur am Rand. Fahrzeugnamen tragen den
   Wachennamen in sich — „MZB #I - WasRet 3 ✔️ - Sasha“ —, und dieses ✔️ in der
   Mitte ist die alte Markierung derselben Wache. Bliebe sie stehen, hinge sie
   für immer im Fahrzeugnamen, während die Wache längst umbenannt ist. */
const HAKEN_ALLE = new RegExp(`[${HAKEN_ZEICHEN}]+\\s*`, 'gu');
/* ── Schutz für Fertiges ──────────────────────────────────────────────
   Was den Punkt trägt, ist erklärtermaßen fertig — daran soll das Skript
   nicht mehr rühren, bis es ausdrücklich freigegeben wird. Der Schalter
   dafür sitzt in der Kopfzeile und fällt bei jedem Reiterwechsel zurück,
   wie „Nur Vorschau“ auch: Freigabe gilt für einen Handgriff, nicht für
   den Rest des Abends.

   Geschützt heißt: nichts wegnehmen. Nicht umbenennen, nicht verkaufen,
   nicht ab- oder ankoppeln, kein Personal abziehen, keine Wache oder
   Erweiterung abschalten. Hinzufügen bleibt erlaubt — werben, ausbilden,
   freie Sitze auffüllen —, denn davon verliert niemand etwas.
   ─────────────────────────────────────────────────────────────────── */
const geschuetzt = o => !S.opts.gruenFrei && hatHaken(o?.caption || '');
let uebergangen = 0;                          // je Lauf gezählt, am Ende gemeldet
const schutzZaehlen = () => { uebergangen++; };
function schutzMelden() {
  if (!uebergangen) return;
  log(`${uebergangen}x übergangen, weil grün markiert — `
    + `zum Ändern in der Kopfzeile „Grüne freigeben“ ankreuzen`, 'warn');
  uebergangen = 0;
}

const ohneHaken = t => String(t)
  .replace(HAKEN_ALLE, '')
  .replace(/\s{2,}/g, ' ')          // wo die Markierung stand, bleibt sonst eine Lücke
  .trim();
const hatHaken  = t => { HAKEN_ALLE.lastIndex = 0; return HAKEN_ALLE.test(String(t)); };

/* Wie eine Wache umbenannt wird, steht in ihrem Bearbeiten-Formular.
   Einmal nachsehen genügt, danach gilt der Weg für alle. */
let umbenennWeg = null;
async function umbenennen(b, name, dry) {
  if (dry) return true;
  if (!umbenennWeg) {
    const html = await getText(`/buildings/${b.id}/edit`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    /* Das Spiel nennt das Feld bei Wachen `building[name]`, bei Fahrzeugen
       dagegen `vehicle[caption]`. Auf `[caption]` allein zu suchen ging an
       jeder Wache vorbei — der Fehler lautete dann „Formular nicht gefunden“,
       obwohl das Formular dastand. */
    const feld = doc.querySelector('#building_name, input[name="building[name]"], '
      + 'input[name$="[caption]"], input[name$="[name]"]');
    const form = feld?.closest('form');
    if (!feld || !form) throw new Error('Namensfeld im Bearbeiten-Formular nicht gefunden');
    umbenennWeg = {
      feld: feld.getAttribute('name'),
      methode: form.querySelector('input[name="_method"]')?.value || null
    };
  }
  const felder = { [umbenennWeg.feld]: name };
  if (umbenennWeg.methode) felder._method = umbenennWeg.methode;
  await postForm(`/buildings/${b.id}`, felder);
  b.caption = name;
  merkeAenderung();
  return true;
}

/* Fahrzeuge umbenennen: Das Bearbeiten-Formular mitsamt seinen übrigen
   Feldern übernehmen, damit nichts anderes verlorengeht. */
async function umbenennenFahrzeug(v, name, dry) {
  if (dry) return true;
  const html = await getText(`/vehicles/${v.id}/edit`);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const feld = doc.querySelector('#vehicle_caption, input[name="vehicle[caption]"]');
  if (!feld) throw new Error('Namensfeld nicht gefunden');
  const felder = { _method: 'patch', 'vehicle[caption]': name };
  // Vorhandene Werte mitschicken, sonst setzt das Spiel sie zurück
  doc.querySelectorAll('form input[name^="vehicle["], form select[name^="vehicle["]').forEach(e => {
    const n2 = e.getAttribute('name');
    if (n2 === 'vehicle[caption]') return;
    if (e.type === 'checkbox' || e.type === 'radio') { if (e.checked) felder[n2] = e.value; return; }
    const wert = e.tagName === 'SELECT'
      ? (e.querySelector('option[selected]')?.value ?? '')
      : (e.getAttribute('value') ?? '');
    if (wert !== '') felder[n2] = wert;
  });
  await postForm(`/vehicles/${v.id}`, felder);
  v.caption = name;
  merkeAenderung();
  return true;
}

/** Alle Personenzuweisungen einer Wache lösen. Nur eine Wache je Lauf —
    ein Versehen soll nicht die halbe Leitstelle leerräumen. */
async function zuweisungenLoeschen(sel, dry) {
  if (sel.length !== 1) {
    log('Aus Sicherheitsgründen nur eine Wache auf einmal. Bitte genau eine auswählen.', 'err');
    return 0;
  }
  const b = sel[0];
  const roster = await readRoster(b);
  if (!roster) { log(`${b.caption}: keine Fahrzeuge`, 'warn'); return 0; }

  const eigene = new Set(mineOf(b).map(v => String(v.id)));
  const belegt = roster.people.filter(p => p.assignedTo && eigene.has(p.assignedTo));
  if (!belegt.length) { log(`${b.caption}: niemand zugewiesen`, 'good'); return 0; }

  if (!dry && !await frage(`Wirklich alle ${belegt.length} Zuweisungen auf „${b.caption}" lösen?`,
      'leeren')) return 0;

  let n = 0;
  for (const p of belegt) {
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }
    log(`${b.caption}: ${p.name} von Fahrzeug ${p.assignedTo} lösen`);
    // Derselbe Aufruf wie beim Zuweisen — er schaltet um
    if (!dry) await postForm(`/vehicles/${p.assignedTo}/zuweisungDo/${p.id}`);
    n++;
  }
  return n;
}

/** Setzt oder entfernt das Häkchen je nach Fortschritt. */
async function hakenAbgleichen(sel, dry) {
  let n = 0, unklar = 0, i = 0;
  for (const b of sel) {
    schritt(i++, sel.length, b.caption);
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }

    /* Fahrzeuge zuerst: voll besetzt heißt Haken. Ob die Besatzung auch
       den nötigen Lehrgang hat, verrät nur die Zuweisungsseite — ein
       Abruf je Wache, derselbe wie beim Personallauf. */
    let roster = null;
    try { roster = await readRoster(b); } catch { /* dann eben ohne */ }
    if (roster) {
      const eigene = new Map(mineOf(b).map(v => [String(v.id), v]));
      /* Je Fahrzeug die Lehrgänge seiner Leute sammeln. Vorher wurde hier
         schon gefiltert und nur noch gezählt — damit ging verloren, WER was
         kann, und `mind` ließ sich gar nicht mehr prüfen. */
      const besatzung = new Map();
      for (const p of roster.people) {
        if (!p.assignedTo || !eigene.has(p.assignedTo)) continue;
        const v = eigene.get(p.assignedTo);
        // „In Ausbildung“ zählt hier wie fertig — nur der FMS-Status wartet.
        const kann = new Set([...p.quals, ...(p.inAusbildung || [])]);
        if (!besatzung.has(v.id)) besatzung.set(v.id, []);
        besatzung.get(v.id).push(kann);
      }
      /* Der Haken gilt ab Mindestbesetzung, nicht ab vollem Fahrzeug. */
      const fertig = new Map(), mangel = new Map();
      for (const v of echteVon(b)) {
        const meta = T.veh(v.vehicle_type);
        if (!meta || !meta.max) continue;
        const fehlt = fehltAn(v, besatzung.get(v.id) || []);
        mangel.set(v.id, fehlt);
        fertig.set(v.id, !fehlt);
      }
      const ohnePunkt = [];
      for (const v of echteVon(b)) {
        const meta = T.veh(v.vehicle_type);
        if (!meta) continue;
        /* Ein Anhänger hat keine Sitze und kann deshalb nie „besetzt“ sein.
           Fertig ist er, wenn er an einem Zugfahrzeug hängt, das seine
           Mindestbesetzung hat — dort sitzen ja auch seine Leute. */
        const voll = meta.max
          ? fertig.get(v.id)
          : !!v.zugfahrzeug && fertig.get(v.zugfahrzeug) === true;

        if (!voll) {
          /* Ohne Begründung ist eine fehlende Markierung nicht von einem
             übersehenen Fahrzeug zu unterscheiden. Beides sieht gleich aus:
             nichts passiert. */
          const zug = v.zugfahrzeug && mineOf(b).find(x => x.id === v.zugfahrzeug);
          ohnePunkt.push(`${ohneHaken(v.caption)}: ` + (!meta.max
            ? (!v.zugfahrzeug ? 'kein Zugfahrzeug'
               : `${zug ? ohneHaken(zug.caption) : 'Zugfahrzeug'} hat keine Mindestbesetzung`)
            : (mangel.get(v.id) || 'nicht besetzbar')));
        }

        const kern = ohneHaken(v.caption);
        const soll = voll ? `${HAKEN} ${kern}` : kern;
        if (soll === v.caption) continue;
        // Den Punkt wegzunehmen ist auch ein Eingriff — gerade der, der zählt
        if (geschuetzt(v)) { schutzZaehlen(); continue; }
        log(`   ${v.caption} → ${soll}`, voll ? 'good' : '');
        try { await umbenennenFahrzeug(v, soll, dry); n++; }
        catch (e) { log(`      fehlgeschlagen: ${e.message}`, 'err'); }
      }
      if (ohnePunkt.length) {
        // Lang genug zum Nachsehen, kurz genug zum Lesen
        ohnePunkt.slice(0, 6).forEach(t => log(`   ohne Punkt — ${t}`));
        if (ohnePunkt.length > 6) log(`   … und ${ohnePunkt.length - 6} weitere`);
      }
    }

    const f = fortschritt(b);
    if (f.unklar) {                                 // kein Urteil ohne Zahlen
      unklar++;
      /* Zwei ganz verschiedene Gründe, früher unter einer Meldung: der
         Ausbildungsstand fehlt, oder der Bestand kennt die Besatzung eines
         Fahrzeugs nicht. Wer das nicht auseinanderhält, erfasst zum dritten
         Mal den Ausbildungsstand und wundert sich. */
      log(`${b.caption}: nicht beurteilbar — ${f.lehrgangUnklar
        ? 'Ausbildungsstand dieser Wache nicht erfasst'
        : `${f.personalUnklar} Fahrzeuge ohne bekannte Besatzung, „Bestand neu laden“ hilft`}`, 'warn');
      continue;
    }
    const kern = ohneHaken(b.caption);
    const soll = f.fertig ? `${HAKEN} ${kern}` : kern;
    if (!f.fertig) {
      const t = [];
      if (f.ausbau)    t.push(`${f.ausbau} Ausbauten`);
      if (f.kauf)      t.push(`${f.kauf} Fahrzeuge`);
      if (f.weg)       t.push(`${f.weg} überzählig`);
      if (f.personal)  t.push(`${f.personal} unterbesetzt`);
      if (f.anhaenger) t.push(`${f.anhaenger} ohne Zugfahrzeug`);
      if (f.lehrgang)  t.push(`${f.lehrgang} Ausbildungen`);
      log(`${b.caption}: kein Punkt — offen sind ${t.join(', ') || 'unbekannte Posten'}`);
    }
    if (soll === b.caption) continue;
    if (geschuetzt(b)) { schutzZaehlen(); continue; }
    log(`${b.caption} → ${soll}`, f.fertig ? 'good' : '');
    try { await umbenennen(b, soll, dry); n++; }
    catch (e) { log(`   fehlgeschlagen: ${e.message}`, 'err'); break; }
  }
  if (unklar) log(`${unklar} Wachen übersprungen — Gründe siehe oben.`, 'warn');
  schutzMelden();
  return n;
}


/* ═══════════════════════════════════════════════════════════════════
   Personalplanung
   Erst wird im Kopf verteilt, dann erst wird gehandelt. Zwei Formen von
   Anforderung: „alle“ heißt, jede zugewiesene Person braucht den Kurs;
   „min n“ heißt, n der Zugewiesenen brauchen ihn.
   ═══════════════════════════════════════════════════════════════════ */

/** Anhänger, die an diesem Fahrzeug hängen. */
const anhaengerAn = v => (S.byBuilding.get(v.building_id) || [])
  .filter(a => a.zugfahrzeug === v.id && (T.veh(a.vehicle_type)?.max || 0) === 0);

/** Was ein Fahrzeug samt Anhängern an Personal und Kursen verlangt. */
function anforderung(v) {
  const meta = T.veh(v.vehicle_type) || {};
  const alle = new Set(), mind = new Map();
  /* amZug = die Anforderung stammt von einem Anhänger. Dann gilt sie nur für
     so viele Plätze, wie der Anhänger an der Einsatzstelle verlangt — der
     Rest der Besatzung des Zugfahrzeugs braucht den Kurs nicht. */
  const merken = (m, amZug) => {
    const fordere = (key, n) => mind.set(key, Math.max(mind.get(key) || 0, n));
    for (const k of (m.kurse || [])) {
      // n = 0 heißt: die Zahl steht in est (Dekon-P, Pferdetransport)
      let n = k.n || m.est || 0;
      /* est ist eine Forderung der Einsatzstelle, nicht der Sitzreihe. Beim
         Pferdetransporter groß sind es vier Reiter auf zwei Sitzen — die
         anderen beiden kommen mit einem zweiten Fahrzeug. Was hier zählt,
         ist also höchstens die eigene Sitzzahl; sonst gilt ein Fahrzeug für
         immer als unbesetzbar, das im Spiel längst ausrückt. */
      /* Auch die Forderung des Anhängers gilt der Einsatzstelle, nicht der
         Sitzreihe des Zugfahrzeugs: der AB-Dekon-P will sechs Leute, das WLF
         hat drei Sitze — die anderen drei kommen mit einem zweiten Fahrzeug.
         Gedeckelt wird deshalb in beiden Richtungen. */
      if (meta.max) n = Math.min(n, meta.max);
      if (k.art === 'alle') {
        if (amZug) fordere(k.k, Math.min(m.est || 0, meta.max || 0));
        else alle.add(k.k);
      } else fordere(k.k, n);
    }
  };
  merken(meta, false);
  // Anhänger bringen Anforderung und Sitzbedarf auf das Zugfahrzeug
  let anhEst = 0;
  for (const a of anhaengerAn(v)) {
    const am = T.veh(a.vehicle_type) || {};
    merken(am, true);
    anhEst += am.est || am.min || 0;
  }
  /* Die vier Leute für das Boot sind die Besatzung, nicht zusätzlich zu ihr —
     einer davon fährt. Deshalb das Größere von beidem, nicht die Summe. Und
     nie mehr, als Sitze da sind: was nicht mitfährt, kommt mit einem zweiten
     Fahrzeug. Welche Lehrgänge diese Plätze brauchen, steht in `mind`. */
  anhEst = Math.min(anhEst, meta.max ?? 0);
  return { min: Math.max(meta.min ?? 0, anhEst), max: meta.max ?? 0,
           alle: [...alle], mind, anhEst };
}

/* ── Besetzung ────────────────────────────────────────────────────────
   Der Planer rechnet mit Lehrgängen, das Spiel arbeitet mit Personen. Wer
   dieselben Lehrgänge hat, ist für jedes Fahrzeug derselbe Mensch — nur der
   Name unterscheidet sich, und jeder Namenswechsel kostet zwei Anfragen.
   Deshalb werden die Leute einer Wache zuerst in Spalten gelegt, eine je
   vorkommender Kombination, und danach wird spaltenweise besetzt. Wer schon
   auf dem Fahrzeug sitzt, wird aus seiner Spalte zuerst genommen — damit
   entsteht der Namenswechsel gar nicht erst.

   Nur Lehrgänge, die diese Wache irgendwo verlangt, bilden Spalten. Ein
   Notarzt an einer Feuerwache steht in derselben Spalte wie ein Ungelernter,
   weil ihn hier niemand braucht.
   ─────────────────────────────────────────────────────────────────── */

function tabelleBauen(leute, gebraucht) {
  const spalten = new Map();
  for (const p of leute) {
    const kurse = [...p.kann].filter(k => gebraucht.has(k)).sort();
    // „~“ heißt: läuft noch. Zählt fürs Zuweisen, zwingt das Fahrzeug aber
    // auf Status 6 — deshalb eine eigene Spalte, nicht dieselbe.
    const marke = kurse.map(k => p.nurLernend.has(k) ? k + '~' : k).join('+') || '—';
    if (!spalten.has(marke)) spalten.set(marke, {
      marke,
      kurse: new Set(kurse),
      lernend: new Set(kurse.filter(k => p.nurLernend.has(k))),
      leute: []
    });
    spalten.get(marke).leute.push(p);
  }
  return spalten;
}

/* Innerhalb einer Spalte sind alle gleichwertig, also entscheidet allein,
   was die Zuweisung kostet: wer schon draufsitzt (nichts), wer nirgends
   sitzt (eine Anfrage), wer woanders sitzt (zwei — und nimmt es dem
   anderen Fahrzeug weg). */
function entnehmen(sp, v) {
  const rang = p => p.assignedTo === String(v.id) ? 0 : !p.assignedTo ? 1 : 2;
  let best = 0;
  for (let i = 1; i < sp.leute.length; i++)
    if (rang(sp.leute[i]) < rang(sp.leute[best])) best = i;
  return sp.leute.splice(best, 1)[0];
}
const zurueck = (sp, p) => { sp.leute.push(p); };

/** Sucht für ein Fahrzeug eine gültige Besatzung aus der Spaltentabelle.
    Gibt die Personen zurück oder null, wenn es nicht aufgeht. */
function besetze(v, tabelle, gebraucht) {
  const a = anforderung(v);
  if (!a.max) return { leute: [], anf: a };
  /* Ein Zugfahrzeug mit zu wenig Sitzen für seine Anhänger ist nicht
     besetzbar — der LKW 7 Lkr 19 tm hat 2 Sitze, seine Anhänger fordern 4. */
  if (a.min > a.max) return { leute: null, anf: a, zuEng: true };

  const eigen = new Set([...a.alle, ...a.mind.keys()]);
  // Was eine Spalte kostet: Lehrgänge, die anderswo an dieser Wache gebraucht
  // werden, hier aber brachliegen. Der einzige Notarzt gehört nicht aufs LF.
  const kosten = sp => [...sp.kurse].filter(k => gebraucht.has(k) && !eigen.has(k)).length;
  const strafe = sp => [...sp.lernend].filter(k => eigen.has(k)).length;
  const sitztHier = sp => sp.leute.some(p => p.assignedTo === String(v.id)) ? 1 : 0;
  // „alle“-Auflagen schränken den Kreis der Spalten von vornherein ein
  const tauglich = [...tabelle.values()].filter(sp => a.alle.every(k => sp.kurse.has(k)));

  const gewaehlt = [];
  const rest = new Map(a.mind);
  const genommen = [];              // für den Rückweg: wer aus welcher Spalte
  let fehlend = null, knoten = 0;

  /* Auflagen decken, mit Rücknahme. Ohne die läuft man sich fest: deckt man
     die Notarzt-Auflage des ITW aus der Spalte „Notarzt“, fehlt danach die
     zweite Intensivpflege, obwohl die Spalte „Notarzt+Intensivpflege“ beides
     auf einem Sitz gebracht hätte. Bei einer Handvoll Spalten ist das
     Zurücknehmen billig — über hundert Einzelpersonen wäre es das nicht. */
  const suche = () => {
    if (++knoten > 500) return false;                    // Notbremse
    let ziel = null, wenigste = Infinity;
    for (const [k, n] of rest) {
      if (n <= 0) continue;
      // Die knappste Auflage zuerst — sie hat die wenigsten Ausweichspalten
      const da = tauglich.reduce((sum, sp) => sum + (sp.kurse.has(k) ? sp.leute.length : 0), 0);
      if (da < wenigste) { wenigste = da; ziel = k; }
    }
    if (!ziel) return true;
    if (gewaehlt.length >= a.max) { fehlend ??= ziel; return false; }

    const deckung = sp => [...rest].filter(([k, n]) => n > 0 && sp.kurse.has(k)).length;
    const kandidaten = tauglich
      .filter(sp => sp.kurse.has(ziel) && sp.leute.length)
      .sort((x, y) => kosten(x) - kosten(y)
                   || strafe(x) - strafe(y)
                   || deckung(y) - deckung(x)
                   || sitztHier(y) - sitztHier(x));
    if (!kandidaten.length) { fehlend ??= ziel; return false; }

    for (const sp of kandidaten) {
      const p = entnehmen(sp, v);
      gewaehlt.push(p); genommen.push([sp, p]);
      // Eine Person deckt alle Auflagen, die ihre Spalte trägt — genau davon
      // lebt die Doppelausbildung: ein Sitz, zwei erfüllte Zeilen.
      const ab = [...rest].filter(([k, n]) => n > 0 && sp.kurse.has(k)).map(([k]) => k);
      ab.forEach(k => rest.set(k, rest.get(k) - 1));
      if (suche()) return true;
      ab.forEach(k => rest.set(k, rest.get(k) + 1));
      genommen.pop(); gewaehlt.pop(); zurueck(sp, p);
    }
    return false;
  };

  const alleZurueck = () => { while (genommen.length) { const [sp, p] = genommen.pop(); zurueck(sp, p); } };

  if (!suche()) {
    alleZurueck();
    return { leute: null, anf: a, fehlend, offen: rest.get(fehlend) || 1 };
  }

  // Auf die Mindestbesatzung auffüllen — aus der billigsten Spalte zuerst
  while (gewaehlt.length < a.min) {
    const sp = tauglich.filter(x => x.leute.length)
      .sort((x, y) => kosten(x) - kosten(y) || strafe(x) - strafe(y) || sitztHier(y) - sitztHier(x))[0];
    if (!sp) break;
    const p = entnehmen(sp, v);
    gewaehlt.push(p); genommen.push([sp, p]);
  }
  if (gewaehlt.length < a.min) {
    const offen = a.min - gewaehlt.length;
    alleZurueck();
    return { leute: null, anf: a, fehlend: a.alle[0] || '__personal', offen };
  }
  return { leute: gewaehlt, anf: a };
}

/** Plant die gesamte Wache durch, ohne den Server zu berühren.
    Zwei Durchgänge: erst bekommt jedes Fahrzeug seine Mindestbesetzung,
    danach werden freie Sitze mit den Übriggebliebenen aufgefüllt. Die
    Reihenfolge ist der Punkt — wer zuerst auffüllt, nimmt einem anderen
    Fahrzeug die Leute weg, die es zum Ausrücken braucht. */
function planeWache(b, roster, vollBesetzen = S.opts.vollBesetzen !== false) {
  const leute = roster.people.map(p => ({
    ...p,
    kann: new Set([...p.quals, ...(p.inAusbildung || [])]),
    nurLernend: new Set(p.inAusbildung || [])
  }));

  /* Grüne Fahrzeuge werden nicht neu verteilt, sondern eingefroren: ihre
     Besatzung bleibt, wo sie ist, und steht dem Rest der Wache nicht mehr
     zur Verfügung. Freie Sitze dürfen später trotzdem aufgefüllt werden —
     hinzufügen nimmt niemandem etwas weg. */
  const fest = new Map();
  for (const v of echteVon(b)) {
    if (!geschuetzt(v) || !(T.veh(v.vehicle_type)?.max > 0)) continue;
    fest.set(v.id, leute.filter(p => p.assignedTo === String(v.id)));
  }
  const festeLeute = new Set([...fest.values()].flat());

  /* Reihenfolge: erst Fahrzeuge mit harten Auflagen, dann der Rest.
     Innerhalb dessen zuerst die, die schon einsatzbereit stehen — so
     landet ein Engpass bei einem ohnehin abgestellten Fahrzeug. */
  const fahrzeuge = echteVon(b)
    .filter(v => (T.veh(v.vehicle_type)?.max || 0) > 0 && !fest.has(v.id))
    .map(v => ({ v, a: anforderung(v) }))
    .sort((x, y) => {
      const hart = z => z.a.alle.length * 100 + z.a.mind.size * 10;
      // Wahrheitswerte ausdrücklich in Zahlen wandeln, statt sie stillschweigend
      // rechnen zu lassen — das liest sich als Absicht und nicht als Versehen.
      const abgestellt = z => z.v.fms_real === 6 ? 1 : 0;
      return (hart(y) - hart(x)) || (abgestellt(x) - abgestellt(y));
    });

  /* Jeder Lehrgang, den diese Wache irgendwo verlangt — auch auf Fahrzeugen,
     die gerade lahmen (die sollen beim nächsten Lauf wieder aufgehen) und auf
     den geschützten. Ließe man letztere weg, kennte die Wache deren Lehrgänge
     nicht mehr und könnte ihre freien Sitze nicht einmal auffüllen. */
  const gebraucht = new Set();
  for (const v of echteVon(b)) {
    if (!(T.veh(v.vehicle_type)?.max > 0)) continue;
    const a = anforderung(v);
    a.alle.forEach(k => gebraucht.add(k));
    a.mind.forEach((_, k) => gebraucht.add(k));
  }

  const tabelle = tabelleBauen(leute.filter(p => !festeLeute.has(p)), gebraucht);
  const zuweisung = new Map();     // vehicleId -> Personen
  const lahm = [];                 // nicht besetzbar
  const luecken = new Map();       // Kurs -> fehlende Anzahl

  for (const { v } of fahrzeuge) {
    const anh = anhaengerAn(v);
    if (anh.length > 1)
      log(`${b.caption}: ${v.caption} zieht ${anh.length} Anhänger `
        + `(${anh.map(x => x.caption).join(', ')}) — im Spiel ist einer möglich`, 'warn');
    const r = besetze(v, tabelle, gebraucht);
    if (!r.leute) {
      /* „Passt nicht“ allein hilft niemandem — die Rechnung dazu schon.
         Fast immer hängen zwei Anhänger an einem Zugfahrzeug, und dann sieht
         man es erst, wenn die Posten einzeln dastehen. */
      let grund = r.fehlend;
      if (r.zuEng) {
        const eigen = T.veh(v.vehicle_type)?.min ?? 0;
        const posten = anhaengerAn(v).map(x => {
          const am = T.veh(x.vehicle_type) || {};
          return `${am.est || am.min || 0} für ${x.caption}`;
        });
        grund = `braucht ${r.anf.min} Plätze (`
          + (posten.length ? `${posten.join(' + ')}; eigene Besatzung ${eigen} zählt mit`
                           : `${eigen} eigene`)
          + `), hat ${r.anf.max}`;
      }
      lahm.push({ v, grund, zuEng: !!r.zuEng });
      if (r.fehlend) luecken.set(r.fehlend, (luecken.get(r.fehlend) || 0) + (r.offen || 1));
      continue;
    }
    zuweisung.set(v.id, r.leute);
  }

  /* Zweiter Durchgang: freie Sitze auffüllen. Volle Fahrzeuge sind im Einsatz
     mehr wert, und wer hier sitzt, sitzt sonst gar nirgends. Aufgefüllt wird
     nur aus Spalten, die nichts kosten — Fachkräfte bleiben frei. */
  if (vollBesetzen) {
    const zumFuellen = [...fahrzeuge,
      ...[...fest.keys()].map(id => {
        const v = echteVon(b).find(x => x.id === id);
        return v ? { v, a: anforderung(v) } : null;
      }).filter(Boolean)];
    for (const { v, a } of zumFuellen) {
      const drauf = zuweisung.get(v.id) || fest.get(v.id);
      if (!drauf) continue;                        // lahm bleibt lahm und leer
      const eigen = new Set([...a.alle, ...a.mind.keys()]);
      const frei = [...tabelle.values()].filter(sp =>
        a.alle.every(k => sp.kurse.has(k)) &&
        ![...sp.kurse].some(k => gebraucht.has(k) && !eigen.has(k)));
      while (drauf.length < a.max) {
        const sp = frei.find(x => x.leute.length);
        if (!sp) break;
        drauf.push(entnehmen(sp, v));
      }
    }
  }

  /* Zum Schluss die eingefrorenen Besatzungen wieder in den Plan legen, damit
     der Abgleich sie als „steht schon richtig“ sieht und nichts anfaßt. */
  for (const [id, ps] of fest) {
    if (ps.length) uebergangen++;
    zuweisung.set(id, ps);
  }
  const uebrig = [...tabelle.values()].reduce((n, sp) => n + sp.leute.length, 0);
  return { zuweisung, lahm, luecken, leute, uebrig, spalten: tabelle.size, fest: fest.size };
}

/* ═══════════════════════════════════════════════════════════════════
   Einsatzbereitschaft: Fahrzeuge, Ausbauten, Wache
   ═══════════════════════════════════════════════════════════════════ */
const KEY_WARTE = 'lssplaner.fmsWarte';   // Umschaltungen, die auf Status 2 warten

const mineOf = b => S.byBuilding.get(b.id) || [];
/* Nur vorgemerkt, noch ohne echte Nummer im Spiel. Für Zählungen zählt es
   mit, für jede Anfrage ist es Gift: `/vehicles/-1787646232475/…` gibt 404. */
const istPlatzhalter = v => !!v?.platzhalter || Number(v?.id) < 0;
/** Fahrzeuge einer Wache, die der Server auch kennt. */
const echteVon = b => mineOf(b).filter(v => !istPlatzhalter(v));

/** Wie viele Personen ein Fahrzeug mindestens braucht, um ausrücken zu
    können — eigene Mindestbesatzung plus die Anforderung jedes fest
    gekoppelten Anhängers. */
/* Eine Quelle für den Bedarf: anforderung() rechnet die Anhänger bereits
   ein. Die frühere Fassung suchte sie über `tractive_vehicle_id` — ein Feld,
   das slimVehicle gar nicht behält, weshalb nie ein Anhänger gezählt wurde
   und Zugfahrzeuge zu früh auf Status 2 sprangen. */
function mindestBedarf(v) {
  return T.veh(v.vehicle_type) ? anforderung(v).min : 0;
}

/** Was dieser Besatzung zum Haken fehlt — leerer Text heißt: nichts.
    `besatzung` ist je Person die Menge ihrer Lehrgänge (fertige und laufende).

    Zwei Kanäle sind zu decken, und der Haken prüfte bisher nur den ersten:
    `alle` verlangt einen Lehrgang von JEDEM Sitz, `mind` verlangt eine Anzahl
    je Lehrgang. Ein Dekon-P mit einer ungelernten Person kam deshalb auf den
    Haken — `alle` ist dort leer, und gezählt wurden nur Köpfe —, während
    planeWache für dasselbe Fahrzeug 6× dekon_p verlangt. Der Punkt fror diesen
    falschen Zustand über geschuetzt() dann fest, und genau der Lauf, der die
    Besatzung richten würde, meldete „grüne Fahrzeuge unangetastet".

    Dieselbe Funktion liefert die Begründung, damit Haken und Meldung nicht
    wieder auseinanderlaufen können. */
function fehltAn(v, besatzung) {
  const a = anforderung(v);
  const min = mindestBedarf(v);
  if (besatzung.length < min) return `${besatzung.length} von ${min} Personen`;
  const ohne = a.alle.filter(k => !besatzung.every(kann => kann.has(k)));
  if (ohne.length) return `nicht alle haben ${ohne.map(k => kursNamen(k)[0] || k).join(', ')}`;
  for (const [k, noetig] of a.mind) {
    const da = besatzung.filter(kann => kann.has(k)).length;
    if (da < noetig) return `${da} von ${noetig} mit ${kursNamen(k)[0] || k}`;
  }
  return '';
}

/* Umschaltungen, die gerade nicht möglich waren, weil das Fahrzeug
   unterwegs ist. Werden beim nächsten Personallauf nachgeholt. */
const warte = store.get(KEY_WARTE, {});
const merkeWarte = (id, ziel) => { warte[id] = { ziel, seit: Date.now() }; store.set(KEY_WARTE, warte); };
const loescheWarte = id => { delete warte[id]; store.set(KEY_WARTE, warte); };

/** Setzt den FMS-Status. Nur aus Status 2 heraus möglich. */
async function setzeFms(v, ziel, dry) {
  if (v.fms_real !== 2 && ziel === 6) {
    /* Nur ein scharfer Lauf darf sich etwas vormerken. Stand das Merken
       außerhalb dieser Sperre, schrieb schon die Vorschau in `fmsWarte` —
       und der nächste scharfe Lauf holte die Umschaltung an einer Wache
       nach, die gar nicht ausgewählt war. */
    if (!dry) merkeWarte(v.id, ziel);
    log(`   ${v.caption}: steht auf Status ${v.fms_real} — Umschaltung ${dry ? 'wäre vorgemerkt' : 'vorgemerkt'}`, 'warn');
    return false;
  }
  log(`   ${v.caption}: Status ${v.fms_real} → ${ziel}`);
  if (!dry) {
    await getAction(`/vehicles/${v.id}/set_fms/${ziel}`);
    v.fms_real = v.fms_show = ziel;
    merkeAenderung();
    // Erledigt ist erst, was auch abgeschickt wurde — sonst löscht die
    // Vorschau eine Vormerkung, die nie ausgeführt wurde.
    loescheWarte(v.id);
  }
  return true;
}

/** Ausbauten und Wache nachziehen: Ist alles zugehörige einsatzbereit,
    darf auch der Ausbau an — sonst aus. Leere Stellplätze zählen nicht. */
async function pflegeAusbauten(b, dry) {
  // Eine grüne Wache abzuschalten wäre ein Eingriff in genau das, was fertig ist
  if (geschuetzt(b)) { schutzZaehlen(); return 0; }
  const mine = S.byBuilding.get(b.id) || [];
  const tgt = T.target(b);
  const pmap = tgt?.pools || {};
  const lay = T.layout(b.building_type);
  if (!lay?.pools?.length) return 0;

  // Fahrzeuge je Topf einsortieren
  const proTopf = new Map();
  const ersterTopf = lay.pools[0].key;
  for (const v of mine) {
    if (T.veh(v.vehicle_type)?.max === 0) continue;
    const k = pmap[v.vehicle_type] && lay.pools.some(p => p.key === pmap[v.vehicle_type])
            ? pmap[v.vehicle_type] : ersterTopf;
    if (!proTopf.has(k)) proTopf.set(k, []);
    proTopf.get(k).push(v);
  }

  const bereit = liste => liste.length > 0 && liste.every(v => v.fms_real !== 6);
  let n = 0;

  // Die Wache selbst hängt am Grundtopf
  const grund = lay.pools.find(p => p.from === 'level' || p.from === 'fixed');
  if (grund) {
    const soll = bereit(proTopf.get(grund.key) || []);
    /* Ein unbekannter Ist-Zustand ist kein Grund zu schalten. Der Endpunkt
       kippt nur, er setzt nicht — wer aus Unwissen kippt, trifft in der Hälfte
       der Fälle das Gegenteil und merkt es nie, weil danach der geglaubte Wert
       lokal steht. Lieber eine Lücke melden als eine Vermutung einsetzen. */
    if (typeof b.enabled !== 'boolean') {
      log(`   Wache ${b.caption}: Einsatzbereitschaft nicht bekannt — nicht angefaßt `
        + `(Bestand neu laden)`, 'warn');
    } else if (b.enabled !== soll && (proTopf.get(grund.key) || []).length) {
      log(`   Wache ${b.caption}: ${soll ? 'einsatzbereit' : 'nicht einsatzbereit'}`);
      if (!dry) { await getAction(`/buildings/${b.id}/active`); b.enabled = soll; merkeAenderung(); }
      n++;
    }
  }

  // Ausbauten: der Umschaltweg steht als Verweis auf der Wachenseite,
  // also von dort lesen statt den Index zu raten.
  const wechsel = [];
  for (const p of lay.pools) {
    if (p === grund || !p.from || p.from === 'level' || p.from === 'fixed') continue;
    const liste = proTopf.get(p.key) || [];
    if (!liste.length) continue;                       // leerer Stellplatz zählt nicht
    const soll = bereit(liste);
    for (const e of (b.extensions || [])) {
      if (e.caption !== p.from) continue;
      if ((e.enabled !== false) === soll) continue;
      wechsel.push({ e, soll });
    }
  }
  if (!wechsel.length) return n;

  const html = await getText(`/buildings/${b.id}`);
  for (const { e, soll } of wechsel) {
    const treffer = [...html.matchAll(/href="(\/buildings\/\d+\/extension_ready\/(\d+)\/\d+)"/g)]
      .find(m => Number(m[2]) === Number(e.type_id));
    if (!treffer) { log(`   ${b.caption}: Umschalter für „${e.caption}" nicht gefunden`, 'warn'); continue; }
    log(`   ${b.caption} · ${e.caption}: ${soll ? 'einsatzbereit' : 'nicht einsatzbereit'}`);
    if (!dry) { await postForm(treffer[1]); e.enabled = soll; merkeAenderung(); }
    n++;
  }
  return n;
}

/* ═══════════════════════════════════════════════════════════════════
   Aktionen
   ═══════════════════════════════════════════════════════════════════ */
async function buildExtensions(sel, dry) {
  let n = 0;
  for (const b of sel) {
    for (const e of analyse(b).extMissing) {
      for (let i = 0; i < Math.min(e.n, e.ids.length); i++) {
        const extId = e.ids[i];
        log(`${b.caption}: Ausbau „${e.caption}" (#${extId})`);
        if (!dry) { await postForm(`/buildings/${b.id}/extension/credits/${extId}?redirect_building_id=${b.id}`); ausbauDazu(b, e.caption, extId); }
        n++;
      }
    }
  }
  return n;
}

async function buyVehicles(sel, dry) {
  const streng = S.opts.strict !== false;   // Voreinstellung: nur bei fertigen Stellplätzen
  let n = 0, uebersprungen = 0, vertagt = 0;

  for (const b of sel) {
    const missing = analyse(b).vehMissing;
    if (!missing.length) continue;

    const stoerung = blockers(b);
    if (streng && stoerung.length) {
      log(`${b.caption}: übersprungen — ${stoerung.join('; ')}`, 'warn');
      uebersprungen++;
      continue;
    }
    if (stoerung.length) log(`${b.caption}: Hinweis — ${stoerung.join('; ')}`, 'warn');

    const { caps, bucket } = poolsOf(b);
    for (const v of missing) {
      const k = bucket(v.id), topf = caps[k];
      const frei = topf ? Math.max(0, topf.cap - topf.belegt) : 0;
      const kaufen = Math.min(v.n, frei);
      if (kaufen < v.n) {
        log(`${b.caption}: nur ${kaufen} von ${v.n} ${v.name} — `
          + `${topf ? topf.label : 'Stellplätze'} ${topf ? topf.belegt : '?'}/${topf ? topf.cap : '?'} belegt`, 'warn');
        vertagt += v.n - kaufen;
      }
      for (let i = 0; i < kaufen; i++) {
        log(`${b.caption}: kaufe ${v.name}`);
        if (!dry) { await getAction(`/buildings/${b.id}/vehicle/${b.id}/${v.id}/credits?building=${b.id}`); fahrzeugDazu(b, v.id, v.name); }
        if (topf) topf.belegt++;
        n++;
      }
    }
  }
  if (uebersprungen) log(`${uebersprungen} Wachen übersprungen — dort erst Ausbauten bauen oder Überzählige verkaufen.`, 'warn');
  if (vertagt) log(`${vertagt} Fahrzeuge nicht gekauft, weil kein Stellplatz frei ist.`, 'warn');
  return n;
}

async function sellSurplus(sel, dry) {
  let n = 0;
  for (const b of sel) {
    const a = analyse(b);
    const mine = S.byBuilding.get(b.id) || [];
    for (const s of a.vehSurplus) {
      const cands = mine.filter(v => String(v.vehicle_type) === String(s.id));
      let done = 0;
      for (const v of cands) {
        if (done >= s.n) break;
        if (istPlatzhalter(v)) continue;          // gibt es serverseitig noch gar nicht
        if (geschuetzt(v) || geschuetzt(b)) { schutzZaehlen(); continue; }
        if (v.fms_real !== 2) {                    // nur was auf der Wache steht
          a.blocked.push(`${v.caption} ist unterwegs (FMS ${v.fms_real})`);
          continue;
        }
        log(`${b.caption}: VERKAUFE ${s.name} „${v.caption}"`);
        if (!dry) { await postForm(`/vehicles/${v.id}`, { _method: 'delete' }); fahrzeugWeg(b, v.id); }
        done++; n++;
      }
      if (done < s.n) log(`  ${s.name}: ${s.n - done} nicht verkauft — Fahrzeuge nicht auf der Wache`, 'warn');
    }
  }
  schutzMelden();
  return n;
}

async function hire(sel, dry) {
  let n = 0;
  for (const b of sel) {
    const a = analyse(b);
    if (!a.hire) continue;
    log(`${b.caption}: 3 Tage werben (${a.staffIst}/${a.staffSoll})`);
    if (!dry) await getAction(`/buildings/${b.id}/hire_do/3`);
    n++;
  }
  return n;
}

/* Anhänger fest an ein Zugfahrzeug binden. Nutzt die Auswahl aus dem
   Bearbeiten-Formular, damit nur zulässige Zugfahrzeuge verwendet werden. */
async function linkTrailers(sel, dry) {
  let n = 0, gespart = 0, fortI = 0;
  for (const b of sel) {
    schritt(fortI++, sel.length, b.caption);
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }
    const mine = S.byBuilding.get(b.id) || [];
    const typVon = new Map(mine.map(v => [String(v.id), v.vehicle_type]));
    // Eine Nummer sagt nichts. Der Bestand kennt den Namen, also steht er da.
    const nameVon = id => (mine.find(v => String(v.id) === String(id))?.caption) || `Fahrzeug ${id}`;

    /* Ob ein Fahrzeug ein Anhänger ist, steht im Katalog (max 0). Früher
       fragte das Skript dafür jede Fahrzeugseite ab — hunderte Abrufe je
       Wache, deren Antwort fast immer „kein Anhänger“ lautete. */
    const anh = mine.filter(v => !istPlatzhalter(v))
      .filter(v => (T.veh(v.vehicle_type)?.max ?? 1) === 0)
      // Ein grüner Anhänger hängt richtig; umhängen wäre genau das Gegenteil
      .filter(v => { if (geschuetzt(v)) { schutzZaehlen(); return false; } return true; });
    gespart += mine.length - anh.length;
    if (!anh.length) continue;

    /* Erst alle lesen, dann verteilen. Andernfalls schnappt der erste
       Anhänger dem zweiten das Zugfahrzeug weg, an dem der schon hängt. */
    const stand = [];
    for (const v of anh) {
      if (abgebrochen()) { log('Abgebrochen.', 'warn'); return n; }
      const html = await getText(`/vehicles/${v.id}/edit`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const feld = doc.querySelector('#vehicle_tractive_vehicle_id');
      if (!feld) { log(`${b.caption}: ${v.caption} — kein Zugfahrzeug-Feld`, 'warn'); continue; }
      /* `zug` sagt nur, was das Spiel zuläßt — bei der MZB sind das GW-Taucher
         **und** GW-Wasserrettung. Erlaubt heißt aber nicht brauchbar: der
         GW-Taucher hat zwei Sitze, die MZB fordert vier Leute an der
         Einsatzstelle. So ein Gespann rückt nie aus. Also wird zusätzlich
         gerechnet, statt sich auf die Liste zu verlassen. */
      const am = T.veh(v.vehicle_type) || {};
      const anhKurse = new Set((am.kurse || []).map(k => k.k));
      const zugMeta = o => T.veh(typVon.get(String(o))) || {};
      const opts = [...feld.querySelectorAll('option')].map(o => o.value).filter(Boolean)
        .filter(o => !am.zug || am.zug.includes(typVon.get(String(o))))
        /* Ein grünes Zugfahrzeug bekommt nichts angehängt: ein Anhänger
           ändert seine Mindestbesetzung, und schon stimmt sein Punkt nicht
           mehr. Hängt der Anhänger bereits dort, bleibt es dabei. */
        .filter(o => String(o) === String(feld.querySelector('option[selected]')?.value || '')
                  || !geschuetzt(mine.find(z => String(z.id) === String(o))))
        /* Rangfolge statt Ausschluß: zuerst das Fahrzeug, das denselben
           Lehrgang ohnehin verlangt — dessen Besatzung bedient den Anhänger,
           ohne daß jemand zwei Lehrgänge braucht. Dann das mit mehr Sitzen.
           Ausgeschlossen wird niemand: der AB-Dekon-P verlangt sechs Leute an
           der Einsatzstelle und hängt am WLF mit drei Sitzen — im Spiel eine
           übliche Kombination, die Übrigen kommen mit einem zweiten Fahrzeug. */
        .sort((x, y) => teilt(y) - teilt(x) || (zugMeta(y).max || 0) - (zugMeta(x).max || 0));
      function teilt(o) {
        return (zugMeta(o).kurse || []).some(k => anhKurse.has(k.k)) ? 1 : 0;
      }
      if (!opts.length) {
        log(`${b.caption}: ${v.caption} — kein zugelassenes Zugfahrzeug vorhanden`, 'warn');
        continue;
      }
      stand.push({
        v, opts,
        cur: feld.querySelector('option[selected]')?.value || '',
        zufall: !!doc.querySelector('#vehicle_tractive_random')?.checked,
        name: doc.querySelector('#vehicle_caption')?.value || v.caption
      });
    }

    /* Ein Zugfahrzeug hält einen Anhänger. Vorher wurde jede bestehende
       Kopplung übernommen, ohne zu prüfen, ob sie schon vergeben ist — hingen
       zwei Boote am selben Fahrzeug, blieb es dabei, und das Gespann galt
       fortan als nicht besetzbar. Deshalb merkt sich `belegt` jetzt, wer das
       Zugfahrzeug hat, und der zweite bekommt ein eigenes. */
    const belegt = new Map();                              // Zugfahrzeug -> Anhänger
    const passt = x => x.cur && !x.zufall && x.opts.includes(x.cur);
    for (const x of stand) if (passt(x) && !belegt.has(x.cur)) belegt.set(x.cur, x);
    for (const x of stand) {
      if (belegt.get(x.cur) === x) continue;               // hängt schon richtig
      if (passt(x)) log(`${b.caption}: ${x.v.caption} hängt am selben Zugfahrzeug wie `
        + `${belegt.get(x.cur).v.caption} — wird umgehängt`, 'warn');
      /* Steht „Zufälliges Zugfahrzeug“ an, gilt die Kopplung als offen — auch
         wenn schon das richtige Fahrzeug eingetragen ist. Dann soll der
         Anhänger dort bleiben und nur der Haken fallen, statt grundlos an ein
         anderes Fahrzeug zu wandern. */
      const bleibt = x.cur && x.opts.includes(x.cur) && !belegt.has(x.cur);
      const frei = bleibt ? x.cur : x.opts.find(o => !belegt.has(o));
      if (!frei) { log(`${b.caption}: ${x.v.caption} — kein freies Zugfahrzeug`, 'warn'); continue; }
      belegt.set(frei, x);
      log(`${b.caption}: ${x.v.caption} → ${nameVon(frei)}`
        + (bleibt && x.zufall ? ' (hing schon dort, „zufälliges Zugfahrzeug“ wird abgewählt)' : ''));
      if (!dry) {
        await postForm(`/vehicles/${x.v.id}`, {
          _method: 'patch',
          'vehicle[caption]': x.name,
          // Das Ankreuzfeld „Zufälliges Zugfahrzeug“ abwählen — sonst sucht
          // sich das Spiel bei jedem Einsatz ein anderes und die feste
          // Zuordnung, auf der die Personalplanung rechnet, ist hinfällig
          'vehicle[tractive_random]': '0',
          'vehicle[tractive_vehicle_id]': frei
        });
        // Bestand gleich nachziehen: die Personalplanung läuft danach und
        // rechnet die Anhänger über genau dieses Feld ein.
        x.v.zugfahrzeug = Number(frei);
        merkeAenderung();
      }
      n++;
    }
  }
  if (gespart) log(`${gespart} Fahrzeuge übersprungen — laut Katalog keine Anhänger.`);
  schutzMelden();
  return n;
}

/* ── Personal ─────────────────────────────────────────────────────────
   Die Zuweisungsseite eines beliebigen Fahrzeugs listet das gesamte
   Personal der Wache samt Qualifikation und aktueller Bindung. Ein
   Abruf je Wache genügt also, danach nur noch gezielte POSTs.        */
async function readRoster(b) {
  const mine = S.byBuilding.get(b.id) || [];
  if (!mine.length) return null;
  const html = await getText(`/vehicles/${mine[0].id}/zuweisung`);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // interner Lehrgangs-Schlüssel → Klartext, aus dem Filter-Dropdown
  const courses = {};
  doc.querySelectorAll('select.education-filter option').forEach(o => {
    if (o.value && !['all', 'no-education'].includes(o.value)) courses[o.value] = o.textContent.trim();
  });
  /* Dieselbe Zuordnung, die sonst die Schulen liefern — hier fällt sie bei
     jedem Personallauf nebenbei ab, auch für Kurse, die keine eigene Schule
     anbietet. Davon leben die Klartextnamen im Katalog. */
  merkeKursNamen(courses);

  const people = [];
  doc.querySelectorAll('#personal_table tbody tr[id^="personal_"]').forEach(tr => {
    const id = tr.id.replace('personal_', '');
    let quals = [];
    // Steht dort kein gültiges JSON, hat die Person eben keine Lehrgänge —
    // ein Grund zu schweigen, aber keiner, es zu verschweigen.
    try { quals = JSON.parse(tr.dataset.filterableBy || '[]'); }
    catch { quals = []; }
    const link = tr.querySelector('td:last-child a[href^="/vehicles/"]:not([personal_id])');
    // Die Statusspalte nennt laufende Lehrgänge mit ihrem Schlüssel:
    // <span data-education-key="police_speaker_operator">Im Unterricht: …</span>
    const inAusbildung = [...tr.querySelectorAll('[data-education-key]')]
      .map(e => e.getAttribute('data-education-key')).filter(Boolean);
    people.push({
      id,
      name: tr.querySelector('td')?.textContent.trim() || '',
      quals,
      inAusbildung,
      assignedTo: link ? link.getAttribute('href').split('/')[2] : null
    });
  });
  /* Die Zuweisungsseite nennt je Person den laufenden Lehrgang. Bisher diente
     das nur der Planung — für die Kursauswahl kam die Zahl allein von der
     Lehrgangsseite, und die kennt jeweils nur den einen Kurs, den man gerade
     ansieht. Deshalb stand in der Auswahl fast überall „0 laufen“, obwohl an
     den Wachen Dutzende in Ausbildung waren. Hier fällt die Zahl für **alle**
     Kurse nebenbei ab, bei jedem Personallauf. */
  const proKurs = {};
  for (const p of people) for (const k of p.inAusbildung) proKurs[k] = (proKurs[k] || 0) + 1;
  setzeInAusbildung(b.id, proKurs);

  /* Und hier fällt auch der Ausbildungsstand ab. Diese Seite führt **jede**
     Person der Wache mit ihren Lehrgängen (`data-filterable-by`) — die
     Schulauswahl `schooling_personal_select`, aus der die Zahlen bisher kamen,
     offenbar nicht: an Wachen, deren Ausgebildete alle auf ihren Fahrzeugen
     saßen, meldete sie null. Wer nur einen Lehrgang hat, kann durch keine
     Verteilung verlorengehen — also lag es an der Quelle, nicht an D-46. */
  zaehleAus(b.id, people.map(p => ({ id: p.id, kurse: p.quals })));

  return { people, courses };
}

async function assignStaff(sel, dry) {
  let n = 0, unterwegs = 0;
  const ueberzaehlig = [];

  /* Vorgemerkte Umschaltungen nachholen, sofern das Fahrzeug daheim ist —
     aber nur an den Wachen, die für diesen Lauf gewählt sind. Ohne diese
     Schranke arbeitete ein Lauf über Wache B die Vormerkungen von Wache A
     mit ab, und der Mensch sah eine Änderung an einer Wache, die er gar
     nicht angehakt hatte. */
  const gewaehlteWachen = new Set(sel.map(b => String(b.id)));
  for (const [id, w] of Object.entries(warte)) {
    const v = S.vehicles.find(x => String(x.id) === String(id));
    if (!v) { loescheWarte(id); continue; }
    if (!gewaehlteWachen.has(String(v.building_id))) continue;
    if (v.fms_real !== 2) continue;
    log(`Nachgeholt: ${v.caption}`);
    if (await setzeFms(v, w.ziel, dry)) n++;
  }

  let fortI = 0;
  for (const b of sel) {
    schritt(fortI++, sel.length, b.caption);
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }
    const roster = await readRoster(b);
    if (!roster) { log(`${b.caption}: keine Fahrzeuge`, 'warn'); continue; }

    const plan = planeWache(b, roster);

    if (plan.lahm.length) {
      const text = [...plan.luecken.entries()]
        .map(([k, z]) => k === '__personal' ? `${z} Personen`
                       : `${z}x ${(learnedCourses()[k] || [k])[0]}`).join(', ');
      log(`${b.caption}: ${plan.lahm.length} Fahrzeuge nicht besetzbar`
        + (text ? ` — es fehlen ${text}` : ''), 'warn');
      plan.lahm.forEach(x => log(`   ${x.v.caption}: ${
        x.zuEng ? x.grund
        : x.grund === '__personal' ? 'zu wenig Personal an dieser Wache'
        : `zu wenig Personal mit ${(learnedCourses()[x.grund] || [x.grund])[0]}`}`, 'warn'));
    }

    if (plan.fest)
      log(`${b.caption}: ${plan.fest} grüne Fahrzeuge unangetastet — nur freie Sitze werden gefüllt`);
    if (S.opts.vollBesetzen === false)
      log(`${b.caption}: Auffüllen ist abgeschaltet — es bleibt bei der Mindestbesetzung`, 'warn');
    const vorgemerkt = mineOf(b).filter(istPlatzhalter).length;
    if (vorgemerkt)
      log(`${b.caption}: ${vorgemerkt} eben gekaufte Fahrzeuge übergangen — `
        + `ihre Nummer kennt der Planer erst nach „Bestand neu laden“`, 'warn');
    if (plan.uebrig) log(`${b.caption}: ${plan.uebrig} Personen ohne Fahrzeug`);

    // Ausführen: nur Abweichungen anfassen
    const istAuf = new Map();
    for (const p of roster.people) if (p.assignedTo) {
      if (!istAuf.has(p.assignedTo)) istAuf.set(p.assignedTo, []);
      istAuf.get(p.assignedTo).push(p);
    }

    const lahmIds = new Set(plan.lahm.map(x => String(x.v.id)));
    for (const v of mineOf(b)) {
      if ((T.veh(v.vehicle_type)?.max || 0) === 0) continue;
      const soll = lahmIds.has(String(v.id)) ? [] : (plan.zuweisung.get(v.id) || []);
      const ist  = istAuf.get(String(v.id)) || [];
      /* Mehr Personen als Sitze kann der Planer nicht verursachen — er bricht
         bei max ab. Steht es trotzdem so da, stimmen die Stammdaten für diesen
         Typ nicht, und das gehört gesagt statt still korrigiert. */
      const sitze = T.veh(v.vehicle_type)?.max || 0;
      if (ist.length > sitze)
        log(`${b.caption}: ${v.caption} — ${ist.length} Personen auf ${sitze} Sitzen `
          + `laut Stammdaten (Typ ${v.vehicle_type})`, 'warn');
      const sollIds = new Set(soll.map(p => p.id));
      const istIds  = new Set(ist.map(p => p.id));

      for (const p of ist) {
        if (sollIds.has(p.id)) continue;
        log(`${b.caption}: ${p.name} von ${v.caption} lösen`);
        if (!dry) await postForm(`/vehicles/${v.id}/zuweisungDo/${p.id}`);
        n++;
      }
      for (const p of soll) {
        if (istIds.has(p.id)) continue;
        if (p.assignedTo && p.assignedTo !== String(v.id)) {
          log(`${b.caption}: ${p.name} von Fahrzeug ${p.assignedTo} lösen`);
          if (!dry) await postForm(`/vehicles/${p.assignedTo}/zuweisungDo/${p.id}`);
          n++;
        }
        log(`${b.caption}: ${p.name} → ${v.caption}`);
        if (!dry) await postForm(`/vehicles/${v.id}/zuweisungDo/${p.id}`);
        n++;
      }
      /* Der Bestand kennt die Besatzungsstärke aus dem letzten Vollabruf. Wer
         direkt nach dem Personallauf die Haken setzt, urteilte sonst über
         Zahlen von vorhin — oder über gar keine, wenn das Fahrzeug neu ist. */
      if (!dry && v.besatzung !== soll.length) { v.besatzung = soll.length; merkeAenderung(); }
    }

    /* Status: lahme Fahrzeuge und solche, deren Besatzung den Kurs erst
       lernt, gehen auf 6. Der Rest kommt zurück auf 2. */
    for (const v of mineOf(b)) {
      if ((T.veh(v.vehicle_type)?.max || 0) === 0) continue;
      const soll = plan.zuweisung.get(v.id) || [];
      const lernend = soll.some(p => [...anforderung(v).alle, ...anforderung(v).mind.keys()]
        .some(k => p.nurLernend.has(k)));
      const ziel = (lahmIds.has(String(v.id)) || lernend) ? 6 : 2;
      if (v.fms_real === ziel) continue;
      if (v.fms_real !== 2 && v.fms_real !== 6) { unterwegs++; merkeWarte(v.id, ziel); continue; }
      if (await setzeFms(v, ziel, dry)) n++;
    }

    n += await pflegeAusbauten(b, dry);

    // Fahrzeuge, die der Plan nicht vorsieht und die stillstehen
    const tgt = T.target(b);
    for (const v of mineOf(b)) {
      if (!tgt?.vehicles?.[v.vehicle_type] && [2, 6].includes(v.fms_real))
        ueberzaehlig.push({ wache: b.caption, v });
    }
  }

  if (unterwegs) log(`${unterwegs} Fahrzeuge waren unterwegs — Umschaltung vorgemerkt.`, 'warn');
  schutzMelden();
  if (ueberzaehlig.length) {
    log('', '');
    log(`${ueberzaehlig.length} Fahrzeuge stehen, die der Plan nicht vorsieht:`, 'warn');
    ueberzaehlig.forEach(x => log(`   ${x.wache}: ${x.v.caption}`));
    log('Über den Reiter „Verkaufen" lassen sie sich abstoßen.', 'warn');
  }
  return n;
}

/* ═══════════════════════════════════════════════════════════════════
   Lehrgänge: Soll aus dem Plan, Ist aus den Zuweisungsseiten
   ═══════════════════════════════════════════════════════════════════ */

/* Ausgebildete je Wache. Die Personalauswahl einer Wache trägt auf jeder
   Checkbox sämtliche Qualifikationen als Attribute — ein Abruf liefert also
   den Bestand für alle Lehrgänge gleichzeitig. */
const quals = { by: {}, ts: null };
let qualsGeladen = false;
function reloadQuals(erzwingen = false) {
  if (qualsGeladen && !erzwingen) return;
  const c = store.get(KEY_QUAL, {});
  quals.by = c.by || {}; quals.ts = c.ts || null;
  qualsGeladen = true;
}
addEventListener('storage', e => {
  if (e.key === KEY_QUAL) reloadQuals(true);
  if (e.key === KEY_COURSE) kurseVergessen();
});
reloadQuals();

function saveQuals() {
  qualsGeladen = true;
  if (!store.set(KEY_QUAL, { ts: quals.ts, by: quals.by }))
    log('Ausbildungsstand konnte nicht gespeichert werden', 'warn');
}

/* ══════════════════════════════════════════════════════════════════
   Doppelausbildungen
   Ein Mensch sitzt in einem Fahrzeug. Wer Notarzt und Intensivpflege hat,
   deckt trotzdem nur einen der beiden Bedarfe — vorher zählte er in beiden
   Spalten mit, die Wache sah versorgt aus und war es nicht.
   Zwei Lehrgänge auf einem Sitz sind nur dann verlangt, wenn ein Fahrzeug
   sie gleichzeitig fordert: der ELW2 Drohne verlangt von jedem elw2 UND
   fire_drone, und ein Zugfahrzeug mit eigenem Lehrgang vererbt diesen an
   die Plätze, die sein Anhänger belegt.
   ══════════════════════════════════════════════════════════════════ */

/** Soll je Kursschlüssel für eine Wache. Bewusst großzügig: jeder geforderte
    Kurs bekommt die volle Besatzung, das schafft Reserve (siehe DECISIONS D-05). */
function bedarfKeys(b, feld = 'max') {
  return T.target(b) ? new Map(Object.entries(courseNeed(b, feld))) : null;
}

/** Kombinationen, die eine Wache auf ein und demselben Sitz braucht. */
function doppelKombis(b) {
  const marke = kurse => [...new Set(kurse)].sort().join('+');
  const ist = new Map(), soll = new Map();
  const buche = (m, kurse, n) => {
    const k = [...new Set(kurse)].sort();
    if (k.length < 2 || n <= 0) return;
    m.set(marke(k), { kurse: k, n: (m.get(marke(k))?.n || 0) + n });
  };

  // Was dasteht: hier ist auch bekannt, welcher Anhänger an welchem Zug hängt
  for (const v of (S.byBuilding.get(b.id) || [])) {
    const meta = T.veh(v.vehicle_type);
    if (!meta || !meta.max) continue;
    const a = anforderung(v);
    if (a.alle.length > 1) buche(ist, a.alle, a.max);
    if (a.alle.length) for (const [m, n] of a.mind) buche(ist, [...a.alle, m], n);
  }
  // Was geplant ist: Typen, die von sich aus zwei Lehrgänge auf jeden Sitz legen
  const tgt = T.target(b);
  for (const [id, n] of Object.entries(tgt?.vehicles || {})) {
    const meta = T.veh(id);
    const alle = (meta?.kurse || []).filter(k => k.art === 'alle').map(k => k.k);
    if (alle.length > 1) buche(soll, alle, sitzeFuerKurs(meta, 'max') * (Number(n) || 0));
  }

  const aus = new Map(ist);
  for (const [k, e] of soll) if (!aus.has(k) || aus.get(k).n < e.n) aus.set(k, e);
  return [...aus.values()];
}

/** Liest die Personalauswahl einer Wache und zählt je Kurs die Ausgebildeten. */
async function scanBuildingQuals(buildingId) {
  /* Die Zuweisungsseite ist die vollständige Quelle: sie nennt alle Personen
     der Wache, ihre fertigen Lehrgänge und die laufenden — in einem Abruf.
     `readRoster` schreibt beides selbst weg. Nur wenn eine Wache gar kein
     Fahrzeug hat, gibt es diese Seite nicht; dann bleibt die Schulauswahl,
     die zwar unvollständig ist, aber besser als nichts. */
  const b = S.byId.get(buildingId);
  if (b && (S.byBuilding.get(buildingId) || []).length) {
    await readRoster(b);
    return quals.by[buildingId];
  }
  await personalListe(buildingId);
  return quals.by[buildingId];
}

/** Erfasst den Ausbildungsstand mehrerer Wachen nacheinander — fertige
    Lehrgänge und laufende. */
async function scanQuals(buildings, onProgress) {
  let done = 0, pannen = 0;
  for (const b of buildings) {
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }
    try {
      quals.by[b.id] = await scanBuildingQuals(b.id);
      pannen = 0;
    } catch (e) {
      log(`${b.caption || b.id}: nicht lesbar (${e.message})`, 'warn');
      if (++pannen >= 3) { log('Drei Fehler in Folge — Abbruch.', 'err'); break; }
    }
    done++;
    if (onProgress) onProgress(done, buildings.length, b);
  }
  quals.ts = Date.now();
  saveQuals();
  return done;
}

/* Grundzuordnung aus dem Spiel. Gelernte Namen haben Vorrang, aber wenn
   eine Schule nicht lesbar war, greift wenigstens diese Liste. */
/* Klartextnamen aller Lehrgänge, die im Katalog vorkommen — aus einem echten
   Spielstand ausgelesen, nicht erfunden. Sie sind reine Beschriftung: gerechnet
   wird über die Schlüssel (D-09). Eingebaut sind sie, damit auch jemand ohne
   eigene Schulen und ohne das Recht, Lehrgänge zu eröffnen, lesbare Namen sieht.
   Was die Schulen später liefern, wird ergänzt und geht vor. */
const KURSE_FEST = {
  highway_police: "Autobahnpolizei", railway_fire: "Bahnrettung",
  // Seenotrettung, nachgetragen aus dem Kurskatalog des Spiels (Wiki + LSSM):
  coastal_rescue: "Seenotretter",
  coastal_helicopter: "Hubschrauberpilot (Seenotrettung)",
  coastal_helicopter_lift: "Windenoperator",
  emergency_paramedic_water_rescue: "Wasserrettungsausbildung für Notfallsanitäter",
  care_service: "Betreuungsdienst", police_firefighting: "Brandbekämpfung",
  dekon_p: "Dekon-P Lehrgang", police_service_group_leader: "Dienstgruppenleitung",
  fire_drone: "Drohnen-Schulung", seg_drone: "Drohnenoperator",
  mountain_command: "Einsatzleiter Bergrettung", elw2: "ELW 2 Lehrgang",
  thw_bridge_construction: "Fachgruppe Brückenbau",
  thw_energy_supply: "Fachgruppe Elektroversorgung",
  thw_rescue_dogs: "Fachgruppe Rettungshundeführer", thw_raumen: "Fachgruppe Räumen",
  heavy_rescue: "Fachgruppe Schwere Bergung",
  water_damage_pump: "Fachgruppe Wasserschaden/Pumpen",
  thw_command: "Fachzug Führung und Kommunikation",
  fire_care_service: "Feuerwehr-Verpflegungseinheit", fwk: "Feuerwehrkran Lehrgang",
  arff: "Flugfeldlöschfahrzeug-Ausbildung", gw_gefahrgut: "GW-Gefahrgut Lehrgang",
  gw_messtechnik: "GW-Messtechnik Lehrgang", gw_taucher: "GW-Taucher Lehrgang",
  gw_wasserrettung: "GW-Wasserrettung Lehrgang", k9: "Hundeführer (Schutzhund)",
  police_fukw: "Hundertschaftsführer (FüKW)", mountain_height_rescue: "Höhenretter",
  gw_hoehenrettung: "Höhenrettung Lehrgang", intensive_care: "Intensivpflege",
  thw_bridge_construction_crane: "Kranführer", criminal_investigation: "Kriminalpolizei",
  police_speaker_operator: "Lautsprecheroperator", lna: "LNA-Ausbildung",
  thw_care_service: "Logistik-Verpflegung", police_mek: "MEK",
  police_motorcycle: "Motorradstaffel", energy_supply: "NEA200 Fortbildung",
  notarzt: "Notarzt-Ausbildung", orgl: "OrgL-Ausbildung",
  polizeihubschrauber: "Polizeihubschrauber", police_horse: "Reiterstaffel",
  seg_rescue_dogs: "Rettungshundeführer", rettungstreppe: "Rettungstreppen-Ausbildung",
  seg_elw: "SEG - Einsatzleitung", seg_gw_san: "SEG - GW-San", police_sek: "SEK",
  disaster_response_technology: "Technik und Sicherheit",
  thw_drone: "Trupp Unbemannte Luftfahrtsysteme",
  care_service_equipment: "Verpflegungshelfer", police_wasserwerfer: "Wasserwerfer",
  wechsellader: "Wechsellader Lehrgang", werkfeuerwehr: "Werkfeuerwehr-Ausbildung",
  police_helicopter_lift: "Windenoperator", rescue_helicopter_lift: "Windenoperator",
  police_einsatzleiter: "Zugführer (leBefKw)", thw_zugtrupp: "Zugtrupp"
};

/* Ein interner Schlüssel kann mehrere Klartextnamen tragen: Die THW-Schule
   nennt gw_taucher „Fachgruppe Bergungstaucher“, die Feuerwehrschule
   „GW-Taucher Lehrgang“. Deshalb zwei Richtungen statt einer Zuordnung —
   Name → Schlüssel ist eindeutig, Schlüssel → Namen ist eine Liste. */
let _kurse = null;
function kursTabellen() {
  if (_kurse) return _kurse;
  const zuKey = {}, zuNamen = {};
  const eintragen = (key, cap) => {
    if (!key || !cap) return;
    zuKey[cap] = key;
    (zuNamen[key] ||= []);
    if (!zuNamen[key].includes(cap)) zuNamen[key].push(cap);
  };
  for (const [k, c] of Object.entries(KURSE_FEST)) eintragen(k, c);
  // Gespeichert wird key → Liste von Namen; ältere Fassungen legten nur
  // einen Namen ab, deshalb beides zulassen.
  for (const [k, v] of Object.entries(store.get(KEY_COURSE, {})))
    (Array.isArray(v) ? v : [v]).forEach(c => eintragen(k, c));
  return (_kurse = { zuKey, zuNamen });
}
const learnedCourses = () => kursTabellen().zuNamen;   // Schlüssel → Namen
const kursNamen = key => kursTabellen().zuNamen[key] || [];
const kurseVergessen = () => { _kurse = null; };

const istSchule = b => /schule|akademie|bundesschule|seefahrt/i
  .test((T.btName(b.building_type) || '') + ' ' + (b.caption || ''));

/* ── Welche Schule für welche Wache ─────────────────────────────────────
   Ein Lehrgang kann an mehreren Schulen angeboten werden — der
   Verpflegungshelfer bei Rettungsdienst, Feuerwehr und THW. Trotzdem darf
   jede Schule nur Personal aus ihrem eigenen Zweig ausbilden. Ohne diese
   Trennung meldet die Rettungsschule 225 Verpflegungshelfer, von denen die
   meisten in THW-Fahrzeugen sitzen sollen.

   Hergeleitet statt festgelegt: ein Lehrgang, den nur **eine** Schulart
   anbietet, verrät den Zweig. Die THW-Schule ist die einzige mit
   `thw_zugtrupp`, also gehört jede Wache, deren Fahrzeuge `thw_zugtrupp`
   verlangen, zu ihr. Über alle solchen Alleinstellungen abgestimmt, ergibt
   sich die Zuordnung von selbst. Erst wenn keine Schule gelesen wurde, greift
   die Tabelle unten.
   ─────────────────────────────────────────────────────────────────────── */
/* Schultyp → Gebäudearten, falls nichts gelesen wurde.
   Am Spiel nachgesehen (27.08.): die THW-Schule ist Gebäudeart **10** und
   fehlte hier ganz — fünf Verbands-THW-Schulen hatten also gar keine
   Ersatzzuordnung. Und die Wasserrettung (15) stand in keiner einzigen Liste,
   obwohl `gw_wasserrettung` nachweislich an der Rettungsschule läuft. Beides
   nachgetragen. */
const SCHULE_NOTFALLS = {
  1: [0], 3: [2, 5, 12, 15, 21, 25, 26, 28], 8: [6, 11, 13, 17, 29], 10: [9]
};

/** Gebäudearten, für die eine Schulart ausbilden darf. */
function zustaendigFuer(schulTyp) {
  const angebot = store.get(KEY_SCHULE, {});
  const meine = new Set(angebot[String(schulTyp)] || []);
  if (!meine.size) return new Set(SCHULE_NOTFALLS[schulTyp] || []);

  // Wie oft kommt ein Lehrgang im Angebot aller gelesenen Schulen vor?
  const wieOft = new Map();
  for (const keys of Object.values(angebot))
    for (const k of new Set(keys)) wieOft.set(k, (wieOft.get(k) || 0) + 1);

  const aus = new Set();
  for (const t of Object.keys(S.modell || {})) {
    const gefordert = new Set(Object.keys(courseNeedTyp(t)));
    if (!gefordert.size) continue;
    // Nur Lehrgänge zählen, die genau eine Schulart anbietet — die anderen
    // sagen über die Zugehörigkeit nichts aus.
    const allein = [...gefordert].filter(k => wieOft.get(k) === 1);
    if (!allein.length) continue;
    if (allein.every(k => meine.has(k))) aus.add(Number(t));
  }
  return aus;
}

/** Lehrgangsbedarf eines Gebäudetyps, unabhängig von einzelnen Wachen. */
function courseNeedTyp(t) {
  const out = {};
  for (const prof of Object.values(T.profiles(t))) {
    for (const [id, n] of Object.entries(prof.vehicles || {})) {
      const meta = T.veh(id);
      if (!meta?.kurse?.length || !(Number(n) > 0)) continue;
      for (const k of meta.kurse) out[k.k] = (out[k.k] || 0) + 1;
    }
  }
  return out;
}

/** Eigene Schulen aus dem Bestand. */
function schools() { return S.buildings.filter(istSchule); }

/** Eigene und Verbandsschulen. Vom Verband genügt je Schultyp eine — die
    Lehrgangsnamen sind für alle Schulen desselben Typs identisch. */
async function allSchools() {
  const eigene = schools();
  const gesehen = new Set(eigene.map(b => b.building_type));
  const aus = eigene.map(b => ({ ...b, verband: false }));
  try {
    const av = await apiGet('/api/alliance_buildings');
    for (const b of (Array.isArray(av) ? av : [])) {
      if (!istSchule(b) || gesehen.has(b.building_type)) continue;
      gesehen.add(b.building_type);
      aus.push({ id: b.id, caption: b.caption || ('Verbandsschule ' + b.id),
                 building_type: b.building_type, verband: true });
    }
  } catch (e) { log('Verbandsgebäude nicht lesbar: ' + e.message, 'warn'); }
  return aus;
}

/** Wo die Kursauswahl liegt, ist je nach Spielstand unterschiedlich.
    Deshalb der Reihe nach probieren, bis eine Seite das Auswahlfeld enthält. */
const EDU_PFADE = [
  id => `/buildings/${id}/education/new`,
  id => `/buildings/${id}/schooling`,
  id => `/buildings/${id}/education`,
  id => `/buildings/${id}`
];
// Der einmal gefundene Pfad gilt für alle Schulen des Accounts. Ohne diese
// Erinnerung klopft das Skript bei jedem Seitenaufbau vier Adressen ab.
let eduPfad = EDU_PFADE[store.get(KEY_EDUPFAD, -1)] || null;

async function holeKursauswahl(buildingId) {
  const reihe = eduPfad ? [eduPfad, ...EDU_PFADE.filter(f => f !== eduPfad)] : EDU_PFADE;
  const fehler = [];
  for (const f of reihe) {
    const url = f(buildingId);
    try {
      const html = await getText(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const sel = doc.querySelector('#education_select');
      if (sel && sel.querySelector('option[value*=":"]')) {
        eduPfad = f; store.set(KEY_EDUPFAD, EDU_PFADE.indexOf(f));
        return sel;
      }
      /* Der bekannte Pfad hat geantwortet, nur ohne Auswahlfeld. Dann liegt
         es an dieser Schule und nicht am Pfad — die übrigen Adressen
         durchzuprobieren kostet drei Abrufe und liefert dreimal 404. */
      if (f === eduPfad) throw new Error('kein Auswahlfeld auf der Seite — '
        + 'laufen dort gerade alle Lehrgänge? Dann bietet das Spiel keine Kursliste an.');
      fehler.push(`${url}: kein Auswahlfeld`);
    } catch (e) {
      if (f === eduPfad && !/HTTP/.test(e.message)) throw e;
      fehler.push(`${url}: ${e.message.replace(/^.*→ /, '')}`);
    }
  }
  throw new Error(fehler.join(' | '));
}

/** Nimmt Schlüssel → Klartext von einer beliebigen Seite auf. Ein Schlüssel
    darf mehrere Namen tragen, deshalb wird angehängt, nicht ersetzt. */
function merkeKursNamen(paare) {
  const map = store.get(KEY_COURSE, {});
  let n = 0;
  for (const [key, cap] of Object.entries(paare || {})) {
    if (!key || !cap) continue;
    const liste = Array.isArray(map[key]) ? map[key] : (map[key] ? [map[key]] : []);
    if (!liste.includes(cap)) { liste.push(cap); n++; }
    map[key] = liste;
  }
  if (n) { store.set(KEY_COURSE, map); kurseVergessen(); }
  return n;
}

/** Liest die Kursauswahl einer Schule und merkt sich Schlüssel → Klartext —
    und nebenbei, welche Lehrgänge diese Schulart überhaupt anbietet. Daraus
    ergibt sich später, für welche Wachen sie zuständig ist. */
async function learnFromSchool(buildingId, btyp) {
  const sel = await holeKursauswahl(buildingId);
  if (!sel) return 0;
  const paare = {}, keys = [];
  sel.querySelectorAll('option').forEach(o => {
    if (!o.value.includes(':')) return;
    const key = o.value.split(':')[0];
    keys.push(key);
    const cap = o.textContent.replace(/\s*\(\d+\s*Tage?\)\s*$/, '').trim();
    if (key && cap) paare[key] = cap;
  });
  if (btyp != null && keys.length) {
    const alle = store.get(KEY_SCHULE, {});
    alle[String(btyp)] = [...new Set(keys)];
    store.set(KEY_SCHULE, alle);
  }
  return merkeKursNamen(paare);
}

/* Verbandsschulen tragen die Kennzeichnung teils schon im Namen. */
const schulName = b => b.caption + (b.verband && !/\[Verband\]/.test(b.caption) ? ' [Verband]' : '');

/** Holt die Zuordnung von allen Schulen. Braucht keinerlei Zutun. */
/* Nicht jeder hat eigene Schulen — und wer im Verband keine Lehrgänge eröffnen
   darf, kommt an keine Kursliste. Für ihn müssen die Namen eingebaut sein; das
   Lesen ist nur noch Nachtrag für alles, was hier fehlt. */
async function learnAllCourses(onProgress = null) {
  const list = await allSchools();
  if (!list.length) { log('Keine Schule gefunden — weder eigene noch im Verband.', 'warn'); return 0; }
  let neu = 0, i = 0;
  let pannen = 0;
  for (const b of list) {
    if (abgebrochen()) { log('Abgebrochen.', 'warn'); break; }
    try {
      const vorher = Object.keys(learnedCourses()).length;
      neu += await learnFromSchool(b.id, b.building_type);
      const jetzt = Object.keys(learnedCourses()).length;
      log(`${schulName(b)}: ${jetzt - vorher} neue Lehrgangsnamen`
        + (eduPfad ? ` (${eduPfad(b.id)})` : ''), 'good');
      pannen = 0;               // „in Folge“ heißt in Folge
    }
    catch (e) {
      log(`${schulName(b)}: ${e.message}`, 'warn');
      if (++pannen >= 3) { log('Drei Fehler in Folge — Abbruch.', 'err'); break; }
    }
    i++;
    if (onProgress) onProgress(i, list.length, b);
  }
  return neu;
}

/** Soll je Lehrgang für eine Wache. Doppelausbildungen zählen für jeden
    geforderten Kurs voll — ein Sitz auf dem ELW2 Drohne braucht beides. */
/** Wie viele Sitze ein Fahrzeugtyp für seinen Lehrgang verlangt.
    Anhänger haben keine eigene Besatzung — ihre Ausbildung muss auf dem
    Zugfahrzeug sitzen, sonst rückt es nicht aus. Also zählt dort die an
    der Einsatzstelle geforderte Zahl. */
function sitzeFuerKurs(meta, feld = 'max') {
  const max = meta.max || 0;
  if (max > 0) return feld === 'min' ? (meta.min ?? max) : max;
  return meta.est || 0;
}

/* Ein Anhänger hat keine eigenen Sitze — seine Leute fahren auf dem
   Zugfahrzeug mit, dessen Plätze schon gezählt sind. Verlangt das Zugfahrzeug
   denselben Lehrgang, wäre der Anhänger eine zweite Rechnung für dieselben
   Köpfe: zwei GW-Wasserrettung (2 × 6) plus zwei MZB (2 × 4) ergäben 20
   Wasserretter, wo zwölf Sitze existieren.

   Bringt der Anhänger dagegen einen Lehrgang mit, den kein zugelassenes
   Zugfahrzeug des Plans fordert — WLF plus AB-MZB —, dann zählt er sehr wohl,
   sonst stünde für das Boot niemand. Welche Fahrzeuge ziehen dürfen, steht in
   den Stammdaten, das muß nicht geraten werden. */
function anhaengerZaehlt(meta, key, tgt) {
  if (!meta || meta.max > 0) return true;
  return !(meta.zug || []).some(z =>
    (Number(tgt?.vehicles?.[z]) || 0) > 0 && T.veh(z)?.kurse?.some(k => k.k === key));
}

function courseNeed(b, feld = 'max') {
  const mk = b.id + '|' + feld;
  const hit = memoK.get(mk);
  if (hit && hit.g === stand0) return hit.v;
  const v = courseNeedIntern(b, feld);
  memoK.set(mk, { g: stand0, v });
  return v;
}
function courseNeedIntern(b, feld) {
  const tgt = T.target(b), out = {};
  if (!tgt) return out;
  for (const [id, n] of Object.entries(tgt.vehicles || {})) {
    const meta = T.veh(id); if (!meta?.kurse?.length) continue;
    const seats = sitzeFuerKurs(meta, feld) * (Number(n) || 0);
    if (!seats) continue;
    for (const k of meta.kurse)
      if (anhaengerZaehlt(meta, k.k, tgt)) out[k.k] = (out[k.k] || 0) + seats;
  }
  return out;
}

/* Das Spiel nennt „N in Ausbildung“ nur für den gerade gewählten Kurs.
   Was einmal sichtbar war, wird deshalb gemerkt — mit Verfallsdatum, denn
   nach Kursende zählen die Leute als ausgebildet und dürfen nicht doppelt
   abgezogen werden. */
const inAus = store.get(KEY_INAUS, {});
let inAusSchmutzig = false;

function merkeInAusbildung(key, bid, n, tage) {
  const bis = Date.now() + Math.max(1, Number(tage) || 7) * 24 * 3600e3;
  const alt = (inAus[key] ||= {})[bid];
  if (alt && alt.n === n && Math.abs(alt.bis - bis) < 3600e3) return;
  inAus[key][bid] = { n, bis };
  inAusSchmutzig = true;
}
function sichereInAusbildung() {
  if (!inAusSchmutzig) return;
  const jetzt = Date.now();
  for (const [k, wachen] of Object.entries(inAus)) {
    for (const [bid, e] of Object.entries(wachen)) if (e.bis < jetzt) delete wachen[bid];
    if (!Object.keys(wachen).length) delete inAus[k];
  }
  store.set(KEY_INAUS, inAus);
  inAusSchmutzig = false;
}
/** Setzt die laufenden Ausbildungen einer Wache neu — was hier nicht steht,
    läuft dort auch nicht mehr. Ohne dieses Aufräumen bliebe ein abgeschlossener
    Lehrgang bis zum Verfallsdatum als „läuft noch“ stehen. */
function setzeInAusbildung(bid, proKurs, tage = 7) {
  for (const [key, wachen] of Object.entries(inAus)) {
    if (wachen[bid] != null && !(key in proKurs)) { delete wachen[bid]; inAusSchmutzig = true; }
  }
  for (const [key, n] of Object.entries(proKurs)) merkeInAusbildung(key, bid, n, tage);
  sichereInAusbildung();
}

/** Laufende Ausbildungen einer Wache für einen Kurs, sofern noch gültig. */
function laufendeAusbildung(key, bid) {
  const e = inAus[key]?.[bid];
  return e && e.bis > Date.now() ? e.n : 0;
}

/** Aggregiert Soll und Ist je Lehrgang über die gewählten Wachen. */
function courseTable(sel) {
  reloadQuals();                     // andere Fenster können erfasst haben
  const rows = {};
  const bedarfe = new Map();         // Wache -> Bedarf je Kurs, nur einmal rechnen
  for (const b of sel) bedarfe.set(b.id, courseNeed(b));

  for (const b of sel) {
    for (const [key, n] of Object.entries(bedarfe.get(b.id))) {
      rows[key] = rows[key] || {
        soll: 0, ist: 0, lauf: 0, fehlt: 0, ueber: 0,
        key, name: '', gemessen: 0, offen: 0, status: 'ok'
      };
      rows[key].soll += n;
    }
  }

  for (const [key, r] of Object.entries(rows)) {
    // Der Klartext ist nur noch Beschriftung. Fehlt er, rechnet es trotzdem.
    r.name = kursNamen(key)[0] || key;
    if (!r.soll) { r.status = 'anhaenger'; r.ist = null; continue; }

    // Wache für Wache rechnen. Personal ist an seine Wache gebunden, also
    // darf Überschuss an einem Ort einen Mangel an einem anderen nicht tilgen.
    for (const b of sel) {
      const soll = bedarfe.get(b.id)[key] || 0;
      if (!soll) continue;
      if (!quals.by[b.id]) { r.offen++; continue; }
      const ist = quals.by[b.id][r.key] || 0;
      const lauf = laufendeAusbildung(r.key, b.id);
      const vorhanden = ist + lauf;
      r.gemessen++;
      r.ist   += ist;
      r.lauf  += lauf;
      r.fehlt += Math.max(0, soll - vorhanden);
      r.ueber += Math.max(0, vorhanden - soll);
    }
    if (!r.gemessen) { r.status = 'nodata'; r.ist = null; }
    else if (r.offen) r.status = 'teil';
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════
   Oberfläche
   ═══════════════════════════════════════════════════════════════════ */
const css = `
/* Zwei Themen aus einer Palette. Dunkel ist die gewohnte Fassung, hell folgt
   dem Spiel: weißes Feld, LSS-Blau, dieselben Grautöne wie Bootstrap 3. Die
   Variablen hängen am Dokument, damit auch der Bestätigungsdialog mitzieht. */
:root{
 --lp-bg:#1b232c; --lp-fg:#e6ebf0; --lp-rand:#2e3a47; --lp-dim:#8b9aa9;
 --lp-dim2:#5d6c7b; --lp-feld:#141a21; --lp-hover:#232d38; --lp-akzent:#e0a33c;
 --lp-akzent-fg:#181206; --lp-ok:#4fb79b; --lp-err:#d8674f; --lp-log:#0e1319;
 --lp-log-fg:#c3d0dc; --lp-fokus:#6f8fb5;
}
html.lssp-hell{
 --lp-bg:#fff; --lp-fg:#333; --lp-rand:#ddd; --lp-dim:#777;
 --lp-dim2:#999; --lp-feld:#fff; --lp-hover:#f5f5f5; --lp-akzent:#337ab7;
 --lp-akzent-fg:#fff; --lp-ok:#3c763d; --lp-err:#a94442; --lp-log:#f7f7f7;
 --lp-log-fg:#444; --lp-fokus:#66afe9;
}
html.lssp-hell #lssp{box-shadow:0 6px 24px rgba(0,0,0,.25)}
html.lssp-hell #lssp nav button.on{color:#333}
#lssp-btn{position:fixed;right:16px;bottom:16px;z-index:99998;background:var(--lp-akzent);color:var(--lp-akzent-fg);
 border:0;border-radius:3px;padding:9px 15px;font:600 14px/1 sans-serif;cursor:pointer;letter-spacing:.05em}
#lssp{position:fixed;left:auto;top:auto;right:16px;bottom:60px;width:520px;max-height:78vh;z-index:99999;display:none;
 background:var(--lp-bg);color:var(--lp-fg);border:1px solid var(--lp-rand);border-radius:4px;
 font:13px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);flex-direction:column}
#lssp.on{display:flex}
#lssp.full{left:0!important;top:0!important;right:0!important;bottom:0!important;
 width:auto!important;height:auto!important;max-height:none;border-radius:0}
#lssp.full .body{max-height:none}
#lssp.drag{user-select:none;cursor:grabbing}
/* Scharf oder Vorschau war an einem Häkchen zu erkennen. Bei einem Werkzeug,
   das Fahrzeuge verkauft, gehört das an den Rahmen. */
#lssp.scharf{border-color:var(--lp-err);box-shadow:0 0 0 2px rgba(216,103,79,.3),0 12px 40px rgba(0,0,0,.6)}
#lssp.scharf header{background:rgba(216,103,79,.12)}
#lssp .scharfmarke{color:var(--lp-err);font:700 11px/1 sans-serif;letter-spacing:.08em;
 border:1px solid var(--lp-err);border-radius:3px;padding:3px 6px}
#lssp header{padding:10px 14px;border-bottom:1px solid var(--lp-rand);display:flex;align-items:center;gap:10px;
 cursor:grab;touch-action:none}
#lssp.full header{cursor:default}
#lssp header .ico{background:none;border:0;color:var(--lp-dim);font:600 15px/1 sans-serif;cursor:pointer;padding:3px 7px;border-radius:3px}
#lssp header .ico:hover{background:var(--lp-hover);color:var(--lp-fg)}
#lssp header b{font-size:15px;letter-spacing:.04em}
#lssp header .sp{flex:1}
#lssp nav{display:flex;border-bottom:1px solid var(--lp-rand);flex-wrap:wrap}
#lssp nav button{flex:1;min-width:80px;background:none;border:0;border-bottom:2px solid transparent;
 color:var(--lp-dim);padding:8px 4px;cursor:pointer;font:600 12px/1 sans-serif}
#lssp nav button.on{color:var(--lp-fg);border-bottom-color:var(--lp-akzent)}
#lssp .unter{display:flex;gap:6px;flex-wrap:wrap;padding:8px 14px 0}
#lssp .unter button{background:none;border:1px solid var(--lp-rand);border-radius:12px;
 color:var(--lp-dim);padding:4px 11px;cursor:pointer;font:600 12px/1 sans-serif}
#lssp .unter button.on{background:var(--lp-akzent);color:var(--lp-akzent-fg);border-color:var(--lp-akzent)}
#lssp #lssp-fort{position:relative;margin:8px 14px 0;height:20px;border:1px solid var(--lp-rand);
 border-radius:3px;background:var(--lp-feld);overflow:hidden}
#lssp #lssp-fort .balken{position:absolute;inset:0 auto 0 0;width:0;background:var(--lp-akzent);
 opacity:.35;transition:width .2s}
#lssp #lssp-fort .wort{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
 font:600 11px/1 sans-serif;color:var(--lp-fg)}
#lssp .einzel{border:1px solid var(--lp-akzent);border-radius:4px;padding:8px 10px;margin-bottom:10px}
#lssp .logkopf{display:flex;gap:6px;align-items:center;margin:10px 0 -4px}
#lssp .logkopf button{background:none;border:1px solid var(--lp-rand);border-radius:10px;
 color:var(--lp-dim);padding:2px 9px;cursor:pointer;font:600 11px/1 sans-serif}
#lssp .logkopf button.on{border-color:var(--lp-akzent);color:var(--lp-akzent)}
#lssp pre.nurwarn span:not(.warn):not(.err){display:none}
#lssp pre.nurerr span:not(.err){display:none}
#lssp .body{padding:12px 14px;overflow-y:auto;flex:1}
#lssp .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
/* Die Aktionsleiste klebt am unteren Rand: bei 102 Wachen war der
   Ausführen-Knopf sonst außer Sicht, sobald man in der Liste blätterte. */
#lssp .tun{position:sticky;bottom:-12px;margin:10px -14px -12px;padding:10px 14px;
 background:var(--lp-bg);border-top:1px solid var(--lp-rand);z-index:2}
/* Nur ein Rollbereich: der Inhalt selbst. Listen in Listen in Listen waren
   nicht zu bedienen — man rollte im falschen Kasten und fand die Aktionsleiste
   nicht wieder. Lieber einmal lang scrollen. */
#lssp .list{max-height:none;overflow:visible}
#lssp .body pre{max-height:none}
#lssp input[type=text],#lssp input:not([type]){font:12px sans-serif}
#lssp button.act{background:var(--lp-hover);color:var(--lp-fg);border:1px solid var(--lp-rand);border-radius:3px;
 padding:6px 12px;cursor:pointer;font:600 12px sans-serif}
#lssp button.act:hover{border-color:var(--lp-fokus)}
#lssp button.go{background:var(--lp-akzent);color:var(--lp-akzent-fg);border-color:var(--lp-akzent)}
#lssp button.danger{border-color:var(--lp-err);color:var(--lp-err)}
#lssp select,#lssp input[type=number]{background:var(--lp-feld);color:var(--lp-fg);border:1px solid var(--lp-rand);
 border-radius:3px;padding:5px 8px;font:12px monospace}
#lssp .list{border:1px solid var(--lp-rand);border-radius:3px}
#lssp .list label{display:flex;gap:8px;padding:4px 9px;border-bottom:1px solid rgba(46,58,71,.5);cursor:pointer}
#lssp .list label:last-child{border-bottom:0}
#lssp .list label:hover{background:var(--lp-hover)}
#lssp .list .gap{margin-left:auto;color:var(--lp-akzent);font:11px monospace}
#lssp .list .ok{margin-left:auto;color:var(--lp-ok);font:11px monospace}
#lssp pre{background:var(--lp-log);border:1px solid var(--lp-rand);border-radius:3px;padding:9px;margin:10px 0 0;
 font:11px/1.6 monospace;white-space:pre-wrap;color:var(--lp-log-fg)}
#lssp .warn{color:var(--lp-akzent)}#lssp .err{color:var(--lp-err)}#lssp .good{color:var(--lp-ok)}
#lssp .hint{color:var(--lp-dim);font-size:12px;margin:0 0 10px}
`;

let el, tab = 'ueber', lastCourses = null;
/* Welches einzelne Ding gerade betrachtet wird: eine Wache oder ein Lehrgang.
   Die Sammelliste beantwortet „was fehlt insgesamt“, diese Ansicht „woran
   liegt es hier“ — dieselben Zahlen, nur die andere Achse. */
let fokus = null;                      // { art: 'wache'|'kurs', id }
/* Was der Plan-Editor gerade zeigt. Bewusst nicht gespeichert: beim nächsten
   Öffnen steht man wieder beim ersten Typ, und das ist weniger verwirrend als
   ein Reiter, der sich an etwas erinnert, das man längst vergessen hat. */
let planTyp = null, planProfil = null;
/* Suchwort und Sortierung der Wachenliste. Sie stehen hier und nicht im DOM,
   weil jeder Lauf die Liste neu zeichnet — im Feld getippter Text wäre sonst
   nach der ersten Aktion weg. */
let suche = '', sortierung = 'offen';

/* Fensterzustand und kleine Vorlieben. Steht auf Modulebene, weil der
   Plan-Reiter sie ebenso braucht wie der Rahmen. */
const ui = store.get(KEY_UI, {});
const saveUi = () => store.set(KEY_UI, ui);

/* Elf Reiter nebeneinander brachen in zwei Zeilen um und mischten dabei
   Ebenen: „Übersicht“ ist eine Ansicht, „Lösen“ ein Eingriff. Jetzt oben die
   Sache, um die es geht, darunter der Handgriff. */
const GRUPPEN = [
  { id: 'ueber',      name: 'Übersicht',  tabs: ['ueber'] },
  { id: 'plan',       name: 'Plan',       tabs: ['plan'] },
  { id: 'bestand',    name: 'Bestand',    tabs: ['ausbau', 'kaufen', 'verkauf'] },
  { id: 'personal',   name: 'Personal',   tabs: ['personal', 'werben', 'anhaenger', 'leeren'] },
  { id: 'ausbildung', name: 'Ausbildung', tabs: ['lehrgang'] },
  { id: 'haken',      name: 'Namen',      tabs: ['haken'] }
];
const TABNAME = {
  ausbau: 'Ausbauten', kaufen: 'Kaufen', verkauf: 'Verkaufen',
  personal: 'Zuweisen', werben: 'Werben', anhaenger: 'Anhänger koppeln', leeren: 'Alles lösen'
};
const gruppeVon = t => GRUPPEN.find(g => g.tabs.includes(t)) || GRUPPEN[0];

/** Reiterwechsel: neue Absicht, also nichts gewählt und nur Vorschau. */
function wechsleAuf(t) {
  tab = t;
  auswahl.clear();
  fokus = null;
  suche = '';
  S.opts.dry = true;
  S.opts.gruenFrei = false;   // Freigabe gilt für einen Handgriff, nicht für den Reiter
  store.set(KEY_OPTS, S.opts);
  render();
}

/* ── Einzelansicht ────────────────────────────────────────────────────
   Die Listen beantworten „was fehlt insgesamt“. Ein Klick auf einen Namen
   dreht die Frage um: was fehlt *hier*, oder wo fehlt *das*. Vier Achsen —
   Wache, Fahrzeugtyp, Ausbau, Lehrgang — und eine gemeinsame Zeilenform,
   damit sie sich gleich lesen.
   ─────────────────────────────────────────────────────────────────── */
const dZeile = (name, rechts, art = '', verweis = '') =>
  `<label><span${verweis ? ` ${verweis} class="lupe"
    style="cursor:pointer;text-decoration:underline dotted"` : ''}>${esc(name)}</span><span class="${art}"
    style="margin-left:auto;text-align:right;min-width:110px">${esc(rechts)}</span></label>`;

const dListe = (zeilen, leer) => zeilen.length
  ? `<div class="list">${zeilen.join('')}</div>`
  : `<p class="hint">${esc(leer)}</p>`;

/* Eine Zeile je Lehrgang für eine Wache — oder je Wache für einen Lehrgang.
   Gerechnet wird beides aus denselben Quellen wie die Sammelliste, damit die
   Zahlen nicht auseinanderlaufen. */
function kursPosten(b, key) {
  const soll = courseNeed(b)[key] || 0;
  const erf  = quals.by[b.id];
  const ist  = erf ? (erf[key] || 0) : null;
  const lauf = laufendeAusbildung(key, b.id);
  return { soll, ist, lauf, fehlt: ist === null ? null : Math.max(0, soll - ist - lauf) };
}

function detailKurs(key) {
  const zeilen = planWachen().map(w => ({ w, p: kursPosten(w, key) })).filter(z => z.p.soll > 0);
  const summe = zeilen.reduce((a, z) => a + (z.p.fehlt || 0), 0);
  return `<div class="row" style="margin-bottom:2px;color:var(--lp-dim);font-size:11px">
      ${summe} fehlen auf ${zeilen.length} Wachen</div>`
    + dListe(zeilen.sort((x, y) => (y.p.fehlt || 0) - (x.p.fehlt || 0))
        .map(z => dZeile(ohneHaken(z.w.caption),
          z.p.fehlt === null ? 'nicht erfaßt'
            : `${z.p.ist} von ${z.p.soll}${z.p.lauf ? ` (+${z.p.lauf})` : ''}${
                z.p.fehlt ? ` — ${z.p.fehlt} fehlen` : ''}`,
          z.p.fehlt === null ? 'warn' : z.p.fehlt ? 'gap' : 'ok', `data-wache="${z.w.id}"`)),
      'Keine Wache im Plan verlangt diesen Lehrgang.');
}

function detailWache(b) {
  const a = analyse(b), f = fortschritt(b);
  const kurse = Object.entries(courseNeed(b)).map(([key, soll]) => {
    const erf = quals.by[b.id];
    const ist = erf ? (erf[key] || 0) : null;
    const lauf = laufendeAusbildung(key, b.id);
    const fehlt = ist === null ? null : Math.max(0, soll - ist - lauf);
    return { name: kursNamen(key)[0] || key, soll, ist, lauf, fehlt };
  }).sort((x, y) => (y.fehlt || 0) - (x.fehlt || 0));

  const teil = (titel, zeilen, leer) =>
    `<div class="row" style="margin:10px 0 2px"><b>${titel}</b>
      <span style="color:var(--lp-dim2);font-size:11px">${zeilen.length || ''}</span></div>`
    + dListe(zeilen, leer);

  return `<div class="row" style="margin-bottom:2px;color:var(--lp-dim);font-size:11px">
      ${esc(T.btName(b.building_type))} · Profil „${esc(T.profileOf(b) || '—')}“
      · ${f.fertig ? 'fertig' : 'offen'}</div>`
    + teil('Fahrzeuge fehlen', a.vehMissing.map(v =>
        dZeile(v.name, `${v.n}×`, 'gap', `data-fahrzeug="${v.id}"`)),
        'Alle geplanten Fahrzeuge stehen da.')
    + teil('Überzählig', a.vehSurplus.map(v =>
        dZeile(v.name, `${v.n}×`, 'warn', `data-fahrzeug="${v.id}"`)),
        'Nichts überzählig.')
    + teil('Ausbauten fehlen', a.extMissing.map(e =>
        dZeile(e.caption, e.n > 1 ? `${e.n}×` : '', 'gap', `data-ausbau="${esc(e.caption)}"`)),
        'Alle geplanten Ausbauten sind gebaut.')
    + teil('Lehrgänge', kurse.map(k => dZeile(k.name,
        k.fehlt === null ? 'nicht erfaßt'
          : `${k.ist} von ${k.soll}${k.lauf ? ` (+${k.lauf})` : ''}${k.fehlt ? ` — ${k.fehlt} fehlen` : ''}`,
        k.fehlt === null ? 'warn' : k.fehlt ? 'gap' : 'ok')),
        'Kein Fahrzeug hier verlangt einen Lehrgang.');
}

function detailFahrzeug(typ) {
  const zeilen = planWachen().map(b => {
    const a = analyse(b);
    const fehlt = a.vehMissing.find(v => String(v.id) === String(typ))?.n || 0;
    const zuviel = a.vehSurplus.find(v => String(v.id) === String(typ))?.n || 0;
    const da = (S.byBuilding.get(b.id) || []).filter(v => String(v.vehicle_type) === String(typ)).length;
    const soll = Number(T.target(b)?.vehicles?.[typ]) || 0;
    return { b, fehlt, zuviel, da, soll };
  }).filter(z => z.soll || z.da);
  const fehltGes = zeilen.reduce((n, z) => n + z.fehlt, 0);
  const zuvielGes = zeilen.reduce((n, z) => n + z.zuviel, 0);
  return `<div class="row" style="margin-bottom:2px;color:var(--lp-dim);font-size:11px">
      ${zeilen.length} Wachen · ${fehltGes} fehlen${zuvielGes ? ` · ${zuvielGes} überzählig` : ''}
      ${T.veh(typ) ? `· ${T.veh(typ).min}–${T.veh(typ).max} Personen` : ''}</div>`
    + dListe(zeilen.sort((x, y) => y.fehlt - x.fehlt || y.zuviel - x.zuviel)
        .map(z => dZeile(ohneHaken(z.b.caption), `${z.da} von ${z.soll}`,
          z.fehlt ? 'gap' : z.zuviel ? 'warn' : 'ok', `data-wache="${z.b.id}"`)),
      'Keine Wache plant diesen Fahrzeugtyp.');
}

function detailAusbau(name) {
  const zeilen = planWachen()
    .map(b => ({ b, fehlt: analyse(b).extMissing.some(e => e.caption === name),
                 geplant: (T.target(b)?.extensions || {})[name] }))
    .filter(z => z.geplant);
  return `<div class="row" style="margin-bottom:2px;color:var(--lp-dim);font-size:11px">
      ${zeilen.filter(z => z.fehlt).length} von ${zeilen.length} Wachen fehlt dieser Ausbau</div>`
    + dListe(zeilen.sort((x, y) => (y.fehlt ? 1 : 0) - (x.fehlt ? 1 : 0))
        .map(z => dZeile(ohneHaken(z.b.caption), z.fehlt ? 'fehlt' : 'gebaut',
          z.fehlt ? 'gap' : 'ok', `data-wache="${z.b.id}"`)),
      'Keine Wache plant diesen Ausbau.');
}

/** Der Rahmen um alle vier Achsen. Leer, solange nichts gewählt ist. */
function einzelAnsicht() {
  if (!fokus) return '';
  const titel = fokus.art === 'wache' ? ohneHaken(S.byId.get(fokus.id)?.caption || '')
    : fokus.art === 'fahrzeug' ? T.vehName(fokus.id)
    : fokus.art === 'ausbau' ? fokus.id
    : (kursNamen(fokus.id)[0] || fokus.id);
  const inhalt = fokus.art === 'wache' ? (S.byId.get(fokus.id) ? detailWache(S.byId.get(fokus.id)) : '')
    : fokus.art === 'fahrzeug' ? detailFahrzeug(fokus.id)
    : fokus.art === 'ausbau' ? detailAusbau(fokus.id)
    : detailKurs(fokus.id);
  return `<div class="einzel"><div class="row" style="align-items:center">
      <b>${esc(titel)}</b><span style="flex:1"></span>
      <button class="act" id="lssp-zu">schließen</button></div>${inhalt}</div>`;
}

/** Klickbare Namen überall gleich verdrahten. */
function einzelBinden(wurzel) {
  wurzel.querySelector('#lssp-zu')?.addEventListener('click', () => { fokus = null; render(); });
  for (const [attr, art] of [['data-wache', 'wache'], ['data-fahrzeug', 'fahrzeug'],
                             ['data-ausbau', 'ausbau'], ['data-kurs', 'kurs']]) {
    wurzel.querySelectorAll(`[${attr}]`).forEach(x => x.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();   // sonst kippt das Ankreuzfeld mit
      const roh = x.getAttribute(attr);
      fokus = { art, id: art === 'wache' ? Number(roh) : roh };
      render();
    }));
  }
}

/** Feld zum Einfügen eines Plans — im Übersichtsreiter und dort, wo er fehlt. */
function planEinfuegen() {
  return `<textarea id="lssp-paste" placeholder='{"format":"lss-plan",…}'
      style="width:100%;min-height:90px;background:var(--lp-feld);color:var(--lp-fg);
             border:1px solid var(--lp-rand);border-radius:3px;padding:8px;font:11px monospace"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="act go" id="lssp-take">Plan übernehmen</button>
      <span style="flex:1"></span>
      <input type="file" id="lssp-file" accept=".json" style="font-size:11px">
    </div>`;
}

function planEinfuegenBinden(wurzel) {
  const take = async txt => {
    try {
      const p = JSON.parse(txt);
      if (p.format !== 'lss-plan') throw new Error('kein lss-plan-Format');
      S.plan = p;
      if (!store.set(KEY_PLAN, p)) log('Plan gilt nur für diese Sitzung — zu groß für den Speicher', 'warn');
      /* Der Plan bringt ein Wunschbild mit. Es zu übernehmen ist eine
         Entscheidung des Menschen, nicht des Skripts — sonst überschreibt ein
         Import stillschweigend alles, was im Editor entstanden ist. */
      if (p.model?.types && await frage(
          'Der Plan enthält ein eigenes Wunschbild. Übernehmen und das bisherige ersetzen?'
          + '\n\nNein behält, was im Reiter „Plan“ steht.', 'plan-modell-uebernehmen')) {
        S.modell = p.model.types;
        if (p.model.assignment) S.zuordnung = p.model.assignment;
        log('Wunschbild und Zuordnung aus dem Plan übernommen.', 'good');
      }
      log('Plan übernommen.', 'good');
      render();
    } catch (e) { log('Plan nicht lesbar: ' + e.message, 'err'); }
  };
  wurzel.querySelector('#lssp-take')?.addEventListener('click', () => {
    const t = wurzel.querySelector('#lssp-paste').value.trim();
    if (t) take(t);
  });
  wurzel.querySelector('#lssp-file')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader(); rd.onload = () => take(String(rd.result)); rd.readAsText(f);
  });
}

/** Zeichnet die beiden Leisten: Gruppen oben, Handgriffe darunter. */
function navZeichnen() {
  const g = gruppeVon(tab);
  el.querySelector('nav').innerHTML = GRUPPEN.map(x =>
    `<button data-g="${x.id}"${x.id === g.id ? ' class="on"' : ''}>${esc(x.name)}</button>`).join('');
  const unter = el.querySelector('.unter');
  unter.innerHTML = g.tabs.length < 2 ? '' : g.tabs.map(t =>
    `<button data-t="${t}"${t === tab ? ' class="on"' : ''}>${esc(TABNAME[t] || t)}</button>`).join('');
  unter.style.display = g.tabs.length < 2 ? 'none' : 'flex';
  el.querySelectorAll('nav button').forEach(x => x.onclick = () => {
    const ziel = GRUPPEN.find(y => y.id === x.dataset.g);
    if (ziel && !ziel.tabs.includes(tab)) wechsleAuf(ziel.tabs[0]);
  });
  unter.querySelectorAll('button').forEach(x => x.onclick = () => {
    if (x.dataset.t !== tab) wechsleAuf(x.dataset.t);
  });
}
/* ── Fortschritt ──────────────────────────────────────────────────────
   Bei 102 Wachen sagte nur das Protokoll, wie weit es ist — und das scrollt.
   Der Balken sitzt fest über dem Inhalt und verschwindet, wenn nichts läuft. */
let fortSeit = 0;
function schritt(getan, gesamt, text = '') {
  if (!el) return;
  const leiste = el.querySelector('#lssp-fort');
  if (!leiste) return;
  if (!gesamt || getan >= gesamt) { leiste.style.display = 'none'; fortSeit = 0; return; }
  if (!fortSeit) fortSeit = Date.now();
  const anteil = Math.max(0, Math.min(1, getan / gesamt));
  // Restzeit aus dem bisherigen Tempo — ehrlicher als jede feste Schätzung
  const rest = getan > 0 ? Math.round((Date.now() - fortSeit) / getan * (gesamt - getan) / 1000) : null;
  leiste.style.display = '';
  leiste.querySelector('.balken').style.width = (anteil * 100).toFixed(1) + '%';
  leiste.querySelector('.wort').textContent =
    `${getan}/${gesamt}${text ? ' — ' + text : ''}${
      rest != null && rest > 2 ? ` · noch etwa ${rest > 90 ? Math.round(rest / 60) + ' min' : rest + ' s'}` : ''}`;
}
const fortAus = () => schritt(0, 0);

function log(msg, kind = '') {
  if (msg !== '') {
    S.log.push({ msg, kind });
    if (S.log.length > 500) S.log.splice(0, S.log.length - 500);
  }
  const pre = el?.querySelector('#lssp-log');
  if (!pre) return;
  if (msg === '') return malLog(pre);        // Neuaufbau nach einem Tab-Wechsel
  const z = document.createElement('span');
  z.className = kind; z.textContent = msg + '\n';   // textContent maskiert selbst
  pre.appendChild(z);
  while (pre.childElementCount > 500) pre.firstChild.remove();
  pre.scrollTop = pre.scrollHeight;
}

/** Baut das Protokollfeld einmalig aus dem Speicher auf. */
function malLog(pre) {
  const frag = document.createDocumentFragment();
  for (const l of S.log.slice(-500)) {
    const z = document.createElement('span');
    z.className = l.kind; z.textContent = l.msg + '\n';
    frag.appendChild(z);
  }
  pre.replaceChildren(frag);
  pre.className = logFilter;
  pre.scrollTop = pre.scrollHeight;
}
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* Ein Lauf über 20 Wachen schreibt hunderte Zeilen „→ zugewiesen“. Die eine
   Warnung dazwischen findet niemand. Gefiltert wird in CSS, damit die Zeilen
   erhalten bleiben und das Umschalten nichts neu aufbaut. */
let logFilter = '';
function logKopf() {
  const zahl = art => S.log.filter(l => art === 'err' ? l.kind === 'err'
    : art === 'warn' ? (l.kind === 'warn' || l.kind === 'err') : true).length;
  const knopf = (id, text) => `<button data-f="${id}"${logFilter === id ? ' class="on"' : ''}>${text}</button>`;
  return `<div class="logkopf">
    ${knopf('', `alles (${zahl('')})`)}
    ${knopf('nurwarn', `Warnungen (${zahl('warn')})`)}
    ${knopf('nurerr', `Fehler (${zahl('err')})`)}
    <span style="flex:1"></span>
    <button data-f="leeren">leeren</button></div>`;
}
function logKopfBinden(wurzel) {
  wurzel.querySelectorAll('.logkopf button').forEach(x => x.onclick = () => {
    if (x.dataset.f === 'leeren') { S.log = []; log(''); render(); return; }
    logFilter = x.dataset.f;
    render();
  });
}

/* Welche Wachen gewählt sind, stand bisher allein in den Ankreuzfeldern —
   und die entstanden bei jedem Neuzeichnen neu, vorangekreuzt nach der Regel
   „hier ist etwas offen“. Wer eine einzelne Wache wählte und dann irgendetwas
   anfasste, das ein Neuzeichnen auslöste, lief unbemerkt gegen alle offenen
   Wachen. Deshalb steht die Auswahl jetzt hier und überlebt das Zeichnen. */
const auswahl = new Set();

function selectedBuildings() {
  // Nur, was gerade auch sichtbar ist: was der Filter ausblendet, ist nicht gemeint
  return [...el.querySelectorAll('.bsel:checked')]
    .map(c => S.byId.get(Number(c.value))).filter(Boolean);
}

/** Ankreuzfelder mit dem Zustand verbinden. Nach jedem render() nötig. */
function auswahlBinden(wurzel) {
  /* Das Suchfeld zeichnet die Liste neu, behält aber den Fokus und die
     Schreibmarke — sonst tippt man ein Wort und landet nach dem ersten
     Buchstaben wieder außerhalb des Feldes. */
  const feld = wurzel.querySelector('#lssp-suche');
  if (feld) feld.oninput = () => {
    suche = feld.value;
    const stelle = feld.selectionStart;
    render();
    const neu = el.querySelector('#lssp-suche');
    if (neu) { neu.focus(); neu.setSelectionRange(stelle, stelle); }
  };
  wurzel.querySelector('#lssp-sort')?.addEventListener('change', e => {
    sortierung = e.target.value; render();
  });
  wurzel.querySelectorAll('.bsel').forEach(c => c.onchange = () => {
    const id = Number(c.value);
    c.checked ? auswahl.add(id) : auswahl.delete(id);
  });
  const setzeAlle = an => wurzel.querySelectorAll('.bsel').forEach(c => {
    c.checked = an;
    an ? auswahl.add(Number(c.value)) : auswahl.delete(Number(c.value));
  });
  wurzel.querySelector('#lssp-all')?.addEventListener('click', () => setzeAlle(true));
  wurzel.querySelector('#lssp-none')?.addEventListener('click', () => setzeAlle(false));
}

function buildingList(filterFn = null) {
  const types = [...new Set(planWachen().map(b => b.building_type))]
    .filter(t => Object.keys(T.profiles(t)).length)
    .sort((a, b) => T.btName(a).localeCompare(T.btName(b), 'de'));
  /* Ein übergebener Filter schlägt die Auswahlliste: im Plan-Reiter steht der
     Gebäudetyp schon oben, ein zweites Menü daneben wäre eine Falle. */
  const tsel = filterFn ? '' : (el?.querySelector('#lssp-type')?.value ?? '');
  const rows = planWachen()
    .filter(b => Object.keys(T.profiles(b.building_type)).length)
    .filter(b => !filterFn || filterFn(b))
    .filter(b => tsel === '' || String(b.building_type) === tsel)
    .map(b => ({ b, f: fortschritt(b), a: analyse(b) }));

  /* Je Reiter zählt etwas anderes. Im Anhänger-Reiter interessiert nicht,
     wie viele Lehrgänge fehlen — sondern wie viele Anhänger kein
     Zugfahrzeug haben. */
  const bereich = {
    ausbau:    f => [f.ausbau,    f.ausbau ? `${f.ausbau} Ausbauten fehlen` : ''],
    kaufen:    f => [f.kauf,      f.kauf ? `${f.kauf} Fahrzeuge fehlen` : ''],
    verkauf:   f => [f.weg,       f.weg ? `${f.weg} überzählig` : ''],
    werben:    f => [f.personal,  f.personal ? `${f.personal} unterbesetzt` : ''],
    anhaenger: f => [f.anhaenger, f.anhaenger ? `${f.anhaenger} ohne Zugfahrzeug` : ''],
    personal:  f => [f.personal,  f.personal ? `${f.personal} unterbesetzt` : ''],
    lehrgang:  f => [f.lehrgang,  f.lehrgangUnklar ? 'Ausbildung unerfasst'
                                : f.lehrgang ? `${f.lehrgang} Ausbildungen fehlen` : ''],
    leeren:    f => [f.personal, f.personal ? `${f.personal} unterbesetzt` : 'besetzt'],
    haken:     f => [f.unklar ? 0 : f.offen,
                     f.unklar ? 'nicht beurteilbar' : f.fertig ? 'Haken setzen' : 'Haken entfernen']
  };

  const alleTeile = f => {
    const t = [];
    if (f.ausbau)    t.push(`${f.ausbau} Ausbau`);
    if (f.kauf)      t.push(`${f.kauf} Fahrzeug`);
    if (f.weg)       t.push(`${f.weg} zu viel`);
    if (f.personal)  t.push(`${f.personal} unterbesetzt`);
    if (f.anhaenger) t.push(`${f.anhaenger} ohne Zugfz`);
    if (f.lehrgang)  t.push(`${f.lehrgang} Lehrgang`);
    if (f.lehrgangUnklar) t.push('Ausbildung unerfasst');
    return t.join(' · ');
  };

  const nurOffen = el?.querySelector('#lssp-nuroffen')?.checked
    ?? (S.opts.nurOffen !== false);
  const offenIm = f => bereich[tab] ? bereich[tab](f)[0] : f.offen;
  /* Suchwort ohne Rücksicht auf Groß- und Kleinschreibung und ohne die
     Markierung: wer „wasret“ tippt, meint auch „🟢 WasRet 3“. */
  const wort = suche.trim().toLowerCase();
  const sichtbar = rows
    .filter(r => !nurOffen || (offenIm(r.f) && !ruht.has(r.b.id)))
    .filter(r => !wort || ohneHaken(r.b.caption).toLowerCase().includes(wort))
    .sort((x, y) => {
      if (sortierung === 'name') return ohneHaken(x.b.caption).localeCompare(ohneHaken(y.b.caption), 'de');
      if (sortierung === 'typ') return T.btName(x.b.building_type).localeCompare(T.btName(y.b.building_type), 'de')
        || ohneHaken(x.b.caption).localeCompare(ohneHaken(y.b.caption), 'de');
      // „offen“: das Dringendste oben, bei Gleichstand alphabetisch
      return (offenIm(y.f) || 0) - (offenIm(x.f) || 0)
        || ohneHaken(x.b.caption).localeCompare(ohneHaken(y.b.caption), 'de');
    });
  const fertigN = rows.filter(r => !offenIm(r.f)).length;
  const ruhtN   = rows.filter(r => ruht.has(r.b.id)).length;
  const gewaehltN = sichtbar.filter(r => auswahl.has(r.b.id)).length;

  const liste = sichtbar.map(({ b, f, a }) => {
    const still = ruht.has(b.id);
    const [offenHier, text] = bereich[tab] ? bereich[tab](f) : [f.offen, alleTeile(f)];
    const zustand = still ? ['ruht', 'var(--lp-dim2)']
      : offenHier ? [`${offenHier} offen`, 'var(--lp-err)']
      : (tab === 'lehrgang' && f.lehrgangUnklar) ? ['unklar', 'var(--lp-akzent)']
      : f.fertig ? ['fertig', 'var(--lp-ok)']
      : ['hier fertig', 'var(--lp-ok)'];
    return `<label${still ? ' style="opacity:.5"' : ''} title="${esc(alleTeile(f) || 'nichts offen')}">
      <input type="checkbox" class="bsel" value="${b.id}" ${auswahl.has(b.id) ? 'checked' : ''}>
      <span class="lupe" data-wache="${b.id}"
        style="cursor:pointer;text-decoration:underline dotted"
        title="Zeigen, was hier offen ist">${esc(b.caption)}</span>
      <span style="color:var(--lp-dim2);font-size:11px">${esc(a.profile || '—')}</span>
      <span style="color:var(--lp-dim2);font-size:11px;flex:1">${esc(text)}</span>
      <span style="color:${zustand[1]}">${zustand[0]}</span>
      <button class="ruht" data-id="${b.id}" title="Wache übergehen"
        style="background:none;border:0;color:var(--lp-dim2);cursor:pointer;padding:0 4px">${still ? '↺' : '⏸'}</button>
    </label>`;
  }).join('');

  return `<div class="row" style="margin-bottom:6px">
      ${filterFn ? '' : `<select id="lssp-type"><option value="">Alle Typen</option>
      ${types.map(t => `<option value="${t}" ${String(t) === tsel ? 'selected' : ''}>${esc(T.btName(t))}</option>`).join('')}</select>`}
      <input id="lssp-suche" value="${esc(suche)}" placeholder="Wache suchen …"
        style="flex:1;min-width:120px;background:var(--lp-feld);color:var(--lp-fg);border:1px solid var(--lp-rand);
               border-radius:3px;padding:5px 8px;font:12px sans-serif">
      <select id="lssp-sort" title="Sortierung">
        <option value="offen"${sortierung === 'offen' ? ' selected' : ''}>offenste zuerst</option>
        <option value="name"${sortierung === 'name' ? ' selected' : ''}>Name</option>
        <option value="typ"${sortierung === 'typ' ? ' selected' : ''}>Typ</option>
      </select>
    </div>
    <div class="row" style="margin-bottom:6px">
      <button class="act" id="lssp-all">Alle</button>
      <button class="act" id="lssp-none">Keine</button>
      <label style="color:var(--lp-dim);font-size:12px">
        <input type="checkbox" id="lssp-nuroffen" ${nurOffen ? 'checked' : ''}> nur offene</label>
      <span style="flex:1"></span>
      <span style="color:${gewaehltN ? 'var(--lp-akzent)' : 'var(--lp-dim2)'};font-size:11px">${
        gewaehltN ? `${gewaehltN} von ${sichtbar.length} gewählt` : `${sichtbar.length} sichtbar`
      }${wort ? ` (Suche „${esc(suche)}“)` : ''} · ${fertigN} fertig${ruhtN ? `, ${ruhtN} ruhen` : ''}${
        S.buildings.filter(ausgeschlossen).length
          ? `, ${S.buildings.filter(ausgeschlossen).length} ausgeschlossen` : ''}</span>
    </div><div class="list">${liste || `<div style="padding:12px;color:var(--lp-ok)">${
      wort ? 'Keine Wache paßt zur Suche.' : 'Alles erledigt.'}</div>`}</div>`;
}

/** Zeigt am Rahmen und im Kopf, ob der nächste Druck das Spiel verändert.
    Eigene Funktion, weil das Häkchen „Nur Vorschau“ sie ebenfalls aufrufen
    muß: es schrieb bisher nur `S.opts.dry` und zeichnete nicht neu, also
    blieb der Rahmen grau und „SCHARF“ verborgen, bis irgendein anderer
    Handler ein render() auslöste. Genau den Fall sollte D-35 verhindern. */
function scharfZeigen() {
  if (!el) return false;
  const scharf = S.opts.dry === false && !['ueber', 'plan', 'lehrgang'].includes(tab);
  el.classList.toggle('scharf', scharf);
  const marke = el.querySelector('#lssp-scharf');
  if (marke) marke.style.display = scharf ? '' : 'none';
  return scharf;
}

function render() {
  if (!el) return;
  const b = el.querySelector('.body');
  navZeichnen();
  // Nach jedem Zeichnen: die Knöpfe des Protokollkopfs sind neu entstanden
  queueMicrotask(() => logKopfBinden(b));
  /* Scharf heißt: der nächste Druck verändert das Spiel. Das gehört an den
     Rahmen, nicht nur an ein Häkchen weiter unten. */
  scharfZeigen();

  /* Ohne importierten Plan lief bisher gar nichts — obwohl seit v0.32 nur noch
     zwei Dinge daraus kommen: die Stellplatz-Töpfe und der Ausbaukatalog. Alles
     andere steht eingebacken bereit. Ein neuer Nutzer stand also vor einer
     Aufforderung, ein Artefakt zu bedienen, das er gar nicht hat. */
  /* Kaufen geht seit v0.44 ohne Plan: die Stellplätze rechnet LAYOUTS_STANDARD
     aus Stufe und Ausbauten. Nur die Ausbauten selbst brauchen noch den
     Katalog aus dem Plan — ohne ihn weiß niemand, welcher Bauplatz welcher ist. */
  /* Der Ausbaureiter braucht die Bauplatz-Nummern. Fehlen sie, wird nicht nach
     einem Plan gefragt, sondern angeboten, sie aus dem Spiel zu holen — ein
     Abruf je Gebäudeart. */
  if (tab === 'ausbau' && !S.plan?.extensionCatalog
      && !Object.keys(store.get(KEY_EXTCAT, {})).length) {
    b.innerHTML = `<p class="hint">Um einen Ausbau zu bestellen, braucht das Spiel die Nummer des
      Bauplatzes. Die steht auf den Ausbauseiten deiner Wachen — ein Abruf je Gebäudeart, danach
      merkt sich der Planer sie.</p>
      <div class="row"><button class="act go" id="lssp-katalog">Ausbaukatalog aus dem Spiel lesen</button></div>
      <pre id="lssp-log"></pre>`;
    b.querySelector('#lssp-katalog').onclick = async ev => {
      ev.target.disabled = true;
      try {
        const r = await ausbauKatalogLesen();
        log(`${r.gesehen} Bauplätze über ${r.proTyp.size} Gebäudearten gelesen, ${r.neu} neu.`, 'good');
      } catch (e) { log(e.message, 'warn'); }
      fortAus(); ev.target.disabled = false; render();
    };
    log('');
    return;
  }

  if (!S.loaded && loadCached()) {
    // Höchstens einmal am Tag von selbst nachladen — sonst wartet der Planer
    // darauf, dass du „Bestand neu laden“ drückst.
    if (S.stamp && Date.now() - S.stamp > 24 * 3600e3 && !S.busy) {
      S.busy = true;
      loadAll(true).then(() => { log('Bestand war über einen Tag alt und wurde erneuert.', 'good'); })
        .catch(e => log('Selbstabgleich fehlgeschlagen: ' + e.message, 'warn'))
        .finally(() => { S.busy = false; fortAus(); render(); });
    }
  }
  if (!S.loaded) {
    b.innerHTML = `<p class="hint"><b>Schritt 2:</b> Der Plan ist da. Jetzt liest der Helfer einmal
      deine Wachen und Fahrzeuge aus dem Spiel — das dauert ein paar Sekunden und ändert nichts.</p>
      <button class="act go" id="lssp-load">Bestand laden</button>`;
    b.querySelector('#lssp-load').onclick = async () => {
      b.innerHTML = '<p class="hint">Lade Wachen und Fahrzeuge…</p>';
      try {
        await loadAll(true);
        log(`${S.buildings.length} Gebäude, ${S.vehicles.length} Fahrzeuge geladen`, 'good');
        b.innerHTML = '<p class="hint">Lese die Lehrgangsnamen aus deinen Schulen…</p>';
        await learnAllCourses();
        log(`${Object.keys(learnedCourses()).length} Lehrgangsnamen bekannt`, 'good');
      }
      catch (e) { log('Laden fehlgeschlagen: ' + e.message, 'err'); }
      render();
    };
    return;
  }

  const acts = {
    ausbau:   ['Ausbauten bauen',      buildExtensions,
      'Baut die im Plan vorgesehenen Erweiterungen. Reihenfolge: erst die, die Stellplätze bringen, '
      + 'dann die übrigen, zuletzt die mehrfach baubaren wie Abrollbehälter-Stellplätze. Kostet Credits.'],
    kaufen:   ['Fahrzeuge kaufen',     buyVehicles,
      'Kauft alle Fahrzeuge, die gegenüber dem Plan fehlen. Kostet Credits. '
      + 'Achtung: Stellplätze müssen vorher gebaut sein.'],
    verkauf:  ['Überzählige verkaufen', sellSurplus,
      'Verkauft Fahrzeuge, die der Plan nicht vorsieht. Das lässt sich nicht rückgängig machen. '
      + 'Fahrzeuge im Einsatz werden übersprungen.'],
    werben:   ['3 Tage werben',        hire,
      'Startet an unterbesetzten Wachen eine dreitägige Bewerbungsphase. Kostet nichts.'],
    anhaenger:['Anhänger koppeln',     linkTrailers,
      'Ordnet jedem Anhänger ein festes Zugfahrzeug zu. Braucht einen Abruf je Fahrzeug und dauert entsprechend.'],
    leeren:   ['Zuweisungen lösen',    zuweisungenLoeschen,
      'Nimmt alle Personen von den Fahrzeugen einer Wache. Gedacht als Neuanfang vor einer '
      + 'sauberen Zuweisung. Aus Sicherheitsgründen immer nur eine einzige Wache je Lauf, '
      + 'und vor der Ausführung wird nochmals nachgefragt.'],
    haken:    ['Haken abgleichen',     hakenAbgleichen,
      'Benennt Wachen um: Wer von A bis Z fertig ist — Ausbauten, Fahrzeuge, Personal, Anhänger, '
      + `Lehrgänge — bekommt ein ${HAKEN} vor den Namen, alle anderen verlieren es. `
      + 'Fahrzeuge bekommen den Haken, sobald sie voll und passend besetzt sind. '
      + 'Wachen ohne erfassten Ausbildungsstand bleiben unangetastet.'],
    personal: ['Personal zuweisen',    assignStaff,
      'Verteilt vorhandenes Personal auf die Fahrzeuge: erst Ausgebildete auf ihre Fachfahrzeuge, dann der Rest. '
      + 'Anschließend wird die Einsatzbereitschaft nachgezogen: Fahrzeuge ohne ausreichende Besatzung gehen auf '
      + 'Status 6, ausreichend besetzte kommen zurück auf 2, und Ausbauten samt Wache folgen ihren Fahrzeugen.']
  };

  if (tab === 'ueber') {
    let vm = 0, em = 0, hires = 0, done = 0, blockiert = 0, fertig = 0, unklar = 0;
    for (const bb of planWachen()) {
      if (!Object.keys(T.profiles(bb.building_type)).length) continue;
      const a = analyse(bb);
      const g = a.vehMissing.reduce((s, x) => s + x.n, 0), e2 = a.extMissing.reduce((s, x) => s + x.n, 0);
      vm += g; em += e2; if (a.hire) hires++; if (!g && !e2) done++;
      if (g && blockers(bb).length) blockiert++;
      const f = fortschritt(bb);
      if (f.fertig) fertig++; else if (f.unklar) unklar++;
    }
    b.innerHTML = `<div class="row">
        <label style="color:var(--lp-dim)">Personal-Puffer
          <input type="number" id="lssp-buf" min="0" max="100" value="${S.opts.buffer}" style="width:64px"> %</label>
        <span class="sp" style="flex:1"></span>
        <span style="color:var(--lp-dim2);font-size:12px">Bestand ${esc(since(S.stamp))}${
          S.aenderungen ? ` · ${S.aenderungen} lokale Änderungen` : ''}</span>
        <button class="act" id="lssp-reload">Bestand neu laden</button>
        <button class="act" id="lssp-drop"${S.plan ? '' : ' style="display:none"'}>Plan ersetzen</button>
      </div>
      ${S.plan ? '' : `<p class="hint" style="margin-bottom:8px">
        <b>Ein Plan ist nicht nötig.</b> Wunschbild, Fahrzeugdaten und Namen sind eingebaut.
        Nur der Reiter <b>Ausbauten</b> braucht den Ausbaukatalog aus dem Plan des
        Soll/Ist-Werkzeugs.</p>
        ${planEinfuegen()}`}
      <p class="hint" style="margin-bottom:8px">
        <b>${HAKEN} im Namen</b> setzt der Planer selbst, sobald eine Wache nach Plan fertig ist;
        was ihn trägt, rührt er ohne Freigabe nicht mehr an.
        <b>${AUSSCHLUSS} im Namen</b> schreibst du selbst — diese Wache verschwindet vollständig
        aus Listen, Zählungen und Läufen. Entfernt wird der rote Punkt nie.</p>
      <label class="row" style="margin-bottom:8px;color:var(--lp-dim);font-size:12px">
        <input type="checkbox" id="lssp-inline" ${ui.inline ? 'checked' : ''}>
        <span><b>Auf Wachenseiten einblenden</b> — versuchsweise: beim Öffnen einer Wache im Spiel
        steht dort, was ihr fehlt. Rein lesend, ohne zusätzliche Abrufe.</span></label>
      ${stille.size ? `<div class="row" style="margin-bottom:8px">
        <span style="color:var(--lp-dim);font-size:12px">${stille.size} Bestätigung${
          stille.size === 1 ? '' : 'en'} abgeschaltet</span>
        <span style="flex:1"></span>
        <button class="act" id="lssp-fragen">Wieder fragen</button></div>` : ''}
      <div class="list">
        <label><span>Fahrzeuge fehlen</span><span class="gap">${vm}</span></label>
        <label><span>Ausbauten fehlen</span><span class="gap">${em}</span></label>
        <label><span>Wachen unter Soll-Personal</span><span class="gap">${hires}</span></label>
        <label><span>Kauf blockiert (Stellplätze oder Überzählige)</span><span class="${blockiert ? 'warn' : 'ok'}">${blockiert}</span></label>
        <label><span>Wachen vollständig fertig</span><span class="${fertig ? 'ok' : 'gap'}">${fertig}</span></label>
        ${unklar ? `<label><span>davon nicht beurteilbar</span><span class="warn">${unklar} — Ausbildungsstand fehlt</span></label>` : ''}
        <label><span>Wachen komplett</span><span class="ok">${done}</span></label>
      </div>
      ${logKopf()}<pre id="lssp-log"></pre>`;
    b.querySelector('#lssp-buf').onchange = e => {
    S.opts.buffer = Number(e.target.value) || 0; store.set(KEY_OPTS, S.opts); standNeu(); render();
  };
    b.querySelector('#lssp-reload').onclick = async () => { await loadAll(true); render(); };
    planEinfuegenBinden(b);
    b.querySelector('#lssp-inline')?.addEventListener('change', e => {
      ui.inline = e.target.checked; saveUi();
      if (ui.inline) wachenSeite(); else document.querySelector('#lssp-wache')?.remove();
    });
    b.querySelector('#lssp-fragen')?.addEventListener('click', () => { stilleLeeren(); render(); });
    b.querySelector('#lssp-drop').onclick = async () => {
      if (!await frage('Geladenen Plan verwerfen?', 'plan-verwerfen')) return;
      S.plan = null; localStorage.removeItem(KEY_PLAN); render();
    };
    log('');
    return;
  }

  if (tab === 'plan') {
    /* Der Editor arbeitet auf einer Kopie und schreibt bei jeder Änderung
       zurück. Ein „Speichern“-Knopf wäre eine zusätzliche Gelegenheit, Arbeit
       zu verlieren. */
    const modell = S.modell;
    const typen = [...new Set([...Object.keys(modell),
      ...S.buildings.map(b => String(b.building_type))])]
      // Schulen, Krankenhäuser und Leitstellen sind gesperrt (D-40) — sie
      // gehören dann auch nicht in die Auswahl, sonst führt sie ins Leere
      .filter(t => !NICHT_PLANEN.has(Number(t)))
      .sort((x, y) => T.btName(x).localeCompare(T.btName(y), 'de'));
    if (!planTyp || !typen.includes(planTyp)) planTyp = typen[0] || null;
    const profile = modell[planTyp]?.profiles || {};
    if (!planProfil || !profile[planProfil]) planProfil = Object.keys(profile)[0] || null;
    const prof = profile[planProfil];

    // Wie viele Wachen hängen an welchem Profil? Erst das macht die Wahl greifbar.
    const wachenVon = {};
    for (const b of planWachen()) {
      if (String(b.building_type) !== planTyp) continue;
      const p = T.profileOf(b) || '—';
      wachenVon[p] = (wachenVon[p] || 0) + 1;
    }
    const eigene = S.buildings.filter(b => String(b.building_type) === planTyp).length;

    const fzZeilen = Object.entries(prof?.vehicles || {})
      .sort((x, y) => T.vehName(x[0]).localeCompare(T.vehName(y[0]), 'de'))
      .map(([id, n]) => `<label>
        <span>${esc(T.vehName(id))}</span>
        <span style="color:var(--lp-dim2);font-size:11px">${
          T.veh(id) ? `${T.veh(id).min}–${T.veh(id).max} Personen` : 'unbekannter Typ'}</span>
        <span style="margin-left:auto;display:flex;gap:4px;align-items:center">
          <button class="act pminus" data-id="${id}" title="weniger">−</button>
          <b style="min-width:22px;text-align:center">${n}</b>
          <button class="act pplus" data-id="${id}" title="mehr">+</button>
          <button class="act pweg" data-id="${id}" title="entfernen">×</button>
        </span></label>`).join('');

    const bekannt = new Set(Object.keys(prof?.vehicles || {}));
    const kaufbar = kaufbareTypen(planTyp);
    const alleZeigen = !!ui.alleTypen;
    const zurWahl = Object.keys(PB)
      .filter(id => !bekannt.has(id))
      .filter(id => alleZeigen || kaufbar.has(id))
      .sort((x, y) => T.vehName(x).localeCompare(T.vehName(y), 'de'))
      .map(id => `<option value="${id}">${esc(T.vehName(id))}</option>`).join('');

    const extZeilen = Object.entries(prof?.extensions || {})
      .sort((x, y) => x[0].localeCompare(y[0], 'de'))
      .map(([name, n]) => `<label><span>${esc(name)}</span>
        <span style="margin-left:auto;display:flex;gap:4px;align-items:center">
          <button class="act eminus" data-n="${esc(name)}">−</button>
          <b style="min-width:22px;text-align:center">${n}</b>
          <button class="act eplus" data-n="${esc(name)}">+</button>
          <button class="act eweg" data-n="${esc(name)}">×</button>
        </span></label>`).join('');

    const sitze = Object.entries(prof?.vehicles || {})
      .reduce((a, [id, n]) => a + (T.veh(id)?.max || 0) * n, 0);
    const fzAnzahl = Object.values(prof?.vehicles || {}).reduce((a, n) => a + n, 0);

    b.innerHTML = `<p class="hint">Hier steht, wie eine Wache aussehen soll. Alles andere im Planer
      rechnet dagegen. Änderungen gelten sofort und bleiben erhalten — auch wenn du später
      einen Plan importierst.</p>
      <div class="row">
        <select id="lssp-ptyp">${typen.map(t => `<option value="${t}"${
          t === planTyp ? ' selected' : ''}>${esc(T.btName(t))}${
          S.buildings.some(x => String(x.building_type) === t) ? '' : ' (keine eigene)'}</option>`).join('')}</select>
        <select id="lssp-pprof">${Object.keys(profile).map(p => `<option value="${esc(p)}"${
          p === planProfil ? ' selected' : ''}>${esc(p)}${
          wachenVon[p] ? ` · ${wachenVon[p]} Wachen` : ''}</option>`).join('')
          || '<option value="">— kein Profil —</option>'}</select>
        <button class="act" id="lssp-pneu">Neu</button>
        <button class="act" id="lssp-pkopie">Kopieren</button>
        <button class="act" id="lssp-pnenn">Umbenennen</button>
        <button class="act danger" id="lssp-plos">Löschen</button>
        <span style="flex:1"></span>
        <button class="act" id="lssp-pstd" title="Nur diesen Gebäudetyp auf den eingebauten Stand zurücksetzen"
          ${MODELL_STANDARD[planTyp] ? '' : 'disabled'}>Standard für ${esc(T.btName(planTyp))}</button>
      </div>
      ${prof ? `
      <div class="row" style="margin-bottom:4px">
        <b>Fahrzeuge</b>
        <span style="color:var(--lp-dim2);font-size:11px">${fzAnzahl} Stück, ${sitze} Sitze</span>
        <span style="flex:1"></span>
        <select id="lssp-pfzwahl" style="max-width:230px"><option value="">Fahrzeugtyp hinzufügen …</option>${zurWahl}</select>
      </div>
      <div class="row" style="margin:-4px 0 6px">
        <span style="color:var(--lp-dim2);font-size:11px">${kaufbar.size} Typen gehören hierher${
          store.get(KEY_KAUFBAR, {})[planTyp] ? ' (aus dem Spiel gelesen)' : ' (aus Profilen und Bestand)'}</span>
        <span style="flex:1"></span>
        <label style="color:var(--lp-dim);font-size:11px">
          <input type="checkbox" id="lssp-palle" ${alleZeigen ? 'checked' : ''}> alle 186 zeigen</label>
        <button class="act" id="lssp-plesen">Typen aus dem Spiel lesen</button>
        <button class="act" id="lssp-pausbau" title="Bauplatz-Nummern dieser Gebäudeart lesen"
          >Ausbaukatalog lesen (${extCatVon(planTyp).filter(Boolean).length})</button>
      </div>
      <div class="list">${fzZeilen
        || '<label><span style="color:var(--lp-dim)">Noch kein Fahrzeug in diesem Profil.</span></label>'}</div>

      <div class="row" style="margin:10px 0 4px">
        <b>Ausbauten</b>
        <span style="flex:1"></span>
        <input id="lssp-pextname" placeholder="Name des Ausbaus" style="flex:1;min-width:160px;
          background:var(--lp-feld);color:var(--lp-fg);border:1px solid var(--lp-rand);border-radius:3px;padding:5px 8px;font:12px sans-serif">
        <button class="act" id="lssp-pextadd">hinzufügen</button>
      </div>
      <div class="list">${extZeilen
        || '<label><span style="color:var(--lp-dim)">Keine Ausbauten vorgesehen.</span></label>'}</div>

      <div class="row" style="margin-top:12px">
        <b>Zuordnung</b>
        <span style="color:var(--lp-dim2);font-size:11px">${eigene} eigene Wachen dieses Typs</span>
        <span style="flex:1"></span>
        <button class="act go" id="lssp-pzuord">Gewählte Wachen auf „${esc(planProfil || '')}“</button>
      </div>
      ${buildingList(x => String(x.building_type) === planTyp)}
      ` : '<p class="hint">Für diesen Gebäudetyp gibt es noch kein Profil. Leg eines an.</p>'}

      <div class="row" style="margin-top:12px">
        <button class="act" id="lssp-pexport">Wunschbild kopieren</button>
        <button class="act" id="lssp-pimport">Einfügen …</button>
      </div>
      ${logKopf()}<pre id="lssp-log"></pre>`;

    const frisch = () => { modellGeaendert(); render(); };
    const zahl = (obj, schluessel, delta) => {
      obj[schluessel] = Math.max(0, (obj[schluessel] || 0) + delta);
      if (!obj[schluessel]) delete obj[schluessel];
    };

    b.querySelector('#lssp-ptyp').onchange = e => { planTyp = e.target.value; planProfil = null; render(); };
    b.querySelector('#lssp-pprof').onchange = e => { planProfil = e.target.value; render(); };

    b.querySelector('#lssp-pneu').onclick = () => {
      const name = prompt('Name des neuen Profils:', 'eigenes');
      if (!name) return;
      modell[planTyp] ||= { slotBonus: 0, profiles: {} };
      modell[planTyp].profiles[name] = { vehicles: {}, extensions: {} };
      planProfil = name; frisch();
    };
    b.querySelector('#lssp-pkopie').onclick = () => {
      if (!prof) return;
      const name = prompt('Name der Kopie:', planProfil + ' 2');
      if (!name) return;
      modell[planTyp].profiles[name] = strukturKopie(prof);
      planProfil = name; frisch();
    };
    b.querySelector('#lssp-pnenn').onclick = () => {
      if (!prof) return;
      const name = prompt('Neuer Name:', planProfil);
      if (!name || name === planProfil) return;
      modell[planTyp].profiles[name] = prof;
      delete modell[planTyp].profiles[planProfil];
      // Zuordnungen mitziehen, sonst zeigen sie ins Leere
      const z = S.zuordnung;
      for (const [bid, p] of Object.entries(z)) if (p === planProfil) z[bid] = name;
      S.zuordnung = z;
      planProfil = name; frisch();
    };
    b.querySelector('#lssp-plos').onclick = async () => {
      if (!prof) return;
      const dran = wachenVon[planProfil] || 0;
      if (!await frage(`Profil „${planProfil}“ löschen?`
        + (dran ? `\n\n${dran} Wachen benutzen es und fallen auf das erste Profil zurück.` : ''))) return;
      delete modell[planTyp].profiles[planProfil];
      planProfil = null; frisch();
    };

    b.querySelector('#lssp-palle')?.addEventListener('change', e => {
      ui.alleTypen = e.target.checked; saveUi(); render();
    });
    b.querySelector('#lssp-plesen')?.addEventListener('click', async () => {
      const wache = S.buildings.find(x => String(x.building_type) === planTyp);
      if (!wache) return log('Keine eigene Wache dieses Typs — daraus läßt sich nichts lesen.', 'warn');
      try {
        const ids = await kaufbareLesen(wache);
        log(`${ids.size} kaufbare Typen für ${T.btName(planTyp)} gelesen.`, 'good');
        render();
      } catch (e) { log('Nicht gelesen: ' + e.message, 'warn'); }
    });
    b.querySelector('#lssp-pausbau')?.addEventListener('click', async () => {
      try {
        // Die Sammelseite bringt alle Gebäudearten mit, nicht nur die gewählte.
        const r = await ausbauKatalogLesen();
        log(`${r.gesehen} Bauplätze über ${r.proTyp.size} Gebäudearten gelesen, ${r.neu} neu `
          + `(davon ${r.proTyp.get(Number(planTyp)) || 0} bei ${T.btName(planTyp)}).`, 'good');
        render();
      } catch (e) { log('Nicht gelesen: ' + e.message, 'warn'); }
    });
    b.querySelector('#lssp-pfzwahl')?.addEventListener('change', e => {
      if (!e.target.value) return;
      prof.vehicles ||= {};
      prof.vehicles[e.target.value] = 1;
      frisch();
    });
    b.querySelectorAll('.pplus').forEach(x => x.onclick = () => { zahl(prof.vehicles, x.dataset.id, +1); frisch(); });
    b.querySelectorAll('.pminus').forEach(x => x.onclick = () => { zahl(prof.vehicles, x.dataset.id, -1); frisch(); });
    b.querySelectorAll('.pweg').forEach(x => x.onclick = () => {
      delete prof.vehicles[x.dataset.id];
      if (prof.pools) delete prof.pools[x.dataset.id];   // sonst bleibt ein Topf ohne Fahrzeug
      frisch();
    });

    b.querySelector('#lssp-pextadd')?.addEventListener('click', () => {
      const feld = b.querySelector('#lssp-pextname');
      const name = feld.value.trim();
      if (!name) return;
      prof.extensions ||= {};
      prof.extensions[name] = (prof.extensions[name] || 0) + 1;
      frisch();
    });
    b.querySelectorAll('.eplus').forEach(x => x.onclick = () => { zahl(prof.extensions, x.dataset.n, +1); frisch(); });
    b.querySelectorAll('.eminus').forEach(x => x.onclick = () => { zahl(prof.extensions, x.dataset.n, -1); frisch(); });
    b.querySelectorAll('.eweg').forEach(x => x.onclick = () => { delete prof.extensions[x.dataset.n]; frisch(); });

    auswahlBinden(b);
    b.querySelector('#lssp-pzuord')?.addEventListener('click', () => {
      const sel = selectedBuildings();
      if (!sel.length) return log('Keine Wache gewählt.', 'warn');
      const z = S.zuordnung;
      for (const w of sel) z[w.id] = planProfil;
      S.zuordnung = z;
      log(`${sel.length} Wachen auf „${planProfil}“ gesetzt.`, 'good');
      render();
    });

    b.querySelector('#lssp-pexport').onclick = async () => {
      const txt = JSON.stringify({ modell: S.modell, zuordnung: S.zuordnung }, null, 1);
      try { await navigator.clipboard.writeText(txt); log('Wunschbild in der Zwischenablage.', 'good'); }
      catch { log('Kopieren nicht möglich. Hier zum Herausnehmen:\n' + txt); }
    };
    b.querySelector('#lssp-pimport').onclick = async () => {
      const txt = prompt('Wunschbild einfügen (JSON):');
      if (!txt) return;
      try {
        const d = JSON.parse(txt);
        const m = d.modell || d.types || d;
        if (typeof m !== 'object') throw new Error('kein Objekt');
        S.modell = m;
        if (d.zuordnung) S.zuordnung = d.zuordnung;
        planTyp = planProfil = null;
        log('Wunschbild übernommen.', 'good'); render();
      } catch (e) { log('Nicht lesbar: ' + e.message, 'err'); }
    };
    b.querySelector('#lssp-pstd').onclick = async () => {
      const vorlage = MODELL_STANDARD[planTyp];
      if (!vorlage) return log('Für diesen Gebäudetyp gibt es keinen eingebauten Stand.', 'warn');
      const eigene = Object.keys(modell[planTyp]?.profiles || {})
        .filter(p2 => !vorlage.profiles[p2]);
      if (!await frage(`Profile für ${T.btName(planTyp)} auf den eingebauten Stand zurücksetzen?`
        + (eigene.length ? `\n\nSelbst angelegt und dabei verloren: ${eigene.join(', ')}` : '')
        + '\n\nAndere Gebäudearten und die Zuordnung der Wachen bleiben unberührt.')) return;
      modell[planTyp] = strukturKopie(vorlage);
      planProfil = null;
      log(`${T.btName(planTyp)} auf den Standard zurückgesetzt.`, 'good');
      modellGeaendert(); render();
    };
    log('');
    return;
  }

  if (tab === 'lehrgang') {
    const learned = Object.keys(learnedCourses()).length;
    b.innerHTML = `<p class="hint">Hier siehst du, wie viele Personen je Lehrgang ausgebildet sein müssen
      und wie viele es schon sind. <b>Soll</b> rechnet der Planer aus deinem Plan aus,
      <b>Ist</b> liest er direkt aus dem Spiel.<br><br>
      <b>So gehst du vor:</b> unten <b>Ausbildungsstand erfassen</b> drücken und warten.
      Danach steht in der Liste, welcher Lehrgang wie oft fehlt.<br>
      ${learned ? `<span class="good">${learned} Lehrgangsnamen bekannt.</span>`
                : `<span class="warn">Noch keine Lehrgangsnamen bekannt.</span> Drück auf
                   <b>Lehrgangsnamen lesen</b> — der Planer holt sie sich selbst aus deinen Schulen.`}
      </p>${buildingList()}
      <div class="row" style="margin-top:10px">
        <button class="act go" id="lssp-scan">Ausbildungsstand erfassen</button>
        <button class="act" id="lssp-learn">Lehrgangsnamen lesen</button>
        <span style="color:var(--lp-dim2);font-size:12px">${quals.ts ? 'zuletzt ' + esc(since(quals.ts)) : 'noch nie erfasst'}</span>
        <span style="flex:1"></span>
        <button class="act" id="lssp-diag">Zuordnung prüfen</button>
        <button class="act" id="lssp-copy">Als Text kopieren</button>
      </div>
      <div id="lssp-ctab"></div>${logKopf()}<pre id="lssp-log"></pre>`;
    b.querySelector('#lssp-type')?.addEventListener('change', render);
  b.querySelector('#lssp-nuroffen')?.addEventListener('change', e => {
    S.opts.nurOffen = e.target.checked; store.set(KEY_OPTS, S.opts); render();
  });
  b.querySelectorAll('button.ruht').forEach(x => x.onclick = ev => {
    ev.preventDefault(); ruhtUm(Number(x.dataset.id)); render();
  });
    auswahlBinden(b);

    const draw = () => {
      const sel = selectedBuildings();
      const rows = courseTable(sel);
      const list = Object.entries(rows).sort((a, c) => (c[1].fehlt || 0) - (a[1].fehlt || 0));
      b.querySelector('#lssp-ctab').innerHTML = einzelAnsicht() + (list.length ? `<div class="list" style="margin-top:10px">
        ${list.map(([n, r]) => {
          let txt, cls;
          if (r.status === 'anhaenger')  { txt = 'kein Sitzbedarf'; cls = ''; }
          else if (r.status === 'nodata'){ txt = 'nicht erfasst';  cls = 'warn'; }
          else { txt = r.fehlt ? r.fehlt + ' fehlen' : 'gedeckt'; cls = r.fehlt ? 'gap' : 'ok'; }
          const teil = (r.status === 'teil' ? ` <span class="warn">(${r.offen} Wachen fehlen)</span>` : '')
            + (r.fehlt && r.ueber ? ` <span style="color:var(--lp-dim2)">· ${r.ueber} überzählig</span>` : '');
          return `<label><span class="lupe" data-kurs="${esc(r.key)}"
            style="cursor:pointer;text-decoration:underline dotted"
            title="Nur diesen Lehrgang ansehen">${esc(r.name)}</span>
            <span style="margin-left:auto;font:11px monospace;color:var(--lp-dim)">${
              r.status === 'anhaenger' ? 'Anhänger' : 'Soll ' + r.soll
            }${r.ist === null ? '' : ' · Ist ' + r.ist}${
              r.lauf ? ' · ' + r.lauf + ' in Ausbildung' : ''}${teil}</span>
            <span class="${cls}" style="min-width:96px;text-align:right">${txt}</span></label>`;
        }).join('')}</div>
        ${Object.keys(inAus).length ? '' : '<p class="hint" style="margin-top:8px">'
          + '<span class="warn">Laufende Ausbildungen sind nicht erfaßt</span> — sie fallen beim '
          + 'Personallauf ab. Bis dahin zählt niemand als unterwegs und „fehlt“ ist zu hoch.</p>'}
        <p class="hint" style="margin-top:8px">
          Steht statt eines Namens ein Schlüssel wie <code>thw_zugtrupp</code>, fehlt nur die
          Beschriftung — gerechnet wird trotzdem richtig; „Lehrgangsnamen lesen“ holt sie nach. &nbsp;
          <span class="warn">nicht erfasst</span> = für diese Wachen wurde der Ausbildungsstand noch nicht gelesen. &nbsp;
          <b>kein Sitzbedarf</b> = weder Besatzung noch eine Anforderung an der Einsatzstelle;
          tritt nur auf, wenn die Stammdaten dazu nichts hergeben.</p>`
        : '<p class="hint" style="margin-top:10px">Für diese Auswahl braucht kein Fahrzeug einen Lehrgang.</p>');
      lastCourses = { rows, sel };

      // Erst nach dem Zeichnen verdrahten: die Knöpfe entstehen ja gerade.
      einzelBinden(b);
    };
    einzelBinden(b);

    b.querySelector('#lssp-scan').onclick = async ev => {
      if (S.busy) return;
      const sel = selectedBuildings();
      if (!sel.length) return log('Keine Wache ausgewählt', 'warn');
      S.busy = true; ev.target.disabled = true; S.log = []; laufStarten();
      log(`Lese ${sel.length} Wachen aus, das dauert etwa ${Math.ceil(sel.length * 0.25)} Sekunden.`, 'good');
      try {
        await scanQuals(sel, (done, total, bb) => {
          schritt(done, total, bb.caption || bb.id);
          if (done % 5 === 0 || done === total) log(`${done}/${total} — zuletzt ${bb.caption || bb.id}`);
        });
        log('Fertig.', 'good');
        const fertig = sel.filter(x => fortschritt(x).fertig).length;
        if (fertig) log(`${fertig} Wachen sind jetzt vollständig — im Reiter „Haken" `
          + `lässt sich das in die Namen übernehmen.`, 'good');
      } catch (e) { log('Abbruch: ' + e.message, 'err'); }
      S.busy = false; ev.target.disabled = false; fortAus(); render();
    };

    b.querySelector('#lssp-learn').onclick = async ev => {
      if (S.busy) return;
      S.busy = true; ev.target.disabled = true; S.log = []; laufStarten();
      const list = await allSchools();
      if (!list.length) {
        log('Keine Schule gefunden — weder eigene noch im Verband. Die eingebauten '
          + 'Lehrgangsnamen genügen; gerechnet wird ohnehin über die Schlüssel.', 'warn');
        return 0;
      }
      log(`Lese ${list.length} Schulen: ${list.map(schulName).join(', ')}`, 'good');
      try {
        await learnAllCourses((i, t, bb) => { schritt(i, t, bb.caption); log(`${i}/${t} — ${bb.caption}`); });
        log(`Jetzt ${Object.keys(learnedCourses()).length} Lehrgangsnamen bekannt.`, 'good');
      } catch (e) { log('Abbruch: ' + e.message, 'err'); }
      S.busy = false; ev.target.disabled = false; fortAus(); render();
    };

    b.querySelector('#lssp-diag').onclick = () => {
      reloadQuals();
      const lc = learnedCourses();
      S.log = [];
      log(`Bekannte Lehrgangsnamen: ${Object.keys(lc).length}`, 'good');
      log(`Wachen mit erfasstem Ausbildungsstand: ${Object.keys(quals.by).length}`
        + (quals.ts ? ` (${since(quals.ts)})` : ''), 'good');
      const sel = selectedBuildings();
      const rows = courseTable(sel);
      log('── Zuordnung je Lehrgang ──');
      for (const [n, r] of Object.entries(rows))
        log(`${n}  →  ${r.key ? r.key : 'KEIN TREFFER'}`, r.key ? '' : 'err');
      const ohne = Object.values(rows).filter(r => !r.key).length;
      if (ohne) {
        log('', '');
        log(`${ohne} Lehrgänge ohne Treffer. Vorhandene Namen zum Vergleich:`, 'warn');
        Object.entries(lc).forEach(([k, v]) =>
          log(`   ${k} = ${Array.isArray(v) ? v.join(' | ') : v}`));
      }
    };

    b.querySelector('#lssp-copy').onclick = async () => {
      const d = lastCourses; if (!d) return log('Erst erfassen', 'warn');
      const txt = Object.entries(d.rows).map(([n, r]) =>
        `${n}\tSoll ${r.soll}\tIst ${r.ist === null ? '?' : r.ist}`
        + `\tfehlt ${r.ist === null ? '?' : r.fehlt}\tüberzählig ${r.ist === null ? '?' : r.ueber}`).join('\n');
      try { await navigator.clipboard.writeText(txt); log('In der Zwischenablage', 'good'); }
      catch { log('Kopieren nicht möglich:\n' + txt); }
    };
    draw(); log('');
    return;
  }

  const [label, fn, hint] = acts[tab];
  const modus = tab !== 'kaufen' ? '' : `
    <div style="border:1px solid var(--lp-rand);border-radius:3px;padding:9px 11px;margin:0 0 10px">
      <div style="color:var(--lp-dim);font-size:12px;margin-bottom:6px">Wenn Stellplätze fehlen:</div>
      <label style="display:block;margin-bottom:4px">
        <input type="radio" name="lsspmode" value="strict" ${S.opts.strict !== false ? 'checked' : ''}>
        <b>Wache ganz überspringen</b> <span style="color:var(--lp-dim2)">— erst Ausbauten bauen, dann kaufen</span></label>
      <label style="display:block">
        <input type="radio" name="lsspmode" value="fit" ${S.opts.strict === false ? 'checked' : ''}>
        <b>So viel kaufen, wie Platz ist</b> <span style="color:var(--lp-dim2)">— Rest wird gemeldet</span></label>
    </div>`;
  const einzeln = tab !== 'leeren' ? '' : `
    <div style="border:1px solid #6b2f2f;background:#2a1414;border-radius:3px;padding:9px 11px;margin:0 0 10px;color:var(--lp-err)">
      <b>Nur eine Wache je Lauf.</b> Sind mehrere ausgewählt, passiert nichts.
      Der Vorgang löst jede Person von ihrem Fahrzeug — danach ist die Wache leer,
      bis du das Personal neu zuweist.
    </div>`;
  const vollopt = tab !== 'personal' ? '' : `
    <label style="display:block;margin:0 0 10px;color:var(--lp-dim)">
      <input type="checkbox" id="lssp-voll" ${S.opts.vollBesetzen !== false ? 'checked' : ''}>
      <b>Fahrzeuge voll besetzen</b>
      <span style="color:var(--lp-dim2)">— sobald jedes Fahrzeug seine Mindestbesetzung hat,
      wandern die Übrigen auf freie Sitze. Wer einen Lehrgang hat, der an dieser Wache
      gebraucht wird, bleibt frei.</span></label>`;
  const heimwarnung = tab !== 'personal' ? '' : `
    <div style="border:1px solid #6b4a1f;background:#2a1f10;border-radius:3px;padding:9px 11px;margin:0 0 10px;color:var(--lp-akzent)">
      <b>Vorher alle Fahrzeuge einrücken lassen.</b> Der Status lässt sich nur umschalten, wenn ein
      Fahrzeug auf seiner Wache steht. Was unterwegs ist, wird vorgemerkt und beim nächsten Lauf nachgeholt.
    </div>`;
  b.innerHTML = `<p class="hint">${esc(hint)}<br><br>
      <b>Lass „Nur Vorschau“ zunächst angehakt.</b> Dann passiert nichts im Spiel, du siehst unten
      nur die Liste dessen, was getan würde. Erst wenn das stimmt, Haken entfernen und erneut drücken.</p>
      ${einzelAnsicht()}${einzeln}${heimwarnung}${vollopt}${modus}${buildingList()}
    <div class="row tun">
      <label style="color:var(--lp-dim)"><input type="checkbox" id="lssp-dry" ${S.opts.dry ? 'checked' : ''}> Nur Vorschau</label>
      <label style="color:${S.opts.gruenFrei ? 'var(--lp-err)' : 'var(--lp-dim)'}" title="Ohne diesen Haken bleibt alles unberührt, was ${HAKEN} trägt">
        <input type="checkbox" id="lssp-gruen" ${S.opts.gruenFrei ? 'checked' : ''}> Grüne freigeben</label>
      <span style="flex:1"></span>
      <button class="act ${tab === 'verkauf' ? 'danger' : 'go'}" id="lssp-run">${esc(label)}</button>
    </div>
    ${logKopf()}<pre id="lssp-log"></pre>`;

  b.querySelector('#lssp-type')?.addEventListener('change', render);
  b.querySelector('#lssp-nuroffen')?.addEventListener('change', e => {
    S.opts.nurOffen = e.target.checked; store.set(KEY_OPTS, S.opts); render();
  });
  b.querySelectorAll('button.ruht').forEach(x => x.onclick = ev => {
    ev.preventDefault(); ruhtUm(Number(x.dataset.id)); render();
  });
  auswahlBinden(b);
  einzelBinden(b);
  b.querySelector('#lssp-dry').onchange = e => {
    S.opts.dry = e.target.checked;
    store.set(KEY_OPTS, S.opts);
    scharfZeigen();               // sonst bleibt der rote Rahmen aus, bis etwas anderes neu zeichnet
  };
  b.querySelector('#lssp-gruen')?.addEventListener('change', e => {
    S.opts.gruenFrei = e.target.checked;
    store.set(KEY_OPTS, S.opts);
    render();                       // die Listen urteilen anders, sobald der Schutz fällt
  });
  b.querySelector('#lssp-voll')?.addEventListener('change', e => {
    S.opts.vollBesetzen = e.target.checked; store.set(KEY_OPTS, S.opts);
  });
  b.querySelectorAll('input[name=lsspmode]').forEach(r => r.onchange = e => {
    S.opts.strict = e.target.value === 'strict'; store.set(KEY_OPTS, S.opts);
  });
  b.querySelector('#lssp-run').onclick = async ev => {
    if (S.busy) return;
    const sel = selectedBuildings();
    if (!sel.length) return log('Keine Wache ausgewählt', 'warn');
    const dry = b.querySelector('#lssp-dry').checked;
    /* Der Verkauf bekommt bewusst kein „nicht mehr fragen“ — er ist die
       einzige Aktion, die sich nicht rückgängig machen lässt. */
    if (!dry && tab === 'verkauf' &&
        !await frage(`Wirklich Fahrzeuge verkaufen? Das lässt sich nicht rückgängig machen.\n${sel.length} Wachen betroffen.`)) return;
    if (!dry && !await frage(`${label} für ${sel.length} Wachen ausführen?`, 'ausfuehren-' + tab)) return;
    S.busy = true; ev.target.disabled = true; laufStarten();
    S.log = []; log(dry ? '── Vorschau ──' : '── Ausführung ──', 'good');
    try {
      const n = await fn(sel, dry);
      log(`${dry ? 'Vorschau' : 'Fertig'}: ${n} Aktionen`, 'good');
      if (!dry && n) log(`Bestand lokal fortgeschrieben. Für gemessene Zahlen `
        + `„Bestand neu laden“ drücken.`, 'warn');
    } catch (e) { log('Abbruch: ' + e.message, 'err'); }
    S.busy = false; ev.target.disabled = false; fortAus();
  };
  log('');
}

/* ── Auf der Wachenseite ──────────────────────────────────────────────
   Versuchsweise: wer eine Wache im Spiel öffnet, sieht dort gleich, was ihr
   nach dem Wunschbild fehlt. Rein lesend, ohne einen einzigen Abruf — alles
   steht schon im Bestand. Ist der Bestand nicht geladen, erscheint nichts;
   eine Schätzung wäre schlimmer als eine Lücke.
   ─────────────────────────────────────────────────────────────────── */
function wachenSeite() {
  const treffer = location.pathname.match(/^\/buildings\/(\d+)\/?$/);
  if (!treffer) return;
  if (!ui.inline) return;                      // versuchsweise, standardmäßig aus
  const b = S.byId.get(Number(treffer[1]));
  if (!b || ausgeschlossen(b) || !T.target(b)) return;

  const a = analyse(b), f = fortschritt(b);
  const zeile = (titel, stuecke, art) => stuecke.length
    ? `<div style="margin:3px 0"><b style="color:${art}">${titel}:</b> ${esc(stuecke.join(', '))}</div>` : '';

  const kurse = Object.keys(courseNeed(b)).map(key => {
    const p = kursPosten(b, key);
    return p.fehlt ? `${p.fehlt}× ${kursNamen(key)[0] || key}` : null;
  }).filter(Boolean);

  const kasten = document.createElement('div');
  kasten.id = 'lssp-wache';
  kasten.style.cssText = 'border:1px solid #ddd;border-left:4px solid '
    + (f.fertig ? '#3c763d' : '#f0ad4e')
    + ';border-radius:4px;padding:8px 12px;margin:0 0 12px;background:#fbfbfb;font-size:13px';
  kasten.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <b>Planer</b>
      <span style="color:#777;font-size:11px">Profil „${esc(T.profileOf(b) || '—')}“ · Stand vom ${
        S.stamp ? new Date(S.stamp).toLocaleString('de') : '?'}</span>
      <span style="flex:1"></span>
      <a href="#" id="lssp-wache-zu" style="font-size:11px">ausblenden</a></div>`
    + (f.fertig ? '<div style="color:#3c763d">Diese Wache ist nach Plan vollständig.</div>' : '')
    + zeile('Fahrzeuge fehlen', a.vehMissing.map(v => `${v.n}× ${v.name}`), '#a94442')
    + zeile('Überzählig', a.vehSurplus.map(v => `${v.n}× ${v.name}`), '#8a6d3b')
    + zeile('Ausbauten fehlen', a.extMissing.map(e => e.caption), '#a94442')
    + zeile('Lehrgänge fehlen', kurse, '#a94442')
    + (f.personal ? `<div style="margin:3px 0"><b style="color:#8a6d3b">Unterbesetzt:</b> ${f.personal} Fahrzeuge</div>` : '')
    + (f.anhaenger ? `<div style="margin:3px 0"><b style="color:#8a6d3b">Ohne Zugfahrzeug:</b> ${f.anhaenger} Anhänger</div>` : '');

  /* Ein Selektor mit Komma nimmt NICHT den erstgenannten Treffer, sondern den
     ersten in Dokumentreihenfolge — die gedachte Rangfolge war also wirkungslos,
     und `.col-md-12` hätte fast jede Bootstrap-Spalte gewonnen. Am Spiel
     nachgesehen: von den vier geratenen Ankern existiert **keiner**. Die Seite
     hängt alles unter `#iframe-inside-container`. Deshalb der Reihe nach
     probieren, den ersten Treffer nehmen und sagen, wenn keiner paßt — geraten
     wird hier nicht mehr. */
  const ANKER = ['#iframe-inside-container', '#building_panel', '#content', '.content'];
  let ziel = null;
  for (const sel of ANKER) { ziel = document.querySelector(sel); if (ziel) break; }
  if (!ziel) {
    log('Hinweis auf der Wachenseite: kein Platz gefunden — '
      + `keiner dieser Anker existiert: ${ANKER.join(', ')}`, 'warn');
    return;
  }
  document.querySelector('#lssp-wache')?.remove();
  ziel.prepend(kasten);
  kasten.querySelector('#lssp-wache-zu').onclick = e => {
    e.preventDefault(); ui.inline = false; saveUi(); kasten.remove();
  };
}

function mount() {
  profilnamenNachziehen();
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const btn = document.createElement('button'); btn.id = 'lssp-btn'; btn.textContent = 'Planer';
  el = document.createElement('div'); el.id = 'lssp';
  el.innerHTML = `<header><b>LSS Planer</b><span style="color:var(--lp-dim2);font-size:11px">v${VERSION}</span>
      <span style="color:var(--lp-dim2);font-size:11px" id="lssp-drag-hint">ziehen zum Verschieben</span>
      <span class="sp"></span>
      <span class="scharfmarke" id="lssp-scharf" style="display:none">SCHARF</span>
      <button class="ico" id="lssp-thema" title="Helles oder dunkles Bild">◐</button>
      <button class="ico" id="lssp-stop" title="Laufenden Vorgang abbrechen">⏹</button>
      <button class="ico" id="lssp-aus" title="In eigenes Fenster lösen">⇱</button>
      <button class="ico" id="lssp-full" title="Vollbild">⛶</button>
      <button class="ico" id="lssp-close" title="Schließen">×</button></header>
    <nav></nav><div class="unter"></div>
    <div id="lssp-fort" style="display:none"><div class="balken"></div><span class="wort"></span></div>
    <div class="body"></div>`;
  document.body.append(btn, el);
  // Erst wenn der Bestand steht, hat die Wachenseite etwas zu zeigen
  if (S.loaded) wachenSeite();
  btn.onclick = () => { el.classList.toggle('on'); render(); };
  el.querySelector('#lssp-stop').onclick = () => {
    if (!S.busy) return log('Es läuft gerade nichts.', 'warn');
    laufStoppen(); log('Abbruch angefordert — der laufende Schritt wird noch beendet.', 'warn');
  };
  el.querySelector('#lssp-close').onclick = () => { laufStoppen(); el.classList.remove('on'); };

  /* Eigenes Fenster: das Panel wandert per adoptNode hinüber, es entsteht
     keine zweite Fassung. Derselbe Ursprung, dieselbe Sitzung, dieselbe
     Warteschlange — nur ein anderes Fenster. Das Spiel muß offen bleiben,
     denn dort läuft der Code weiterhin. */
  let aussen = null;
  const zurueckholen = () => {
    if (!aussen) return;
    document.body.appendChild(document.adoptNode(el));
    el.classList.add('on');
    el.classList.remove('imFenster');
    aussen = null;
    render();
  };
  el.querySelector('#lssp-aus').onclick = () => {
    if (aussen && !aussen.closed) { aussen.focus(); return; }
    aussen = open('', 'lssp-fenster', 'width=620,height=860');
    if (!aussen) return log('Das Fenster wurde blockiert — Pop-ups für diese Seite erlauben.', 'warn');
    aussen.document.write('<!doctype html><meta charset="utf-8"><title>LSS Planer</title>');
    aussen.document.close();
    aussen.document.documentElement.className = document.documentElement.className;
    const st = aussen.document.createElement('style');
    st.textContent = css + `
      html,body{margin:0;height:100%;background:var(--lp-bg)}
      #lssp{position:static!important;width:auto!important;height:100vh!important;
            max-height:100vh!important;border:0;border-radius:0;box-shadow:none;display:flex!important}
      #lssp header .ico[id="lssp-aus"],#lssp header .ico[id="lssp-full"]{display:none}
      #lssp-drag-hint{display:none}`;
    aussen.document.head.appendChild(st);
    aussen.document.body.appendChild(aussen.document.adoptNode(el));
    el.classList.add('on', 'imFenster');
    aussen.addEventListener('beforeunload', zurueckholen);
    // Schließt sich das Spiel, hat das Fenster keinen Code mehr hinter sich
    addEventListener('pagehide', () => aussen && !aussen.closed && aussen.close(), { once: true });
    render();
  };
  addEventListener('pagehide', laufStoppen, { once: true });
  /* ---------- Verschieben und Vollbild ---------- */
  document.documentElement.classList.toggle('lssp-hell', !!ui.hell);
  el.querySelector('#lssp-thema').onclick = () => {
    ui.hell = !ui.hell;
    document.documentElement.classList.toggle('lssp-hell', !!ui.hell);
    saveUi();
  };

  function place() {
    if (ui.full) { el.classList.add('full'); return; }
    el.classList.remove('full');
    if (typeof ui.x === 'number' && typeof ui.y === 'number') {
      const w = el.offsetWidth || 520, h = el.offsetHeight || 400;
      // Nach Fenstergrößenänderung nicht aus dem Bild rutschen
      ui.x = Math.min(Math.max(0, ui.x), Math.max(0, innerWidth - 120));
      ui.y = Math.min(Math.max(0, ui.y), Math.max(0, innerHeight - 60));
      Object.assign(el.style, { left: ui.x + 'px', top: ui.y + 'px', right: 'auto', bottom: 'auto' });
    }
  }

  const fullBtn = el.querySelector('#lssp-full');
  const hint = el.querySelector('#lssp-drag-hint');
  function syncFull() {
    fullBtn.textContent = ui.full ? '🗗' : '⛶';
    fullBtn.title = ui.full ? 'Vollbild verlassen' : 'Vollbild';
    hint.style.display = ui.full ? 'none' : '';
  }
  fullBtn.onclick = () => { ui.full = !ui.full; saveUi(); place(); syncFull(); };

  /* Zieh-Handler nur registrieren, solange wirklich gezogen wird — sonst
     lauscht das Fenster dauerhaft auf jede Mausbewegung der Seite. */
  let drag = null;
  const beimZiehen = ev => {
    if (!drag) return;
    ui.x = Math.min(Math.max(0, ev.clientX - drag.dx), innerWidth - 120);
    ui.y = Math.min(Math.max(0, ev.clientY - drag.dy), innerHeight - 60);
    Object.assign(el.style, { left: ui.x + 'px', top: ui.y + 'px', right: 'auto', bottom: 'auto' });
  };
  const ziehenEnde = () => {
    if (!drag) return;
    drag = null; el.classList.remove('drag'); saveUi();
    removeEventListener('pointermove', beimZiehen);
    removeEventListener('pointerup', ziehenEnde);
  };
  el.querySelector('header').addEventListener('pointerdown', ev => {
    if (ui.full || ev.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    el.classList.add('drag');
    el.setPointerCapture?.(ev.pointerId);
    addEventListener('pointermove', beimZiehen);
    addEventListener('pointerup', ziehenEnde);
    ev.preventDefault();
  });
  addEventListener('resize', place);
  addEventListener('pagehide', () => {
    removeEventListener('resize', place);
    removeEventListener('pointermove', beimZiehen);
    removeEventListener('pointerup', ziehenEnde);
  }, { once: true });

  // Doppelklick auf die Titelzeile schaltet ebenfalls um
  el.querySelector('header').addEventListener('dblclick', ev => {
    if (ev.target.closest('button')) return;
    ui.full = !ui.full; saveUi(); place(); syncFull();
  });

  place(); syncFull();
}

/* ═══════════════════════════════════════════════════════════════════
   Lehrgangsseite: Bedarf je Wache einblenden und Auswahl füllen
   Der Knopf hakt nur Checkboxen an — abgeschickt wird das Formular
   vom Spiel selbst über „Ausbilden".
   ═══════════════════════════════════════════════════════════════════ */
function educationPage() {
  const selEdu = document.querySelector('#education_select');

  /* Welche Schulart diese Seite ist, verrät die Adresse: /buildings/<id>.
     Daraus folgt, für welche Wachen sie ausbilden darf — und nur deren
     Bedarf gehört in die Beschriftung. Bei einer Verbandsschule, die nicht
     im eigenen Bestand steht, bleibt es beim ungefilterten Gesamtbedarf. */
  /* Welche Schulart ist das? Zwei Wege, weil zwei Adressen hierher führen:

     Auf `/buildings/<id>` steht die Schule im Pfad. Sie steckt aber nur dann in
     `S.byId`, wenn sie EIGEN ist — `S.byId` wird aus `/api/buildings` gebaut.
     Von 28 Schulen dieses Kontos gehören 27 dem Verband, also war `schulTyp`
     auf so gut wie jeder Schulseite `null`, `zustaendigFuer(null)` lieferte
     nichts, und die Trennung nach Zweigen aus D-48 war abgeschaltet — genau der
     Fall mit den 225 Verpflegungshelfern, den D-48 beheben sollte.

     Auf `/schoolings/<id>` steht die Schule überhaupt nicht im Pfad. Dafür
     nennt jedes Gebäude in `/api/buildings` und `/api/alliance_buildings` unter
     `schoolings[]` die Kennungen seiner laufenden Kurse — darüber ist die
     Schule zu finden. Das kostet einen Abruf, der ohnehin zwischengespeichert
     ist, und läuft nachträglich: bis er zurück ist, wird ungefiltert gerechnet,
     danach einmal neu gezeichnet. Lieber kurz ungefiltert als dauerhaft falsch. */
  const schulId = Number((location.pathname.match(/\/buildings\/(\d+)/) || [])[1]) || null;
  const kursId  = Number((location.pathname.match(/\/schoolings\/(\d+)/) || [])[1]) || null;
  let zustaendig = null;
  const inReichweite = b => !zustaendig?.size || zustaendig.has(Number(b.building_type));

  function setzeZustaendig(typ) {
    if (typ == null) return false;
    const neu2 = zustaendigFuer(typ);
    if (!neu2?.size) return false;
    zustaendig = neu2;
    return true;
  }
  setzeZustaendig(schulId != null ? S.byId.get(schulId)?.building_type ?? null : null);

  /** Schulart nachtragen, wenn sie aus dem eigenen Bestand nicht hervorging. */
  async function schulartNachtragen() {
    if (zustaendig?.size) return;
    try {
      const kandidaten = [...S.buildings];
      const av = await apiGet('/api/alliance_buildings');
      if (Array.isArray(av)) kandidaten.push(...av);
      let typ = null;
      if (schulId != null) typ = kandidaten.find(x => Number(x.id) === schulId)?.building_type ?? null;
      if (typ == null && kursId != null)
        typ = kandidaten.find(x => (x.schoolings || []).some(k => Number(k.id) === kursId))?.building_type ?? null;
      if (setzeZustaendig(typ)) { refresh(); auswahlBeschriften(); }
    } catch (e) {
      log('Schulart nicht bestimmbar: ' + e.message, 'warn');
    }
  }

  // Zuordnung lernen, wo ein Auswahlfeld vorhanden ist
  const map = store.get(KEY_COURSE, {});
  if (selEdu) {
    selEdu.querySelectorAll('option').forEach(o => {
      if (!o.value.includes(':')) return;
      map[o.value.split(':')[0]] = o.textContent.replace(/\s*\(\d+\s*Tage?\)\s*$/, '').trim();
    });
    store.set(KEY_COURSE, map);
    kurseVergessen();
  }
  const namen = learnedCourses;

  // Wunschbild und Zuordnung kommen seit v0.32 aus eigenem Speicher; der
  // importierte Plan wird auf dieser Seite gar nicht mehr gebraucht (D-54).
  /* `S.modell` fällt auf MODELL_STANDARD zurück, ist also NIE leer — die alte
     Prüfung `Object.keys(modell).length` konnte deshalb nie zuschlagen, und der
     rote Hinweis „Es gibt noch kein Wunschbild" war unerreichbar. Gefragt ist
     nicht, ob ein Wunschbild im Speicher steht, sondern ob je eines angelegt
     wurde — sonst wird gegen fremde Vorgaben gebucht. */
  const eigenesWunschbild = () => !!store.get(KEY_MODELL, null);
  let handKey = null;              // vom Nutzer gewählt, falls nicht erkennbar

  /** Um welchen Lehrgang geht es auf dieser Seite? Mehrere Wege, weil die
      Seiten für eigene, fremde und Verbandslehrgänge unterschiedlich sind. */
  function erkannterKurs() {
    if (selEdu && selEdu.value.includes(':')) return selEdu.value.split(':')[0];

    // Lehrgangsseiten nennen den Schlüssel im eigenen Skript
    const m = document.documentElement.innerHTML.match(/schooling_disable\(\s*["']([a-z0-9_]+)["']\s*\)/);
    if (m) return m[1];

    // Sichtbarer Beschreibungsblock trägt den Schlüssel im id-Attribut
    for (const d of document.querySelectorAll('[id^="description_"]')) {
      if (d.offsetParent !== null && !d.hidden) return d.id.replace(/^description_/, '');
    }
    // Gesperrte Checkboxen verraten den Kurs: das Spiel sperrt genau die,
    // die ihn schon haben
    const box = document.querySelector('.schooling_checkbox[disabled]');
    if (box) for (const a of box.attributes)
      if (a.value === 'true' && kursNamen(a.name).length) return a.name;

    // Sonst über den Klartext in Überschriften und Titel
    const text = [document.title,
      ...[...document.querySelectorAll('h1,h2,h3,.panel-title,.alert')].map(e => e.textContent)]
      .join(' ');
    let treffer = null, laenge = 0;
    for (const [k, liste] of Object.entries(namen()))
      for (const cap of (Array.isArray(liste) ? liste : [liste]))
        if (cap && text.includes(cap) && cap.length > laenge) { treffer = k; laenge = cap.length; }
    return treffer;
  }

  /* erkannterKurs() serialisiert im ungünstigsten Fall das ganze Dokument.
     Einmal je Auffrischung reicht — sonst lief das je Panel. */
  let keyCache = null, keyGueltig = false;
  const keyVergessen = () => { keyGueltig = false; };
  const curKey = () => {
    /* Die Auswahl des Spiels hat immer recht. Sie zuerst zu lesen erspart die
       Suche im Dokument und hält die Zahlen aktuell, wenn der Mensch oben
       einen anderen Lehrgang wählt — vorher blieb der alte Schlüssel stehen
       und „Bedarf anhaken“ hakte den Bedarf des vorigen Kurses an. */
    if (selEdu && selEdu.value.includes(':')) return selEdu.value.split(':')[0];
    if (handKey) return handKey;
    if (!keyGueltig) { keyCache = erkannterKurs(); keyGueltig = true; }
    return keyCache;
  };
  const curName = () => {
    // Der Text der gewählten Option ist der genaueste Name — ein Schlüssel
    // kann je Schule verschieden heißen.
    const opt = selEdu?.selectedOptions?.[0];
    const ausAuswahl = (opt?.dataset?.lsspOrig || opt?.textContent || '')
      .replace(/\s*\(\d+\s*Tage?\)\s*$/, '').replace(/,[^,)]*\)$/, ')').trim();
    // Die Option trägt ihren Schlüssel selbst — kein Namensvergleich nötig
    if (ausAuswahl && opt?.value?.split(':')[0] === curKey()) return ausAuswahl;
    return kursNamen(curKey())[0] || curKey() || '';
  };

  const panels = () => [...document.querySelectorAll('.building_list[building_id]')];
  const idOf   = el => Number(el.getAttribute('building_id'));
  const typeOf = el => Number(el.getAttribute('building_type_id'));
  /* Gefiltert wird auf dieser Seite NICHT vom Spiel — ein Suchfeld gibt es dort
     gar nicht —, sondern vom LSS-Manager. Am Spiel nachgesehen heißt seine
     Klasse `lssmv4-buildingListFilter-filter-hidden`; keiner der drei bisher
     geratenen Namen kommt vor. Eine im Manager ausgefilterte Wache galt damit
     als sichtbar und wurde mitangehakt. Die alten Namen bleiben stehen, falls
     das Spiel doch einmal selbst filtert. */
  const sichtbar = el => !el.classList.contains('lssmv4-buildingListFilter-filter-hidden')
                      && !el.classList.contains('hidden-by-dispatch')
                      && !el.classList.contains('building-filtered-by-search')
                      && !el.classList.contains('hidden');
  const nameVon = el => el.getAttribute('search_attribute') || idOf(el);

  /* Der grüne Punkt schützt auch gegen Ausbildung (Sasha, 27.08.): ein Lehrgang
     zieht die Person für Tage vom Fahrzeug, und D-27 sagt, Grünes wird nicht
     angetastet. Von dieser Seite aus ist allerdings nicht zu sehen, WER auf
     welchem Fahrzeug sitzt — die Ankreuzfelder nennen nur die Wache. Zu
     entscheiden ist hier also nur der eindeutige Fall: steht an einer Wache
     ausschließlich Grünes, ist dort jede Besatzung geschützt, und die Wache
     wird übergangen. Bei gemischten Wachen bleibt eine Lücke; sie ist in
     NAECHSTER_SCHRITT.md notiert und braucht die Zuweisungsseite. */
  const nurGruen = el => {
    const fz = (S.byBuilding?.get(Number(idOf(el))) || []).filter(v => T.veh(v.vehicle_type)?.max);
    return fz.length > 0 && fz.every(v => geschuetzt(v));
  };

  /** Freie Plätze — oder null, wenn die Seite es nicht sagt. */
  const freiePlaetze = () => {
    const feld = document.querySelector('#schooling_free');
    if (feld) {
      const n = Number((feld.textContent || '').replace(/\D+/g, ''));
      if (Number.isFinite(n)) return n;
    }
    // Auf Lehrgangsseiten ohne eigenen Zähler steht die Zahl im Text
    const m = document.body.textContent.match(/(?:Freie|freie)\s+Pl[äa]tze[^0-9]{0,12}(\d+)/);
    if (m) return Number(m[1]) - document.querySelectorAll('.schooling_checkbox:checked').length;
    /* Hier wurde früher „10 je Klassenraum" geraten. Auf der Seite eines
       LAUFENDEN Lehrgangs gibt es aber weder Zähler noch Wachenliste — geraten
       wurden dann zehn freie Plätze für einen Kurs, der niemanden mehr aufnimmt,
       und die Absage nannte anschließend den Filter des Spiels als Grund.
       Lieber eine Lücke melden als eine Vermutung einsetzen. */
    return null;
  };

  /** Läuft dieser Lehrgang schon? Dann zeigt die Seite weder Zähler noch
      Wachenliste, und es kann niemand mehr dazukommen. */
  const laeuftSchon = () => !document.querySelector('#schooling_free') && !panels().length;
;

  /** Soll dieser Wache für den gewählten Lehrgang, aus dem Plan. */
  /* Rechnet nicht mehr selbst, sondern fragt den geprüften Kern.
     Die eigene Rechnung hier war die dritte Fassung derselben Formel und die
     einzige ohne `anhaengerZaehlt` — sie zählte die Besatzung eines Anhängers
     doppelt, einmal am Anhänger und einmal am Zugfahrzeug, das dieselben Leute
     fährt. Nachgerechnet über alle 89 Kurs/Profil-Paare des eingebauten
     Wunschbilds weichen genau zwei ab, beide beim `gw_wasserrettung`:
     Wasserrettung 20 statt 12 (min 10 statt 2), SEG 10 statt 6 (min 5 statt 1).
     Der erste Durchgang von `fill()` rechnet über `sollMin` — dort buchte er
     also das Fünffache. Das ist die Regel aus D-19, die auf diesem Weg nie
     ankam; `test-planung.js` hält sie in Probe 17 fest.

     Nebenwirkung, gewollt: `T.target` geht über `T.profiles` und damit über
     NICHT_PLANEN (D-40), und es liest `S.modell` frisch statt die Kopie, die
     beim Seitenaufbau gezogen wurde und nie nachzieht. */
  function needFor(buildingId, buildingType, feld = 'max') {
    if (!inReichweite({ building_type: buildingType })) return 0;
    const key = curKey(); if (!key) return 0;
    return bedarfDerWache({ id: buildingId, building_type: buildingType }, key)[feld] || 0;
  }

  /* Einmal ermittelte Zahlen bleiben gültig, auch wenn die Wache wieder
     zugeklappt ist. Abgelegt wird das im selben Speicher wie der übrige
     Ausbildungsstand — eine Quelle statt dreier. */
  let standSchmutzig = false;
  const merkeStand = (id, key, n) => {
    const z = (quals.by[id] ||= {});
    /* Haben wir die Personalliste dieser Wache selbst gelesen, steht in z
       die verteilte Zahl — eine Person, ein Kurs. Die Zahl des Spiels zählt
       Doppelqualifizierte mehrfach und darf sie nicht überschreiben. */
    if (z._verfuegbar != null) {
      const r = (z._roh ||= {});
      if (r[key] === n) return;
      r[key] = n; quals.ts = Date.now();
      standSchmutzig = true;
      return;
    }
    if (z[key] === n) return;
    z[key] = n; quals.ts = Date.now();
    standSchmutzig = true;          // gesammelt am Ende von refresh() sichern
  };

  /** Wie viele stecken hier gerade in diesem Lehrgang. Das Spiel schreibt
      diese Zahl selbst in die Kopfzeile — sie ist nicht die Zahl der
      Ausgebildeten, sondern die der laufenden Ausbildungen. */
  /** Kursdauer aus der Auswahl, für das Verfallsdatum des Merkers. */
  function kursTage(key) {
    const opt = selEdu?.querySelector(`option[value^="${key}:"]`);
    const m = (opt?.dataset.lsspOrig || opt?.textContent || '').match(/(\d+)\s*Tage?/);
    return m ? Number(m[1]) : 7;
  }

  function inAusbildungAt(id) {
    const lab = document.querySelector('#personal-select-heading-building-' + id);
    const m = (lab?.textContent || '').match(/(\d+)\s*in Ausbildung/);
    if (!m) return 0;
    const n = Number(m[1]);
    const key = curKey();
    if (key) merkeInAusbildung(key, id, n, kursTage(key));   // für die Kursauswahl merken
    return n;
  }

  /** Wie viele hier den gewählten Lehrgang bereits abgeschlossen haben.
      Der LSS-Manager blendet diese Zahl als grünes Label ein; im
      Originalspiel gibt es sie nicht, dort wird selbst gezählt. */
  function trainedAt(id, key) {
    const lab = document.querySelector('#personal-select-heading-building-' + id);
    const gruen = (lab?.textContent || '').match(/(\d+)\s*ausgebildete/i);
    if (gruen) { merkeStand(id, key, Number(gruen[1])); return Number(gruen[1]); }

    const body = document.querySelector(`.panel-body[building_id="${id}"]`);
    if (body && !body.classList.contains('hidden')) {
      const boxes = [...body.querySelectorAll('.schooling_checkbox')];
      if (boxes.length) {
        const n = boxes.filter(c => c.getAttribute(key) === 'true').length;
        merkeStand(id, key, n);
        return n;
      }
    }
    if (quals.by[id] && key in quals.by[id]) return quals.by[id][key];
    if (quals.by[id]) return 0;              // erfasst, aber niemand mit diesem Kurs
    return null;
  }

  const base = 'display:inline-block;margin-right:10px;padding:3px 9px;border-radius:3px;'
             + 'font:600 11px/1.35 monospace;text-align:right;vertical-align:middle';
  function badge(el) {
    let b = el.querySelector('.lssp-need');
    if (!b) {
      b = document.createElement('span');
      b.className = 'lssp-need';
      b.style.cssText = base;
      el.querySelector('.pull-right')?.prepend(b);
    }
    return b;
  }

  /** Offener Bedarf je Wache, für Anzeige und Auswahl. */
  function bedarf(el, key) {
    if (!key) return null;
    const id = idOf(el), typ = typeOf(el);
    const soll = needFor(id, typ, 'max');
    const sollMin = needFor(id, typ, 'min');
    const da = trainedAt(id, key);
    const lauf = inAusbildungAt(id);
    // Wer gerade ausgebildet wird, zählt bereits als vorhanden
    const vorhanden = da === null ? null : da + lauf;
    return {
      soll, sollMin, da, lauf, vorhanden,
      offen:    vorhanden === null ? null : Math.max(0, soll - vorhanden),
      offenMin: vorhanden === null ? null : Math.max(0, sollMin - vorhanden)
    };
  }

  const grau  = base + ';background:#e8eaed;color:#57606a';
  const gelb  = base + ';background:#f0ad4e;color:#fff';
  const gruen = base + ';background:#5cb85c;color:#fff';

  let imRefresh = false;
  const setHtml = (n, h) => { if (n.innerHTML !== h) n.innerHTML = h; };

  function refresh() {
    // Das Schreiben der Beschriftungen erzeugt selbst DOM-Änderungen. Ohne
    // diese Sperre stößt der Beobachter unten den nächsten Durchlauf an —
    // eine Dauerschleife ohne jede Nutzereingabe.
    if (imRefresh) return;
    imRefresh = true;
    keyVergessen();
    reloadQuals(true);
    try { refreshIntern(); }
    finally { beobachter?.takeRecords(); imRefresh = false; }
    if (standSchmutzig) { saveQuals(); standSchmutzig = false; }
    sichereInAusbildung();
  }

  function refreshIntern() {
    const key = curKey();
    for (const el of panels()) {
      const b = badge(el);
      if (!key) { setHtml(b, ''); b.style.cssText = base + ';background:transparent'; continue; }
      const d = bedarf(el, key);
      const lauf = d.lauf ? ` (+${d.lauf} in Ausbildung)` : '';
      if (!d.soll) {
        setHtml(b, d.da === null ? 'kein weiterer Bedarf'
                                 : `Ausgebildet: ${d.da}${lauf}<br>kein weiterer Bedarf`);
        b.style.cssText = grau; continue;
      }
      if (d.vorhanden === null) { setHtml(b, `Ziel: ${d.soll}<br>Stand unbekannt`); b.style.cssText = grau; continue; }
      setHtml(b, `Ausgebildet: ${d.da}${lauf}<br>Ziel: ${d.soll} &nbsp;|&nbsp; Fehlend ${d.offen}`);
      b.style.cssText = d.offen ? gelb : gruen;
    }
  }

  function alertBar(text) {
    const d = document.querySelector('#lssp-edu-msg');
    if (d) d.textContent = text;
  }

  /** Hakt so viele Personen an, wie in den Lehrgang passen — nach Bedarf
      sortiert, und nur bei Wachen, die auch wirklich welche brauchen. */
  /** Darf diese schon ausgebildete Person in einen weiteren Lehrgang?
      Regel (Sasha, 27.08.): ja, aber nur wenn der Lehrgang, den sie bereits
      hat, an dieser Wache um mindestens die Hälfte über dem liegt, was die
      Fahrzeuge brauchen, die ihn fordern. Sonst reißt die Ausbildung ein Loch
      in eine Besetzung, die gerade steht — und der Grund gehört genannt.
      Ungelernte gehen immer zuerst; das ist D-07 und bleibt. */
  function darfInDenKurs(el, c) {
    const eigene = [...c.attributes].filter(a => a.value === 'true').map(a => a.name);
    if (!eigene.length) return { ok: true };
    const id = idOf(el), typ = typeOf(el);
    for (const k of eigene) {
      const noetig = bedarfDerWache({ id, building_type: typ }, k).max;
      if (!noetig) continue;                       // hier gar nicht verlangt
      const da = trainedAt(id, k);
      if (da === null) return { ok: false, grund: `${kursNamen(k)[0] || k} nicht erfaßt` };
      if (da < noetig * 1.5)
        return { ok: false, grund: `${kursNamen(k)[0] || k} ${da}/${noetig} — keine 50 % Überdeckung` };
    }
    return { ok: true };
  }

  /** Öffnet eine Wache bei Bedarf und hakt bis zum Ziel an.
      Gibt zurück, wie viele gesetzt wurden; Übergangenes wandert mit Begründung
      nach `uebergangen`, damit am Ende nicht „nichts gefunden" dasteht, wo in
      Wirklichkeit die Liste nicht geladen hat. */
  async function fuelleWache(el, ziel, key, frei, geoeffnet, wiederZu, uebergangen) {
    if (ziel <= 0 || frei <= 0) return 0;
    const id = idOf(el);
    const body = el.querySelector(`.panel-body[building_id="${id}"]`);
    if (body && body.classList.contains('hidden')) {
      alertBar(`Lade Personal von ${nameVon(el)} …`);
      const kopf = el.querySelector('.personal-select-heading');
      if (!kopf) { uebergangen.push(`${nameVon(el)}: Kopfzeile zum Aufklappen nicht gefunden`); return 0; }
      kopf.click();
      wiederZu.push(el);
      geoeffnet.n++;
      for (let i = 0; i < 20 && !body.querySelector('.schooling_checkbox'); i++) await sleep(150);
    }
    const boxes = [...(body?.querySelectorAll('.schooling_checkbox') || [])];
    if (!boxes.length) {
      uebergangen.push(`${nameVon(el)}: Personalliste nicht geladen`);
      return 0;
    }

    let offen = Math.max(0, ziel - boxes.filter(c => c.checked).length);
    /* Ungelernt oder nicht — erkannt am Ankreuzfeld selbst. Es trägt jeden
       Lehrgangsschlüssel als Wahrheitswert. Früher wurde dafür
       `#school_personal_education_<id>` befragt; das Element steht zwar da, ist
       aber leer, also landeten ALLE im Topf „ungelernt" und die Reihenfolge,
       für die D-07 geschrieben wurde, war wirkungslos. */
    const ohne = [], mit = [];
    for (const c of boxes) {
      if (c.checked || c.disabled || c.getAttribute(key) === 'true') continue;
      ([...c.attributes].some(a => a.value === 'true') ? mit : ohne).push(c);
    }

    let gesetzt = 0;
    for (const c of ohne) {
      if (!offen || frei - gesetzt <= 0) break;
      c.checked = true; offen--; gesetzt++;
    }
    for (const c of mit) {
      if (!offen || frei - gesetzt <= 0) break;
      const urteil = darfInDenKurs(el, c);
      if (!urteil.ok) { uebergangen.push(`${nameVon(el)}: übergangen — ${urteil.grund}`); continue; }
      c.checked = true; offen--; gesetzt++;
    }
    return gesetzt;
  }


  /** Hakt so viele Personen an, wie in den Lehrgang passen.
      Erst kommen alle Wachen auf die Mindestbesatzung, danach erst wird
      auf die volle Besatzung aufgefüllt. */
  async function fill() {
    if (!curKey()) { alertBar('Bitte oben zuerst einen Lehrgang auswählen.'); return 0; }
    if (!eigenesWunschbild()) {
      alertBar('Kein eigenes Wunschbild angelegt — es gälte sonst die eingebaute Vorlage, '
        + 'und die ist eine fremde Meinung. Im Planer unter „Plan“ anlegen oder die Vorlage dort übernehmen.');
      return 0;
    }

    let frei = freiePlaetze();
    if (frei === null) {
      alertBar(laeuftSchon()
        ? 'Dieser Lehrgang läuft bereits — es kann niemand mehr dazukommen.'
        : 'Die Zahl der freien Plätze steht nicht auf der Seite. Nichts angehakt.');
      return 0;
    }
    if (frei <= 0) { alertBar('Keine freien Plätze. Mehr Klassenräume wählen oder Häkchen entfernen.'); return 0; }

    const key = curKey();
    /* Ohne den Schlüssel gibt `bedarf()` null zurück — und null hieß einmal
       „nichts offen“ (D-58). Es heißt aber „nicht gemessen“, und danach wird
       nicht gebucht: wer den Ausbildungsstand nicht kennt, bucht sonst das
       volle Ziel, als wäre niemand ausgebildet. Diese Wachen werden benannt
       und übersprungen (Sasha, 27.08.: „erst erfassen"). */
    const alle = panels().filter(sichtbar).map(el => ({ el, d: bedarf(el, key) }));
    const gefragt  = alle.filter(x => x.d && x.d.soll > 0);
    const ohneStand = gefragt.filter(x => x.d.offen === null);
    const gruen = gefragt.filter(x => x.d.offen !== null && x.d.offen > 0 && nurGruen(x.el));
    const kandidaten = gefragt.filter(x => x.d.offen !== null && x.d.offen > 0 && !nurGruen(x.el));

    if (!kandidaten.length) {
      const sichtbareWachen = alle.length;
      alertBar(!sichtbareWachen
        ? 'Keine Wache sichtbar — Filter des LSS-Managers zurücksetzen.'
        : ohneStand.length === gefragt.length && gefragt.length
          ? `Der Ausbildungsstand dieser ${ohneStand.length} Wachen ist nicht erfaßt — `
            + 'im Planer unter „Ausbildung“ erfassen, dann noch einmal.'
          : gruen.length
            ? `${gruen.length} Wachen tragen überall den grünen Punkt — deren Besatzung wird `
              + 'nicht in Lehrgänge geschickt. Zum Ändern den Punkt dort entfernen.'
            : `Für ${kursNamen(key)[0] || key} ist bei allen ${sichtbareWachen} sichtbaren Wachen der Bedarf gedeckt.`);
      return 0;
    }

    const geoeffnet = { n: 0 }, wiederZu = [], uebergangen = [];
    let gesetzt = 0;

    // Durchgang 1: überall die Mindestbesatzung sicherstellen
    const rundeMin = kandidaten
      .filter(x => x.d.offenMin > 0)
      .sort((a2, b2) => b2.d.offenMin - a2.d.offenMin);
    for (const { el, d } of rundeMin) {
      if (frei <= 0) break;
      const n = await fuelleWache(el, Math.min(d.offenMin, frei), key, frei, geoeffnet, wiederZu, uebergangen);
      frei -= n; gesetzt += n;
    }

    // Durchgang 2: auf die volle Besatzung auffüllen
    if (frei > 0) {
      const rundeMax = kandidaten.slice().sort((a2, b2) => b2.d.offen - a2.d.offen);
      for (const { el, d } of rundeMax) {
        if (frei <= 0) break;
        const n = await fuelleWache(el, Math.min(d.offen, frei), key, frei, geoeffnet, wiederZu, uebergangen);
        frei -= n; gesetzt += n;
      }
    }

    // Die geöffneten Wachen wieder einklappen. Die Häkchen bleiben im
    // Formular erhalten, auch wenn der Bereich nicht mehr sichtbar ist.
    for (const el of wiederZu) {
      const body = el.querySelector(`.panel-body[building_id="${idOf(el)}"]`);
      if (body && !body.classList.contains('hidden')) body.classList.add('hidden');
    }

    const fr = document.querySelector('#schooling_free');
    if (fr) fr.textContent = String(Math.max(0, frei));
    refresh();

    /* Die Meldung sagt den Grund, nicht nur das Ergebnis: wie viele Wachen
       aufgeklappt wurden, wie viele übersprungen und warum. `geoeffnet` wurde
       bisher gezählt und nie gelesen. */
    const anhang = []
      .concat(ohneStand.length ? [`${ohneStand.length} ohne erfaßten Stand übersprungen`] : [])
      .concat(gruen.length ? [`${gruen.length} ganz grün, Besatzung geschützt`] : [])
      .concat(uebergangen.length ? [`${uebergangen.length} übergangen`] : [])
      .concat(geoeffnet.n ? [`${geoeffnet.n} Wachen aufgeklappt`] : []);
    const schwanz = anhang.length ? ` (${anhang.join(', ')})` : '';
    if (uebergangen.length) uebergangen.slice(0, 12).forEach(g => log(g, 'warn'));
    alertBar(gesetzt
      ? `${gesetzt} Personen angehakt, ${Math.max(0, frei)} Plätze frei${schwanz}. `
        + `Jetzt unten auf „Ausbilden“ drücken.`
      : `Nichts angehakt${schwanz || ' — keine passende Person gefunden'}.`);
    return gesetzt;
  }


  // Werkzeugleiste unter die Lehrgangsauswahl
  const bar = document.createElement('div');
  bar.style.cssText = 'margin:12px 0;padding:10px 12px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa';
  const erkannt = erkannterKurs();
  /* Ein eigenes Auswahlfeld nur dort, wo das Spiel keines hat. Auf der
     Schulseite steht `#education_select` — ein zweites daneben sah aus wie eine
     Wahl, war aber nur eine Behauptung: gewählt wird oben, und der Planer hörte
     bisher nicht darauf, wenn sich das änderte. */
  const kursWahl = (erkannt || selEdu) ? '' : `
    <div style="margin-bottom:8px">
      <label style="font-weight:600">Welcher Lehrgang ist das?</label>
      <select id="lssp-edu-kurs" style="margin-left:6px">
        <option value="">— bitte wählen —</option>
        ${Object.entries(namen())
          .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(cap => [k, cap]))
          .sort((a, b2) => String(a[1]).localeCompare(String(b2[1]), 'de'))
          .map(([k, cap]) => `<option value="${k}">${esc(cap)}</option>`).join('')}
      </select>
    </div>`;
  /* Wechselt der Mensch oben den Lehrgang, muß alles neu gerechnet werden. */
  selEdu?.addEventListener('change', () => {
    handKey = null;
    keyVergessen();
    zaehlerAnstossen();
    refresh();
  });

  bar.innerHTML = `${kursWahl}<div style="margin-bottom:8px;color:#57606a;font-size:13px">
      <b>Planer:</b> Wähle oben einen Lehrgang. Bei jeder Wache steht dann, wie viele Personen dort
      noch ausgebildet werden müssen. <b>Bedarf anhaken</b> füllt die freien Plätze des Lehrgangs
      — größter Bedarf zuerst. Abgeschickt wird nichts, das machst du selbst mit „Ausbilden“.
      ${eigenesWunschbild() ? '' : '<br><b style="color:#a94442">Es gibt noch kein eigenes Wunschbild.</b> '
        + 'Bis dahin gälte die eingebaute Vorlage. Öffne den Planer im Hauptfenster, Reiter „Plan“.'}
      ${Object.keys(inAus).length ? '' :
        '<br><b style="color:#a94442">Laufende Ausbildungen sind nicht erfaßt.</b> '
        + 'Die Zahl steht auf der Zuweisungsseite jeder Wache, nicht hier — lass einmal '
        + '„Personal“ oder „Haken setzen“ über die Wachen laufen, Vorschau genügt. '
        + 'Bis dahin ist „benötigt“ zu hoch, weil niemand als unterwegs gilt.'}
    </div>
    <button type="button" class="btn btn-primary btn-sm" id="lssp-edu-fill">Bedarf anhaken</button>
    <button type="button" class="btn btn-default btn-sm" id="lssp-edu-refresh">Neu berechnen</button>
    <span id="lssp-edu-msg" style="margin-left:10px;color:#57606a"></span>`;
  /** Beschriftet die Kursauswahl mit dem Bedarf aus dem Planer.
      Gerechnet wird über den gesamten Bestand, nicht über die Wachen, die
      diese Schule zufällig auflistet — der Bedarf hängt an den Wachen. */
  function auswahlBeschriften() {
    if (!selEdu) return;
    if (!S.buildings.length && !loadCached()) return;

    // Einmal je Durchlauf rechnen, nicht je Option
    // Nur Wachen, deren Personal diese Schule überhaupt ausbilden darf
    const rows = courseTable(planWachen().filter(inReichweite));

    for (const o of selEdu.querySelectorAll('option')) {
      if (!o.value.includes(':')) continue;
      if (!o.dataset.lsspOrig) o.dataset.lsspOrig = o.textContent;
      const roh = o.dataset.lsspOrig.trim();
      // Der Name in der Auswahl ist maßgeblich; fällt er aus, greifen die
      // übrigen Namen desselben Schlüssels.
      const r = rows[o.value.split(':')[0]];

      let zusatz = '';
      if (r) {
        if (r.status === 'anhaenger') zusatz = '';
        else if (r.status === 'nodata') zusatz = 'Stand nicht erfasst';
        else if (r.fehlt) zusatz = `${r.fehlt} benötigt`
          + (r.lauf ? `, ${r.lauf} laufen` : '')
          + (r.status === 'teil' ? `, ${r.offen} Wachen unklar` : '');
        else zusatz = r.status === 'teil' ? 'teils unklar' : 'gedeckt';
      }

      // „ELW 2 Lehrgang (7 Tage)“ → „ELW 2 Lehrgang (7 Tage, 226 benötigt)“
      o.textContent = !zusatz ? roh
        : /\)\s*$/.test(roh) ? roh.replace(/\)\s*$/, `, ${zusatz})`)
        : `${roh} (${zusatz})`;
    }
  }

  const anker = selEdu
    || document.querySelector('#accordion')
    || document.querySelector('.schooling_checkbox')?.closest('table, .panel, form')
    || document.querySelector('form');
  if (!anker) return;
  anker.parentNode.insertBefore(bar, anker);

  bar.querySelector('#lssp-edu-kurs')?.addEventListener('change', e => {
    handKey = e.target.value || null;
    alertBar(handKey ? `Lehrgang gesetzt: ${curName()}` : '');
    zaehlerAnstossen(); refresh();
  });
  bar.querySelector('#lssp-edu-fill').onclick = () => fill();
  bar.querySelector('#lssp-edu-refresh').onclick = () => { zaehlerAnstossen(); refresh(); };

  /** Das Spiel lädt seine Zähler nur für gerade sichtbare Wachen nach.
      Hier bitten wir es, das für alle zu tun — gestaffelt, damit nichts hakt. */
  /* Zähler nur für Wachen anfordern, die der Nutzer tatsächlich sieht.
     Die frühere Salve über alle Panels lief am Anfrage-Takt vorbei und
     stapelte bei jedem Aufruf ungelöschte Zeitgeber. */
  let sichtBeobachter = null;
  function zaehlerAnstossen() {
    const f = window.schooling_check_educated_counter_load;
    if (typeof f !== 'function') return;
    sichtBeobachter?.disconnect();
    const geholt = new Set();
    sichtBeobachter = new IntersectionObserver(eintraege => {
      let etwas = false;
      for (const e of eintraege) {
        if (!e.isIntersecting) continue;
        const id = idOf(e.target);
        if (geholt.has(id)) { sichtBeobachter.unobserve(e.target); continue; }
        geholt.add(id); etwas = true;
        // Der Zähler des Spiels; scheitert er, bleibt die Zahl eben leer
        try { f(id); } catch { /* Zähler des Spiels, nicht unserer */ }
        sichtBeobachter.unobserve(e.target);
      }
      if (etwas) spaeter();
    }, { rootMargin: '200px' });
    panels().forEach(el => sichtBeobachter.observe(el));
  }
  selEdu?.addEventListener('change', () => setTimeout(() => {
    handKey = null; keyVergessen(); zaehlerAnstossen(); refresh();
  }, 150));

  /* Die Beschriftung der Kursauswahl ändert sich nicht durch Scrollen und
     nicht durch nachgeladene Panels. Sie gehört deshalb nicht in refresh(),
     sondern an die wenigen Stellen, an denen sich der Bedarf ändern kann. */
  auswahlBeschriften();
  schulartNachtragen();   // trägt die Schulart nach, wenn der Bestand sie nicht hergab
  addEventListener('storage', e => {
    if (e.key === KEY_QUAL || e.key === KEY_PLAN) { reloadQuals(true); auswahlBeschriften(); }
  });

  // Das Spiel füllt seine Zähler beim Scrollen nach. Nicht bei jeder Änderung
  // neu rechnen, sonst blockiert die Seite.
  let warten = null, beobachter = null;
  const spaeter = () => { clearTimeout(warten); warten = setTimeout(refresh, 400); };
  const acc = document.querySelector('#accordion');
  if (acc) {
    beobachter = new MutationObserver(spaeter);
    beobachter.observe(acc, { childList: true, subtree: true });
  }
  const beimScrollen = () => spaeter();
  addEventListener('scroll', beimScrollen, { passive: true });
  addEventListener('pagehide', () => {
    beobachter?.disconnect(); sichtBeobachter?.disconnect();
    clearTimeout(warten); removeEventListener('scroll', beimScrollen);
  }, { once: true });

  refresh();
  setTimeout(zaehlerAnstossen, 600);

  // Einzelner Sprung von der Übersicht: nur anhaken, nicht abschicken.
  const auto = store.get('lssplaner.autofill', null);
  if (auto && Date.now() - auto.ts < 60000 && location.pathname.startsWith(auto.url)) {
    localStorage.removeItem('lssplaner.autofill');
    if (!handKey && !erkannterKurs()) handKey = auto.key;
    setTimeout(async () => {
      alertBar('Fülle den Bedarf automatisch …');
      await fill();
      const zurueck = document.createElement('button');
      zurueck.type = 'button'; zurueck.className = 'btn btn-default btn-sm';
      zurueck.style.marginLeft = '8px';
      zurueck.textContent = 'Zurück zur Lehrgangsübersicht';
      zurueck.onclick = () => location.href = '/schoolings';
      bar.appendChild(zurueck);
    }, 1200);
    return;
  }

}


/* ═══════════════════════════════════════════════════════════════════
   Lehrgänge im Hintergrund füllen — ohne Seitenwechsel
   ═══════════════════════════════════════════════════════════════════ */

/** Personalliste einer Wache, roh und zwischengespeichert. */
const personalCache = new Map();
async function personalListe(buildingId) {
  if (personalCache.has(buildingId)) return personalCache.get(buildingId);
  const html = await getText(`/buildings/${buildingId}/schooling_personal_select`);
  // Dieselbe Antwort trägt beides: die Personen und ihren Ausbildungsstand.
  // Beides hier abzuleiten spart später einen zweiten Durchgang über
  // dieselben Wachen — und liefert die Zahlen, bevor ein Lehrgangsmenü
  // überhaupt geöffnet wurde.
  // Jede Checkbox als eigener Textabschnitt — reicht völlig und ist billig
  const boxen = [];
  const re = /<input\b[^>]*class="schooling_checkbox"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const id = (tag.match(/\svalue="(\d+)"/) || [])[1];
    if (!id) continue;
    // Array statt Set: je Person sind es typisch null bis drei Einträge,
    // dafür ist includes schneller und der Speicherbedarf deutlich kleiner.
    const kurse = [];
    const rk = /\s([a-z0-9_]+)="true"/g;
    let k;
    while ((k = rk.exec(tag))) if (!kurse.includes(k[1])) kurse.push(k[1]);
    boxen.push({ id, kurse });
  }

  /* Laufende Ausbildungen: erst hier nachsehen, denn diese Antwort liegt
     ohnehin vor. Trägt sie die Schlüssel — dieselbe Schreibweise wie auf der
     Zuweisungsseite —, kostet die Zahl keinen einzigen Abruf. Findet sich
     nichts, bleibt `null`, und der Aufrufer entscheidet, ob ihm die Zahl
     einen eigenen Abruf wert ist. Geraten wird nichts: kein Treffer heißt
     „hier steht es nicht“, nicht „es läuft keiner“. */
  const proKurs = {};
  let gefunden = false;
  const rl = /data-education-key="([a-z0-9_]+)"/g;
  let e;
  while ((e = rl.exec(html))) { proKurs[e[1]] = (proKurs[e[1]] || 0) + 1; gefunden = true; }
  if (gefunden) setzeInAusbildung(buildingId, proKurs);

  // Am Array selbst vermerkt, damit der Zwischenspeicher beim zweiten Aufruf
  // dieselbe Antwort gibt und nicht erneut nachgeholt wird
  boxen.laufendeBekannt = gefunden;
  personalCache.set(buildingId, boxen);
  /* Diese Liste ist erwiesenermaßen lückenhaft — sie zählt nur, solange die
     Zuweisungsseite für diese Wache noch nichts geliefert hat. Sonst machte
     ein Ausbildungslauf die eben erfaßten Zahlen wieder kaputt. */
  if (quals.by[buildingId]?._verfuegbar == null) zaehleAus(buildingId, boxen);
  return boxen;
}

/** Leitet den Ausbildungsstand aus einer gelesenen Personalliste ab.
    Jede Person zählt genau einmal — für den Kurs, an dem es hier am meisten
    fehlt. Nur wo eine Doppelqualifikation wirklich gefordert ist, zählt ein
    Kopf für beide Auflagen, denn dort besetzt er auch beide auf einem Sitz. */
function zaehleAus(buildingId, boxen) {
  const b = S.byId.get(buildingId);
  const bedarf = b ? bedarfKeys(b) : null;
  const z = { _verfuegbar: boxen.length };
  if (!bedarf) {
    // Ohne Zielprofil ist nicht entscheidbar, welcher Kurs mehr zählt
    for (const p of boxen) for (const k of p.kurse) z[k] = (z[k] || 0) + 1;
  } else {
    const rest = new Map(bedarf);
    const zaehle = k => { z[k] = (z[k] || 0) + 1; rest.set(k, (rest.get(k) ?? 0) - 1); };
    const luecke = k => rest.get(k) ?? 0;

    const kombis = doppelKombis(b);
    const offen = new Map(kombis.map(k => [k.kurse.join('+'), k.n]));
    /* Wenige Kurse zuerst: wer nur einen hat, hat keine Wahl. Nähme ein
       Doppelqualifizierter dessen Kurs weg, bliebe der Einzelne ungezählt. */
    const leute = boxen.filter(p => p.kurse.length)
                       .sort((x, y) => x.kurse.length - y.kurse.length);
    const einzeln = [];
    for (const p of leute) {
      const treffer = kombis.find(k => (offen.get(k.kurse.join('+')) || 0) > 0
                                    && k.kurse.every(x => p.kurse.includes(x)));
      if (!treffer) { einzeln.push(p); continue; }
      const marke = treffer.kurse.join('+');
      offen.set(marke, offen.get(marke) - 1);
      treffer.kurse.forEach(zaehle);           // ein Kopf, zwei erfüllte Auflagen
    }

    /* Wer noch übrig ist, wird dem **knappsten** seiner Kurse zugerechnet, nicht
       dem mit der größten Lücke. Die Lücke ist absichtlich großzügig gerechnet
       (D-05): die Kriminalpolizei fordert drei Zivilstreifen à zwei Sitze, die
       Dienstgruppenleitung nur einen Platz. Nach der Lückenregel gewann immer
       der aufgeblähte Kurs, und die beiden einzigen Leute mit
       Dienstgruppenleitung wurden der Kriminalpolizei zugeschlagen — die Wache
       meldete „0 von 2", obwohl zwei fertig dastanden. */
    const kandidaten = new Map();
    for (const p of einzeln) for (const k of p.kurse) kandidaten.set(k, (kandidaten.get(k) || 0) + 1);
    for (const p of einzeln) {
      const moeglich = p.kurse.filter(k => luecke(k) > 0);
      const wahl = (moeglich.length ? moeglich : p.kurse).reduce((best, k) => {
        const a = kandidaten.get(k) || 0, b2 = kandidaten.get(best) || 0;
        return a < b2 || (a === b2 && luecke(k) > luecke(best)) ? k : best;
      }, (moeglich.length ? moeglich : p.kurse)[0]);
      zaehle(wahl);
      for (const k of p.kurse) kandidaten.set(k, (kandidaten.get(k) || 0) - 1);
    }
  }
  quals.by[buildingId] = z;
  quals.ts = Date.now();
  saveQuals();
}

/** Mindest- und Vollbedarf einer Wache für einen Kurs. */
function bedarfDerWache(b, key) {
  const tgt = T.target(b);
  let min = 0, max = 0;
  for (const [id, n] of Object.entries(tgt?.vehicles || {})) {
    const meta = T.veh(id);
    if (!meta?.kurse?.some(k => k.k === key)) continue;
    if (!anhaengerZaehlt(meta, key, tgt)) continue;
    const anz = Number(n) || 0;
    max += sitzeFuerKurs(meta, 'max') * anz;
    min += sitzeFuerKurs(meta, 'min') * anz;
  }
  return { min, max };
}

/* Wer in diesem Lauf schon eingeteilt wurde. Bleibt über mehrere Lehrgänge
   hinweg erhalten, sonst würde dieselbe Wache mehrfach bedient. */
const laufZuteilung = new Map();     // `buildingId|kurs` -> Anzahl
const lz = (bid, key) => laufZuteilung.get(bid + '|' + key) || 0;

/** Wer an dieser Wache noch fehlt, um eine geforderte Doppelqualifikation
    zu erfüllen, und wen man dafür in genau diesen Kurs schicken müsste.
    Alle anderen Ausgebildeten bleiben unangetastet: ein zweiter Lehrgang
    macht aus einem Kopf keine zwei Besatzungen. */
function doppelKandidaten(b, key, liste) {
  const aus = [];
  const vergeben = new Set();
  for (const kombi of doppelKombis(b)) {
    if (!kombi.kurse.includes(key)) continue;
    const partner = kombi.kurse.filter(k => k !== key);
    const fertig = liste.filter(p => kombi.kurse.every(k => p.kurse.includes(k))).length;
    let offen = kombi.n - fertig;
    if (offen <= 0) continue;
    // Wer die übrigen Kurse der Kombination schon hat, ist einen Lehrgang
    // davon entfernt. Wer mehr mitbringt, als die Kombination verlangt,
    // bleibt draußen — sein Zusatzkurs verfiele.
    for (const p of liste) {
      if (offen <= 0) break;
      if (vergeben.has(p.id) || p.kurse.includes(key)) continue;
      if (!partner.every(k => p.kurse.includes(k))) continue;
      if (p.kurse.some(k => !kombi.kurse.includes(k))) continue;
      vergeben.add(p.id);
      aus.push(p);
      offen--;
    }
  }
  return aus;
}

/** Wählt Personen aus. Erst bekommt jede Wache die Mindestbesatzung,
    danach wird auf die Vollbesetzung aufgefüllt.
    Als vorhanden zählt: ausgebildet + in Ausbildung + in diesem Lauf zugeteilt. */
async function waehlePersonen(key, plaetze, wachen, inAusbildung, ausgebildetLabel, melde) {
  const daten = [];
  let gelesen = 0;
  for (const b of wachen) {
    if (abgebrochen()) break;
    const { min, max } = bedarfDerWache(b, key);
    if (!max) continue;
    gelesen++;
    const liste = await personalListe(b.id);
    if (melde) melde(gelesen, wachen.length, b);
    /* Der eigene Zähler gilt: er verteilt Doppelqualifizierte auf einen Kurs.
       Das grüne Label des LSS-Managers zählt sie doppelt und ließe die Wache
       versorgter aussehen, als sie ist. Ohne eigene Zahl das Label nehmen. */
    const ausgebildet = quals.by[b.id]?._verfuegbar != null
      ? (quals.by[b.id][key] || 0)
      : (ausgebildetLabel?.[b.id] ?? liste.filter(p => p.kurse.includes(key)).length);
    const vorhanden = ausgebildet + (inAusbildung[b.id] || 0) + lz(b.id, key);

    /* Nur Ungelernte in die Schule. Wer schon einen Lehrgang hat, sitzt
       bereits auf einem Fahrzeug — ein zweiter Kurs zieht ihn dort weg,
       ohne dass irgendwo eine Besatzung dazukommt. Ausnahme: die Wache
       verlangt zwei Lehrgänge auf einem Sitz. */
    const ungelernt = liste.filter(p => !p.kurse.length);
    const doppelt = doppelKandidaten(b, key, liste);
    const frei = [...ungelernt, ...doppelt];
    daten.push({ b, min, max, vorhanden, frei, genommen: 0 });
  }

  const gewaehlt = [];
  const nimm = (w, wieviel) => {
    while (wieviel-- > 0 && gewaehlt.length < plaetze && w.frei.length) {
      gewaehlt.push(w.frei.shift().id);
      w.genommen++;
      laufZuteilung.set(w.b.id + '|' + key, lz(w.b.id, key) + 1);
    }
  };

  // Durchgang 1: überall die Mindestbesatzung erreichen
  for (const w of daten) nimm(w, Math.max(0, w.min - w.vorhanden - w.genommen));
  // Durchgang 2: auf die Vollbesetzung auffüllen
  if (gewaehlt.length < plaetze)
    for (const w of daten) nimm(w, Math.max(0, w.max - w.vorhanden - w.genommen));

  return gewaehlt;
}

/** Holt einen Lehrgang, wählt Personen und schickt sie ab. */
/* Die Seite eines Lehrgangs ist für alle Kurse desselben Typs gleich
   aufgebaut: dieselben Wachen, dieselben Stände. Vier Bahnrettungs-Kurse
   brauchen also nur einen Abruf statt vier. */
const seiteProKurs = new Map();

async function lehrgangsSeite(eintrag) {
  const merk = eintrag.key || eintrag.url;
  if (seiteProKurs.has(merk)) return { ...seiteProKurs.get(merk), ausCache: true };

  const html = await getText(eintrag.url);
  const key = eintrag.key
    || (html.match(/schooling_disable\(\s*["']([a-z0-9_]+)["']\s*\)/) || [])[1];
  const ids = [...html.matchAll(/class="building_list[^"]*"[^>]*building_id="(\d+)"/g)]
    .map(m => Number(m[1]));

  // Die Kopfzeile kann beides tragen: das blaue „in Ausbildung“ des Spiels
  // und das grüne „ausgebildete Personen“ des LSS-Managers. Deshalb ein
  // großzügiges Fenster je Wache statt bis zum ersten schließenden Tag.
  const inAusbildung = {}, ausgebildetLabel = {};
  const teile = html.split('personal-select-heading-building-');
  for (let i = 1; i < teile.length; i++) {
    const bid = Number((teile[i].match(/^(\d+)/) || [])[1]);
    if (!bid) continue;
    // Bis zur nächsten Kopfzeile lesen — die Splitgrenze ist bereits die
    // richtige Schranke, ein festes Zeichenfenster schneidet Labels ab.
    const a = teile[i].match(/(\d+)\s*in Ausbildung/);
    if (a) inAusbildung[bid] = Number(a[1]);
    const g = teile[i].match(/(\d+)\s*ausgebildete/i);
    if (g) ausgebildetLabel[bid] = Number(g[1]);
  }

  // Was hier für alle Wachen auf einmal sichtbar ist, gleich für die
  // Kursauswahl merken — sonst kennt sie nur den zuletzt geöffneten Kurs.
  if (key) {
    for (const [bid, n] of Object.entries(inAusbildung)) merkeInAusbildung(key, Number(bid), n, 7);
    sichereInAusbildung();
  }

  const daten = { key, ids, inAusbildung, ausgebildetLabel };
  seiteProKurs.set(merk, daten);
  return { ...daten, ausCache: false };
}

/** Gesamter Sollbedarf eines Kursnamens über den ganzen Bestand. */
async function fuelleLehrgangHeadless(eintrag, melde) {
  const seite = await lehrgangsSeite(eintrag);
  const key = seite.key;
  if (!key) return { fehler: 'Lehrgang nicht erkannt' };

  // Die Zahl der freien Plätze steht schon in der Übersicht
  const plaetze = Number(eintrag.frei) || 0;
  if (plaetze <= 0) return { fehler: 'keine freien Plätze' };

  const wachen = planWachen().filter(b => seite.ids.includes(b.id));
  if (!wachen.length) return { fehler: 'keine passenden Wachen auf der Seite' };

  const gewaehlt = await waehlePersonen(key, plaetze, wachen,
    seite.inAusbildung, seite.ausgebildetLabel, melde);
  if (!gewaehlt.length) return { gesetzt: 0, ausCache: seite.ausCache };

  const body = new URLSearchParams();
  body.append('utf8', '✓');
  body.append('authenticity_token', csrf());
  gewaehlt.forEach(id => body.append('personal_ids[]', id));
  body.append('commit', 'Ausbilden');

  const r = await queued(async sig => fetch(`${eintrag.url}/education`, {
    method: 'POST', credentials: 'same-origin', body, signal: sig,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }), WRITE_DELAY);
  if (!r.ok) return { fehler: `HTTP ${r.status}` };
  await r.text();                       // Strom leeren, bevor der Takt weiterläuft

  // Die frisch Eingeteilten sind für weitere Lehrgänge nicht mehr verfügbar.
  // Set statt includes, und nur neu ablegen, wo sich wirklich etwas ändert.
  const weg = new Set(gewaehlt);
  for (const [bid, liste] of personalCache) {
    const rest = liste.filter(p => !weg.has(p.id));
    if (rest.length !== liste.length) personalCache.set(bid, rest);
  }
  return { gesetzt: gewaehlt.length, ausCache: seite.ausCache };
}

/* ═══════════════════════════════════════════════════════════════════
   Übersicht /schoolings — offene Lehrgänge mit dem Plan abgleichen
   ═══════════════════════════════════════════════════════════════════ */
const K_AUTO  = 'lssplaner.autofill';    // einzelner Sprung
const K_UEBER = 'lssplaner.ueberUi';     // Zustand der Übersicht

function schoolingsOverview() {
  const tabellen = ['#schooling_opened_table', '#schooling_own_table']
    .map(q => document.querySelector(q)).filter(Boolean);
  if (!tabellen.length) return;

  const ui = store.get(K_UEBER, { zu: false, alle: false });

  /** Offene Lehrgänge aus den Tabellen lesen. */
  function lehrgaenge() {
    const aus = [];
    for (const t of tabellen) {
      const offen = t.id === 'schooling_opened_table';
      for (const tr of t.querySelectorAll('tr')) {
        const key = tr.getAttribute('data-education-key');
        const a = tr.querySelector('a[href^="/schoolings/"]');
        if (!key || !a) continue;
        const tds = tr.querySelectorAll('td');
        const frei = offen ? parseInt((tds[1]?.textContent || '').replace(/\D+/g, ''), 10) : null;
        aus.push({
          key, titel: a.textContent.trim(),
          frei: Number.isFinite(frei) ? frei : null,
          kosten: offen ? (tds[2]?.textContent || '').trim() : '',
          offen, url: a.getAttribute('href')
        });
      }
    }
    return aus;
  }

  /** Wie viele Personen fehlen im ganzen Bestand für diesen Kurs. */
  function fehlmenge(key) {
    if (!S.buildings.length) return { grund: 'kein Bestand' };
    if (!key) return { grund: 'Lehrgang nicht erkannt' };
    reloadQuals();
    let fehlt = 0, unbekannt = 0;
    for (const b of planWachen()) {
      const soll = courseNeed(b)[key] || 0;
      if (!soll) continue;
      const q = quals.by[b.id];
      if (!q) { unbekannt++; continue; }
      fehlt += Math.max(0, soll - (q[key] || 0));
    }
    return { fehlt, unbekannt };
  }

  const alle = lehrgaenge();
  if (!alle.length) return;

  /** Bedarf für alle Einträge neu bestimmen. Muss nach dem Laden des
      Bestands laufen, sonst kennt der Planer keine einzige Wache. */
  function bedarfRechnen() {
    for (const l of alle) {
      l.b = fehlmenge(l.key);
      // Ohne bezifferte freie Plätze lässt sich nichts eintragen. Das betrifft
      // die eigenen laufenden Lehrgänge, die gar keine Plätze-Spalte haben.
      l.brauchbar = !!(l.b && l.b.fehlt > 0) && Number.isFinite(l.frei) && l.frei > 0;
    }
  }

  const box = document.createElement('div');
  box.style.cssText = 'margin:14px 0;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;overflow:hidden';

  function zeichnen() {
    const sichtbar = ui.alle ? alle : alle.filter(l => l.brauchbar);
    const versteckt = alle.length - sichtbar.length;
    const zumFuellen = alle.filter(l => l.brauchbar);

    const zeilen = sichtbar.map(l => {
      const bedarf = l.b?.grund ? `<span style="color:#8a6d3b">${esc(l.b.grund)}</span>`
        : l.b.fehlt ? `<b>${l.b.fehlt} fehlen</b>`
            + (l.b.unbekannt ? ` <span style="color:#8a6d3b">(${l.b.unbekannt} Wachen nicht erfasst)</span>` : '')
        : '<span style="color:#3c763d">kein Bedarf</span>';
      return `<tr>
        <td style="padding:3px 8px 3px 0">${esc(l.titel)}</td>
        <td style="padding:3px 8px;white-space:nowrap">${l.frei === null ? '—' : l.frei + ' frei'}</td>
        <td style="padding:3px 8px;white-space:nowrap;color:#57606a">${esc(l.kosten)}</td>
        <td style="padding:3px 8px">${bedarf}</td>
        <td style="padding:3px 0"><button type="button" class="btn btn-xs ${l.brauchbar ? 'btn-primary' : 'btn-default'}"
             data-url="${l.url}" data-key="${l.key}">Öffnen und füllen</button></td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <div id="lssp-ueber-kopf" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
           background:#eef1f4;border-bottom:${ui.zu ? '0' : '1px solid #d0d7de'}">
        <span style="font:600 13px sans-serif">Planer — Lehrgänge nach Bedarf</span>
        <span style="color:#57606a;font-size:12px">${sichtbar.length} von ${alle.length}</span>
        <span style="flex:1"></span>
        <span style="color:#57606a">${ui.zu ? '▸' : '▾'}</span>
      </div>
      <div id="lssp-ueber-inhalt" style="padding:12px 14px;${ui.zu ? 'display:none' : ''}">
        <div style="margin-bottom:8px;color:#57606a;font-size:13px">
          <b>Öffnen und füllen</b> springt auf den Lehrgang und hakt den Bedarf an.
          <b>Alle füllen</b> geht sie der Reihe nach durch und schickt jeden ab.
          ${S.buildings.length ? '' : '<br><b style="color:#a94442">Kein Bestand geladen.</b> '
            + 'Im Planer-Panel auf „Bestand neu laden“ drücken.'}
        </div>
        ${Object.keys(quals.by).length ? '' :
          '<p style="color:#8a6d3b;margin:0 0 8px">Der Ausbildungsstand wurde noch nie erfasst — '
          + 'ohne ihn kann der Bedarf nicht berechnet werden. Im Planer-Panel unter „Lehrgänge“ '
          + 'auf <b>Ausbildungsstand erfassen</b> drücken.</p>'}
        <div style="margin-bottom:8px">
          <button type="button" class="btn btn-primary btn-sm" id="lssp-ueber-alle"
            ${zumFuellen.length ? '' : 'disabled'}>Alle füllen (${zumFuellen.length})</button>
          <label style="margin-left:12px;font-weight:400;color:#57606a">
            <input type="checkbox" id="lssp-ueber-zeigalle" ${ui.alle ? 'checked' : ''}>
            auch ohne Bedarf oder ohne freie Plätze zeigen${versteckt && !ui.alle ? ` (${versteckt} ausgeblendet)` : ''}</label>
        </div>
        ${sichtbar.length
          ? `<table style="width:100%;font-size:13px"><tbody>${zeilen}</tbody></table>`
          : '<p style="color:#57606a;margin:0">Kein offener Lehrgang passt gerade zu deinem Bedarf.</p>'}
      </div>`;

    box.querySelector('#lssp-ueber-kopf').onclick = () => {
      ui.zu = !ui.zu; store.set(K_UEBER, ui); zeichnen();
    };
    box.querySelector('#lssp-ueber-zeigalle').onchange = e => {
      ui.alle = e.target.checked; store.set(K_UEBER, ui); zeichnen();
    };
    box.querySelectorAll('button[data-url]').forEach(btn => btn.onclick = () => {
      store.set(K_AUTO, { url: btn.dataset.url, key: btn.dataset.key, ts: Date.now() });
      location.href = btn.dataset.url;
    });
    const alleBtn = box.querySelector('#lssp-ueber-alle');
    if (alleBtn) alleBtn.onclick = () => starteReihe(zumFuellen);
  }

  /** Arbeitet die Lehrgänge nacheinander ab — im Hintergrund, ohne
      die Seite zu verlassen. */
  async function starteReihe(liste) {
    const kostet = liste.filter(l => l.kosten && !/^0\s*Credits/i.test(l.kosten));
    const text = `${liste.length} Lehrgänge füllen und jeweils abschicken?\n\n`
      + liste.map(l => `• ${l.titel} — ${l.frei ?? '?'} Plätze, ${l.b.fehlt} fehlen`).join('\n')
      + (kostet.length ? `\n\nACHTUNG: ${kostet.length} davon kosten Credits pro Tag und Teilnehmer.` : '')
      + `\n\nDas läuft im Hintergrund, die Seite bleibt offen.`;
    if (!await frage(text, 'lehrgangsreihe')) return;

    const inhalt = box.querySelector('#lssp-ueber-inhalt');
    const prot = document.createElement('pre');
    /* Feste Farben, keine Variablen: dieses Feld sitzt auf der Spielseite, und
       die Palette wird in `mount()` gesetzt — das aber läuft nicht, wenn die
       Übersicht in einem Rahmen des Spiels geöffnet wird. Dann blieben beide
       Angaben ungültig und der Text stand weiß auf weiß. */
    prot.style.cssText = 'background:#f7f7f7;color:#333;border:1px solid #ddd;border-radius:3px;'
      + 'padding:9px;font:11px/1.6 monospace;max-height:220px;overflow:auto;margin:10px 0 0;'
      + 'white-space:pre-wrap';
    inhalt.appendChild(prot);
    const zeilenLog = [];
    const sag = t => { zeilenLog.push(t); prot.textContent = zeilenLog.slice(-200).join('\n'); prot.scrollTop = prot.scrollHeight; };

    laufStarten();
    let abbruch = false;
    const stopBtn = box.querySelector('#lssp-ueber-alle');
    stopBtn.textContent = 'Abbrechen';
    stopBtn.onclick = () => { abbruch = true; laufStoppen(); sag('Abbruch angefordert …'); };

    let gesamt = 0;
    for (const [i, l] of liste.entries()) {
      if (abbruch) break;
      sag(`[${i + 1}/${liste.length}] ${l.titel} — ${l.frei ?? '?'} Plätze`);
      try {
        const r = await fuelleLehrgangHeadless(l, (n, ges) => {
          if (n % 5 === 0 || n === ges) sag(`      lese Wache ${n}/${ges} …`);
        });
        if (r.fehler) sag(`      übersprungen: ${r.fehler}`);
        else if (!r.gesetzt) sag('      niemand passend gefunden');
        else {
          sag(`      ${r.gesetzt} Personen eingeteilt${r.ausCache ? ' (ohne erneutes Auslesen)' : ''}`);
          gesamt += r.gesetzt;
        }
      } catch (e) { sag(`      Fehler: ${e.message}`); }
    }
    sag(`Fertig: ${gesamt} Personen in Ausbildung geschickt.`);
    stopBtn.textContent = 'Seite neu laden';
    stopBtn.onclick = () => location.reload();
  }

  const anker = tabellen[0].closest('.panel, .row') || tabellen[0];
  anker.parentNode.insertBefore(box, anker);

  if (!S.buildings.length) loadCached();
  bedarfRechnen();
  zeichnen();

  // Kein Bestand im Zwischenspeicher? Nicht ungefragt laden — der bloße
  // Aufruf einer Seite soll keinen Vollabruf auslösen.
  if (!S.buildings.length && S.plan) {
    box.querySelector('#lssp-ueber-inhalt')?.insertAdjacentHTML('afterbegin',
      '<p id="lssp-ueber-lade" style="margin:0 0 8px">'
      + '<button type="button" class="btn btn-sm btn-default" id="lssp-ueber-laden">Bestand jetzt laden</button> '
      + '<span style="color:#57606a">wird für die Bedarfsrechnung gebraucht</span></p>');
    const knopf = box.querySelector('#lssp-ueber-laden');
    if (knopf) knopf.onclick = () => {
      knopf.disabled = true; knopf.textContent = 'Lade …';
      loadAll(true).then(() => { bedarfRechnen(); zeichnen(); })
        .catch(e => { knopf.disabled = false; knopf.textContent = 'Fehlgeschlagen: ' + e.message; });
    };
  }

}

if (!inFrame) mount();
// Eigene Schule, Verbandslehrgang oder fremder Lehrgang — überall dort, wo
// Personen für einen Kurs angehakt werden können.
if (/^\/schoolings\/?$/.test(location.pathname)) schoolingsOverview();
else if (document.querySelector('#education_select') || document.querySelector('.schooling_checkbox')
    || /^\/schoolings\/\d+/.test(location.pathname)) educationPage();
})();
