# Entscheidungen

## D-01 Stammdaten im Skript statt aus dem Plan (v0.19.0)

**Lage.** `T.veh()` las Sitze und Lehrgänge aus dem importierten Soll-Plan. Der
Plan führt Lehrgänge als Klartext, die Personalplanung braucht interne Schlüssel.
Die Rückübersetzung war Zeichenkettenvergleich mit `includes()`.

**Entschieden.** `lss-personalbedarf.json` liegt als `PB` fest im Skript.
`vehMeta()` führt zusammen: `PB` gewinnt, der Plan liefert den Anzeigenamen und
springt für unbekannte Typen ein (`geraten: true`).

**Verworfen.** Zur Laufzeit aus dem Spiel ableiten — es gibt keinen Endpunkt, der
Personalanforderungen je Fahrzeugtyp herausgibt; alles andere wäre Raten aus
Einsatzseiten gewesen.

**Preis.** Neue Fahrzeugtypen des Spiels müssen von Hand nachgetragen werden.
Sichtbar an `geraten: true`, deshalb tragbar.

## D-02 Klartext wird abgeleitet, nicht erraten (v0.19.0)

Schlüssel → Namen ist eine gepflegte Liste (`KURSE_FEST` plus das, was die Schulen
liefern), der Rückweg war nie eindeutig: ein Schlüssel trägt mehrere Namen, und
`gw_taucher` heißt beim THW anders als bei der Feuerwehr. `meta.schooling` ist
jetzt ein Getter über `kursNamen(k)`. Nebenbei lernt `readRoster()` die Zuordnung
aus dem Filter-Dropdown der Zuweisungsseite mit — auch für Kurse ohne eigene
Schule.

## D-03 Anhänger heben die Mindestbesetzung des Zugfahrzeugs (v0.19.0, korrigiert v0.27.0)

`est` eines Anhängers zählt zur Mindestbesetzung des Zugfahrzeugs, nicht nur zur
Kursanforderung. `mindestBedarf()` ist deshalb nur noch `anforderung(v).min` —
eine Quelle statt zweier. Passt es nicht auf die Sitze (LKW 7 Lkr 19 tm mit
Anh MzB), gilt das Gespann als nicht besetzbar und wird gemeldet.

**Korrektur v0.27.0:** gerechnet wurde `min + est`, richtig ist `max(min, est)`.
**Korrektur v0.29.0:** zusätzlich auf `max` gedeckelt, siehe D-25.
Die vier Leute für das Boot *sind* die Besatzung, nicht zusätzlich zu ihr — einer
davon fährt. Die GW-Wasserrettung mit MZB braucht also 4 Plätze, nicht 5. Welche
Lehrgänge diese Plätze verlangen, steht ohnehin getrennt in `mind`.

## D-04 Anhänger erkennt der Katalog, nicht der Server (v0.19.0)

`linkTrailers()` fragte jede Fahrzeugseite ab, um zu erfahren, ob es ein Anhänger
ist — der gelernte Cache (`lssplaner.anhTypen`) half erst ab dem zweiten Lauf.
`max === 0` steht im Katalog. Zusätzlich filtert `zug` die angebotenen
Zugfahrzeuge: das Spiel bietet dem MZB auch den GW-Taucher an, richtig ist die
GW-Wasserrettung. Gekoppelt wird in zwei Durchgängen — erst lesen und bestehende
Kopplungen reservieren, dann verteilen.

## D-05 Lehrgangs-Soll bleibt großzügig (v0.20.0)

`sitzeFuerKurs()` bucht für jeden geforderten Kurs die **volle** Besatzung, nicht
die genaue Zahl aus `PB.kurse[].n` — beim ITW also 3 Notärzte statt 1. Das ist
Absicht: es schafft Reserve für Ausfälle und erlaubt die Vollbesetzung. Nicht als
Fehler anfassen.

## D-06 Zuweisung füllt bis Vollbesetzung auf (v0.20.0)

Die frühere Regel „nur bis `min`, kein Auffüllen" schützte knappe Fachkräfte,
ließ aber Sitze leer. Jetzt zwei Durchgänge: erst Mindestbesetzung über alle
Fahrzeuge, dann Auffüllen mit den Übrigen. Beim Auffüllen bleibt frei, wer einen
Lehrgang trägt, den diese Wache irgendwo verlangt — die Regel „Person mit Kurs,
der auf diesem Fahrzeug nicht gebraucht wird, abwählen" gilt damit weiter für
alles, was an der Wache knapp ist, aber nicht für einen Taucher an einer Wache
ohne Tauchfahrzeug. Abschaltbar im Personal-Reiter.

Dazu die Reihenfolge in `besetze()`: die Mindestbesetzung nimmt jetzt die
Ungelernten zuerst (`wert` aufsteigend). Vorher entschied die Reihenfolge der
Personalliste, und der einzige Wasserretter landete auf dem LF, weil er dort
weiter oben stand.

## D-07 Ausbildung nimmt nur Ungelernte (v0.21.0)

`waehlePersonen()` schloss bisher nur aus, wer den Kurs **schon** hatte, und
sortierte den Rest nach Kursanzahl. Gingen die Ungelernten aus, wurden
Ausgebildete in einen zweiten Lehrgang geschickt — das nahm sie ihrem Fahrzeug
weg, ohne irgendwo eine Besatzung zu schaffen.

Jetzt kommen nur Ungelernte in Frage. Ausnahme: `doppelKandidaten()` holt gezielt
die dazu, denen genau ein Lehrgang zu einer geforderten Kombination fehlt, und
nur so viele, wie die Kombination noch offen hat. Wer mehr Kurse mitbringt, als
die Kombination verlangt, bleibt draußen — sein Zusatzkurs verfiele.

Folge: Sind an einer Wache keine Ungelernten mehr da, wird für sie nichts
gebucht. Das ist gewollt — der Engpass ist dann Personal, nicht Ausbildung.

## D-08 Zählung verteilt statt zu summieren (v0.21.0)

Grundlage der Fehlbuchung war die Zählung: `zaehleAus()` addierte jede
Qualifikation jeder Person. Eine Wache mit drei Doppelqualifizierten sah aus wie
sechs Ausgebildete. Jetzt bekommt jede Person genau einen Kurs zugerechnet, und
zwar den mit der größeren Restlücke; Personen mit nur einem Kurs werden zuerst
verteilt, weil sie keine Wahl haben.

Die Zahlen sinken damit sichtbar, und `fortschritt()` meldet an manchen Wachen
wieder offene Lehrgänge. Das ist die Korrektur, nicht ein neuer Fehler.

## D-09 Bedarf rechnet auf Schlüsseln (v0.22.0)

