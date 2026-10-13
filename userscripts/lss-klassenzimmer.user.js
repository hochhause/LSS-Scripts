// ==UserScript==
// @name         LSS Klassenzimmer — fehlende Lehrgänge öffnen
// @namespace    https://leitstellenspiel.de/
// @version      0.1.0
// @description  Ein Knopf auf der Verbands-Gebäudeseite: öffnet für jeden Lehrgang, der im Verband gerade nirgends offen ist, einen (oder zwei) kostenlos für 2 Tage
// @match        https://www.leitstellenspiel.de/verband/gebauede*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/hochhause/LSS-Scripts
// @supportURL   https://github.com/hochhause/LSS-Scripts/issues
// @downloadURL  https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-klassenzimmer.user.js
// @updateURL    https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-klassenzimmer.user.js
// ==/UserScript==

(function () {
'use strict';
const VERSION = '0.1.0';

/* ═══════════════════════════════════════════════════════════════════
   Was dieses Skript tut

   Auf Knopfdruck, nie von selbst: Für jeden Lehrgang, den eine Schulart des
   Verbands anbietet, wird geprüft, ob gerade irgendwo einer **offen** ist —
   offen heißt, er hat noch nicht begonnen, man kann also noch Leute
   hineinschicken. Fehlt einer, startet das Skript ihn an einer Verbandsschule:
   kostenlos (`alliance[cost]` 0) und für 2 Tage freigegeben
   (`alliance[duration]` 172800), ohne eigene Teilnehmer.

   Wie viele: je Lehrgang **ein** Raum. Reichen die freien Räume einer
   Schulart für **zwei** je fehlendem Lehrgang, dann zwei — mehr nie (Sasha,
   13.10.2026). Gerechnet wird je Schulart, weil eine Feuerwehrschule keinen
   Polizeilehrgang anbietet: freie Räume der einen helfen der anderen nicht.

   Gemessen am 13.10.2026 (Notizen/SPIELSEITEN.md, „Klassenzimmer"):
   - `/api/alliance_buildings` und `/api/buildings` führen je Schule
     `schoolings` mit `education` (Schlüssel) und `education_start_time`.
     Liegt der Start in der Zukunft, läuft noch die Freigabe — der Lehrgang
     ist offen. Damit braucht es `/schoolings` nicht, dessen Zeilen die
     Schulart nur im Klartext nennen.
   - Die Schulseite `/buildings/<id>`: kein Formular = alle Räume belegt;
     Formular ohne `building_rooms_use` = genau ein Raum frei (dann schickt
     auch das Spiel das Feld nicht mit); sonst nennt die Auswahl die Zahl.
   - Start: POST auf die `action` des Formulars mit utf8, Token,
     building_rooms_use, education_select („schlüssel:nummer", von der Seite
     gelesen), alliance[duration], alliance[cost], commit. Erfolg = Weiterleitung
     auf `/schoolings/<neu>`.
   ═══════════════════════════════════════════════════════════════════ */

const SCHULARTEN = { 1: 'Feuerwehr', 3: 'Rettung', 8: 'Polizei', 10: 'THW', 27: 'Seenotrettung' };
const FREIGABE = '172800';          // 2 Tage
const PAUSE = 300;                   // ms zwischen Anfragen — das Spiel ist kein Lasttest
const pause = () => new Promise(r => setTimeout(r, PAUSE));

async function lies(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
const json = async url => (await lies(url)).json();
const dom = async url => new DOMParser().parseFromString(await (await lies(url)).text(), 'text/html');

/** Eine Schulseite: Formular, freie Räume, Angebot. `null`, wenn voll. */
async function schulSeite(id) {
  const d = await dom(`/buildings/${id}`);
  const form = d.querySelector('form[action$="/education"]');
  if (!form) return null;
  const auswahl = d.querySelector('select[name="building_rooms_use"]');
  return {
    action: form.getAttribute('action'),
    token: form.querySelector('input[name="authenticity_token"]')?.value,
    mitAuswahl: !!auswahl,
    frei: auswahl ? Math.max(0, ...[...auswahl.options].map(o => Number(o.value) || 0)) : 1,
    kurse: new Map([...d.querySelectorAll('#education_select option')]
      .filter(o => o.value).map(o => [o.value.split(':')[0], { wert: o.value, name: o.textContent.trim() }]))
  };
}

/** Alles lesen und ausrechnen, ohne etwas abzuschicken. */
async function planen(melde) {
  const [verband, eigene] = await Promise.all([json('/api/alliance_buildings'), json('/api/buildings')]);
  const jetzt = Date.now();
  const plan = [];
  for (const [typ, name] of Object.entries(SCHULARTEN)) {
    const schulen = verband.filter(b => b.building_type === Number(typ));
    if (!schulen.length) continue;
    // Offen zählt auch, was an eigenen Schulen derselben Art für den Verband freigegeben ist.
    const offen = new Set([...schulen, ...eigene.filter(b => b.building_type === Number(typ))]
      .flatMap(b => b.schoolings || [])
      .filter(s => Date.parse(s.education_start_time) > jetzt)
      .map(s => s.education));
    const seiten = [];
    for (const s of schulen) {
      melde(`${name}: ${s.caption} …`);
      const seite = await schulSeite(s.id);
      if (seite) seiten.push({ s, ...seite });
      await pause();
    }
    const angebot = new Map();
    seiten.forEach(x => x.kurse.forEach((v, k) => { if (!angebot.has(k)) angebot.set(k, v.name); }));
    const fehlen = [...angebot.keys()].filter(k => !offen.has(k));
    const frei = seiten.reduce((n, x) => n + x.frei, 0);
    const je = fehlen.length && frei >= 2 * fehlen.length ? 2 : 1;
    plan.push({ name, seiten, fehlen, angebot, frei, je, offen: offen.size });
  }
  return plan;
}

/** Einen Lehrgang an einer Schule mit `raeume` Räumen starten. Die Seite
    wird dafür frisch gelesen: nach dem vorletzten Raum verschwindet die
    Raumauswahl, und andere Mitglieder belegen zwischendurch. */
async function starten(schulId, key, raeume) {
  const seite = await schulSeite(schulId);
  if (!seite || !seite.kurse.has(key)) return { ok: false, grund: 'kein Raum mehr frei' };
  const n = Math.min(raeume, seite.frei);
  const body = new URLSearchParams();
  body.append('utf8', '✓');
  body.append('authenticity_token', seite.token || document.querySelector('meta[name="csrf-token"]')?.content || '');
  if (seite.mitAuswahl) body.append('building_rooms_use', String(n));
  body.append('education_select', seite.kurse.get(key).wert);
  body.append('alliance[duration]', FREIGABE);
  body.append('alliance[cost]', '0');
  body.append('commit', 'Ausbilden');
  const r = await fetch(seite.action, {
    method: 'POST', credentials: 'same-origin', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  await r.text();
  const ziel = new URL(r.url).pathname;
  return /^\/schoolings\/\d+/.test(ziel)
    ? { ok: true, raeume: n, url: ziel }
    : { ok: false, grund: `keine Weiterleitung auf einen Lehrgang (HTTP ${r.status}, ${ziel})` };
}

async function lauf(knopf, status) {
  const melde = t => { status.textContent = t; };
  knopf.disabled = true;
  try {
    melde('lese Schulen …');
    const plan = await planen(melde);
    const zuOeffnen = plan.reduce((n, p) => n + p.fehlen.length, 0);
    if (!zuOeffnen) {
      melde(`Nichts zu tun — jeder angebotene Lehrgang ist im Verband offen (${
        plan.map(p => `${p.name} ${p.offen}`).join(', ')}).`);
      return;
    }
    const zeilen = plan.filter(p => p.fehlen.length).map(p =>
      `${p.name}: ${p.fehlen.length} fehlen, ${p.frei} Räume frei → je ${p.je} Raum${p.je > 1 ? 'e' : ''}`
      + (p.frei < p.fehlen.length ? ` (reicht nur für ${p.frei})` : ''));
    if (!confirm(`Fehlende Lehrgänge öffnen — kostenlos, 2 Tage Freigabe:\n\n${zeilen.join('\n')}\n\nStarten?`)) {
      melde('Abgebrochen — nichts geöffnet.');
      return;
    }
    let geoeffnet = 0, raeume = 0; const fehler = [];
    for (const p of plan) {
      for (const key of p.fehlen) {
        // Die Schule mit den meisten freien Räumen zuerst — so bleiben
        // Zweier-Starts möglich, statt eine Schule auf einen Raum herunterzufahren.
        const schule = p.seiten.filter(x => x.frei > 0 && x.kurse.has(key)).sort((a, b) => b.frei - a.frei)[0];
        if (!schule) { fehler.push(`${p.name} ${p.angebot.get(key)}: keine Schule mit freiem Raum`); continue; }
        melde(`${p.name}: ${p.angebot.get(key)} …`);
        const r = await starten(schule.s.id, key, p.je);
        await pause();
        if (r.ok) { geoeffnet++; raeume += r.raeume; schule.frei -= r.raeume; }
        else { schule.frei = 0; fehler.push(`${p.name} ${p.angebot.get(key)}: ${r.grund}`); }
      }
    }
    melde(`${geoeffnet} Lehrgänge geöffnet (${raeume} Räume)`
      + (fehler.length ? ` — ${fehler.length} nicht: ${fehler.slice(0, 3).join('; ')}${fehler.length > 3 ? ' …' : ''}` : '') + '.');
    if (fehler.length) console.warn('[LSS Klassenzimmer] nicht geöffnet:', fehler);
  } catch (e) {
    melde(`Fehler: ${e.message} — was bis dahin geöffnet war, bleibt offen.`);
    console.error('[LSS Klassenzimmer]', e);
  } finally {
    knopf.disabled = false;
  }
}

function aufbau() {
  const h4 = [...document.querySelectorAll('.panel-heading h4')].find(h => h.textContent.trim() === 'Gebäude');
  if (!h4 || h4.querySelector('.lssk-knopf')) return;
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = 'btn btn-xs btn-default lssk-knopf';
  knopf.style.marginLeft = '10px';
  knopf.textContent = 'Fehlende Lehrgänge öffnen';
  knopf.title = `LSS Klassenzimmer v${VERSION}: je fehlendem Lehrgang 1–2 Räume, kostenlos, 2 Tage`;
  const status = document.createElement('small');
  status.style.marginLeft = '8px';
  status.style.fontWeight = 'normal';
  knopf.addEventListener('click', () => lauf(knopf, status));
  h4.append(knopf, status);
}

aufbau();
})();
