# Leitstellenspiel-Werkzeuge — Projektstand

Stand: 26.08.2026, Skript v0.49.0. Diese Datei und `CLAUDE.md` genügen, um an
einem beliebigen Punkt weiterzuarbeiten. Uploads von Stammdaten, Spielbestand
oder Seitenabzügen braucht es nicht mehr — alles Nötige steckt in den Dateien
unten oder wird aus dem Spiel gelesen.

## Dateien

| Datei | Zweck |
|---|---|
| `lss-planer.user.js` | Userscript v0.49.0: setzt das Wunschbild im Spiel um |
| `lss-farben.user.js` | v0.1.0: reine Anzeige — blendet den 🟢 aus und färbt den Namen grün, Status 6 rot |
| `lss-einruecken.user.js` | v0.2.0: Fahrzeuge zurück zur Wache rufen — *nicht in dieser Ablage* |
| `lss-einsatz-flott.user.js` | v0.3.0: nächsten Einsatz vorwärmen — *nicht in dieser Ablage* |
| `CLAUDE.md` | Arbeitsanweisung: Sprache, Prüfungen, Gefahren |
| `NAECHSTER_SCHRITT.md` | was offen ist |
| `DECISIONS.md` | 59 Entscheidungen mit Begründung, auch die verworfenen |
| `personal-soll.js` | einmaliges Konsolenskript: Personal-Sollwert aller Wachen |
| `lss-personalbedarf.json` | Personalanforderungen je Fahrzeugtyp — **Pflegequelle** für `PB` |
| `lss-fahrzeugprofile.md` | Soll-Papier: Profile, Stellplatz-Formeln, Ausbauten je Gebäudeart — **Pflegequelle** für `MODELL_STANDARD` und `LAYOUTS_STANDARD` |
| `lss-modell-standard.json` | dasselbe maschinenlesbar, so wie es im Skript steht |
| `lss-layouts-standard.json` | Stellplatz-Formeln maschinenlesbar |
| `lss-kursnamen.json` | 56 Lehrgangsnamen, Pflegequelle für `KURSE_FEST` |
| `test-planung.js` | Prüft den Rechenkern der Personalplanung in node, ohne Browser |
| `pruefer.js` | Statische Durchsicht: fehlende Argumente, tote Funktionen, stille Fallen |

## Spielstand des Nutzers

102 Gebäude, 1.395 Fahrzeuge. 23 Feuerwachen (Stufe 19), 25 Rettungswachen (14),
24 Polizeiwachen (14), 10 Wasserrettung (5), dazu THW, BePol, SEG, Bergrettung,
Seenotrettung, Autobahnpolizei. Drei eigene Schulen: Feuerwehr, Polizei,
Rettungsdienst — **keine** THW-Bundesschule, die kommt aus dem Verband.
Wachennamen tragen teils eine Fertig-Markierung (47 von 102). Zwei Zeichen:
🟢 setzt der Planer selbst (fertig), 🔴 schreibt der Mensch (Wache komplett
ausgeschlossen, `ausgeschlossen()` / `planWachen()`). Seit v0.26 ist das ein 🟢 **vor** dem Namen; alte `✔️` am Ende werden weiter erkannt und beim nächsten Lauf ersetzt.

Offen laut Plan: rund 1.133 Fahrzeuge und 58,7 Mio. Credits an Ausbauten.
Zwei Drittel der Käufe hängen an fehlenden Stellplatz-Ausbauten.

## Arbeitsweise

- Deutsch, Du-Form. Kommentare im Code auf Deutsch, sie erklären **warum**.
- Vor jeder Änderung: `pruefer.js` (fehlende Argumente, Reste), `test-planung.js`
  (Rechenkern) und `domtest.js` (jeden Reiter mit echten Daten zeichnen). Reine
  Syntaxprüfung reicht nicht — sie hat `gespart`, `heimwarnung` und `bereich`
  allesamt durchgelassen.