Seit v0.19 leitete sich `meta.schooling` aus den Schlüsseln ab — die
Bedarfsrechnung fragte aber weiter nach Klartext. Solange ein Name nicht gelernt
war, ergab die Kette `courseNeed → courseNames → leer` einen Bedarf von null:
`fortschritt()` hielt die Wache für fertig und setzte den Haken,
`bedarfDerWache()` übersprang sie beim Ausbilden. Betroffen waren 39 der 60
Kurse — praktisch das ganze THW, die Polizei-Sonderkurse, SEG, Berg- und
Seenotrettung.

Jetzt rechnet alles auf Schlüsseln, Klartext ist Anzeige. `matchKey()` und
`courseNames()` sind entfallen. Der Status `nokey` in `courseTable()` existiert
nicht mehr — ein unbekannter Name ist kein Rechenproblem mehr.

## D-10 Planwechsel verwirft die Zwischenergebnisse (v0.22.0)

`S.plan = p` beim Import setzte den Plan, ließ aber `memoA`, `memoG` und `memoK`
stehen. Der Planer rechnete mit den Zahlen des alten Plans weiter, bis zufällig
der Bestand neu geladen wurde. Der Setter ruft jetzt `standNeu()`.

## D-11 Bestätigungen mit Gedächtnis, Vorschau ohne (v0.23.0)

`confirm()` hat keinen Platz für ein Ankreuzfeld, deshalb ein eigener Dialog
(`frage(text, merk)`). Abgeschaltet wird immer nur die einzelne Frage, gespeichert
unter `lssplaner.stilleFragen`; im Übersichts-Reiter lässt sich das zurücknehmen.
Der **Fahrzeugverkauf** bekommt bewusst kein „nicht mehr fragen“ — er ist die
einzige Aktion, die sich nicht rückgängig machen lässt.

Umgekehrt beim Haken „Nur Vorschau“: der wird bei jedem Reiterwechsel wieder
gesetzt. Wer im Kaufen-Reiter scharf geschaltet hat, soll es im Personal-Reiter
nicht unbemerkt bleiben.

## D-12 Der bekannte Lehrgangspfad wird nicht überstimmt (v0.23.0)

`holeKursauswahl()` probierte vier Adressen durch. Antwortete die bekannte, gute
Adresse mit einer Seite ohne Auswahlfeld, liefen trotzdem drei weitere Abrufe in
je einen 404. Das lag nie am Pfad, sondern an der Schule — sie bietet gerade
keine Kursliste an. Jetzt bricht es dort mit dieser Aussage ab.

Dazu: `learnAllCourses()` setzte den Pannenzähler nach einem Erfolg nicht zurück,
brach also nach drei Fehlern **insgesamt** ab und behauptete dabei „drei in
Folge“.

## D-13 Namen drehen statt Leute schieben (v0.24.0)

Der Planer verteilt von Grund auf neu und weiß nicht, wer gerade wo sitzt.
`assignStaff()` schickt zwar nur Abweichungen los, aber die Abweichung besteht oft
nur im Namen: der Plan will Ungelernten A, auf dem Fahrzeug sitzt Ungelernter B.
Das kostete zwei Anfragen für null Wirkung, und bei jedem Zugang oder
Lehrgangsabschluss verschoben sich die `wert`-Zahlen und damit die Namen erneut.

Erwogen und verworfen: bei gleichem `wert` zuerst nehmen, wer schon draufsitzt.
Das hätte nur den Regelfall erwischt und die Auswahlreihenfolge mit einer zweiten
Absicht belastet. Stattdessen bleibt die Auswahl rein fachlich und `angleichen()`
dreht das Ergebnis danach auf die Wirklichkeit — mit Nachrechnen nach jedem
Tausch, damit keine Auflage kippt.

Der Notarzt, der auf dem LF sitzt, wandert weiterhin aufs NEF. Getauscht wird nur,
wo es für die Auflagen gleichgültig ist.

## D-14 Besetzung über Spalten (v0.25.0)

Ersetzt D-13. Statt den Plan hinterher auf die Wirklichkeit zu drehen, entsteht er
gleich so: Personen werden nach Lehrgangskombination in Spalten gelegt, und
innerhalb der Spalte zieht, wer am wenigsten Anfragen kostet — Draufsitzender vor
Unvergebenem vor Fremdsitzendem. `angleichen()` und die `wert`-Sortierung sind
ersatzlos entfallen; drei Mechanismen wurden zu einem.

Verworfen: erst alle Falschsitzenden abwählen und dann verteilen. Danach sind alle
gleich „frei", und die Reihenfolge kann Behalten, Zuweisen und Wegnehmen nicht
mehr unterscheiden.

Beim Zuweisen deckt ein Doppelqualifizierter **zwei** Auflagen (ein Sitz, zwei
erfüllte Zeilen — so prüft es das Spiel), beim Zählen nach D-08 nur **eine**. Das
ist Absicht: die Zählung steuert die Ausbildung, und dort ist einer zu viel
besser als eine Wache, die sich versorgt glaubt.

Neu ist auch, dass „im Unterricht" eine eigene Spalte bildet. Ein Lernender zählt
fürs Zuweisen, zwingt das Fahrzeug aber auf Status 6 — getrennte Spalten heißt,
er kommt erst dran, wenn kein Fertiger mehr da ist.

## D-15 est ist eine Forderung der Einsatzstelle, nicht der Sitzreihe (v0.25.1)

Beim Pferdetransporter groß (Typ 135) stehen 4 Reiter an der Einsatzstelle, aber
nur 2 Sitze im Fahrzeug — die anderen beiden kommen mit einem zweiten Fahrzeug.
Die est-Zahl als Besatzungsauflage zu lesen machte das Fahrzeug dauerhaft
unbesetzbar, obwohl es im Spiel längst ausrückt.

Die eigene Auflage eines Fahrzeugs wird deshalb auf `max` gedeckelt. Beim Dekon-P
(est 6, 6 Sitze) ändert das nichts. Für **Anhänger** bleibt es beim vollen Wert:
deren est gilt dem Zugfahrzeug, und passt sie dort nicht auf die Sitze, ist das
Gespann tatsächlich nicht besetzbar (D-03).

Betroffen war genau ein Typ im ganzen Katalog.

## D-16 „Nicht beurteilbar" nennt den Grund (v0.25.2)

`fortschritt().unklar` hat zwei Quellen: fehlender Ausbildungsstand **oder**
Fahrzeuge, deren Besatzungsstärke der Bestand nicht kennt. Der Haken-Lauf meldete
beides als „ohne erfassten Ausbildungsstand" — wer gerade erfasst hatte, erfasste
daraufhin ein zweites Mal.

