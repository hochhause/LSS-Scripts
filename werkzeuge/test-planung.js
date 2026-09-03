/* Prüft den Rechenkern der Personalplanung ohne Browser und ohne Spiel.
   Geschnitten wird aus dem Userscript, damit hier nicht eine zweite,
   auseinanderlaufende Fassung derselben Logik entsteht. */
const fs   = require('fs');
const path = require('path');

/* Pfad am Ort dieser Datei festgemacht, damit der Aufruf aus jedem
   Verzeichnis geht. Zweites Argument erlaubt eine andere Fassung. */
const DATEI  = process.argv[2] || path.join(__dirname, '..', 'userscripts', 'lss-planer.user.js');
const quelle = fs.readFileSync(DATEI, 'utf8');

const schnitt = (von, bis) => {
  const a = quelle.indexOf(von);
  const b = quelle.indexOf(bis);
  if (a < 0 || b < 0 || b <= a) throw new Error(`Marke nicht gefunden: ${von} .. ${bis}`);
  return quelle.slice(a, b);
};

const teile = [
  schnitt('const PB = {', 'const T = {'),
  schnitt('/** Anhänger, die an diesem Fahrzeug hängen. */', '/* ═══════════════════════════════════════════════════════════════════\n   Einsatzbereitschaft'),
  schnitt('function mindestBedarf(v) {', '/* Umschaltungen, die gerade nicht möglich'),
  schnitt('/** Soll je Kursschlüssel für eine Wache.', '/** Liest die Personalauswahl einer Wache'),
  schnitt('function sitzeFuerKurs(meta, feld', '/* Das Spiel nennt „N in Ausbildung“'),
  schnitt('/** Leitet den Ausbildungsstand aus einer gelesenen Personalliste ab.', '/* Wer in diesem Lauf schon eingeteilt wurde.'),
  schnitt('function doppelKandidaten(b, key, liste) {', '/** Wählt Personen aus.')
].join('\n');

const stub = `
const S = { plan: null, byBuilding: new Map(), byId: new Map(), opts: {} };
const hatHaken = t => /\u{1F7E2}/u.test(String(t || ''));
const geschuetzt = o => !S.opts.gruenFrei && hatHaken(o?.caption || '');
let uebergangen = 0;
const quals = { by: {}, ts: null };
const saveQuals = () => {};
const log = () => {};        // im Test still
const T = {
  veh: id => vehMeta(id),
  vehName: id => vehMeta(id)?.name || ('Typ ' + id),
  profileOf(b) {
    const ps = S.plan?.model?.types?.[b.building_type]?.profiles || {};
    const a = S.plan?.model?.assignment?.[b.id];
    return (a && ps[a]) ? a : Object.keys(ps)[0] || null;
  },
  target(b) {
    const p = this.profileOf(b);
    return p ? S.plan.model.types[b.building_type].profiles[p] : null;
  }
};
const kursNamen = k => [k];
const stand0 = 0;
const memoK = new Map();
const mineOf = b => S.byBuilding.get(b.id) || [];
const istPlatzhalter = v => !!v?.platzhalter || Number(v?.id) < 0;
const echteVon = b => mineOf(b).filter(v => !istPlatzhalter(v));
`;

const kern = new Function(`${stub}\n${teile}\nreturn { vehMeta, anforderung, besetze, planeWache, mindestBedarf,
           bedarfKeys, doppelKombis, zaehleAus, doppelKandidaten, quals, S,
           courseNeed, bedarfDerWache, memoK, fehltAn, sitzplanSchritte,
           verkaufsKandidaten, verkaufsRang, verkaufsNamen, bestandGegenSoll,
           anhaengerAn, PB_TYPEN: PB };`)();
const { vehMeta, anforderung, besetze, planeWache, mindestBedarf,
        bedarfKeys, doppelKombis, zaehleAus, doppelKandidaten, quals, S,
        courseNeed, bedarfDerWache, memoK, fehltAn, sitzplanSchritte,
        verkaufsKandidaten, verkaufsRang, verkaufsNamen, bestandGegenSoll,
        anhaengerAn, PB_TYPEN } = kern;

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a === b) { console.log(`  ok   ${name}`); return; }
  console.log(`  FEHL ${name}\n       ist  ${a}\n       soll ${b}`);
  fehler++;
};

let lfd = 1;
const fz = (typ, opt = {}) => ({ id: lfd++, building_id: 1, vehicle_type: typ,
  caption: vehMeta(typ).name, fms_real: 2, zugfahrzeug: null, ...opt });
const wache = fahrzeuge => {
  S.byBuilding = new Map([[1, fahrzeuge]]);
  return { id: 1, caption: 'Testwache' };
};
const person = (id, ...kurse) => ({ id: String(id), name: 'P' + id, quals: kurse, inAusbildung: [] });
// Person, die im Spiel schon auf einem Fahrzeug sitzt
const sitzt = (id, fzId, ...kurse) => ({ ...person(id, ...kurse), assignedTo: String(fzId) });
const auf = (plan, v) => (plan.zuweisung.get(v.id) || []).map(p => p.id).sort();

/* ── 1. Lehrgangsschlüssel kommen überhaupt an ─────────────────────── */
console.log('\n1. Anforderung aus den Stammdaten');
{
  const v = fz(64);                       // GW-Wasserrettung
  wache([v]);
  const a = anforderung(v);
  pruefe('GW-Wasserrettung: alle brauchen gw_wasserrettung', a.alle, ['gw_wasserrettung']);
  pruefe('GW-Wasserrettung: min/max', [a.min, a.max], [1, 6]);
}
{
  const v = fz(97);                       // ITW
  wache([v]);
  const a = anforderung(v);
  pruefe('ITW: intensive_care 2', a.mind.get('intensive_care'), 2);
  pruefe('ITW: notarzt 1', a.mind.get('notarzt'), 1);
  pruefe('ITW: kein Alle-Kurs', a.alle, []);
}

/* ── 2. n = 0 heißt: Zahl steht in est ─────────────────────────────── */
console.log('\n2. Dekon-P — Anforderung steckt in est, nicht in n');
{
  const v = fz(53);
  wache([v]);
  const a = anforderung(v);
  pruefe('Dekon-P: 6x dekon_p', a.mind.get('dekon_p'), 6);
}

/* ── 3. Anhänger schieben Bedarf auf das Zugfahrzeug ───────────────── */
console.log('\n3. Anhänger');
{
  const zug = fz(64);                     // GW-Wasserrettung, 6 Sitze
  const mzb = fz(70, { zugfahrzeug: zug.id });   // MZB: est 4, gw_wasserrettung
  wache([zug, mzb]);
  const a = anforderung(zug);
  // Die vier für das Boot sind die Besatzung, nicht zusätzlich zu ihr
  pruefe('MZB setzt die Mindestbesatzung auf 4', a.min, 4);
  pruefe('MZB fordert 4x gw_wasserrettung', a.mind.get('gw_wasserrettung'), 4);
  pruefe('mindestBedarf zählt den Anhänger', mindestBedarf(zug), 4);
  pruefe('Anhänger selbst braucht nichts', mindestBedarf(mzb), 0);
}
{
  /* LKW 7 Lkr 19 tm hat 2 Sitze, der Anh MzB verlangt 4 an der Einsatzstelle.
     Im Spiel ist das eine übliche Kombination — die anderen zwei kommen mit
     einem zweiten Fahrzeug. Das Gespann ist also besetzbar, mit zweien. */
  const zug = fz(65);
  const anh = fz(66, { zugfahrzeug: 0 });
  anh.zugfahrzeug = zug.id;
  const b2 = wache([zug, anh]);
  const a = anforderung(zug);
  pruefe('Forderung auf die Sitze gedeckelt', [a.min, a.max], [2, 2]);
  pruefe('zwei davon mit Wasserrettung', a.mind.get('gw_wasserrettung'), 2);
  const plan = planeWache(b2, { people: [
    person(1, 'gw_wasserrettung'), person(2, 'gw_wasserrettung'), person(3)
  ] }, false);
  pruefe('Gespann besetzbar', plan.lahm.length, 0);
}

