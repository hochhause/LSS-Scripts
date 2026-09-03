# Nächster Schritt

Stand v0.56.0. Was hier steht, ist offen — alles darüber ist erledigt und in
`DECISIONS.md` begründet.

## Im Spiel anzusehen: der Reiter heißt jetzt „Zerstören"

Der Endpunkt ist nachgemessen und war richtig (D-84, `SPIELSEITEN.md`). Falsch
war das Wort: das Spiel kennt keinen Verkauf, nur den Papierkorb mit der
Rückfrage „Wirklich das Fahrzeug zerstören?". Reiter, Knopf, Protokoll und
Rückfrage sagen das seit v0.56.0.

Anzusehen bleibt, wie es im Fenster aussieht — die Oberfläche ist nicht
abgedeckt. Mit „Nur Vorschau" an: Reitername, Knopftext, die Zeile
„ZERSTÖRE …" und die Überzählig-Zeile, die jetzt das Fahrzeug nennt
(`2× RTW → RTW B, RTW A`).

**Offen und nur durch eine echte Tat zu klären:** ob beim Zerstören Credits
zurückfließen. Die Rückfrage des Spiels nennt keinen Betrag. Wer das einmal an
einem Fahrzeug prüft, das ohnehin weg soll, schreibt es in D-84 nach.

## Ungeprüft im laufenden Spiel

Der Rechenkern ist mit `test-planung.js` abgedeckt, die Oberfläche nicht. Diese
Dinge sind gebaut, aber noch nie im Spiel gesehen worden:

- **Eigenes Fenster** (⇱ im Kopf). Popup-Blocker beim ersten Mal, und ob die
  Themenfarben drüben stimmen.
- **Hinweis auf der Wachenseite** (versuchsweise, im Übersichtsreiter
  einzuschalten). Der Kasten wird an `#building_panel`, `.col-md-12`, `#content`
  oder `.content` gehängt — geraten, weil kein HTML vorlag. Landet er falsch,
  genügt ein Stück der Wachenseite.
- **Ausbaukatalog lesen** über alle Gebäudearten.
- **Zwei Leisten statt elf Reitern**: ob die sechs Gruppenknöpfe bei 520 px in
  eine Zeile passen.

## Offene Arbeit

- **Profile inhaltlich durchgehen.** Feuerwache, Rettungswache, Polizeiwache und
  THW sind aus dem Soll-Papier übernommen, aber nicht Stück für Stück besprochen.
  Bei der SEG hat das eine Runde gebracht (D-44): der SEG-NEA50 war die teurere
  Fassung eines Anhängers, den die Feuerwehr ohne Lehrgang fährt.
- **Stellplätze der Gebäude ohne eigenen Bestand.** Für Rettungshundestaffel,
  Bergrettung, Seenotrettung und Autobahnpolizei nennt das Papier die
  Stellplatzzahl auf **Stufe 0**, die Fahrzeuge aber auf Vollausbau. Die
  Formeln in `LAYOUTS_STANDARD` stammen von dort und sind für diese vier
  ungeprüft.
- **Hubschrauberstationen** (Typ 5 und 13) fehlen im Soll-Papier. Ihre Profile
  stammen noch aus dem alten Auto-Export.
- **Grüner Punkt und Ausbildung, der gemischte Fall.** „Bedarf anhaken"
  übergeht eine Wache, die überall den Punkt trägt. Bei gemischten Wachen ist
  von der Lehrgangsseite aus nicht zu sehen, wer auf einem grünen Fahrzeug
  sitzt — die Ankreuzfelder nennen nur die Wache. Dafür müßte die
  Zuweisungsseite je Person das Fahrzeug festhalten (D-71).
- **Werben mit eigenem Sollwert.** `personal-soll.js` setzt pauschal 400. Der
  Planer kennt je Wache den genauen Bedarf (`staffSoll`) — er schreibt ihn nur
  nicht. Gehört in den Werben-Reiter.

## Entschiedene Regeln (gelten weiter)

- Fahrzeug-Haken ab **Mindestbesetzung**, nicht ab Vollbesetzung — und ab
  v0.51.0 gegen **beide** Anforderungskanäle geprüft (`alle` und `mind`).
- **Der Punkt der Wache ist die Summe der Fahrzeugpunkte** (D-76). Ausbauten,
  Käufe und Ausbildungen entscheiden nicht mehr darüber.
- „In Ausbildung" zählt wie fertig — **außer** beim FMS: solche Fahrzeuge
  bekommen den Haken, bleiben aber auf Status 6.
- Erweiterung aus, sobald **ein** zugehöriges Fahrzeug lahmt.
- Über `min` hinaus wird aufgefüllt, aber nur mit Leuten, deren Lehrgang an
  dieser Wache nirgends gebraucht wird.
- Anhänger koppeln **vor** der Personalzuweisung.
- 🟢 setzt der Planer, 🔴 schreibt der Mensch und schließt die Wache aus.
- Keine zufälligen Verzögerungen zur Verschleierung. Fester Mindestabstand
  (150 ms lesen, 350 ms schreiben) und Sichtbarkeitssperre genügen.