Die Meldung nennt jetzt je Wache den tatsächlichen Grund. Dazu zwei Ursachen
beseitigt, statt sie nur besser zu beschreiben:

- `fahrzeugDazu()` setzt `besatzung: 0`. Ein eben gekauftes Fahrzeug hat
  nachweislich niemanden an Bord; das Feld zu weglassen machte die ganze Wache
  unbeurteilbar.
- `assignStaff()` schreibt die neue Besatzungsstärke in den Bestand zurück. Wer
  direkt danach die Haken setzt, urteilte sonst über die Zahlen des letzten
  Vollabrufs.

## D-17 Fertig-Markierung: grüner Punkt, vorangestellt (v0.26.0)

Einfärben des Namens wäre das Schönere gewesen, geht aber nicht: die Bezeichnung
liegt als Text auf dem Server und wird maskiert ausgegeben. Alles, was ohne
laufendes Userscript sichtbar bleiben soll, muß im Namen selbst stehen.

Deshalb 🟢 statt ✔️, und **vorangestellt** — so sammeln sich die fertigen
Fahrzeuge in den Listen des Spiels an einem Block.

`ohneHaken()` räumt jetzt vorn **und** hinten auf, damit die alten Häkchen beim
nächsten Lauf verschwinden. Erkannt werden ✅ ✔️ ✔ ✓ und 🟢. Der Variantenwähler
U+FE0F gehört ausdrücklich dazu: ✔️ war nie ein Zeichen, sondern zwei, und der
unsichtbare zweite bliebe sonst im Namen hängen.

Einmalige Folge: jedes Fahrzeug und jede Wache mit altem Häkchen wird beim
nächsten Haken-Lauf einmal umbenannt.

## D-18 Ein Zugfahrzeug hält einen Anhänger (v0.27.0)

`linkTrailers()` übernahm jede bestehende Kopplung ungeprüft, auch wenn das
Zugfahrzeug schon vergeben war. Hingen zwei Boote am selben Fahrzeug — egal ob von
Hand oder aus einem früheren Lauf —, blieb es dabei, und das Gespann galt fortan
als nicht besetzbar, weil zweimal `est` verlangt wurde.

`belegt` ist jetzt eine Map von Zugfahrzeug auf Anhänger: der erste behält, der
zweite wird umgehängt und das gemeldet.

## D-19 Anhänger zählen nicht zweimal (v0.27.1)

Ein Anhänger hat keine eigenen Sitze — seine Leute fahren auf dem Zugfahrzeug
mit, dessen Plätze bereits gezählt sind. `courseNeed()` addierte trotzdem seine
`est` obendrauf: zwei GW-Wasserrettung (2 × 6) plus zwei MZB (2 × 4) ergaben 20
Wasserretter, wo zwölf Sitze existieren.

`anhaengerZaehlt()` prüft jetzt über `zug`, ob ein zugelassenes Zugfahrzeug im
Plan denselben Lehrgang fordert. Wenn ja, ist der Bedarf schon gedeckt und der
Anhänger steuert nichts bei. Wenn nein — WLF plus AB-MZB —, zählt er sehr wohl,
sonst stünde für das Boot niemand.

Das ist dieselbe Korrektur wie in D-03, eine Ebene höher: dort `min + est` statt
`max(min, est)` bei der Besatzung, hier die Summe statt der Deckung beim
Lehrgangsbedarf.

## D-20 Wachen heißen `building[name]` (v0.27.2)

`umbenennen()` suchte das Namensfeld über `input[name$="[caption]"]`. Das trifft
Fahrzeuge (`vehicle[caption]`), aber keine Wache — dort heißt es `building[name]`.
Jede Umbenennung einer Wache scheiterte mit „Umbenennen-Formular nicht gefunden",
obwohl das Formular dastand. Gesucht wird jetzt nach `#building_name` und beiden
Namensformen; die Fehlermeldung sagt „Namensfeld", weil das der Teil war, der
fehlte.

## D-21 Anhänger folgen ihrem Zugfahrzeug (v0.27.2)

Ein Anhänger hat keine Sitze und kann nie „besetzt" sein — bisher wurde er beim
Haken-Lauf schlicht übergangen und blieb ohne Markierung. Fertig ist er, wenn er
an einem Zugfahrzeug hängt, das seine Mindestbesetzung hat: dort sitzen ja auch
seine Leute. Ohne Zugfahrzeug bleibt er ohne Punkt, denn dann ist er unbrauchbar.

## D-22 Die Auswahl ist Zustand, nicht Anzeige (v0.28.0)

Welche Wachen gewählt waren, stand allein in den Ankreuzfeldern — und die
entstanden bei jedem `render()` neu, vorangekreuzt nach der Regel „hier ist etwas
offen". Wer eine einzelne Wache wählte und danach irgendetwas anfaßte, das ein
Neuzeichnen auslöste, lief unbemerkt gegen **alle** offenen Wachen.

Die Auswahl liegt jetzt in `auswahl` (Set von Wachen-IDs) und überlebt das
Zeichnen. Vorangekreuzt wird nichts mehr, und ein Reiterwechsel räumt sie leer:
neue Absicht, nichts gewählt, „Nur Vorschau" wieder an (D-11).

## D-23 Markierungen werden überall aus dem Namen geräumt (v0.28.1)

`ohneHaken()` räumte nur die Ränder. Fahrzeugnamen tragen den Wachennamen aber in
sich — „MZB #I - WasRet 3 ✔️ - Sasha" —, und dieses ✔️ in der Mitte ist die alte
Markierung derselben Wache. Sie blieb für immer stehen, auch wenn die Wache
längst umbenannt war. Jetzt fällt jede Markierung überall im Namen weg; die
Lücke, die sie hinterläßt, wird mit eingezogen.

## D-24 Jede fehlende Markierung wird begründet (v0.28.1)

Der Haken-Lauf meldete nur Änderungen. Ein Fahrzeug ohne Punkt und ein
übersehenes Fahrzeug sahen damit gleich aus: nichts passiert. Jetzt nennt er je
Fahrzeug den Grund — kein Zugfahrzeug, Zugfahrzeug ohne Mindestbesetzung, oder
„2 von 4 mit passendem Lehrgang" — und für die Wache selbst die offenen Posten.
Gedeckelt bei sechs Zeilen je Wache, damit ein großer Lauf lesbar bleibt.

## D-25 Auch der Anhänger fordert für die Einsatzstelle (v0.29.0)

