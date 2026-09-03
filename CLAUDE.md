# CLAUDE.md

Arbeitsanweisung für dieses Verzeichnis. Wer hier etwas ändert — Mensch oder
Modell —, hält sich daran.

## Worum es geht

Userscripts für [leitstellenspiel.de](https://www.leitstellenspiel.de). Kern ist
`lss-planer.user.js`: es vergleicht ein hinterlegtes Wunschbild („so soll jede
Wache aussehen") mit dem Spielstand und setzt die Unterschiede um — Fahrzeuge
kaufen, Anhänger koppeln, Personal zuweisen, Lehrgänge belegen, Wachen
benennen.

Das Skript **verändert ein echtes Spielkonto**. Es kauft und verkauft Fahrzeuge,
löst Personal von Fahrzeugen und benennt Wachen um. Ein Fehler kostet Credits
und Arbeit. Danach richtet sich alles Weitere.

## Sprache

Deutsch, Du-Form, auch in Kommentaren und Meldungen. Kommentare erklären
**warum**, nicht was — das Was steht im Code. Ein Kommentar, der nur die Zeile
darunter wiederholt, wird gestrichen.

## Vor jeder Auslieferung

```
node --check userscripts/lss-planer.user.js   # Syntax
node --check userscripts/lss-farben.user.js   # Syntax
node werkzeuge/pruefer.js                     # fehlende Argumente, Reste, stille Fallen
node werkzeuge/test-planung.js                # Rechenkern, 248 Proben
```

Beide Werkzeuge finden den Planer selbst; ein Pfad als Argument prüft eine
andere Fassung. Aufruf von überall aus, die Pfade hängen am Ort der Werkzeuge.

Alle drei müssen sauber durchlaufen. Reine Syntaxprüfung genügt nicht — sie hat
`gespart`, `heimwarnung` und `bereich` allesamt durchgelassen.

`pruefer.js` sucht die Fehlerarten, die beim Lesen durchrutschen, weil sie
nichts umwerfen: Aufrufe mit zu wenigen Argumenten, doppelte oder tote
Funktionen, Speicherschlüssel ohne Leser, globale Ausdrücke mit `.test()`, leere
`catch`-Blöcke, `@version` gegen `const VERSION`.

`test-planung.js` schneidet den Rechenkern aus dem Userscript heraus und prüft
ihn in node — **keine zweite Fassung derselben Logik**. Wer den Kern ändert,
ändert die Proben mit.

Die Oberfläche selbst ist nicht abgedeckt. Was dort geändert wird, gehört im
Spiel angesehen, mit „Nur Vorschau" an.

## Ablage

```
userscripts/   was im Browser läuft (Tampermonkey)
konsole/       Einmalskripte, per Hand in die Konsole
werkzeuge/     Prüfungen, laufen in node — nie im Browser
daten/         Auszüge der eingebauten Tabellen, zum Nachschlagen
Notizen/       Stand, Entscheidungen, offene Arbeit
```

Die Tabellen in `daten/` sind **Auszüge**. Gültig ist, was im Userscript steht —
wer dort etwas ändert, zieht den Auszug nach oder streicht ihn.

## Beim Ändern

- **Version hochziehen**, in `@version` **und** `const VERSION`. Sie steht im
  Fensterkopf, daran erkennt man draußen den Stand.
- **`main` ist ausgeliefert.** `@updateURL` zeigt auf den Rohtext von `main`;
  jeder Push dorthin wird jeder Installation als Aktualisierung angeboten.
  Ungeprüftes gehört auf einen Zweig, nicht nach `main`.
- **`DECISIONS.md` fortschreiben.** Jede Entscheidung, die sich später wie ein
  Fehler anfühlen könnte, bekommt einen Eintrag mit Begründung. Dort steht auch,
  was **verworfen** wurde und warum — das ist der wertvollere Teil.
- **`PROJECT_CONTEXT.md`** hält den Stand: Dateien, Endpunkte, Spielregeln.
- Nichts raten. Endpunkte, Feldnamen und Spielregeln werden aus dem Spiel
  gelesen oder erfragt. Lieber eine Lücke melden als eine Vermutung einsetzen.
- Meldungen sagen den **Grund**, nicht nur das Ergebnis. „Nichts passiert" und
  „nichts zu tun" müssen unterscheidbar sein — mehrere Fehler sind allein daran
  aufgefallen, daß sie es nicht waren.

## Gefahren, die schon einmal zugebissen haben

- **Vorgemerkte Fahrzeuge** (negative Nummer nach einem Kauf) dürfen in keine
  Anfrage. `echteVon(b)` statt `mineOf(b)`, wo etwas abgeschickt wird.
- **Zwei Quellen für dieselbe Zahl** laufen auseinander. Der Ausbildungsstand
  kommt aus `/vehicles/<id>/zuweisung`, nicht aus der Schulauswahl — die ist
  unvollständig.
- **Lehrgänge über Schlüssel**, nie über Klartext. Ein Schlüssel trägt mehrere
  Namen, ein Name mehrere Schlüssel: `police_helicopter_lift`,
  `rescue_helicopter_lift` **und** `coastal_helicopter_lift` heißen alle drei
  „Windenoperator". Und der Kursname der Schule ist nicht der Name in der
  Personalliste — `emergency_paramedic_water_rescue` heißt dort
  „Notfallsanitäter mit Wasserrettungsausbildung", in der Schule aber
  „Wasserrettungsausbildung für Notfallsanitäter".
- **Seiten nachmessen, nicht raten.** Was das Spiel liefert, steht in
  `Notizen/SPIELSEITEN.md` — aufgenommen mit einem angemeldeten Browser. Drei
  Adressen waren jahrelang falsch, ohne daß es auffiel, weil der Code
  schlüssig aussah. Wer einen Endpunkt oder Selektor ändert, mißt ihn nach und
  schreibt die Notiz fort.
- **Wahlfreie Parameter ausschreiben** (`function frage(text, merk = '')`).
  Sonst sieht ein Aufruf mit einem Argument aus wie ein vergessenes zweites.

## Was eingebaut ist und was aus dem Spiel kommt

| eingebaut im Skript | aus dem Spiel gelesen |
|---|---|
| `PB` — 186 Fahrzeugtypen, Sitze, Lehrgänge, Anhängerkopplung | Bestand (`/api/buildings`, `/api/v2/vehicles`) |
| `MODELL_STANDARD` — Wunschbild je Gebäudeart | Ausbildungsstand, laufende Lehrgänge |
| `LAYOUTS_STANDARD` — Stellplätze als Formel | Ausbaukatalog (Bauplatz-Nummern) |
| `KURSE_FEST` — 60 Lehrgangsnamen | Kursangebot je Schulart |
| `GEBAEUDE_NAMEN` | |

Der frühere Plan-Import aus dem Artefakt ist seit v0.52.0 **entfernt** (D-78).
Alles, was er lieferte, steht eingebaut im Skript oder wird aus dem Spiel
gelesen. Ein neuer Fahrzeugtyp gehört nach `PB`, nicht in einen Plan.

## Nicht in dieser Ablage

`lss-soll-ist.html` (das Artefakt), `lss-einruecken.user.js`,
`lss-einsatz-flott.user.js`, `lss-katalog.json`, `domtest.js`. Sie gehören zum
Projekt, sind hier aber nie angekommen. Wer sie hat, legt sie an die passende
Stelle oben und schreibt README und `Notizen/PROJECT_CONTEXT.md` fort.