/* ── 4. Der Fall, an dem die alte Verteilung scheiterte ────────────── */
console.log('\n4. Knappheit zuerst: A kann X und Y, B nur Y');
{
  const fzX = fz(63);                     // GW-Taucher   → alle gw_taucher
  const fzY = fz(64);                     // GW-Wasserr.  → alle gw_wasserrettung
  const b = wache([fzX, fzY]);
  const roster = { people: [
    person(1, 'gw_taucher', 'gw_wasserrettung'),   // A
    person(2, 'gw_wasserrettung'),                 // B
    person(3, 'gw_taucher')                        // C, damit GW-Taucher (min 2) aufgeht
  ] };
  const plan = planeWache(b, roster);
  const auf = id => (plan.zuweisung.get(id) || []).map(p => p.id).sort();
  pruefe('GW-Taucher bekommt die beiden Taucher', auf(fzX.id), ['1', '3']);
  pruefe('GW-Wasserrettung bekommt B', auf(fzY.id), ['2']);
  pruefe('nichts lahmgelegt', plan.lahm.length, 0);
}

/* ── 5. Engpass wird gemeldet, nicht verschluckt ───────────────────── */
console.log('\n5. Engpass');
{
  const v1 = fz(64), v2 = fz(64);
  const b = wache([v1, v2]);
  const plan = planeWache(b, { people: [person(1, 'gw_wasserrettung')] });
  pruefe('eine Wasserrettung besetzt', plan.zuweisung.size, 1);
  pruefe('die zweite lahmt', plan.lahm.length, 1);
  pruefe('Lücke benannt', plan.luecken.get('gw_wasserrettung'), 1);
}

/* ── 6. Ungelernte landen nicht auf Fachfahrzeugen ─────────────────── */
console.log('\n6. Ungelernte');
{
  const lf = fz(0), gw = fz(64);
  const b = wache([lf, gw]);
  const plan = planeWache(b, { people: [person(1), person(2), person(3, 'gw_wasserrettung')] });
  const aufGw = (plan.zuweisung.get(gw.id) || []).map(p => p.id);
  pruefe('nur der Ausgebildete auf der GW-Wasserrettung', aufGw, ['3']);
  pruefe('LF 20 kommt mit Ungelernten aus', (plan.zuweisung.get(lf.id) || []).length >= 1, true);
}

/* ── 7. Unbekannter Fahrzeugtyp bricht nichts ──────────────────────── */
console.log('\n7. Fahrzeugtyp, den die Stammdaten nicht kennen');
{
  const v = { id: 99, building_id: 1, vehicle_type: 9999, caption: 'Neu', fms_real: 2 };
  const b = wache([v]);
  pruefe('vehMeta liefert null statt zu werfen', vehMeta(9999), null);
  pruefe('mindestBedarf bleibt 0', mindestBedarf(v), 0);
  pruefe('planeWache übergeht ihn', planeWache(b, { people: [] }).zuweisung.size, 0);
}

/* ── 8. Auffüllen bis Vollbesetzung ────────────────────────────────── */
console.log('\n8. Auffüllen, nachdem jedes Fahrzeug sein Minimum hat');
{
  const lf = fz(0);                        // LF 20: min 1, max 9, kein Kurs
  const nef = fz(29);                      // NEF: min 1, max 2, alle notarzt
  const b = wache([lf, nef]);
  const leute = [person(1, 'notarzt'), person(2), person(3), person(4)];
  const plan = planeWache(b, { people: leute }, true);
  const aufLf = (plan.zuweisung.get(lf.id) || []).map(p => p.id).sort();
  const aufNef = (plan.zuweisung.get(nef.id) || []).map(p => p.id);
  pruefe('Notarzt bleibt dem NEF', aufNef, ['1']);
  pruefe('LF bekommt alle Ungelernten', aufLf, ['2', '3', '4']);
  pruefe('niemand bleibt übrig', plan.uebrig, 0);
}
{
  const lf = fz(0), gw = fz(64);           // GW-Wasserrettung: alle gw_wasserrettung
  const b = wache([lf, gw]);
  const leute = [person(1, 'gw_wasserrettung'), person(2, 'gw_wasserrettung'), person(3)];
  const plan = planeWache(b, { people: leute }, true);
  const aufGw = (plan.zuweisung.get(gw.id) || []).map(p => p.id).sort();
  pruefe('beide Wasserretter füllen die GW auf', aufGw, ['1', '2']);
  pruefe('der Ungelernte fährt LF', (plan.zuweisung.get(lf.id) || []).map(p => p.id), ['3']);
}
{
  const lf = fz(0);
  const b = wache([lf]);
  // Ein Taucher an einer Wache ohne Tauchfahrzeug ist hier keine Fachkraft
  const plan = planeWache(b, { people: [person(1, 'gw_taucher'), person(2)] }, true);
  pruefe('nicht gebrauchter Lehrgang hindert das Auffüllen nicht',
    (plan.zuweisung.get(lf.id) || []).map(p => p.id).sort(), ['1', '2']);
}
{
  const nef = fz(29);
  const b = wache([nef]);
  const plan = planeWache(b, { people: [person(1, 'notarzt'), person(2)] }, true);
  pruefe('Ungelernter kommt nicht aufs NEF', (plan.zuweisung.get(nef.id) || []).map(p => p.id), ['1']);
  pruefe('er bleibt übrig', plan.uebrig, 1);
}
{
  const lf = fz(0), nef = fz(29);
  const b = wache([lf, nef]);
  const plan = planeWache(b, { people: [person(1, 'notarzt'), person(2)] }, false);
  pruefe('ohne Auffüllen nur Mindestbesetzung',
    [(plan.zuweisung.get(lf.id) || []).length, (plan.zuweisung.get(nef.id) || []).length], [1, 1]);
}

/* ── 9. Eine Person zählt einmal ───────────────────────────────────── */
console.log('\n9. Doppelausbildung zählt nicht doppelt');

// Zielprofil setzen: darüber weiß die Wache, was sie braucht
const ziel = (bid, typ, vehicles) => {
  memoK.clear();                     // wie standNeu() beim Planwechsel
  S.plan = { model: { types: { [typ]: { profiles: { A: { vehicles } } } }, assignment: { [bid]: 'A' } } };
  const b = { id: bid, caption: 'Testwache', building_type: typ };
  S.byId = new Map([[bid, b]]);
  return b;
};
const box = (id, ...kurse) => ({ id: String(id), kurse });