D-15 hat den Deckel für die eigene Auflage eines Fahrzeugs eingeführt, für
Anhänger blieb der volle Wert stehen — mit der Begründung, deren Leute müßten ja
mitfahren. Eine Probe über den ganzen Katalog widerlegt das: fünf Anhängertypen
hätten dann **kein einziges** brauchbares Zugfahrzeug.

```
AB-Dekon-P  est 6  →  WLF hat 3 Sitze
AB-MZB      est 4  →  WLF hat 3 Sitze
Anh MzB/SchlB/MzAB  est 4  →  LKW 7 Lkr 19 tm hat 2 Sitze
```

Das sind gängige Kombinationen im Spiel. Also gilt auch hier: `est` ist eine
Forderung der Einsatzstelle, die Übrigen kommen mit einem zweiten Fahrzeug.
Gedeckelt wird in beiden Richtungen, und „passt nicht auf die Sitze" verschwindet
damit praktisch als Fall.

## D-26 Zugfahrzeuge werden gereiht, nicht ausgeschlossen (v0.29.0)

`zug` sagt nur, was das Spiel zuläßt: bei der MZB sind das GW-Taucher **und**
GW-Wasserrettung. Der Planer koppelte deshalb Boote an Taucherfahrzeuge — dort
bräuchte die Besatzung zwei Lehrgänge, und zwei Sitze stehen vier
Einsatzstellen-Plätzen gegenüber.

Erst versucht, das über eine harte Sitzprüfung auszuschließen; das nahm den fünf
Typen aus D-25 jedes Zugfahrzeug. Jetzt eine Rangfolge: zuerst das Fahrzeug, das
denselben Lehrgang ohnehin verlangt, dann das mit mehr Sitzen. Die MZB landet
damit an der GW-Wasserrettung, ohne daß eine Regel dafür im Code steht.

## D-27 Grün heißt: Finger weg (v0.30.0)

Was den Punkt trägt, ist erklärtermaßen fertig. `geschuetzt(objekt)` sperrt es
gegen jeden Eingriff, der etwas **wegnimmt**:

- Umbenennen, also auch das Entfernen des Punktes
- Verkaufen
- An- und Abkoppeln von Anhängern; ein grünes Zugfahrzeug bekommt auch nichts
  Neues angehängt, denn das änderte seine Mindestbesetzung
- Personal abziehen — die Besatzung eines grünen Fahrzeugs wird eingefroren und
  steht dem Rest der Wache nicht mehr zur Verfügung
- Wache oder Erweiterung abschalten

Erlaubt bleibt alles, was **hinzufügt**: werben, ausbilden, freie Sitze auffüllen,
kaufen. Davon verliert niemand etwas.

Der Schalter „Grüne freigeben" sitzt neben „Nur Vorschau" und fällt bei jedem
Reiterwechsel zurück (D-11); über einen Neustart wird er absichtlich nicht
wiederhergestellt. Wer freigibt, tut es für einen Handgriff.

Übergangene Eingriffe werden gezählt und am Ende jedes Laufs gemeldet — sonst
wäre „nichts passiert" nicht von „nichts zu tun" zu unterscheiden (vgl. D-24).

## D-28 Laufende Ausbildungen fallen beim Personallauf ab (v0.30.1)

Die Kursauswahl zeigt `Y benötigt`, und `Y` ist bereits um die Laufenden
vermindert — `fehlt = max(0, soll - (ist + lauf))`. Nur kam `lauf` ausschließlich
von der Lehrgangsseite selbst (`#personal-select-heading-building-<id>`), und die
kennt jeweils nur den einen Kurs, den man gerade ansieht. Für alle übrigen stand
dort dauerhaft null, also war `Y` zu hoch und „N laufen" fehlte.

Die Zuweisungsseite nennt je Person den laufenden Lehrgang mit Schlüssel — sie
wird bei jedem Personallauf ohnehin gelesen. Von dort fällt die Zahl jetzt für
**alle** Kurse nebenbei ab. `setzeInAusbildung()` ersetzt dabei den Stand einer
Wache vollständig, statt ihn zu ergänzen: was nicht mehr dasteht, läuft auch
nicht mehr.

## D-29 Laufende Ausbildungen gehören zum Ausbildungsstand (v0.31.0)

Die Zahl fiel bisher nur beim Personallauf ab (D-28) — wer „Ausbildungsstand
erfassen" drückte, bekam sie nicht, obwohl er genau das gemeint hatte.

Jetzt zweistufig. Erst wird die Antwort befragt, die ohnehin vorliegt:
`schooling_personal_select` wird je Wache geladen, und trägt sie
`data-education-key`, kostet die Zahl keinen Abruf. Findet sich nichts, gilt das
als „hier steht es nicht" und **nicht** als „es läuft keiner" — dann holt der
Erfassungslauf die Zuweisungsseite nach, ein Abruf mehr je Wache. Für alle
übrigen Läufe bleibt es bei einem.

## D-30 Einzelansicht im Lehrgangsreiter (v0.31.1)

Die Sammelliste beantwortet „was fehlt insgesamt". Wer wissen will, woran es an
**einer** Wache liegt oder wo **ein** Lehrgang fehlt, mußte bisher die Auswahl
umstellen und neu rechnen lassen.

Ein Klick auf einen Wachennamen oder einen Lehrgangsnamen öffnet jetzt die
jeweils andere Achse — dieselben Zahlen aus denselben Quellen (`courseNeed`,
`quals`, `laufendeAusbildung`), damit Sammelliste und Einzelansicht nicht
auseinanderlaufen. Der Klick auf den Namen kippt dabei nicht das Ankreuzfeld
daneben; Auswahl und Betrachtung sind zwei verschiedene Absichten. Ein
Reiterwechsel schließt die Einzelansicht, wie er auch die Auswahl räumt (D-22).

## D-31 Wunschbild getrennt vom Plan (v0.32.0)

Der Plan war eine Datei mit zwei Naturen. Spieldaten sind für jeden gleich und
gehören eingebacken; das Wunschbild ist eine Meinung und gehört bearbeitet. Es
liegt deshalb in eigenem Speicher (`lssplaner.modell`), die Zuordnung Wache →
Profil in einem zweiten (`lssplaner.zuordnung`).

Sasha's Profile sind als `MODELL_STANDARD` eingebacken — **ohne** die Zuordnung,
denn die besteht aus Gebäudenummern seines Kontos und zeigt bei jedem anderen
ins Leere. `profileOf()` fällt in dem Fall auf das erste Profil des Typs zurück,
was für einen neuen Nutzer die richtige Voreinstellung ist.

Ein importierter Plan überschreibt das Wunschbild nicht mehr stillschweigend,
sondern fragt. Sonst wäre jede Editorarbeit einen Import weit von der Löschung
entfernt.

