/* Personal-Sollwert für alle Wachen setzen — einmaliges Konsolenskript.
   Auf einer beliebigen Seite von leitstellenspiel.de einfügen und ausführen.

   Der Wert steuert das automatische Werben (Premium). Gesetzt wird über
   dasselbe Formular, das die Wachenseite anzeigt:
       POST /buildings/<id>?personal_count_target_only=1
       _method=patch · building[personal_count_target]=<zahl>

   Erst mit TROCKEN = true laufen lassen und die Liste ansehen. Wenn sie paßt,
   auf false stellen und erneut ausführen.                                   */

(async () => {
  const ZIEL    = 400;
  const TROCKEN = false;          // ← auf false setzen, wenn es wirklich passieren soll
  const PAUSE   = 350;           // ms zwischen zwei Schreibvorgängen

  /* Gebäudearten ohne Personal übergehen: Schulen, Krankenhaus, Leitstelle.
     Dort gibt es das Feld nicht, der Aufruf ginge ins Leere. */
  const OHNE_PERSONAL = new Set([1, 3, 4, 7, 8]);

  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!token) return console.error('Kein CSRF-Token gefunden — bist du eingeloggt?');

  const alle = await (await fetch('/api/buildings')).json();
  const wachen = alle.filter(b => !OHNE_PERSONAL.has(b.building_type));
  console.log(`${alle.length} Gebäude, davon ${wachen.length} mit Personal.`);

  if (TROCKEN) {
    console.table(wachen.slice(0, 20).map(b => ({ id: b.id, Wache: b.caption, neu: ZIEL })));
    console.log(`Trockenlauf: nichts geändert. ${wachen.length} Wachen würden auf ${ZIEL} gesetzt.`);
    console.log('Zum Ausführen oben TROCKEN = false setzen.');
    return;
  }

  const schlaf = ms => new Promise(r => setTimeout(r, ms));
  let ok = 0, fehler = 0;

  for (const [i, b] of wachen.entries()) {
    const koerper = new URLSearchParams({
      _method: 'patch',
      authenticity_token: token,
      'building[personal_count_target]': String(ZIEL)
    });
    try {
      const r = await fetch(`/buildings/${b.id}?personal_count_target_only=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: koerper,
        credentials: 'same-origin'
      });
      if (r.ok) ok++; else { fehler++; console.warn(`${b.caption}: HTTP ${r.status}`); }
    } catch (e) {
      fehler++; console.warn(`${b.caption}: ${e.message}`);
    }
    if (i % 10 === 9) console.log(`${i + 1}/${wachen.length} …`);
    await schlaf(PAUSE);
  }

  console.log(`Fertig: ${ok} gesetzt, ${fehler} fehlgeschlagen.`);
})();