{
  // ITW: 2x Intensivpflege, 1x Notarzt — auf drei Sitzen, also drei Köpfe
  const b = ziel(1, 2, { 97: 1 });
  S.byBuilding = new Map([[1, []]]);
  quals.by = {};
  zaehleAus(1, [box(1, 'notarzt', 'intensive_care'), box(2, 'intensive_care')]);
  const z = quals.by[1];
  pruefe('Doppelqualifizierter zählt nur einmal', (z.notarzt || 0) + (z.intensive_care || 0), 2);
  pruefe('der Einzelne behält seinen Kurs', z.intensive_care, 1);
  pruefe('der Doppelte deckt die größere Lücke', z.notarzt, 1);
}
{
  // ELW2 Drohne verlangt beide Lehrgänge auf jedem Sitz
  const b = ziel(1, 2, { 129: 1 });
  S.byBuilding = new Map([[1, []]]);
  quals.by = {};
  const kombis = doppelKombis(b);
  pruefe('Kombination erkannt', kombis.map(k => k.kurse.join('+')), ['elw2+fire_drone']);
  zaehleAus(1, [box(1, 'elw2', 'fire_drone')]);
  pruefe('hier zählt ein Kopf für beides',
    [quals.by[1].elw2, quals.by[1].fire_drone], [1, 1]);
}
{
  // Zugfahrzeug mit eigenem Lehrgang vererbt ihn an die Plätze des Anhängers
  const wlf = fz(46);                                  // WLF: alle wechsellader
  const ab = fz(71, { zugfahrzeug: wlf.id });          // AB-MZB: est 4, gw_wasserrettung
  const b = ziel(1, 2, { 46: 1, 71: 1 });
  S.byBuilding = new Map([[1, [wlf, ab]]]);
  const kombis = doppelKombis(b);
  pruefe('Gespann fordert beide Lehrgänge auf einem Sitz',
    kombis.map(k => k.kurse.join('+')), ['gw_wasserrettung+wechsellader']);
  // WLF hat drei Sitze, mehr Doppelqualifizierte kann es dort nicht brauchen
  pruefe('für so viele Plätze, wie das WLF hat', kombis[0].n, 3);
}

/* ── 10. Wen die Ausbildung anfassen darf ──────────────────────────── */
console.log('\n10. Auswahl für die Schule');
{
  const b = ziel(1, 2, { 64: 1 });                     // nur GW-Wasserrettung geplant
  S.byBuilding = new Map([[1, []]]);
  const liste = [box(1), box(2, 'notarzt'), box(3, 'gw_wasserrettung')];
  pruefe('kein Doppelbedarf → keine Ausgebildeten',
    doppelKandidaten(b, 'gw_wasserrettung', liste).map(p => p.id), []);
}
{
  const b = ziel(1, 2, { 129: 1 });                    // ELW2 Drohne
  S.byBuilding = new Map([[1, []]]);
  const liste = [box(1), box(2, 'elw2'), box(3, 'elw2', 'fire_drone'), box(4, 'notarzt')];
  const k = doppelKandidaten(b, 'fire_drone', liste).map(p => p.id);
  pruefe('nur wer den Partnerkurs schon hat', k, ['2']);
  pruefe('der Fertige bleibt draußen', k.includes('3'), false);
  pruefe('der Notarzt bleibt draußen', k.includes('4'), false);
}
{
  const b = ziel(1, 2, { 129: 1 });
  S.byBuilding = new Map([[1, []]]);
  // Bedarf ist gedeckt: sechs Sitze, sechs fertige Doppelqualifizierte
  const liste = Array.from({ length: 6 }, (_, i) => box(i + 1, 'elw2', 'fire_drone'));
  liste.push(box(9, 'elw2'));
  pruefe('gedeckter Doppelbedarf zieht niemanden mehr nach',
    doppelKandidaten(b, 'fire_drone', liste).map(p => p.id), []);
}

/* ── 11. Bedarf hängt nicht mehr am Klartext ───────────────────────── */
console.log('\n11. Bedarf rechnet auf Schlüsseln');
{
  // thw_zugtrupp hat keinen fest hinterlegten Klartextnamen. Bis v0.21 fiel
  // der Bedarf dadurch auf null und die Wache galt als fertig.
  const b = ziel(1, 2, { 165: 2 });        // MTW (FGr N) o.ä. — Hauptsache THW
  S.byBuilding = new Map([[1, []]]);
  const meta = vehMeta(165);
  if (meta?.kurse?.length) {
    const key = meta.kurse[0].k;
    const soll = courseNeed(b)[key] || 0;
    pruefe(`Bedarf für ${key} ohne Klartextnamen`, soll > 0, true);
    pruefe('bedarfDerWache liefert dieselbe Sicht', bedarfDerWache(b, key).max, soll);
  } else {
    pruefe('Testfahrzeug 165 trägt einen Lehrgang', !!meta?.kurse?.length, true);
  }
}
{
  const b = ziel(1, 2, { 97: 1 });         // ITW
  S.byBuilding = new Map([[1, []]]);
  const n = courseNeed(b);
  pruefe('Schlüssel statt Namen in courseNeed',
    Object.keys(n).sort(), ['intensive_care', 'notarzt']);
  pruefe('großzügig gebucht: volle Besatzung je Kurs (D-05)', n.notarzt, 3);
}
{
  const b = ziel(1, 2, { 9999: 1 });       // Typ, den PB nicht kennt
  S.byBuilding = new Map([[1, []]]);
  pruefe('unbekannter Typ fordert keine Ausbildung', Object.keys(courseNeed(b)).length, 0);
}

/* ── 12. Namen drehen statt Leute schieben ─────────────────────────── */
console.log('\n12. Vorhandene Besetzung bleibt sitzen');
{
  // Zwei gleichwertige Ungelernte, jeder sitzt schon auf einem LF.
  // Der Plan darf sie nicht über Kreuz tauschen.
  const lf1 = fz(0), lf2 = fz(0);
  const b = wache([lf1, lf2]);
  const plan = planeWache(b, { people: [sitzt(1, lf2.id), sitzt(2, lf1.id)] }, true);
  pruefe('jeder bleibt auf seinem Fahrzeug', [auf(plan, lf1), auf(plan, lf2)], [['2'], ['1']]);
}
{
  // Der Geplante sitzt woanders, ein gleichwertiger sitzt schon drauf
  const lf = fz(0), gw = fz(64);
  const b = wache([lf, gw]);
  const plan = planeWache(b, {
    people: [sitzt(1, gw.id, 'gw_wasserrettung'), sitzt(2, lf.id), person(3)]
  }, false);
  pruefe('Wasserretter bleibt auf der GW', auf(plan, gw), ['1']);
  pruefe('der Sitzende behält das LF', auf(plan, lf), ['2']);
}
{
  // Angleichen darf keine Auflage brechen: nur einer kann Notarzt
  const nef = fz(29), lf = fz(0);
  const b = wache([nef, lf]);
  const plan = planeWache(b, {
    people: [sitzt(1, lf.id, 'notarzt'), sitzt(2, nef.id)]
  }, false);
  pruefe('der Notarzt muss aufs NEF, auch wenn er falsch sitzt', auf(plan, nef), ['1']);
  pruefe('der andere aufs LF', auf(plan, lf), ['2']);
}
{
  // Über Kreuz: beide sind qualifiziert, sitzen aber vertauscht
  const gw1 = fz(64), gw2 = fz(64);
  const b = wache([gw1, gw2]);
  const plan = planeWache(b, {
    people: [sitzt(1, gw2.id, 'gw_wasserrettung'), sitzt(2, gw1.id, 'gw_wasserrettung')]
  }, false);
  pruefe('Kreuztausch aufgelöst', [auf(plan, gw1), auf(plan, gw2)], [['2'], ['1']]);
  const bewegt = [...plan.zuweisung.entries()]
    .flatMap(([vid, ps]) => ps.filter(x => x.assignedTo !== String(vid)));
  pruefe('niemand muss umziehen', bewegt.length, 0);
}
{
  // Ohne vorhandene Besetzung ändert der Angleich nichts
  const lf = fz(0);
  const b = wache([lf]);
  const plan = planeWache(b, { people: [person(1), person(2)] }, true);
  pruefe('eine Spalte, weil kein Lehrgang gebraucht wird', plan.spalten, 1);
  pruefe('trotzdem voll geplant', auf(plan, lf), ['1', '2']);
}