Noch offen: `layouts` und `extensionCatalog` kommen weiter aus dem Plan. Beide
sind Spieldaten und ließen sich live auslesen — das ist der nächste Schritt zur
Unabhängigkeit vom Artefakt.

## D-32 Wachenliste: Suche, Sortierung, Zählung (v0.33.0)

Bei 102 Wachen war die Liste ein Fenster von zehn Zeilen ohne Suche und ohne
Sortierung. Neu: Suchfeld, Sortierung nach „offenste zuerst" (Voreinstellung),
Name oder Typ, und die Zahl der Gewählten neben der Zahl der Sichtbaren.

Suchwort und Sortierung stehen im Zustand, nicht im DOM — jeder Lauf zeichnet
die Liste neu, im Feld getippter Text wäre sonst nach der ersten Aktion weg.
Gesucht wird über den Namen **ohne** Markierung: wer „wasret" tippt, meint auch
„🟢 WasRet 3". Der Reiterwechsel räumt die Suche mit, wie er Auswahl und
Einzelansicht räumt (D-22).

Die Aktionsleiste klebt jetzt am unteren Rand. Vorher scrollte der
Ausführen-Knopf mit der Liste aus dem Bild — bei einem Werkzeug, dessen
Vorschau-Haken direkt daneben sitzt, keine gute Anordnung.

## D-33 Zwei Leisten statt elf Reiter (v0.34.0)

Elf Reiter brachen auf 520 px in zwei Zeilen um und mischten dabei Ebenen:
„Übersicht" ist eine Ansicht, „Lösen" ein Eingriff. Jetzt oben die Sache
(Übersicht · Plan · Bestand · Personal · Ausbildung · Namen), darunter der
Handgriff, sobald eine Gruppe mehr als einen hat. Der Wechsel räumt weiterhin
Auswahl, Suche, Einzelansicht und die Freigaben (D-11, D-22, D-32).

## D-34 Zwei Themen aus einer Palette (v0.34.0)