- Version in `@version` **und** `const VERSION` hochziehen, sie steht im Fensterkopf.
- Nichts raten: Endpunkte und Feldnamen aus dem Spiel-HTML lesen lassen.
- Dateiuploads des Nutzers kommen oft leer an; eingefügter Text funktioniert.

## Personalzuweisung in zwei Durchgängen (seit v0.20)

`planeWache()` verteilt erst die **Mindestbesetzung** über alle Fahrzeuge der
Wache — knappste Anforderung zuerst, Ungelernte zuerst — und füllt danach freie
Sitze mit den Übriggebliebenen auf. Wer einen Lehrgang hat, den diese Wache
irgendwo verlangt, bleibt beim Auffüllen frei; sonst besetzt der einzige Notarzt
das LF und das NEF steht. Abschaltbar im Personal-Reiter
(`S.opts.vollBesetzen`).

## Lehrgänge sind Schlüssel (seit v0.22)

Die ganze Bedarfsrechnung läuft auf internen Schlüsseln: `courseNeed()`,
`bedarfKeys()`, `bedarfDerWache()`, `needFor()`, `fortschritt()`, `courseTable()`.
Klartext ist nur noch Beschriftung (`kursNamen(key)[0]`); fehlt er, steht in der
Oberfläche der Schlüssel und gerechnet wird trotzdem richtig.

`matchKey()` und `courseNames()` sind ersatzlos entfallen — damit auch die
Mehrdeutigkeit „ein Schlüssel, mehrere Namen". Von den 60 Kursen im Katalog haben
nur 21 einen fest hinterlegten Namen; die übrigen kamen früher erst aus den
Schulen, und bis dahin fiel ihr Bedarf auf null.

Preis: Fahrzeugtypen, die `PB` nicht kennt (`geraten: true`), fordern **keine**
Ausbildung. Der Plan führt Lehrgänge nur als Klartext, und genau dessen
Rückübersetzung war die Fehlerquelle. Neue Typen gehören deshalb nach `PB`.

## Wunschbild im Skript (seit v0.32)

Der importierte Plan trägt zweierlei: **Spieldaten** (Stellplatz-Töpfe,
Ausbaukatalog, Namen — für jeden gleich) und das **Wunschbild** (welche Wache wie
aussehen soll — eine Meinung). Nur das zweite gehört bearbeitet, und es steht
jetzt getrennt vom Plan:

```
MODELL_STANDARD      eingebacken, 15 Gebäudetypen, 18 Profile, 386 Fahrzeuge
                     „standard“ überall, dazu „standard-groß“ bei Feuer-,
                     Rettungs- und Polizeiwache. Mit Stellplatz-Töpfen je Fahrzeug.
S.modell             lssplaner.modell  — bearbeitbar, überlebt jeden Neuimport
S.zuordnung          lssplaner.zuordnung — Wache → Profil, kontogebunden
```

Der Reiter **Plan** bearbeitet das: Profil je Gebäudetyp anlegen, kopieren,
umbenennen, löschen; Fahrzeuge und Ausbauten je Profil mit +/−; gewählte Wachen
einem Profil zuordnen; Wunschbild kopieren, einfügen, auf Standard zurücksetzen.

Ein importierter Plan **fragt**, bevor er das Wunschbild ersetzt. Die Zuordnung
aus einem fremden Plan ist wertlos — sie hängt an Gebäudenummern.

Eingebacken sind außerdem `LAYOUTS_STANDARD` (Stellplätze je Gebäudeart, als
Formel aus Stufe und Ausbauten) und `GEBAEUDE_NAMEN`. Der Ausbaukatalog (Bauplatz-Nummer → Name) wird aus dem Spiel gelernt:
gebaute Plätze kostenlos beim Bestandsladen aus `/api/buildings`, leere über
den Knopf im Plan-Reiter aus `/buildings/<id>/leitstelle-extensions`. **Der
Plan des Artefakts wird damit nicht mehr gebraucht.**

## Besetzung über Spalten (seit v0.25)