/* ── 13. Spaltenlogik ──────────────────────────────────────────────── */
console.log('\n13. Spalten');
{
  // Der Fall aus der Absprache: ITW will 2x Intensivpflege + 1x Notarzt auf
  // drei Sitzen. Der Doppelte deckt zwei Zeilen mit einem Sitz.
  const itw = fz(97);
  const b = wache([itw]);
  const plan = planeWache(b, { people: [
    person(1, 'notarzt', 'intensive_care'),
    person(2, 'intensive_care'),
    person(3)
  ] }, true);
  pruefe('ITW besetzt', auf(plan, itw), ['1', '2', '3']);
}
{
  // Sackgasse: die Notarzt-Auflage zuerst aus der reinen Notarzt-Spalte zu
  // decken lässt die zweite Intensivpflege fehlen. Muss zurückgenommen werden.
  const itw = fz(97);
  const b = wache([itw]);
  const plan = planeWache(b, { people: [
    person(1, 'notarzt'),
    person(2, 'notarzt', 'intensive_care'),
    person(3, 'intensive_care'),
    person(4)
  ] }, false);
  const drauf = auf(plan, itw);
  pruefe('eine gültige Besatzung gefunden', drauf.length, 3);
  pruefe('Doppelter ist dabei', drauf.includes('2'), true);
  pruefe('nicht lahmgelegt', plan.lahm.length, 0);
}
{
  // Fertig schlägt „im Unterricht“ — das Fahrzeug soll nicht auf Status 6
  const gw = fz(64);
  const b = wache([gw]);
  const lernt = { ...person(2), inAusbildung: ['gw_wasserrettung'] };
  const plan = planeWache(b, { people: [person(1, 'gw_wasserrettung'), lernt] }, false);
  pruefe('der Ausgebildete kommt zuerst', auf(plan, gw), ['1']);
}
{
  // Wer nirgends sitzt, geht vor dem, der woanders sitzt
  const lf1 = fz(0), lf2 = fz(0);
  const b = wache([lf1, lf2]);
  const plan = planeWache(b, { people: [sitzt(1, lf2.id), person(2)] }, false);
  pruefe('der Freie füllt das leere Fahrzeug', auf(plan, lf1), ['2']);
  pruefe('der Sitzende bleibt sitzen', auf(plan, lf2), ['1']);
}
{
  // Spalten entstehen nur aus Lehrgängen, die diese Wache verlangt
  const gw = fz(64);
  const b = wache([gw]);
  const plan = planeWache(b, { people: [
    person(1, 'gw_wasserrettung'),
    person(2, 'notarzt'),          // hier irrelevant → Spalte „—“
    person(3)
  ] }, false);
  pruefe('zwei Spalten: mit und ohne Wasserrettung', plan.spalten, 2);
}

/* ── 14. Einsatzstellen-Bedarf sprengt keine Sitzreihe ─────────────── */
console.log('\n14. est über der Sitzzahl');
{
  // Pferdetransporter groß: 2 Sitze, aber 4 Reiter an der Einsatzstelle.
  // Die anderen beiden kommen mit einem zweiten Fahrzeug.
  const pt = fz(135);
  wache([pt]);
  const a = anforderung(pt);
  pruefe('Auflage auf die Sitzzahl gedeckelt', a.mind.get('police_horse'), 2);
  const b2 = wache([pt]);
  const plan = planeWache(b2, { people: [
    { ...person(1), inAusbildung: ['police_horse'] },
    { ...person(2), inAusbildung: ['police_horse'] },
    person(3)
  ] }, false);
  pruefe('mit Lernenden besetzbar', auf(plan, pt), ['1', '2']);
  pruefe('nicht mehr lahm', plan.lahm.length, 0);
}
{
  // Dekon-P: 6 an der Einsatzstelle, 6 Sitze — hier ändert der Deckel nichts
  const dp = fz(53);
  wache([dp]);
  pruefe('Dekon-P bleibt bei 6', anforderung(dp).mind.get('dekon_p'), 6);
}
{
  // Der Anhänger behält seine Forderung: sie gilt dem Zugfahrzeug
  const zug = fz(64), mzb = fz(70, { zugfahrzeug: 0 });
  mzb.zugfahrzeug = zug.id;
  wache([zug, mzb]);
  pruefe('MZB fordert weiter 4', anforderung(zug).mind.get('gw_wasserrettung'), 4);
}

/* ── 15. Warum ein Gespann nicht aufgeht, muss dastehen ────────────── */
console.log('\n15. Zwei Anhänger an einem Zugfahrzeug');
{
  /* Diese Probe verlangte bis v0.57.0 sechs Leute: `anforderung` summierte
     die Anhänger (4+4), gedeckelt auf die Sitzzahl. Sie kodierte damit die
     falsche Regel. Ein Zugfahrzeug darf an mehreren Anhängern hängen, zieht
     aber nur einen — also fordert das Gespann so viel wie sein größter
     Anhänger, nicht wie alle zusammen (D-85). */
  const gw = fz(64);                                  // 1 eigener, 6 Sitze
  const m1 = fz(70, { zugfahrzeug: 0 }), m2 = fz(70, { zugfahrzeug: 0 });
  m1.zugfahrzeug = gw.id; m2.zugfahrzeug = gw.id;     // zwei MZB an einem Zug
  const b = wache([gw, m1, m2]);
  const a = anforderung(gw);
  pruefe('zwei MZB an einem GW: es zaehlt eines, nicht beide', a.min, 4);
  pruefe('ein MZB allein fordert dasselbe', (() => {
    wache([gw, m1]);
    const eins = anforderung(gw).min;
    wache([gw, m1, m2]);
    return eins;
  })(), a.min);
  const plan = planeWache(b, { people: [] }, false);
  pruefe('ohne Personal lahm, aber nicht wegen der Sitze',
    !!plan.lahm.find(y => y.v.id === gw.id)?.zuEng, false);
}

/* ── 16. Ein Zugfahrzeug, ein Anhänger ─────────────────────────────── */
console.log('\n16. Zwei GW, zwei MZB — das geht auf');
{
  const gw1 = fz(64), gw2 = fz(64);
  const m1 = fz(70), m2 = fz(70);
  m1.zugfahrzeug = gw1.id; m2.zugfahrzeug = gw2.id;
  const b = wache([gw1, gw2, m1, m2]);
  pruefe('jedes Gespann braucht 4', [anforderung(gw1).min, anforderung(gw2).min], [4, 4]);
  const leute = Array.from({ length: 8 }, (_, i) => person(i + 1, 'gw_wasserrettung'));
  const plan = planeWache(b, { people: leute }, false);
  pruefe('beide besetzt', plan.lahm.length, 0);
  pruefe('vier auf jedem', [auf(plan, gw1).length, auf(plan, gw2).length], [4, 4]);
}

