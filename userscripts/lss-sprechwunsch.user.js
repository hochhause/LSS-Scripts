// ==UserScript==
// @name         LSS Sprechwunsch — Ziel von selbst wählen
// @namespace    https://leitstellenspiel.de/
// @version      0.1.1
// @description  Ein Knopf neben dem FMS-Zeichen erledigt den Sprechwunsch: Patient ins nächste passende Krankenhaus, Gefangener in die nächste freie Zelle
// @match        https://www.leitstellenspiel.de/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/hochhause/LSS-Scripts
// @supportURL   https://github.com/hochhause/LSS-Scripts/issues
// @downloadURL  https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-sprechwunsch.user.js
// @updateURL    https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-sprechwunsch.user.js
// ==/UserScript==

(function () {
'use strict';
const VERSION = '0.1.1';   // im Fensterkopf sichtbar, damit der Stand erkennbar ist

// Die Funkliste steht nur im Hauptfenster; in den Lightboxen des Spiels hätte
// das Skript nichts zu tun und würde seinen Knopf doppelt setzen.
if (window.top !== window.self) return;

/* ═══════════════════════════════════════════════════════════════════
   Was dieses Skript tut, und was es dafür wissen muß

   Ein Sprechwunsch (FMS 5) heißt: das Fahrzeug fragt, wohin. Zwei Sorten
   kommen vor — ein Patient will ins Krankenhaus, ein Gefangener in eine
   Zelle. **Welche von beiden es ist, wird nicht am Fahrzeugtyp geraten**:
   `/vehicles/<id>` sagt es selbst, im Attribut `data-transport-request-type`
   („patient" oder „prisoner", SPIELSEITEN.md 04.10.2026).

   Die beiden Sorten liefern ihre Ziele auf **verschiedenen Wegen**, und das
   ist keine Schönheitsfrage: die Krankenhäuser stehen fertig als Tabellen im
   Seitentext, die Zellenliste dagegen baut das Spiel erst im Browser. Im
   Rohtext stehen von ihr nur die **eigenen** Wachen (als `erb_prisons.push`),
   die des Verbands holt die Seite mit `/building/load_prisons`. Wer die Seite
   nur mit `fetch` liest und das übersieht, schickt jeden Gefangenen in eine
   eigene Wache und hält das für „das nächste Ziel".

   Die Falle, an der eine naive Fassung scheitert: beide Listen sind **nicht
   durchgehend nach Entfernung sortiert**. Eigene Ziele stehen zuerst, dann
   die des Verbands — jede Gruppe für sich aufsteigend. Wer den ersten
   Eintrag nimmt, bekommt das nächste *eigene*, nicht das nächste überhaupt.
   Deshalb wird hier zusammengeführt und selbst sortiert.
   ═══════════════════════════════════════════════════════════════════ */

const READ_DELAY = 150, WRITE_DELAY = 350;
const KEY_OPTS = 'lssfms.opts';
const KEY_UI   = 'lssfms.ui';

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

const getJson = pfad => queued(async () => {
  const r = await fetch(pfad, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${pfad} → HTTP ${r.status}`);
  return r.json();
}, READ_DELAY);

const getText = pfad => queued(async () => {
  const r = await fetch(pfad, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${pfad} → HTTP ${r.status}`);
  return r.text();
}, READ_DELAY);

/* „Anfahren" und die Zellenwahl sind reine GET-Verweise ohne `data-method`.
   Ein Aufruf genügt — und ist bereits die Tat, deshalb der Schreibabstand. */
const getAction = pfad => queued(async () => {
  const r = await fetch(pfad, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}, WRITE_DELAY);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
const opts = store.get(KEY_OPTS, { dry: true, eigeneZuerst: false });

/* ═══════════════════════════════════════════════════════════════════
   Lesen, was die Fahrzeugseite anbietet
   ═══════════════════════════════════════════════════════════════════ */

/** „1,62" → 1.62. Der Punkt ist Tausendertrenner, das Komma das Komma. */
function kommaZahl(s) {
  const z = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(z) ? z : null;
}
/** „5,15 km" aus einer Tabellenzeile. */
function km(text) {
  const m = String(text).match(/([\d.,]+)\s*km/);
  return m ? kommaZahl(m[1]) : null;
}

/** Name der ersten Zelle, ohne die Wiederholung für schmale Fenster.
    `div.visible-xs` trägt denselben Inhalt noch einmal als Fließtext — bliebe
    er stehen, hieße das Krankenhaus „Name 5,15 km Freie Betten: 36 / 40 …". */
function zellenName(td) {
  const kopie = td.cloneNode(true);
  kopie.querySelectorAll('.visible-xs').forEach(e => e.remove());
  return kopie.textContent.trim().replace(/\s+/g, ' ');
}

/** Krankenhäuser aus beiden Tabellen, zusammengeführt und sortiert. */
function krankenhaeuser(doc) {
  const aus = [];
  for (const [id, verband] of [['own-hospitals', false], ['alliance-hospitals', true]]) {
    const tab = doc.getElementById(id);
    if (!tab) continue;
    for (const tr of tab.querySelectorAll('tbody tr')) {
      const a = tr.querySelector('a[href*="/patient/"]');
      if (!a) continue;                                   // ohne Knopf kein Ziel
      const zellen = [...tr.children];
      const betten = (tr.textContent.match(/(\d+)\s*\/\s*(\d+)/) || []);
      const marke = tr.querySelector('span.label');
      aus.push({
        name: zellenName(zellen[0]),
        km: km(tr.textContent),
        frei: betten.length ? Number(betten[1]) : null,
        /* Fehlt die Marke, ist die Fachabteilung unbekannt — das wird gemeldet
           und nicht zu „ja" verdreht. Lieber ein wartender Patient als einer,
           der im falschen Haus abgeliefert wird. */
        fach: marke ? (marke.classList.contains('label-success') ? 'ja' : 'nein') : 'unbekannt',
        abgabe: (tr.textContent.match(/(\d+)\s*%/) || [])[1] || null,
        verband,
        href: a.getAttribute('href')
      });
    }
  }
  return aus;
}

/** Zellen kommen aus dem Abruf, den auch der „mehr laden"-Knopf der Seite
    benutzt: `/building/load_prisons?mission_id=<einsatz>` liefert
    `{prisons, alliance_prisons}` mit Entfernung, freien Zellen und
    `is_alliance` je Eintrag. Reiner Leseaufruf.

    Der Verweis wird so zusammengesetzt, wie die Seite ihn selbst baut —
    samt der beiden Parameter. Was sie bedeuten, ist nicht nachgemessen;
    weglassen hieße raten (dieselbe Regel wie beim Rückalarm, D-90). */
async function zellen(fzId, missionId) {
  const d = await getJson(`/building/load_prisons?mission_id=${missionId}`);
  return [...(d.prisons || []), ...(d.alliance_prisons || [])].map(p => ({
    name: p.name,
    km: kommaZahl(p.distance_in_km),
    frei: Number(p.free_cells),
    verband: !!p.is_alliance,
    href: `/vehicles/${fzId}/gefangener/${p.id}`
        + '?load_all_prisons=false&show_only_available=false'
  }));
}

/** Aus den Angeboten das Ziel wählen. Gibt Ziel **oder** Grund zurück. */
function zielWaehlen(liste, braucht) {
  if (!liste.length) return { grund: 'die Seite bietet kein einziges Ziel an' };
  const frei = liste.filter(z => z.frei > 0 && !z.voll);
  if (!frei.length) return { grund: `${liste.length} Ziele, aber keines mit Platz` };
  const passend = braucht === 'fach' ? frei.filter(z => z.fach === 'ja') : frei;
  if (!passend.length) {
    const unklar = frei.filter(z => z.fach === 'unbekannt').length;
    return { grund: `keines der ${frei.length} freien Häuser hat die Fachabteilung`
      + (unklar ? ` (bei ${unklar} steht sie nicht in der Zeile)` : '') };
  }
  /* Selbst sortieren, nicht auf die Reihenfolge der Seite vertrauen: dort
     stehen erst die eigenen, dann die des Verbands — jede Gruppe für sich
     aufsteigend. Der erste Eintrag ist also das nächste *eigene* Ziel. */
  const nachNaehe = [...passend].sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  if (opts.eigeneZuerst) {
    const eigen = nachNaehe.find(z => !z.verband);
    if (eigen) return { ziel: eigen };
  }
  return { ziel: nachNaehe[0] };
}

/** Ein Sprechwunsch, von der Fahrzeugseite bis zum Verweis. */
async function erledige(fzId, name) {
  const html = await getText(`/vehicles/${fzId}`);
  const doc = new DOMParser().parseFromString(html, 'text/html');

  /* Das Merkmal steht **zweimal** auf der Seite: einmal als „prisoner-header"
     an der Überschrift, einmal als „prisoner" am Inhaltsblock — und der
     Kopfteil kommt zuerst. Wer `querySelector` nimmt, liest den Kopf und
     erkennt die Sorte nicht wieder. Gesucht wird deshalb der genaue Wert. */
  const sorten = [...doc.querySelectorAll('[data-transport-request-type]')]
    .map(e => e.getAttribute('data-transport-request-type'));
  const sorte = sorten.find(v => v === 'prisoner' || v === 'patient') || sorten[0];

  let art, wahl;
  if (sorte === 'prisoner') {
    art = 'Zelle';
    /* Ohne Einsatznummer gibt der Abruf nichts her. Sie steht auf der
       Fahrzeugseite selbst — verlässlicher als die Funkzeile, die es beim
       Einzelknopf zwar auch hätte, beim Sammellauf aber nicht immer. */
    const mid = (doc.querySelector('a[href^="/missions/"]')?.getAttribute('href') || '')
      .match(/missions\/(\d+)/)?.[1];
    if (!mid) return { art, fehler: 'kein Einsatz auf der Fahrzeugseite — ohne ihn liefert /building/load_prisons nichts' };
    wahl = zielWaehlen(await zellen(fzId, mid), 'platz');
  } else if (sorte === 'patient') {
    art = 'Krankenhaus';
    wahl = zielWaehlen(krankenhaeuser(doc), 'fach');
  } else {
    /* Eine dritte Sorte hat hier niemand gemessen — und ein erledigter
       Sprechwunsch sieht genauso aus. Beides gehört gemeldet, nicht geraten. */
    return { fehler: `unbekannte Art des Sprechwunschs (${sorte || 'kein Merkmal auf der Seite'})` };
  }

  if (wahl.grund) return { art, fehler: wahl.grund };
  const z = wahl.ziel;
  const wo = `${z.name} — ${z.km != null ? z.km.toFixed(2) + ' km' : 'Entfernung unbekannt'}`
    + `, ${z.frei} frei${z.verband ? `, Verband${z.abgabe ? ` (${z.abgabe} % Abgabe)` : ''}` : ''}`;

  if (opts.dry) { log(`${name}: ${art} → ${wo}  [Vorschau, nichts geschickt]`); return { art, ziel: z, dry: true }; }
  await getAction(z.href);
  log(`${name}: ${art} → ${wo}`, 'good');
  return { art, ziel: z };
}

/* ═══════════════════════════════════════════════════════════════════
   Oberfläche: ein Knopf je Zeile, ein Fenster für Protokoll und Schalter
   ═══════════════════════════════════════════════════════════════════ */
const css = `
#lssfms{position:fixed;right:16px;bottom:118px;width:430px;max-height:70vh;z-index:99995;display:none;
 background:#1b232c;color:#e6ebf0;border:1px solid #2e3a47;border-radius:4px;
 font:13px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);flex-direction:column}
#lssfms.on{display:flex}
#lssfms header{padding:9px 13px;border-bottom:1px solid #2e3a47;display:flex;align-items:center;gap:9px;cursor:grab;touch-action:none}
#lssfms header .ico{background:none;border:0;color:#8b9aa9;font:600 15px/1 sans-serif;cursor:pointer;padding:3px 7px;border-radius:3px}
#lssfms header .ico:hover{background:#232d38;color:#e6ebf0}
#lssfms .body{padding:11px 13px;overflow-y:auto;flex:1}
#lssfms .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
#lssfms button.act{background:#232d38;color:#e6ebf0;border:1px solid #2e3a47;border-radius:3px;
 padding:6px 12px;cursor:pointer;font:600 12px sans-serif}
#lssfms button.act:hover{border-color:#6f8fb5}
#lssfms button.go{background:#5b7fa6;border-color:#5b7fa6;color:#fff}
#lssfms pre{background:#0e1319;border:1px solid #2e3a47;border-radius:3px;padding:8px;margin:9px 0 0;
 font:11px/1.6 monospace;white-space:pre-wrap;max-height:230px;overflow-y:auto;color:#c3d0dc}
#lssfms .hint{color:#8b9aa9;font-size:12px;margin:0 0 9px}
#lssfms .warn{color:#e0a33c}#lssfms .err{color:#d8674f}#lssfms .good{color:#4fb79b}
#lssfms-btn{position:fixed;right:16px;bottom:74px;z-index:99994;background:#7a5ba6;color:#fff;
 border:0;border-radius:3px;padding:9px 15px;font:600 14px/1 sans-serif;cursor:pointer;letter-spacing:.05em}
.lssfms-zeile{margin:0 4px!important}
`;

let el, busy = false, protokoll = [];
/* Einmal je Seitenaufruf fragen, ob scharf geschaltet werden soll — öfter
   wäre Bevormundung, seltener ließe den Haken für immer unentdeckt. */
let gefragt = false;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function zeichneProtokoll() {
  const pre = el?.querySelector('#lssfms-log');
  if (!pre) return;
  pre.innerHTML = protokoll.slice(-200).map(z => `<span class="${z.k}">${esc(z.t)}</span>`).join('\n');
  pre.scrollTop = pre.scrollHeight;
}
function log(t, k = '') { protokoll.push({ t, k }); zeichneProtokoll(); }

/** Alle offenen Sprechwünsche der Funkliste, als Zeilen mit Fahrzeugnummer. */
function offene() {
  return [...document.querySelectorAll('#radio_messages_important > li, #radio_messages > li')]
    .filter(li => li.querySelector('span.building_list_fms_5'))
    .map(li => ({
      li,
      // Die Lupe trägt die Nummer sauber; die Klasse des `li` nur angehängt.
      id: li.querySelector('img.vehicle_search')?.getAttribute('vehicle_id')
          || (li.className.match(/radio_message_vehicle_(\d+)/) || [])[1],
      name: li.querySelector('a[href^="/vehicles/"]')?.textContent.trim() || '?'
    }))
    .filter(z => z.id);
}

/** Knopf in eine Zeile setzen — gleich rechts neben das FMS-Zeichen.
    Er öffnet **nichts**: wer ihn drückt, will senden, nicht lesen. Was dabei
    herauskam, steht danach am Knopf selbst (Text und Titel); das ausführliche
    Protokoll gibt es im Einstellungsfenster für den, der es sucht. */
function knopfSetzen(zeile) {
  if (zeile.li.querySelector('.lssfms-zeile')) return;
  const anker = zeile.li.querySelector('span.building_list_fms')
             || zeile.li.querySelector('a.mission-radio-button');
  if (!anker) return;
  const b = document.createElement('button');
  b.className = 'btn btn-xs btn-default lssfms-zeile';
  const ruhe = 'Nächstes passendes Ziel anfahren — Patient ins Krankenhaus mit Fachabteilung, '
             + 'Gefangener in die nächste freie Zelle';
  b.textContent = 'Senden';
  b.title = ruhe;
  b.onclick = async ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (busy) return;
    /* Zwei Durchgänge: beim ersten kann „Nur Vorschau" dazwischenkommen.
       Sagt der Mensch dann „scharf schalten", läuft derselbe Griff gleich
       noch einmal — sonst müßte er raten, daß er nochmal drücken soll. */
    for (let versuch = 0; versuch < 2; versuch++) {
      b.disabled = true; b.textContent = '…'; b.title = ruhe;
      let r;
      try { r = await erledige(zeile.id, zeile.name); }
      catch (e) {
        log(`${zeile.name}: fehlgeschlagen — ${e.message}`, 'err');
        b.textContent = '!'; b.title = e.message; b.disabled = false;
        return;
      }
      if (r.fehler) {
        /* Der Grund gehört an den Knopf, nicht in ein Fenster, das niemand
           offen hat. Wieder freigeben: der nächste Versuch kann klappen,
           sobald woanders ein Bett frei wird. */
        b.textContent = '!'; b.title = r.fehler; b.disabled = false;
        log(`${zeile.name}: ${r.fehler}`, 'warn');
        return;
      }
      if (!r.dry) {
        b.textContent = '✓'; b.title = `${r.art} → ${r.ziel.name}`;
        return;
      }
      /* Vorschau. „Sonst ist aber nichts passiert" war die erste Rückmeldung
         eines fremden Nutzers (04.10.) — und sie stimmte: der Knopf blieb
         ausgegraut stehen und nannte keinen Grund. Beides war falsch. Er wird
         wieder freigegeben, sagt im Titel was los ist, und beim ersten Mal
         wird gefragt, statt den Haken im Profilmenü suchen zu lassen. */
      b.textContent = 'Vorschau'; b.disabled = false;
      b.title = `Nur Vorschau — es wurde NICHTS geschickt. Ziel wäre: ${r.ziel.name}. `
        + 'Abschalten: Profil → „Sprechwunsch — Einstellungen" → Haken „Nur Vorschau" weg.';
      if (versuch || gefragt) return;
      gefragt = true;
      if (!confirm('„Nur Vorschau" ist eingeschaltet — es wurde nichts geschickt.\n\n'
        + `${r.art} wäre: ${r.ziel.name}\n\n`
        + 'Jetzt scharf schalten und wirklich senden?\n'
        + '(Der Haken sitzt im Profilmenü unter „Sprechwunsch — Einstellungen".)')) return;
      opts.dry = false; store.set(KEY_OPTS, opts);
    }
  };
  anker.insertAdjacentElement('afterend', b);
}

function knoepfeSetzen() {
  for (const z of offene()) knopfSetzen(z);
  const k = el?.querySelector('#lssfms-alle');
  if (k) k.textContent = `Alle erledigen (${offene().length})`;
}

async function alleErledigen() {
  if (busy) return;
  const liste = offene();
  if (!liste.length) return log('Kein Sprechwunsch offen — nichts zu tun.', 'warn');
  if (!opts.dry && !confirm(`${liste.length} Sprechwünsche erledigen?\n\n`
    + 'Jedes Fahrzeug fährt danach sein Ziel an.')) return;
  busy = true; protokoll = [];
  log(opts.dry ? `── Vorschau: ${liste.length} Sprechwünsche ──` : `── ${liste.length} Sprechwünsche ──`, 'good');
  let ok = 0, offen = 0;
  for (const z of liste) {
    try {
      const r = await erledige(z.id, z.name);
      if (r.fehler) { log(`${z.name}: ${r.fehler}`, 'warn'); offen++; } else ok++;
    } catch (e) { log(`${z.name}: fehlgeschlagen — ${e.message}`, 'err'); offen++; }
  }
  log(`${opts.dry ? 'Vorschau' : 'Fertig'}: ${ok} zugewiesen${offen ? `, ${offen} offen geblieben` : ''}`,
      offen ? 'warn' : 'good');
  busy = false;
  knoepfeSetzen();
}

/* Das Fenster öffnen heißt auch: den Rumpf zeichnen. Ohne das stand nach
   einem Klick auf einen Zeilenknopf ein leeres Fenster da — das Protokoll
   lag im Speicher, hatte aber kein Feld, in das es schreiben konnte. */
function fensterZeigen() {
  if (!el) return;
  el.classList.add('on');
  zeichne();
}

function zeichne() {
  const b = el.querySelector('.body');
  b.innerHTML = `
    <p class="hint">Erledigt Sprechwünsche: der Patient kommt ins <b>nächste</b> Krankenhaus mit
      freier Kapazität <b>und</b> passender Fachabteilung, der Gefangene in die nächste Wache mit
      freier Zelle. Eigene und Verbandsziele stehen dabei in einem Topf — das Spiel führt sie
      getrennt auf, dieses Skript sortiert sie zusammen.
      <b>Nichts wird abgeschickt</b>, solange „Nur Vorschau" angehakt ist.</p>
    <div class="row">
      <button class="act go" id="lssfms-alle">Alle erledigen (${offene().length})</button>
      <button class="act" id="lssfms-neu">Knöpfe neu setzen</button>
    </div>
    <div class="row">
      <label style="color:#8b9aa9"><input type="checkbox" id="lssfms-dry" ${opts.dry ? 'checked' : ''}> Nur Vorschau</label>
      <label style="color:#8b9aa9" title="Verbandshäuser nehmen eine Abgabe. Mit diesem Haken geht der Patient zum nächsten EIGENEN Ziel, auch wenn ein fremdes näher liegt.">
        <input type="checkbox" id="lssfms-eigen" ${opts.eigeneZuerst ? 'checked' : ''}> Eigene bevorzugen</label>
    </div>
    <pre id="lssfms-log"></pre>`;
  b.querySelector('#lssfms-alle').onclick = alleErledigen;
  b.querySelector('#lssfms-neu').onclick = knoepfeSetzen;
  b.querySelector('#lssfms-dry').onchange = e => { opts.dry = e.target.checked; store.set(KEY_OPTS, opts); };
  b.querySelector('#lssfms-eigen').onchange = e => { opts.eigeneZuerst = e.target.checked; store.set(KEY_OPTS, opts); };
  zeichneProtokoll();
}

/** Der Weg zu den Einstellungen führt über das Profilmenü — dort sucht man
    so etwas, und die Spielfläche bleibt frei. Gemessen am 04.10.2026:
    `#menu_profile + ul.dropdown-menu` mit Einträgen `li[role=presentation]`.
    Findet sich das Menü nicht, bleibt ein kleiner Schwebeknopf übrig; ohne
    ihn wäre das Fenster unerreichbar, und eine Einstellung, an die niemand
    herankommt, ist schlimmer als ein Knopf zuviel. */
function menueEintrag() {
  const menu = document.querySelector('#menu_profile + .dropdown-menu');
  if (!menu || menu.querySelector('#lssfms-menu')) return !!menu;
  const li = document.createElement('li');
  li.setAttribute('role', 'presentation');
  li.innerHTML = '<a id="lssfms-menu" role="menuitem" href="#">Sprechwunsch — Einstellungen</a>';
  li.querySelector('a').onclick = ev => { ev.preventDefault(); fensterZeigen(); };
  menu.appendChild(li);
  return true;
}

function aufbau() {
  const stil = document.createElement('style'); stil.textContent = css; document.head.appendChild(stil);
  el = document.createElement('div'); el.id = 'lssfms';
  el.innerHTML = `<header><b>Sprechwunsch</b><span style="color:#5d6c7b;font-size:11px">v${VERSION}</span>
      <span style="flex:1"></span><button class="ico" id="lssfms-zu" title="Schließen">×</button></header>
    <div class="body"></div>`;
  document.body.append(el);
  el.querySelector('#lssfms-zu').onclick = () => el.classList.remove('on');

  if (!menueEintrag()) {
    const btn = document.createElement('button');
    btn.id = 'lssfms-btn'; btn.textContent = 'Sprechwunsch';
    btn.onclick = () => { if (el.classList.contains('on')) el.classList.remove('on'); else fensterZeigen(); };
    document.body.append(btn);
  }

  const ui = store.get(KEY_UI, {});
  const setzen = () => {
    if (typeof ui.x !== 'number') return;
    Object.assign(el.style, { left: Math.min(ui.x, innerWidth - 120) + 'px',
      top: Math.min(ui.y, innerHeight - 60) + 'px', right: 'auto', bottom: 'auto' });
  };
  let zieh = null;
  el.querySelector('header').addEventListener('pointerdown', ev => {
    if (ev.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    zieh = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    el.setPointerCapture?.(ev.pointerId); ev.preventDefault();
  });
  addEventListener('pointermove', ev => {
    if (!zieh) return;
    ui.x = Math.max(0, Math.min(ev.clientX - zieh.dx, innerWidth - 120));
    ui.y = Math.max(0, Math.min(ev.clientY - zieh.dy, innerHeight - 60));
    Object.assign(el.style, { left: ui.x + 'px', top: ui.y + 'px', right: 'auto', bottom: 'auto' });
  });
  addEventListener('pointerup', () => { if (zieh) { zieh = null; store.set(KEY_UI, ui); } });
  setzen();

  /* Das Spiel schreibt die Funkliste laufend um — jede neue Meldung ersetzt
     Zeilen. Ein Beobachter setzt die Knöpfe nach, gebündelt auf den nächsten
     Bildaufbau, damit nicht jede einzelne Zeile einen Durchgang auslöst. */
  let geplant = false;
  const anstossen = () => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => { geplant = false; knoepfeSetzen(); });
  };
  const liste = document.querySelector('#radio_panel_body') || document.body;
  new MutationObserver(anstossen).observe(liste, { childList: true, subtree: true });
  knoepfeSetzen();
}

aufbau();
})();