Die Leute einer Wache liegen in Spalten, eine je vorkommender Kombination von
Lehrgängen — und zwar nur aus denen, die *diese* Wache irgendwo verlangt. Ein
Notarzt an einer Feuerwache steht in derselben Spalte wie ein Ungelernter.

Innerhalb einer Spalte sind alle gleichwertig, also entscheidet allein der Preis
der Zuweisung: wer schon auf dem Fahrzeug sitzt (0 Anfragen), wer nirgends sitzt
(1), wer woanders sitzt (2). Damit entsteht der Namenswechsel gar nicht erst —
das frühere `angleichen()` und die `wert`-Sortierung sind entfallen.

Spaltenwahl je Auflage: knappste Auflage zuerst, dann die Spalte mit den
wenigsten anderswo gebrauchten Lehrgängen, Fertige vor Lernenden, bei Gleichstand
die Spalte, die mehr offene Auflagen auf einmal deckt. Eine Person deckt **alle**
Auflagen, die ihre Spalte trägt — genau davon lebt die Doppelausbildung: ein
Sitz, zwei erfüllte Zeilen. Führt eine Wahl in die Sackgasse, wird sie
zurückgenommen (`suche()`, gedeckelt bei 500 Knoten).

## Eine Person, ein Lehrgang (seit v0.21)

Wer zwei Lehrgänge hat, sitzt trotzdem nur in einem Fahrzeug. `zaehleAus()`
verteilt deshalb jede Person auf **einen** Kurs — den mit der größeren Lücke an
dieser Wache — statt sie in beiden Spalten mitzuzählen. Nur wo ein Fahrzeug zwei
Lehrgänge auf demselben Sitz verlangt (`doppelKombis()`), zählt ein Kopf für
beide Auflagen.

Solche Kombinationen entstehen auf zwei Wegen: ein Typ fordert sie von sich aus
(ELW2 Drohne: `elw2` **und** `fire_drone` für jeden Sitz), oder ein Zugfahrzeug
mit eigenem Lehrgang vererbt ihn an die Plätze, die sein Anhänger belegt
(WLF + AB-MZB: vier Sitze brauchen `wechsellader` und `gw_wasserrettung`).

`quals.by[<wache>][<kurs>]` ist damit die **verteilte** Zahl. Die rohe Zahl des
Spiels landet unter `._roh` und überschreibt sie nicht mehr.

## Stammdaten im Skript (`PB`, seit v0.19)

Sitzplätze und Lehrgänge kommen **nicht mehr** aus dem importierten Plan, sondern
aus der eingebetteten Tabelle `PB` — 186 Fahrzeugtypen, Format wie
`lss-personalbedarf.json`:

```
c     Kurzname
min   Personen zum Ausrücken     max  Sitze (0 = Anhänger)
kurse [{k: Schlüssel, art: 'alle'|'min', n: Anzahl}]
      'alle' → jede zugewiesene Person braucht den Kurs
      'min'  → n der Besatzung brauchen ihn; n = 0 heißt, die Zahl steht in est
est   Personal an der Einsatzstelle; beim Anhänger die Zahl, die auf dem
      Zugfahrzeug mitfahren muss
zug   Fahrzeugtypen, die diesen Anhänger ziehen dürfen
```

`vehMeta(id)` führt `PB` und Plan zusammen: `PB` gewinnt, der Plan liefert nur den
Anzeigenamen. Kennt `PB` einen Typ nicht, greift der Plan allein — der Eintrag
trägt dann `geraten: true`. Neue Fahrzeugtypen also in `lss-personalbedarf.json`
nachtragen und den `PB`-Block im Skript ersetzen.

Klartextnamen der Lehrgänge werden aus den Schlüsseln abgeleitet
(`kursNamen(key)`), nie umgekehrt. Der frühere Rückweg — aus dem Klartext den
Schlüssel raten — ist ersatzlos entfallen.

## Bekannte Endpunkte