/* ── 17. Anhänger zählen nicht doppelt ─────────────────────────────── */
console.log('\n17. Lehrgangsbedarf einer Wasserrettungswache');
{
  // 2x GW-Wasserrettung (6 Sitze), 2x MZB (est 4), 2x GW-Taucher (2 Sitze)
  const b = ziel(1, 12, { 64: 2, 70: 2, 63: 2 });
  S.byBuilding = new Map([[1, []]]);
  const n = courseNeed(b);
  pruefe('Wasserretter: nur die Sitze der GW', n.gw_wasserrettung, 12);
  pruefe('Taucher: 2 Fahrzeuge à 2 Sitze', n.gw_taucher, 4);
  pruefe('bedarfDerWache stimmt überein', bedarfDerWache(b, 'gw_wasserrettung').max, 12);
}
{
  // WLF zieht den AB-MZB: hier fordert kein Zugfahrzeug die Wasserrettung,
  // also muß der Anhänger sie beisteuern — sonst stünde für das Boot niemand
  const b = ziel(1, 12, { 46: 1, 71: 1 });
  S.byBuilding = new Map([[1, []]]);
  const n = courseNeed(b);
  pruefe('AB-MZB steuert seine 4 bei', n.gw_wasserrettung, 4);
  pruefe('WLF fordert weiter Wechsellader', n.wechsellader > 0, true);
}

/* ── 18. Schutz für grün Markiertes ───────────────────────────────── */
console.log('\n18. Grüne Fahrzeuge bleiben unangetastet');
{
  const gruen = fz(64, { caption: '\u{1F7E2} GW-Wasserrettung #I' });
  const offen = fz(64);
  const b = wache([gruen, offen]);
  const leute = [
    sitzt(1, gruen.id, 'gw_wasserrettung'),
    sitzt(2, gruen.id, 'gw_wasserrettung'),
    person(3, 'gw_wasserrettung')
  ];
  S.opts.gruenFrei = false;
  const plan = planeWache(b, { people: leute }, false);
  pruefe('die Besatzung des grünen bleibt', auf(plan, gruen), ['1', '2']);
  pruefe('sie wird nicht anderswo verplant', auf(plan, offen), ['3']);
  pruefe('als fest gemeldet', plan.fest, 1);
}
{
  // Freigegeben darf umverteilt werden
  const gruen = fz(64, { caption: '\u{1F7E2} GW-Wasserrettung #I' });
  const taucher = fz(63);
  const b = wache([gruen, taucher]);
  const leute = [
    sitzt(1, gruen.id, 'gw_taucher'), sitzt(2, gruen.id, 'gw_taucher'),
    person(3, 'gw_wasserrettung')
  ];
  S.opts.gruenFrei = true;
  const frei = planeWache(b, { people: leute }, false);
  pruefe('freigegeben wandern die Taucher zum Taucherfahrzeug', auf(frei, taucher), ['1', '2']);
  S.opts.gruenFrei = false;
  const schutz = planeWache(b, { people: leute }, false);
  pruefe('geschützt bleiben sie sitzen', auf(schutz, gruen), ['1', '2']);
  pruefe('das Taucherfahrzeug bleibt dafür leer', schutz.lahm.length, 1);
}
{
  // Auffüllen bleibt erlaubt: hinzufügen nimmt niemandem etwas weg
  const gruen = fz(64, { caption: '\u{1F7E2} GW-Wasserrettung #I' });
  const b = wache([gruen]);
  S.opts.gruenFrei = false;
  const plan = planeWache(b, {
    people: [sitzt(1, gruen.id, 'gw_wasserrettung'), person(2, 'gw_wasserrettung')]
  }, true);
  pruefe('freier Sitz wird gefüllt', auf(plan, gruen), ['1', '2']);
}
S.opts.gruenFrei = false;

/* ── 19. Eben gekaufte Fahrzeuge bleiben unangetastet ──────────────── */
console.log('\n19. Vorgemerkte Fahrzeuge');
{
  const echt = fz(64);
  const neuGekauft = { ...fz(64), id: -1787646232475, caption: 'GW-Wasserrettung (neu)', platzhalter: true };
  const b = wache([echt, neuGekauft]);
  const plan = planeWache(b, { people: [person(1, 'gw_wasserrettung'), person(2, 'gw_wasserrettung')] }, true);
  pruefe('das echte wird besetzt', (plan.zuweisung.get(echt.id) || []).length > 0, true);
  pruefe('das vorgemerkte nicht', plan.zuweisung.has(neuGekauft.id), false);
  pruefe('und gilt auch nicht als lahm', plan.lahm.some(x => x.v.id === neuGekauft.id), false);
}

/* ── 20. Knappe Kurse gehen vor aufgeblähten ───────────────────────── */
console.log('\n20. Verteilung nach Knappheit');
{
  // Polizeiwache: 3 Zivilstreifen (6 Sitze Kriminalpolizei), 1 FuStW DGL (2),
  // 2 FuStW AP (4). Zwei Leute können Kriminalpolizei UND Dienstgruppenleitung.
  const b = ziel(1, 6, { 98: 3, 103: 1, 184: 2 });
  S.byBuilding = new Map([[1, []]]);
  quals.by = {};
  zaehleAus(1, [
    box(1, 'criminal_investigation', 'police_service_group_leader'),
    box(2, 'criminal_investigation', 'police_service_group_leader'),
    box(3, 'criminal_investigation'),
    box(4, 'highway_police', 'criminal_investigation'),
    box(5, 'highway_police')
  ]);
  const z = quals.by[1];
  pruefe('Dienstgruppenleitung wird nicht verschluckt', z.police_service_group_leader, 2);
  pruefe('Kriminalpolizei behält den Rest', z.criminal_investigation, 2);
  pruefe('Autobahnpolizei ebenfalls versorgt', z.highway_police, 1);
  pruefe('jeder zählt genau einmal',
    (z.police_service_group_leader || 0) + (z.criminal_investigation || 0) + (z.highway_police || 0), 5);
}

/* ── 21. Ein einzelner Lehrgang geht nie verloren ──────────────────── */
console.log('\n21. Einzelqualifizierte');
{
  // Zwei Leute, nur Motorradstaffel, sonst nichts — die Wache plant zwei Motorräder
  const b = ziel(1, 6, { 95: 2, 98: 3 });
  S.byBuilding = new Map([[1, []]]);
  quals.by = {};
  zaehleAus(1, [box(1, 'police_motorcycle'), box(2, 'police_motorcycle'),
                box(3, 'criminal_investigation')]);
  pruefe('beide Motorradfahrer gezählt', quals.by[1].police_motorcycle, 2);
  pruefe('der Dritte ebenfalls', quals.by[1].criminal_investigation, 1);
}