Das Panel war dunkel, das Spiel ist hell — und das eigene Overlay auf
`/schoolings` benutzte bereits LSS-Stile. Zwei Handschriften im selben Werkzeug.
Alle 90 Farbstellen laufen jetzt über CSS-Variablen am Dokument; `html.lssp-hell`
schaltet auf LSS-Optik um (weißes Feld, #337ab7, Bootstrap-Grautöne). Der
Schalter sitzt im Fensterkopf, die Wahl bleibt gespeichert.

Am Dokument und nicht am Panel, damit auch der Bestätigungsdialog mitzieht — der
war bisher der dritte Stil im Bunde.

## D-35 Scharf sieht man am Rahmen (v0.34.0)

Ob der nächste Druck das Spiel verändert, hing an einem Häkchen weiter unten.
Jetzt färbt sich der Fensterrahmen rot und im Kopf steht SCHARF, sobald „Nur
Vorschau" aus ist — außer in den Reitern, die ohnehin nichts ausführen.

## D-36 Fortschritt, Protokollfilter, eigenes Fenster (v0.35.0)

**Balken.** Bei 102 Wachen sagte nur das Protokoll, wie weit es ist — und das
scrollt. Der Balken sitzt fest über dem Inhalt, die Restzeit kommt aus dem
bisher gemessenen Tempo statt aus einer festen Schätzung, und er verschwindet,
sobald nichts mehr läuft.

**Protokollfilter.** Ein Lauf über 20 Wachen schreibt hunderte Zeilen; die eine
Warnung dazwischen fand niemand. Gefiltert wird über eine Klasse am `<pre>` und
CSS — die Zeilen bleiben erhalten, das Umschalten baut nichts neu auf.

**Eigenes Fenster.** Das Panel wandert per `adoptNode` in ein `window.open` auf
denselben Ursprung: keine zweite Fassung, dieselbe Sitzung, dieselbe
Warteschlange. Das Spielfenster muß offen bleiben, denn dort läuft der Code.
Schließt eines von beiden, kehrt das Panel zurück beziehungsweise das Fenster
geht mit zu.

Dazu ein Fund: `frage()` hängte seinen Dialog immer an `document.body`. Im
gelösten Fenster wäre die Rückfrage im Spielfenster erschienen, während der
Mensch woanders hinsieht — sie folgt jetzt dem Panel.

## D-37 Nur Fahrzeugtypen, die dorthin gehören (v0.36.0)

Der Editor bot alle 186 Typen an, auch das Löschboot für die Rettungswache. Eine
Tabelle „Typ gehört zu Gebäudeart" gibt es nicht, also drei Quellen statt einer
Erfindung:

1. **aus dem Spiel gelesen** — die Wachenseite trägt je kaufbarem Fahrzeug einen
   Verweis `/vehicle/<wache>/<typ>/credits`, denselben, den der Planer zum Kaufen
   benutzt. Ein Knopf im Plan-Reiter liest ihn aus und merkt sich das Ergebnis je
   Gebäudetyp.
2. was in den Profilen dieses Gebäudetyps steht — geplant hat es jemand, der es
   kaufen konnte
3. was auf eigenen Wachen dieses Typs tatsächlich steht

Findet die Leseroutine keine solchen Verweise, wirft sie einen Fehler, statt eine
leere Liste als Wahrheit auszugeben. Ein Ankreuzfeld zeigt notfalls wieder alle.

## D-38 Eine Einzelansicht für vier Achsen (v0.36.0)

Die Einzelansicht gab es nur für Lehrgänge. Jetzt für Wache, Fahrzeugtyp, Ausbau
und Lehrgang, mit einer gemeinsamen Zeilenform — und untereinander verknüpft: von
der Wache zum Fahrzeugtyp, von dort zu den anderen Wachen, die ihn vermissen. Die
Wachenansicht zeigt alle vier Bereiche auf einmal (Fahrzeuge, Überzählige,
Ausbauten, Lehrgänge).

Wachennamen sind jetzt in **jedem** Reiter anklickbar, nicht nur im
Lehrgangsreiter.

## D-39 Hinweis auf der Wachenseite (v0.36.0, versuchsweise)

Wer eine Wache im Spiel öffnet, sieht oben, was ihr nach dem Wunschbild fehlt.
Rein lesend, ohne einen einzigen zusätzlichen Abruf — alles steht im Bestand.
Ohne geladenen Bestand erscheint nichts; eine Schätzung wäre schlimmer als eine
Lücke. Standardmäßig aus, einzuschalten im Übersichtsreiter.

## D-40 Schulen, Krankenhäuser und Leitstellen bleiben außen vor (v0.37.0)

An diesen Gebäudearten gibt es nichts zu besetzen, zu kaufen oder zu benennen.
`NICHT_PLANEN = {1, 3, 4, 7, 8}` sperrt sie in `T.profiles()`, also an der Wurzel
— auch ein importierter Plan bringt sie nicht zurück. Aus dem Bestand fliegen sie
**nicht**: die Schulen werden zum Lesen der Lehrgangsnamen gebraucht.

## D-41 Ein Profil heißt „standard" (v0.37.0)

Jeder Gebäudetyp hatte ein leeres Profil namens `standard` an erster Stelle — und
`profileOf()` fällt genau auf das erste zurück. Ein neuer Nutzer hätte also
überall „nichts geplant" gesehen. Das war die schlimmste Falle im geteilten
Stand.

Jetzt heißt das gepflegte Profil `standard`, das größere `standard-groß`; die
leeren und die unvollständigen `auto`-Profile sind weg. Wer schon mit v0.32
gespeichert hat, dessen Namen zieht `profilnamenNachziehen()` einmalig mit —
sonst zeigte die Zuordnung ins Leere.

## D-42 Profile aus dem Soll-Papier (v0.38.0)

Die eingebackenen Profile stammen jetzt aus `lss-fahrzeugprofile.md` — dem aus
den Spielseiten destillierten Soll-Modell — statt aus einem halbautomatischen
Export. 15 Gebäudetypen, 18 Profile, 386 Fahrzeuge, samt Topfzuordnung je
Fahrzeug und Ausbautenliste je Profil.

Übernommen wurde maschinell, geprüft ebenso: alle 386 Fahrzeugnamen ließen sich
eindeutig auf Katalog-Nummern abbilden, die Sitzsummen jedes Profils stimmen mit
den im Papier genannten überein (146, 190, 29, 54, …), und kein Anhänger steht
ohne zugelassenes Zugfahrzeug im selben Profil.

Drei Namen kommen im Katalog doppelt vor — NEA50, NEA200, FKH. Aufgelöst über
den Gebäudetyp und die Lehrgänge: NEA50 ist 110 beim THW, 111 bei der Feuerwehr,
175 bei der SEG; NEA200 ist 112 (`thw_energy_supply`) gegen 113
(`energy_supply`). Nicht geraten, sondern belegt.

## D-43 Vorgemerkte Fahrzeuge kommen in keine Anfrage (v0.38.1)

`fahrzeugDazu()` legt nach einem Kauf einen Eintrag mit erfundener, negativer
Nummer an — der Server hat dem Fahrzeug längst eine eigene gegeben, die wir erst
beim nächsten Bestandsladen erfahren. Für den Fortschritt muß der Eintrag zählen
(sonst kauft der nächste Lauf dasselbe Fahrzeug noch einmal), in einer Anfrage
ist er Gift: `/vehicles/-1787646232475/zuweisungDo/…` gibt 404 und bricht den
ganzen Personallauf ab.

`echteVon(b)` liefert deshalb nur, was der Server kennt, und wird überall dort
benutzt, wo etwas abgeschickt wird — Personal, Haken, Kopplung, Verkauf. Der
Personallauf sagt einmal je Wache, wie viele er übergangen hat.

## D-44 SEG: TeSi-Block auf 3 GW + 3 MTW (v0.38.2)

Nachgeprüft im Spiel: die drei NEA50-Nummern (110 THW, 111 Feuerwehr, 175 SEG)
sind für Einsätze dasselbe Fahrzeug. Der Feuerwehr-NEA50 verlangt **keinen**
Lehrgang und steht bereits auf 23 Wachen; der SEG-NEA50 hätte zwei Ausgebildete
auf dem Zugfahrzeug gebunden. Er entfällt, mit ihm der LKW Technik (Notstrom),
der nur ihn ziehen konnte.

Der TeSi-Block ist jetzt 3× GW TeSi + 3× MTW TeSi. Die sechs Plätze des Ausbaus
bleiben exakt belegt, die SEG steigt von 106 auf 119 Sitze.

Preis der Entscheidung: der Anh TeSi entfällt mit. Ihn gibt es **nur** an der
SEG — kein anderes Fahrzeug im Spiel darf ihn ziehen —, und er kostete null
Sitze. Bewußt aufgegeben zugunsten von zwei zusätzlichen MTW.

## D-45 Zurücksetzen gilt je Gebäudetyp (v0.39.0)

„Auf Standard zurücksetzen" warf das ganze Wunschbild weg — wer eine Feuerwache
verstellt hatte, verlor auch seine SEG. Der Knopf sitzt jetzt oben bei Neu,
Kopieren, Umbenennen und Löschen, heißt „Standard für <Gebäudeart>" und rührt
nur diesen einen Typ an. Selbst angelegte Profile, die es im eingebauten Stand
nicht gibt, werden vorher namentlich genannt.

## D-46 Verteilt wird nach Knappheit, nicht nach Lücke (v0.39.1)

D-08 rechnet jede Person genau einem Kurs zu. Welchem, entschied bisher die
größte Restlücke — und die ist absichtlich großzügig gerechnet (D-05). An einer
Polizeiwache fordert die Kriminalpolizei drei Zivilstreifen à zwei Sitze, die
Dienstgruppenleitung einen einzigen Platz. Wer beides konnte, wurde deshalb
**immer** der Kriminalpolizei zugeschlagen; die Wache meldete „0 von 2
Dienstgruppenleitung", obwohl zwei fertig ausgebildet dastanden.

Entscheidend ist jetzt, wie viele Personen für einen Kurs überhaupt in Frage
kommen: wer sonst niemanden hat, bekommt ihn zuerst. Der aufgeblähte Kurs holt
sich, was übrig bleibt.

Der Fehler betraf jede Wache mit Doppelqualifizierten und war von außen nur
daran zu erkennen, daß die Lehrgangsübersicht Bedarf meldete, den es im Spiel
nicht gab.

## D-47 Der Ausbildungsstand kommt von der Zuweisungsseite (v0.40.0)

Eine Wache mit zwei Motorradfahrern, beide ohne weiteren Lehrgang, meldete „0
von 2". Das schließt die Verteilung aus D-46 aus: wer nur einen Kurs hat, kann
durch keine Zuordnung verlorengehen. Also lag es an der Quelle.

Gezählt wurde aus `schooling_personal_select` — der Liste, aus der das Spiel
Teilnehmer für einen Kurs auswählen läßt. Die ist **nicht** der Personalstand
der Wache; an Wachen, deren Ausgebildete alle auf ihren Fahrzeugen saßen, kam
null zurück. Genau die Ausgebildeten sitzen aber auf den Fachfahrzeugen — der
Fehler traf systematisch die Kurse, die man geprüft haben wollte.

Die Zuweisungsseite `/vehicles/<id>/zuweisung` führt dagegen **jede** Person der
Wache mit `data-filterable-by`, dazu die laufenden Lehrgänge. Ein Abruf, beide
Zahlen. `readRoster()` schreibt den Stand jetzt selbst weg, `scanBuildingQuals`
geht diesen Weg, und die Schulauswahl zählt nur noch ersatzweise für Wachen
ohne Fahrzeug — sonst machte ein Ausbildungslauf die eben erfaßten Zahlen
wieder kaputt.

Nebeneffekt: der zusätzliche Abruf aus D-29 entfällt, das Erfassen wird wieder
so schnell wie vorher.

## D-48 Jede Schule zählt nur ihren eigenen Zweig (v0.41.0)

Der Verpflegungshelfer (`care_service_equipment`) wird von SEG-, Feuerwehr- und
THW-Fahrzeugen verlangt und an mehreren Schulen angeboten. Die Rettungsschule
meldete deshalb 225 Bedarf, von dem der größte Teil in THW-Fahrzeugen sitzen
soll — Personal, das sie nicht ausbilden darf.

Die Zuordnung Schule → Gebäudearten wird **hergeleitet, nicht festgelegt**: ein
Lehrgang, den nur eine Schulart anbietet, verrät den Zweig. Die THW-Schule ist
die einzige mit `thw_zugtrupp`, also gehört jede Wache, deren Fahrzeuge ihn
verlangen, zu ihr; über alle Alleinstellungen abgestimmt ergibt sich der Rest.
Durchgerechnet liefert das genau die erwartete Aufteilung — Feuerwehrschule → 0,
Rettungsschule → 2, 5, 12, 21, 25, 26, 28, Polizeischule → 6, 11, 13, 17, 29,
THW-Schule → 9.

Grundlage ist das Kursangebot, das `learnFromSchool()` beim „Lehrgangsnamen
lesen" ohnehin sieht und jetzt je Schulart mitschreibt. Wurde nichts gelesen,
greift eine Notfalltabelle; steht die Schule nicht im eigenen Bestand (Verband),
bleibt es beim ungefilterten Gesamtbedarf statt einer Vermutung.

## D-49 Farben außerhalb des Panels ohne Variablen (v0.41.1)

Die Palette (D-34) wird in `mount()` gesetzt — und `mount()` läuft nicht, wenn
die Seite in einem Rahmen des Spiels steckt (`inFrame`). Das Protokollfeld der
Lehrgangsübersicht stand deshalb weiß auf weiß: beide Farbangaben waren
ungültig, der Hintergrund blieb durchsichtig.

Es bekommt jetzt feste Farben für die helle Spielseite, wie der Rest jenes
Overlays. Der Bestätigungsdialog, der ebenfalls im Rahmen aufgehen kann, hat
Ersatzwerte in jedem `var()`.

## D-50 Roter Punkt schließt eine Wache aus (v0.42.0)

Gegenstück zum grünen: 🔴 im Namen nimmt eine Wache vollständig aus dem Planer —
keine Liste, keine Zählung, kein Lauf, kein Hinweis auf der Wachenseite. Gedacht
für Wachen, die man bewußt anders führt als den Plan.

Zwei Eigenschaften unterscheiden ihn vom grünen Punkt: er wird **nie** vom
Skript gesetzt, und er wird **nie** entfernt — `ohneHaken()` läßt ihn stehen,
sonst wäre er nach dem ersten Umbenennen weg.

Umgesetzt über `planWachen()` statt über einen Filter je Aufrufstelle: elf
Stellen rechnen über den Bestand, und eine vergessene hätte die Wache
klammheimlich wieder eingeschlossen.

Konfigurierbar sind die beiden Zeichen bisher nicht — sie stehen als `HAKEN` und
`AUSSCHLUSS` im Kopf des Skripts.

## D-51 Ohne Plan arbeiten (v0.43.0)

`render()` hielt den ganzen Planer hinter „Noch kein Plan geladen" fest — ein
Stand aus der Zeit, als der Plan alles mitbrachte. Seit v0.32 kommen daraus nur
noch zwei Dinge: die Stellplatz-Töpfe und der Ausbaukatalog. Ein neuer Nutzer
stand also vor der Aufforderung, ein Artefakt zu bedienen, das er nicht hat,
während Personal, Anhänger, Lehrgänge, Namen und der Plan-Reiter längst ohne
ihn liefen.

Die Sperre gilt jetzt nur noch für **Ausbauten** und **Kaufen** und erklärt
dort, was fehlt und was trotzdem geht. Die Gebäudenamen, bisher ebenfalls aus
dem Plan, sind als `GEBAEUDE_NAMEN` eingebacken — sonst hieße jede Wache im
Editor „Gebäudetyp 11".

Beim Umbau habe ich zunächst zu viel herausgeschnitten und den Übersichtsreiter
mitgenommen; aufgefallen ist es, weil „Bestand neu laden" verschwand. Der
Schnitt endet jetzt am eigenen `return;` des Blocks, nicht am nächsten Reiter.

## D-52 Stellplätze als Formel eingebacken (v0.44.0)

Die Stellplatz-Aufteilung stand nur im Plan. Sie ist aber Spieldatum und im
Soll-Papier bereits als Herleitung notiert — „fest 1, +5 je Fachgruppe
Wassergefahren, …". Genau in dieser Form nimmt sie `poolsOf()` entgegen, also
ist sie jetzt als `LAYOUTS_STANDARD` eingebaut.

Wichtig ist die **Formel**, nicht die Zahl: sie rechnet sich bei jedem Spieler
aus seiner eigenen Stufe und seinen eigenen Ausbauten aus, statt Sashas Wache
abzubilden. Ein Freund mit einer Stufe-3-Feuerwache bekommt 4 Plätze, nicht 20.

Gegengeprüft an neun Fällen: mit Sashas Stufen und Ausbauten liefern die Formeln
exakt die Zahlen aus dem Papier — 44, 56, 15, 21, 42, 48, 28, 6, 23 — und in
jedem Fall genau so viele Plätze, wie das Profil Fahrzeuge vorsieht.

Damit braucht nur noch der Reiter **Ausbauten** einen Plan: für den
`extensionCatalog`, also welcher Bauplatz welcher ist. Der ließe sich aus
`/buildings/<id>/leitstelle-extensions` lesen, das der Planer ohnehin abruft.

## D-53 Ausbaukatalog aus dem Spiel (v0.45.0)

Um einen Ausbau zu bestellen, genügt sein Name nicht — das Spiel will die Nummer
des Bauplatzes. Diese Zuordnung war der letzte Grund, das Artefakt zu brauchen.
Sie steht im Spiel selbst, an zwei Stellen:

- **Gebaute** Bauplätze nennt `/api/buildings` mit `type_id` und Namen. Das
  kostet nichts, der Bestand wird ohnehin geladen — seitdem lernt jedes
  Bestandsladen den Katalog nebenbei mit.
- **Leere** Bauplätze stehen auf der Ausbauseite im Verweis des Kaufknopfes:
  `/extension/credits/14`, beim Umschalter `/extension_ready/12/`. Ein Knopf im
  Plan-Reiter liest sie je Gebäudeart.

An echtem Seiten-HTML geprüft: Bauplätze 10 bis 16 der Polizeiwache werden
korrekt zugeordnet; die Zeile „Zelle — Gebaut 10 / 10" trägt keinen Verweis und
wird übergangen, weil der Bestand sie bereits kennt.

Damit ist der Planer vollständig eigenständig: Wunschbild, Fahrzeugdaten,
Gebäudenamen, Stellplätze und Ausbaukatalog kommen aus dem Skript oder aus dem
Spiel. Ein importierter Plan darf weiterhin alles überschreiben.

## D-54 Der Plan ist überall entbehrlich (v0.46.0)

Drei Reste hingen noch daran, alle aus der Zeit, als der Plan die einzige Quelle
war: die Kursbeschriftung auf der Schulseite, die Fehlmengen-Rechnung und der
Ausbaureiter.

Der Ausbaureiter fragt jetzt nicht mehr nach einem Plan, sondern bietet an, die
Bauplatz-Nummern aus dem Spiel zu holen — ein Abruf je Gebäudeart, mit
Fortschrittsbalken. Was der Bestand ohnehin kennt, ist da schon gelernt (D-53).

Dazu: `learnAllCourses()` bricht freundlich ab, wenn es weder eigene noch
Verbandsschulen gibt. Für wen im Verband keine Lehrgänge eröffnen darf, ist das
der Normalfall — und kein Fehler, weil gerechnet ohnehin über die Schlüssel wird
und die Namen nur Beschriftung sind.

## D-55 Lehrgangsnamen eingebaut (v0.47.0)

`KURSE_FEST` trug 21 der 60 Lehrgänge; die übrigen zeigte der Planer als
Schlüssel — `thw_zugtrupp` statt „Zugtrupp". Wer keine eigenen Schulen hat oder
im Verband keine Lehrgänge eröffnen darf, kommt an die Namen gar nicht heran.

Jetzt sind 56 eingebaut, **ausgelesen aus einem echten Spielstand**, nicht
erfunden. Es bleiben vier, die nur die Seenotrettung betreffen
(`coastal_rescue`, `coastal_helicopter`, `coastal_helicopter_lift`,
`emergency_paramedic_water_rescue`) — sie hängen an zwei Fahrzeugen, die noch
niemand besitzt, dessen Schulen gelesen wurden.

Die Namen bleiben reine Beschriftung: gerechnet wird über die Schlüssel (D-09).
Was die Schulen später liefern, wird ergänzt und geht vor.

## D-56 Die Auswahl des Spiels hat recht (v0.48.0)

Auf der Schulseite wählt man den Lehrgang oben in `#education_select`. Der
Planer stellte daneben ein **zweites** Auswahlfeld — gedacht für Seiten, auf
denen der Kurs nicht erkennbar ist, gezeigt aber auch dort, wo das Spiel längst
eines hat. Es sah aus wie eine Wahl und war eine Behauptung.

Schlimmer: der Planer hörte nicht darauf, wenn oben umgestellt wurde.
`curKey()` gab den zwischengespeicherten Schlüssel zurück, und „Bedarf
anhaken" hakte den Bedarf des **vorigen** Lehrgangs an. Genau das ist das
„funktioniert nicht immer".

Jetzt liest `curKey()` zuerst `#education_select`, und ein `change`-Horcher
wirft Zwischenspeicher und Zähler weg. Das eigene Feld erscheint nur noch, wo
das Spiel keines hat.

## D-57 Ein Rollbereich, nicht sieben (v0.48.0)

Listen im Panel hatten eigene Höhen und eigenes Rollen — im Plan-Reiter drei
davon übereinander, dazu das Protokoll und der Inhalt selbst. Man rollte im
falschen Kasten und fand die Aktionsleiste nicht wieder. Jetzt rollt nur der
Inhalt; die Listen wachsen, wie sie müssen.

## D-58 „Bedarf anhaken" bekam den Lehrgang nicht (v0.48.1)

`bedarf(el, key)` verlangt zwei Angaben und gibt ohne Schlüssel `null` zurück.
`fill()` rief es mit einer auf. Damit war jeder Kandidat `null`, die Liste leer
und die Meldung lautete „bei allen sichtbaren Wachen ist der Bedarf gedeckt" —
während obendrüber hundert fehlende Personen standen.

Ein fehlendes Argument, das nichts umwarf, sondern eine plausible Lüge erzeugte.
Genau deshalb sagt die Meldung jetzt auch, **welcher** Fall vorliegt: keine
Wache sichtbar, Ausbildungsstand nicht erfaßt, oder wirklich gedeckt — mit Namen
des Lehrgangs und Zahl der geprüften Wachen.

## D-59 Durchsicht mit Werkzeug statt mit Augenmaß (v0.49.0)

D-58 — ein Aufruf mit einem Argument zu wenig — hätte kein Lesen gefunden: der
Code sah richtig aus und log nur im Ergebnis. Deshalb `pruefer.js`, das genau
diese Arten sucht:

- Aufrufe mit weniger Argumenten als Pflichtparameter
- doppelt deklarierte und nie aufgerufene Funktionen
- Speicherschlüssel, die nirgends gelesen werden
- globale Ausdrücke mit `.test()` (wandernder `lastIndex`)
- leere `catch`-Blöcke ohne Begründung
- `@version` gegen `const VERSION`

Kommentare und Zeichenketten werden vorher ausgeblendet — die erste Fassung
meldete Beispiele aus Kommentaren als Fehler.

Gefunden und bereinigt: `KEY_ANH` (seit v0.19 tot), fünf unbenutzte Variablen,
Rechnen mit Wahrheitswerten in der Fahrzeugsortierung, zwei stumme
`catch`-Blöcke. Wahlfreie Parameter (`frage`, `learnAllCourses`, `buildingList`)
haben jetzt ausgeschriebene Vorgaben — sonst sieht ein Aufruf mit einem Argument
aus wie ein vergessenes zweites, und genau das war D-58.
