// ==UserScript==
// @name         LSS Farben — fertig grün, Status 6 rot
// @namespace    https://leitstellenspiel.de/
// @version      0.1.0
// @description  Färbt fertige Wachen und Fahrzeuge grün und blendet den Markierungspunkt aus, Status 6 wird rot
// @match        https://www.leitstellenspiel.de/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

/* Dieses Skript ändert nichts am Spiel — es färbt nur, was ohnehin dasteht.
   Zwei Quellen:
     1. Der Markierungspunkt 🟢, den der Planer fertigen Wachen und Fahrzeugen
        voranstellt. Er steht im Namen auf dem Server, damit er auch ohne
        Skript sichtbar bleibt; hier wird er aus der Anzeige genommen und
        stattdessen der Name selbst grün.
     2. Der Fahrzeugbestand, den der Planer unter `lssplaner.data` ablegt.
        Daraus kommt der Status. Ohne den Planer bleibt das Rot aus — dieses
        Skript ruft absichtlich nichts ab, es soll leicht bleiben. */

const PUNKT   = '\u{1F7E2}';
const KEY     = 'lssplaner.data';
const ALTER   = 6 * 60 * 60 * 1000;      // Bestand älter als 6 h: Status ignorieren

/* Farben. Das Spiel hat helle und dunkle Bereiche — die Leitstelle ist dunkel,
   die Gebäudeseiten sind hell. Dieselbe Farbe wäre in einem der beiden
   schlecht lesbar, deshalb wird die Helligkeit des Untergrunds gemessen. */
const FARBEN = {
  hell:   { fertig: '#137333', sechs: '#b3261e' },
  dunkel: { fertig: '#5ddb87', sechs: '#ff8080' }
};

function untergrundIstDunkel() {
  for (let el = document.body; el; el = el.parentElement) {
    const f = getComputedStyle(el).backgroundColor;
    const m = f && f.match(/(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m || Number(m[4] ?? 1) === 0) continue;             // durchsichtig: weiter oben schauen
    const [r, g, b] = [1, 2, 3].map(i => Number(m[i]));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
  }
  return false;
}

const farbe = FARBEN[untergrundIstDunkel() ? 'dunkel' : 'hell'];
const stil = document.createElement('style');
stil.textContent = `
  .lssf-fertig { color: ${farbe.fertig} !important; font-weight: 600; }
  .lssf-sechs  { color: ${farbe.sechs}  !important; font-weight: 600; }
`;
document.head.appendChild(stil);

/* ── Status aus dem Bestand des Planers ─────────────────────────────── */
function statusKarte() {
  try {
    const roh = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!roh || !Array.isArray(roh.vehicles)) return null;
    // Ein alter Bestand färbt Fahrzeuge rot, die längst wieder fahren.
    // Lieber gar nicht färben als falsch.
    if (roh.ts && Date.now() - roh.ts > ALTER) return null;
    const karte = new Map();
    for (const v of roh.vehicles) karte.set(String(v.id), v.fms_real);
    return karte;
  } catch { return null; }
}
let status = statusKarte();

/* ── Punkt aus der Anzeige nehmen, Namen färben ─────────────────────── */
const UEBERGANGEN = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);

function punkteFaerben(wurzel) {
  const lauf = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.includes(PUNKT)) return NodeFilter.FILTER_REJECT;
      const el = n.parentElement;
      if (!el || UEBERGANGEN.has(el.tagName) || el.isContentEditable) return NodeFilter.FILTER_REJECT;
      // Das Planer-Fenster zeigt die Namen absichtlich mit Punkt
      if (el.closest('#lssp, #lssp-btn')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const treffer = [];
  for (let n = lauf.nextNode(); n; n = lauf.nextNode()) treffer.push(n);
  for (const n of treffer) {
    /* Nur die Anzeige wird angefasst, nie ein Eingabefeld: der Name auf dem
       Server behält seinen Punkt. Wer die Wache umbenennt, sieht im Formular
       weiterhin, was wirklich gespeichert ist. */
    n.nodeValue = n.nodeValue.replace(new RegExp(PUNKT + '\\s*', 'gu'), '');
    n.parentElement?.classList.add('lssf-fertig');
  }
}

/* ── Fahrzeuge auf Status 6 rot ─────────────────────────────────────── */
function sechsenFaerben(wurzel) {
  if (!status) return;
  const links = [...(wurzel.querySelectorAll?.('a[href*="/vehicles/"]') || [])];
  if (wurzel.matches?.('a[href*="/vehicles/"]')) links.push(wurzel);
  for (const a of links) {
    const id = (a.getAttribute('href').match(/\/vehicles\/(\d+)/) || [])[1];
    if (!id) continue;
    /* Der zuletzt gesetzte Stand steht am Element. Damit wird nichts doppelt
       gefärbt, und wenn der Planer den Bestand fortschreibt, fällt die Farbe
       von selbst wieder ab statt hängenzubleiben. */
    const stand = String(status.get(id) ?? '');
    if (a.dataset.lssf === stand) continue;
    a.dataset.lssf = stand;
    a.classList.toggle('lssf-sechs', status.get(id) === 6);
  }
}

function durchgang(wurzel = document.body) {
  if (!wurzel || wurzel.nodeType !== 1) return;
  punkteFaerben(wurzel);
  sechsenFaerben(wurzel);
}

durchgang();

/* Das Spiel lädt Listen nach — Einsätze, Fahrzeugtabellen, Lightboxen.
   Ein Beobachter reicht, gebündelt auf den nächsten Bildaufbau, damit
   nicht jede einzelne Zeile einen eigenen Durchgang auslöst. */
let geplant = false;
const warteschlange = new Set();
new MutationObserver(list => {
  for (const m of list)
    for (const n of m.addedNodes) if (n.nodeType === 1) warteschlange.add(n);
  if (geplant || !warteschlange.size) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    // Nur das Nachgeladene ansehen, nicht jedes Mal die ganze Seite
    for (const n of warteschlange) if (n.isConnected) durchgang(n);
    warteschlange.clear();
  });
}).observe(document.body, { childList: true, subtree: true });

// Der Planer schreibt den Bestand fort; im selben Tab meldet das kein Ereignis,
// deshalb zusätzlich alle paar Minuten nachsehen.
const neuLesen = () => {
  const vorher = status;
  status = statusKarte();
  if (status !== vorher) durchgang();
};
addEventListener('storage', e => { if (e.key === KEY) neuLesen(); });
setInterval(neuLesen, 5 * 60 * 1000);

})();