console.log('\n22. Haken: beide Anforderungskanäle, nicht nur Köpfe');
{
  /* Der Haken prüfte früher nur `alle` und zählte danach Köpfe. Ein Dekon-P
     (Typ 53: min 1, est 6, dekon_p als `min`-Anforderung) galt damit mit einer
     ungelernten Person als fertig -- und der grüne Punkt fror das fest. */
  const kann = (...k) => new Set(k);
  const dekon = fz(53);
  S.byBuilding = new Map([[1, [dekon]]]);

  pruefe('Dekon-P mit einem Ungelernten ist NICHT fertig',
         !!fehltAn(dekon, [kann()]), true);
  pruefe('Grund nennt den fehlenden Lehrgang',
         /dekon_p/.test(fehltAn(dekon, [kann()])), true);
  pruefe('sechs Ungelernte reichen auch nicht',
         !!fehltAn(dekon, Array.from({ length: 6 }, () => kann())), true);
  pruefe('sechs mit dekon_p sind fertig',
         fehltAn(dekon, Array.from({ length: 6 }, () => kann('dekon_p'))), '');

  // `alle` gilt für jeden Sitz: eine Person ohne den Kurs kippt das Fahrzeug
  const gwW = fz(64);
  S.byBuilding = new Map([[1, [gwW]]]);
  const noetig = mindestBedarf(gwW);
  const voll = Array.from({ length: noetig }, () => kann('gw_wasserrettung'));
  pruefe('GW-Wasserrettung voll ausgebildet ist fertig', fehltAn(gwW, voll), '');
  pruefe('einer ohne Lehrgang genügt zum Nein',
         !!fehltAn(gwW, voll.slice(0, -1).concat([kann()])), true);
  pruefe('zu wenige Personen wird zuerst gemeldet',
         /von \d+ Personen/.test(fehltAn(gwW, [])), true);
}

console.log('');
console.log('23. Sitzplan: Umzuege ueberleben jede Reihenfolge');
{
  /* `zuweisungDo` ist ein Umschalter. Wer ueber eine Momentaufnahme arbeitet,
     loest beim zweiten Griff wieder aus, was der erste gesetzt hat — und ob
     das passiert, entschied allein die Reihenfolge des Bestands (D-81).
     Geprueft wird deshalb der ENDZUSTAND, nachgespielt mit echter
     Umschalt-Wirkung, nicht die Schrittfolge. */
  const person = (id, auf) => ({ id: String(id), name: 'P' + id, assignedTo: auf ? String(auf) : null });
  const spielDurch = (personen, schritte) => {
    const sitzt = new Map(personen.map(p => [p.id, p.assignedTo || null]));
    for (const sch of schritte) sitzt.set(sch.pId, sitzt.get(sch.pId) === sch.fzId ? null : sch.fzId);
    return sitzt;
  };
  const A = { id: 10 }, B = { id: 20 };

  // P sitzt auf A, soll auf B — einmal in jeder Reihenfolge
  for (const [reihe, wie] of [[[A, B], 'A vor B'], [[B, A], 'B vor A']]) {
    const leute = [person(1, 10)];
    const zuw = new Map([[20, [leute[0]]]]);
    const { schritte } = sitzplanSchritte(leute, zuw, reihe, new Set());
    const ende = spielDurch(leute, schritte);
    pruefe('Umzug A->B, ' + wie + ': P landet auf B', ende.get('1'), '20');
  }

  // Kreuztausch: P von A nach B, Q von B nach A
  {
    const leute = [person(1, 10), person(2, 20)];
    const zuw = new Map([[10, [leute[1]]], [20, [leute[0]]]]);
    const { schritte } = sitzplanSchritte(leute, zuw, [A, B], new Set());
    const ende = spielDurch(leute, schritte);
    pruefe('Kreuztausch: P nach B', ende.get('1'), '20');
    pruefe('Kreuztausch: Q nach A', ende.get('2'), '10');
  }

  // Wer schon richtig sitzt, wird nicht angefasst
  {
    const leute = [person(1, 10)];
    const zuw = new Map([[10, [leute[0]]]]);
    const { schritte } = sitzplanSchritte(leute, zuw, [A, B], new Set());
    pruefe('richtig Sitzender kostet keine Anfrage', schritte.length, 0);
  }

  // Lahmes Fahrzeug wird geleert
  {
    const leute = [person(1, 10)];
    const { schritte } = sitzplanSchritte(leute, new Map(), [A], new Set(['10']));
    const ende = spielDurch(leute, schritte);
    pruefe('lahmes Fahrzeug wird geraeumt', ende.get('1'), null);
    pruefe('und zwar mit genau einer Anfrage', schritte.length, 1);
  }

  // Ein Umzug kostet zwei Anfragen, nicht drei
  {
    const leute = [person(1, 10)];
    const zuw = new Map([[20, [leute[0]]]]);
    const { schritte } = sitzplanSchritte(leute, zuw, [B, A], new Set());
    pruefe('Umzug kostet genau zwei Anfragen', schritte.length, 2);
  }
}

console.log('');
console.log('24. Fachkraefte bleiben frei, solange es einfachere gibt');
{
  /* X = gw_taucher, Y = gw_wasserrettung. Ein Fahrzeug verlangt nur Y.
     Steht an derselben Wache auch ein X-Fahrzeug, ist X knapp — dann gehoert
     der Doppelqualifizierte NICHT auf das Y-Fahrzeug. Massstab ist nicht
     „wenige Lehrgaenge", sondern „wenige Lehrgaenge, die HIER knapp sind". */
  const yF = fz(64), xF = fz(63);
  const b = wache([yF, xF]);
  const plan = planeWache(b, { people: [
    person(1, 'gw_wasserrettung'),
    person(2, 'gw_wasserrettung', 'gw_taucher'),
    person(3, 'gw_taucher'),
    person(4, 'gw_taucher')
  ] }, false);
  pruefe('Y-Fahrzeug nimmt den Y-Only', auf(plan, yF), ['1']);
  pruefe('X-Fahrzeug nimmt die X-Only', auf(plan, xF), ['3', '4']);
  pruefe('der Doppelte bleibt uebrig', plan.uebrig, 1);
}
{
  // Reicht es nicht, muss der Doppelte ran — Freihalten ist kein Selbstzweck
  const yF = fz(64), xF = fz(63);
  const b = wache([yF, xF]);
  const plan = planeWache(b, { people: [
    person(1, 'gw_wasserrettung', 'gw_taucher'),
    person(2, 'gw_taucher'),
    person(3, 'gw_taucher')
  ] }, false);
  pruefe('ohne Y-Only springt der Doppelte ein', auf(plan, yF), ['1']);
  pruefe('das X-Fahrzeug bleibt trotzdem besetzt', auf(plan, xF), ['2', '3']);
}

/* ── 25. Verkauf: irgendeiner des Typs, aber der unschaedlichste ───── */
console.log('\n25. Verkauf waehlt unter den Fahrzeugen eines Typs');
/* Namen sind hier die Probe: welches Fahrzeug faellt, nicht wie viele. */
const namen = l => l.map(v => v.caption).sort();
const gruende = r => r.bleiben.map(x => `${x.v.caption}: ${x.grund}`).sort();
const RTW = 28, WLF = 46, AB = 49;      // AB-Oel hat keine Sitze, ist also Anhaenger