```
GET  /api/buildings, /api/v2/vehicles?limit=1000, /api/alliance_buildings
GET  /buildings/<id>/schooling_personal_select      wählbares Personal für einen Kurs
                                                    — **unvollständig**, nur für die Kurswahl
GET  /vehicles/<id>/zuweisung                       vollständiger Personalstand einer Wache:
                                                    alle Personen, Lehrgänge, laufende Kurse
GET  /buildings/<id>/leitstelle-extensions          alle Ausbauten; die Bauplatz-Nummer
                                                    steht im href: /extension/credits/<nr>
                                                    bzw. /extension_ready/<nr>/
POST /buildings/<id>/extension/credits/<typeId>     bauen
POST /buildings/<id>/extension_ready/<typeId>/<ls>  Ausbau ein/aus
GET  /buildings/<id>/active                         Wache ein/aus (UMSCHALTER, kein Setzer)
GET  /buildings/<leitstelle>/leitstelle-extensions  Ausbaukatalog ALLER eigenen Gebäude
                                                    (auf einer Wache: HTTP 500)
GET  /buildings/<id>/vehicles/new                   Kaufliste (NICHT auf /buildings/<id>)
GET  /buildings/<id>/hire_do/3                      werben
GET  /vehicles/<id>/zuweisung                       Personalliste der Wache
POST /vehicles/<vid>/zuweisungDo/<pid>              zuweisen/lösen (Umschalter)
GET  /vehicles/<id>/set_fms/<n>                     FMS setzen (nur aus 2 heraus)
GET  /vehicles/<id>/edit                            Zugfahrzeug-Auswahl des Anhängers
PATCH/vehicles/<id>                                 umbenennen, Anhänger koppeln
POST /vehicles/<id>  _method=delete                 Fahrzeug ZERSTÖREN (nicht verkaufen —
                                                    das kennt das Spiel nicht), gemessen D-84
GET  /buildings/<id>/edit                           Wache umbenennen: Feld `building[name]`
POST /schoolings/<id>/education                     personal_ids[] + commit
GET  /schoolings                                    Übersicht, data-education-key je Zeile
```

## Regeln des Spiels, die zählen

- `staff.min` = Personen zum Ausrücken, `staff.max` = Sitze.
- `training: {kurs: {all:true}}` — **jede zugewiesene** Person braucht den Kurs.
- `training: {kurs: {min:N}}` — N der Besatzung brauchen ihn.
- Ein interner Schlüssel kann mehrere Klartextnamen haben (THW nennt
  `gw_taucher` „Fachgruppe Bergungstaucher", die Feuerwehr „GW-Taucher Lehrgang").
- Anhänger haben `max 0`; ihre Ausbildung muss auf dem **Zugfahrzeug** sitzen,
  Zahl steht in `trainingAtScene` (`est`). Sie hebt dort auch die
  Mindestbesetzung — aber nicht zusätzlich: die vier Plätze der MZB *sind* die
  Besatzung, einer davon fährt.
- Ein Zugfahrzeug **darf an mehreren Anhängern hängen**; ziehen kann es nur
  einen davon. Der Bedarf eines Gespanns ist deshalb der **größte** Anhänger,
  nicht die Summe — die Lehrgänge fordern trotzdem alle, weil vorher nicht
  feststeht, welcher gezogen wird. Bestehende Kopplungen werden nie gelöst
  (D-85). Im gemessenen Bestand trugen 10 von 72 Zugfahrzeugen mehrere.
- **Personal** läßt sich unabhängig vom FMS zuweisen, auch bei einem Fahrzeug
  im Einsatz. Nur die Statusumschaltung braucht Status 2
  (`GET /vehicles/<id>/set_fms/<n>`) und wird sonst vorgemerkt (D-85).
- Auf der Zuweisungsseite steht je Person der laufende Kurs als
  `<span data-education-key="…">Im Unterricht: …</span>`; das Filter-Dropdown
  derselben Seite liefert nebenbei Schlüssel → Klartext.
- Lehrgang fasst 10 Personen je Klassenraum.
