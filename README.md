# LSS-Scripts

Userscripts und Einmalwerkzeuge für [leitstellenspiel.de](https://www.leitstellenspiel.de).
Alles auf Deutsch, weil das Spiel es ist.

> **Achtung:** Der Planer verändert ein echtes Spielkonto. Er kauft Fahrzeuge,
> koppelt Anhänger, löst Personal ab und benennt Wachen um. Erst mit
> **„Nur Vorschau"** laufen lassen, die Liste lesen, dann handeln.

## Installieren

Voraussetzung ist [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge,
Firefox). Auf den Namen klicken, Tampermonkey fragt nach der Installation.

| Skript | Fassung | Was es tut |
|---|---|---|
| [**LSS Planer**](https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-planer.user.js) | 0.49.0 | Vergleicht das hinterlegte Wunschbild mit dem Spielstand und setzt die Unterschiede um: Ausbauten, Fahrzeuge, Anhänger, Personal, Lehrgänge, Wachennamen. |
| [**LSS Farben**](https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/lss-farben.user.js) | 0.1.0 | Färbt fertige Wachen und Fahrzeuge grün, Status 6 rot, und nimmt den Markierungspunkt aus der Anzeige. |

## Einmalskripte

`konsole/` enthält, was man einmal braucht und dann nicht mehr. Auf einer Seite
von leitstellenspiel.de die Konsole öffnen (F12), einfügen, ausführen.

- **`personal-soll.js`** — setzt den Personal-Sollwert aller Wachen auf einen
  festen Wert (steuert das automatische Werben, Premium). Läuft zuerst mit
  `TROCKEN = true` und zeigt nur, was es täte.

## Ablage

```
userscripts/   was im Browser läuft
konsole/       Einmalskripte für die Konsole
werkzeuge/     Prüfungen, laufen in node
daten/         Auszüge der eingebauten Tabellen
Notizen/       Stand, Entscheidungen, offene Arbeit
```

Die Tabellen in `daten/` sind **Auszüge** zum Nachschlagen — Fahrzeugtypen,
Personalbedarf, Lehrgangsnamen, Stellplatzformeln, Wunschbild je Gebäudeart.
Gültig ist, was im Userscript steht.

## Mitarbeiten

Vor jeder Auslieferung müssen alle drei sauber durchlaufen:

```sh
node --check userscripts/lss-planer.user.js   # Syntax
node werkzeuge/pruefer.js                     # fehlende Argumente, Reste, stille Fallen
node werkzeuge/test-planung.js                # Rechenkern, 98 Proben
```

`werkzeuge/pruefer.js` sucht die Fehler, die beim Lesen durchrutschen, weil sie
nichts umwerfen. `werkzeuge/test-planung.js` schneidet den Rechenkern aus dem
Userscript heraus und prüft ihn in node — es gibt absichtlich keine zweite
Fassung derselben Logik.

`main` ist ausgeliefert: jeder Push wird jeder Installation als Aktualisierung
angeboten. Ungeprüftes gehört auf einen Zweig.

Die Arbeitsanweisung steht in [CLAUDE.md](CLAUDE.md), der Stand in
[Notizen/PROJECT_CONTEXT.md](Notizen/PROJECT_CONTEXT.md), die Begründungen in
[Notizen/DECISIONS.md](Notizen/DECISIONS.md), das Offene in
[Notizen/NAECHSTER_SCHRITT.md](Notizen/NAECHSTER_SCHRITT.md).

## Lizenz

[GPL-3.0](LICENSE). Kein Zusammenhang mit den Machern von leitstellenspiel.de.