{
  // B1: Status 6 heisst abgestellt auf der Wache, nicht unterwegs.
  // F1: und genau der geht zuerst, weil er gerade niemandem fehlt.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A' }), b2 = fz(RTW, { caption: 'RTW B', fms_real: 6 }),
        c = fz(RTW, { caption: 'RTW C' });
  const b = wache([a, b2, c]);
  const r = verkaufsKandidaten(b, RTW, 1);
  pruefe('abgestellter RTW faellt, nicht der erste der Liste', namen(r.fallen), ['RTW B']);
  pruefe('die einsatzbereiten bleiben ungenannt', r.bleiben.length, 0);
}
{
  // Ohne Abgestellten bleibt die Reihenfolge der API — kein Wuerfeln.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A' }), b2 = fz(RTW, { caption: 'RTW B' });
  const b = wache([a, b2]);
  pruefe('gleicher Rang: erster der Liste', namen(verkaufsKandidaten(b, RTW, 1).fallen), ['RTW A']);
}
{
  // Zwei zu viel: beide faellige werden benannt, nicht nur einer.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A' }), b2 = fz(RTW, { caption: 'RTW B', fms_real: 6 }),
        c = fz(RTW, { caption: 'RTW C' });
  const b = wache([a, b2, c]);
  pruefe('Ueberzahl 2 nimmt zwei', namen(verkaufsKandidaten(b, RTW, 2).fallen), ['RTW A', 'RTW B']);
}
{
  // B2: der Grund gehoert an das Fahrzeug. Vorher hiess jeder Ausfall
  // pauschal „nicht auf der Wache" — auch bei grün und bei unterwegs.
  S.opts = {};
  const a = fz(RTW, { caption: '🟢 RTW A' }), b2 = fz(RTW, { caption: 'RTW B', fms_real: 3 });
  const b = wache([a, b2]);
  const r = verkaufsKandidaten(b, RTW, 1);
  pruefe('gruen und unterwegs: nichts faellt', r.fallen, []);
  pruefe('jeder mit eigenem Grund',
         gruende(r), ['RTW B: unterwegs (Status 3)', '🟢 RTW A: grün markiert']);
  pruefe('nur der gruene zaehlt als geschuetzt', r.bleiben.filter(x => x.gruen).length, 1);
}
{
  // Grün freigegeben: der gruene ist verkaeuflich, aber zuletzt.
  const a = fz(RTW, { caption: '🟢 RTW A' }), b2 = fz(RTW, { caption: 'RTW B' });
  const b = wache([a, b2]);
  S.opts = { gruenFrei: true };
  pruefe('mit Freigabe faellt trotzdem der ungruene', namen(verkaufsKandidaten(b, RTW, 1).fallen), ['RTW B']);
  pruefe('bei Freigabe und Ueberzahl 2 faellt auch der gruene',
         namen(verkaufsKandidaten(b, RTW, 2).fallen), ['RTW B', '🟢 RTW A']);
  S.opts = {};
}
{
  // Die ganze Wache gruen: nichts faellt, und der Grund nennt die Wache.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A' });
  const b = { ...wache([a]), caption: '🟢 Testwache' };
  const r = verkaufsKandidaten(b, RTW, 1);
  pruefe('gruene Wache schuetzt ihre Fahrzeuge', r.fallen, []);
  pruefe('und sagt das auch so', gruende(r), ['RTW A: Wache ist grün markiert']);
}
{
  // F2: ein Zugfahrzeug mit Anhaenger bleibt stehen — sonst haengt der
  // Anhaenger an nichts mehr. Der freie WLF geht.
  S.opts = {};
  const w1 = fz(WLF, { caption: 'WLF A' }), w2 = fz(WLF, { caption: 'WLF B' });
  const ab = fz(AB, { caption: 'AB-Oel', zugfahrzeug: w1.id });
  const b = wache([w1, w2, ab]);
  const r = verkaufsKandidaten(b, WLF, 1);
  pruefe('der freie WLF faellt, nicht der bespannte', namen(r.fallen), ['WLF B']);
  pruefe('und der bespannte sagt warum', gruende(r), ['WLF A: Anhänger hängt dran']);
}
{
  // Haengt an beiden ein Anhaenger, faellt keiner — lieber Ueberzahl als
  // eine Waise.
  S.opts = {};
  const w1 = fz(WLF, { caption: 'WLF A' }), w2 = fz(WLF, { caption: 'WLF B' });
  const b = wache([w1, w2, fz(AB, { caption: 'AB 1', zugfahrzeug: w1.id }),
                          fz(AB, { caption: 'AB 2', zugfahrzeug: w2.id })]);
  pruefe('beide bespannt: nichts faellt', verkaufsKandidaten(b, WLF, 1).fallen, []);
}
{
  // B4/B2: ein eben gekauftes Fahrzeug gibt es serverseitig noch nicht.
  // Vorher meldete es „Fahrzeuge nicht auf der Wache" — falsch und irre-
  // fuehrend, denn es steht ja da.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A (neu)', id: -1, platzhalter: true });
  const b = wache([a]);
  const r = verkaufsKandidaten(b, RTW, 1);
  pruefe('Platzhalter faellt nicht', r.fallen, []);
  pruefe('Platzhalter nennt den richtigen Grund',
         gruende(r), ['RTW A (neu): gerade gekauft, dem Server noch unbekannt']);
  pruefe('und gilt nicht als grün uebergangen', r.bleiben.filter(x => x.gruen).length, 0);
}
{
  // Ein anderer Typ auf derselben Wache bleibt unbeteiligt.
  S.opts = {};
  const r = fz(RTW, { caption: 'RTW A' }), w = fz(WLF, { caption: 'WLF A' });
  const b = wache([r, w]);
  pruefe('nur der ueberzaehlige Typ wird angefasst',
         namen(verkaufsKandidaten(b, RTW, 1).fallen), ['RTW A']);
  pruefe('fremder Typ steht nicht in den Gruenden', verkaufsKandidaten(b, RTW, 1).bleiben, []);
}
{
  // F3: Vorschau und Verkauf muessen dasselbe Fahrzeug nennen. Der Eintrag
  // kommt hier in der Form, die vehSurplus liefert: { id, n, name }.
  S.opts = {};
  const a = fz(RTW, { caption: 'RTW A' }), b2 = fz(RTW, { caption: 'RTW B', fms_real: 6 });
  const b = wache([a, b2]);
  const eintrag = { id: RTW, n: 1, name: 'RTW' };
  pruefe('Anzeige nennt das Fahrzeug, das auch faellt',
         verkaufsNamen(b, eintrag), 'RTW B');
  pruefe('Anzeige und Verkauf stimmen ueberein',
         verkaufsNamen(b, eintrag),
         verkaufsKandidaten(b, eintrag.id, eintrag.n).fallen.map(v => v.caption).join(', '));
  pruefe('Ueberzahl 2 nennt beide in der Rangfolge',
         verkaufsNamen(b, { id: RTW, n: 2, name: 'RTW' }), 'RTW B, RTW A');
}
{
  // Nichts verkaeuflich muss auch so heissen — und nicht leer bleiben.
  S.opts = {};
  const b = wache([fz(RTW, { caption: 'RTW A', fms_real: 3 })]);
  pruefe('nichts verkaeuflich gibt leeren Namen zurueck',
         verkaufsNamen(b, { id: RTW, n: 1, name: 'RTW' }), '');
}
{
  // Rang als Zahl, damit die Absicht nicht nur indirekt geprueft wird.
  pruefe('Rang: abgestellt vor einsatzbereit',
         verkaufsRang({ caption: 'X', fms_real: 6 }) < verkaufsRang({ caption: 'X', fms_real: 2 }), true);
  pruefe('Rang: ungruen vor gruen',
         verkaufsRang({ caption: 'X', fms_real: 2 }) < verkaufsRang({ caption: '🟢 X', fms_real: 6 }), true);
}

/* ── 26. Bestand gegen Soll: die Invarianten hinter B4 ──────────────── */
console.log('\n26. Bestand gegen Soll');
/* Die Sorge hinter B4 war: ein eben gekauftes Fahrzeug treibt die Überzahl
   hoch und meldet dann stumm „nicht zerstört". Nachgerechnet an
   buyVehicles kann das nicht sein — hier steht es geprüft statt begründet. */
const zahl = (l, id) => l.find(x => String(x.id) === String(id))?.n || 0;
{
  const soll = { [RTW]: 2, [WLF]: 1 };
  for (let da = 0; da <= 4; da++) {
    const g = bestandGegenSoll({ [RTW]: da }, soll);
    const fehltRTW = zahl(g.fehlt, RTW), zuvielRTW = zahl(g.zuviel, RTW);
    pruefe(`${da} von 2 RTW: nie fehlend UND ueberzaehlig`,
           fehltRTW > 0 && zuvielRTW > 0, false);
    pruefe(`${da} von 2 RTW: genau eine Richtung stimmt`,
           [fehltRTW, zuvielRTW], [Math.max(0, 2 - da), Math.max(0, da - 2)]);
    /* Kauf wie buyVehicles: genau das Fehlende, Stellplaetze frei.
       Die Invariante ist nicht „danach null" — eine Ueberzahl, die schon
       vorher bestand, bleibt zu Recht stehen. Sie ist: der Kauf macht sie
       nicht groesser. */
    pruefe(`${da} RTW: der Kauf vergroessert die Ueberzahl nicht`,
           zahl(bestandGegenSoll({ [RTW]: da + fehltRTW }, soll).zuviel, RTW), zuvielRTW);
  }
}
{
  // Ein Typ, den der Plan nicht kennt, ist vollstaendig ueberzaehlig.
  const g = bestandGegenSoll({ [WLF]: 3 }, { [RTW]: 1 });
  pruefe('ungeplanter Typ ist ganz ueberzaehlig', zahl(g.zuviel, WLF), 3);
  pruefe('und der geplante fehlt trotzdem', zahl(g.fehlt, RTW), 1);
}
{
  // Sitze: der Plan zaehlt, nicht der Bestand — sonst waechst der
  // Personalbedarf mit jedem gekauften Fahrzeug nachtraeglich.
  const leer = bestandGegenSoll({}, { [RTW]: 2 });
  const voll = bestandGegenSoll({ [RTW]: 2 }, { [RTW]: 2 });
  pruefe('Sitze haengen am Soll, nicht am Bestand', leer.sitze, voll.sitze);
  pruefe('Sitze: 2 RTW mal 2 Plaetze', leer.sitze, 4);
}
{
  // Kein Soll: alles ueberzaehlig, nichts fehlt, keine Sitze.
  const g = bestandGegenSoll({ [RTW]: 1 }, undefined);
  pruefe('ohne Soll ist alles ueberzaehlig', [zahl(g.zuviel, RTW), g.fehlt.length, g.sitze], [1, 0, 0]);
}

/* ── 27. Ein Zugfahrzeug traegt mehrere Anhaenger, zieht aber einen ── */
console.log('\n27. Mehrere Anhaenger an einem Zugfahrzeug');
/* Sashas Regel (03.09.): erlaubt ist die Kopplung an mehrere, nur nicht das
   gleichzeitige Ziehen. Vorher summierte `anforderung` die Anhaenger und
   hielt das Zugfahrzeug fuer unbesetzbar. */
{
  const WLF = 46, GG = 77, EL = 78, NEA = 180;   // AB-Gefahrgut/-Einsatzleitung/-NEA200: est 1
  pruefe('Vorbedingung: WLF hat 3 Sitze, min 1', [vehMeta(WLF).min, vehMeta(WLF).max], [1, 3]);
  pruefe('Vorbedingung: die drei AB fordern je 1 an der Einsatzstelle',
         [GG, EL, NEA].map(t => vehMeta(t).est || vehMeta(t).min || 0), [1, 1, 1]);

  const zug = fz(WLF, { caption: 'WLF' });
  wache([zug]);
  pruefe('WLF ohne Anhaenger: min 1', anforderung(zug).min, 1);

  const eins = fz(GG, { caption: 'AB 1', zugfahrzeug: zug.id });
  wache([zug, eins]);
  pruefe('ein Anhaenger est 1: min bleibt 1', anforderung(zug).min, 1);

  const zwei = fz(EL, { caption: 'AB 2', zugfahrzeug: zug.id });
  wache([zug, eins, zwei]);
  pruefe('zwei Anhaenger est 1: min bleibt 1, nicht 2',
         anforderung(zug).min, 1);
  pruefe('und beide werden auch gesehen', anhaengerAn(zug).length, 2);

  const drei = fz(NEA, { caption: 'AB 3', zugfahrzeug: zug.id });
  wache([zug, eins, zwei, drei]);
  pruefe('drei Anhaenger est 1: min bleibt 1, nicht 3 (waere Vollbesetzung)',
         anforderung(zug).min, 1);
  pruefe('drei Anhaenger werden gesehen', anhaengerAn(zug).length, 3);
}
{
  // Der groesste Anhaenger bestimmt weiter, und die Sitzzahl deckelt.
  const WLF = 46, DEKON = 54, GG = 77;
  const gross = vehMeta(DEKON).est || vehMeta(DEKON).min || 0;
  const zug = fz(WLF, { caption: 'WLF' });
  const a = fz(DEKON, { caption: 'AB gross', zugfahrzeug: zug.id });
  wache([zug, a]);
  const alleinGross = anforderung(zug).min;
  pruefe('grosser Anhaenger allein: gedeckelt auf die Sitzzahl',
         alleinGross, Math.max(1, Math.min(gross, 3)));

  const b2 = fz(GG, { caption: 'AB klein', zugfahrzeug: zug.id });
  wache([zug, a, b2]);
  pruefe('gross plus klein: der grosse bestimmt, nicht die Summe',
         anforderung(zug).min, alleinGross);
}
{
  // Lehrgaenge kommen von allen Anhaengern, nicht nur vom groessten —
  // welcher gezogen wird, steht vorher nicht fest.
  const WLF = 46;
  const zug = fz(WLF, { caption: 'WLF' });
  const kurseVon = t => new Set((vehMeta(t).kurse || []).map(k => k.k));
  const mitKurs = Object.keys(PB_TYPEN).filter(t => !vehMeta(t).max && kurseVon(t).size
    && (vehMeta(t).zug || []).includes(WLF));
  if (mitKurs.length >= 2) {
    const [t1, t2] = mitKurs;
    const a = fz(Number(t1), { caption: 'AB A', zugfahrzeug: zug.id });
    const b2 = fz(Number(t2), { caption: 'AB B', zugfahrzeug: zug.id });
    wache([zug, a, b2]);
    const gefordert = new Set([...anforderung(zug).alle, ...anforderung(zug).mind.keys()]);
    const erwartet = [...kurseVon(t1), ...kurseVon(t2)].filter(k => k !== 'wechsellader');
    pruefe('Kurse beider Anhaenger werden gefordert',
           erwartet.every(k => gefordert.has(k)), true);
  } else {
    pruefe('kein Paar kursfordernder AB am WLF — Probe entfaellt', true, true);
  }
}

console.log(fehler ? `\n${fehler} Fehler\n` : '\nalle Proben bestanden\n');
process.exit(fehler ? 1 : 0);
