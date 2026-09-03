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

## D-60 Veröffentlichung über GitHub, Aktualisierung vom Zweig `main` (v0.49.1)

`@downloadURL` und `@updateURL` fehlten — ohne sie bekommt niemand eine
Korrektur, auch der eigene Rechner nicht. Beide zeigen jetzt auf den Rohtext
von `main`:

```
https://raw.githubusercontent.com/hochhause/LSS-Scripts/main/userscripts/<datei>
```

Verworfen wurden zwei Fassungen mit mehr Sicherheit:

- **Ein Zweig `release`, in den nur Geprüftes wandert.** Sauberer, weil der
  Planer ein echtes Konto verändert und ein Fehler Credits kostet. Aber ein
  Zweig, den man von Hand nachzieht, wird vergessen — dann steht draußen eine
  Fassung, deren Fehler hier längst behoben ist. Die Regel „Ungeprüftes gehört
  nicht nach `main`" leistet dasselbe und kostet keinen zweiten Handgriff.
- **GitHub-Releases mit Marke je Fassung.** Deutlichste Versionierung, aber die
  URL im Skript müßte bei jeder Fassung mitwandern — eine weitere Stelle, die
  auseinanderlaufen kann. Genau das ist bei `@version` gegen `const VERSION`
  schon einmal passiert, weshalb `pruefer.js` es prüft.

Bleibt: **jeder Push nach `main` wird jeder Installation angeboten.** Das steht
so in `CLAUDE.md` und ist der Preis dieser Wahl.

Dazu Lizenz **GPL-3.0**: Weitergabe ja, aber Änderungen bleiben offen. Für ein
Skript, das andere an ihrem eigenen Konto arbeiten lassen, ist eine geschlossene
Abwandlung das schlechtere Ergebnis.

## D-61 Nach Zweck getrennte Ablage, Werkzeuge ohne festen Pfad (v0.49.1)

Alles lag flach in einem Verzeichnis. Getrennt nach Zweck — `userscripts/`,
`konsole/`, `werkzeuge/`, `daten/`, `Notizen/` —, weil sich die vier Arten in
der Gefahr unterscheiden: was im Browser am Konto arbeitet, was einmal per Hand
in die Konsole geht, was nur in node prüft, was nur nachgeschlagen wird.

Ordnernamen deutsch wie der Inhalt; `userscripts/` bleibt englisch, weil
Tampermonkey den Begriff selbst so führt.

`pruefer.js` und `test-planung.js` suchten den Planer unter
`/home/claude/lss/…` — einem Pfad, den es nur in der Werkstatt gab, in der sie
entstanden sind. Jetzt hängt der Pfad an `__dirname`, nicht am
Arbeitsverzeichnis, und ein Argument prüft eine andere Fassung. Am
Arbeitsverzeichnis festgemacht wäre kürzer gewesen, hätte aber jeden Aufruf aus
dem Wurzelverzeichnis ins Leere laufen lassen — und dort steht der Aufruf in
`CLAUDE.md`.

Die Tabellen in `daten/` sind **Auszüge**, nicht die Quelle. Gültig ist, was im
Userscript steht; zwei Quellen für dieselbe Zahl laufen auseinander (D-47).

## D-62 Der Abbruch muß sichtbar bleiben (v0.50.0)

`laufStoppen()` setzte `lauf = null`. Damit war die einzige Spur des Abbruchs
gelöscht: `abgebrochen()` liest `lauf?.signal.aborted` und meldete danach für
immer „läuft weiter", und `queued()` nimmt `sig = lauf?.signal` beim Aufruf ab —
also bekam jede folgende Anfrage gar kein Signal mehr mit.

Der Stoppknopf brach damit genau **eine** laufende Anfrage ab; der Lauf ging
weiter und schrieb den Rest der Wachen durch. Bei einem Haken-Lauf ist das
besonders unangenehm: der abgebrochene Lesevorgang landet im stummen `catch`,
`fertig` bleibt leer, und das Umbenennen nimmt allen übrigen Fahrzeugen den
grünen Punkt wieder ab. Dazu setzte `laufStoppen` auch noch `S.busy = false`,
das Panel sah also untätig aus, während es weiterschrieb.

Der Regler bleibt jetzt stehen. Ersetzt wird er in `laufStarten()` — dort stand
schon immer `lauf?.abort()` vor der Neuanlage, ein zweites Nullen war nie nötig.

Verworfen: ein eigenes Abbruch-Flag neben dem Controller. Zwei Quellen für
dieselbe Aussage sind genau die Falle, vor der CLAUDE.md warnt; der Controller
weiß es bereits.

## D-63 Die Vorschau darf sich nichts vormerken (v0.50.0)

`setzeFms()` rief `merkeWarte()` vor der `dry`-Sperre und `loescheWarte()`
dahinter. Eine Vorschau schrieb also in `lssplaner.fmsWarte` und löschte daraus.

Zusammen mit dem Nachhol-Durchgang am Anfang von `assignStaff()`, der über
**alle** Vormerkungen lief statt über die gewählten Wachen, ergab das den
schlimmsten Fall, den dieses Werkzeug kennt: eine Vorschau an Wache A merkt
Umschaltungen vor, ein scharfer Lauf an Wache B holt sie nach — an einer Wache,
die der Mensch nie angehakt hat.

Beides geändert: Vormerken und Löschen nur noch im scharfen Lauf, und der
Nachhol-Durchgang bleibt in der Auswahl. Die Vorschau sagt jetzt „wäre
vorgemerkt" statt „vorgemerkt", damit der Unterschied auch im Protokoll steht.

## D-64 „SCHARF" muß sofort erscheinen (v0.50.0)

Der Rahmen und die Marke „SCHARF" wurden nur in `render()` berechnet. Das
Häkchen „Nur Vorschau" schrieb aber bloß `S.opts.dry` und zeichnete nicht neu —
der Nachbar daneben („Grüne freigeben") ruft `render()` auf, dieses nicht.

Damit war der übliche Ablauf genau der, den D-35 verhindern sollte: Reiter
wählen, Häkchen entfernen, Knopf drücken. Rahmen grau, keine Marke, Credits weg.
Sichtbar wurde es nur, wenn zufällig etwas anderes ein `render()` auslöste.

`scharfZeigen()` ist jetzt eine eigene Funktion, die beide Wege aufrufen. Sie
bleibt eine `function`-Deklaration, damit `pruefer.js` sie sieht (D-59).

Nicht geändert, aber notiert: der Knopf trägt in beiden Fassungen dieselbe
Aufschrift. Das gehört zur Oberflächenarbeit, nicht zu dieser Sperre.

## D-65 Einsatzbereitschaft wird gelesen, nicht geraten (v0.50.0)

`slimBuilding` warf `enabled` weg. `b.enabled` war damit nach jedem Laden
`undefined`, und `undefined !== soll` ist immer wahr — `pflegeAusbauten` schickte
also bei **jedem** scharfen Personallauf einen Umschalter an **jede** Wache mit
Fahrzeugen im Grundtopf.

`/buildings/<id>/active` kennt kein Ziel, es kippt nur — anders als
`/set_fms/<ziel>` drei Zeilen weiter. Die Hälfte dieser Anfragen nahm also eine
einsatzbereite Wache aus dem Dienst, während das Protokoll „einsatzbereit"
meldete. Danach schrieb Zeile 1610 den geglaubten Wert lokal fest, und beim
nächsten Bestandsladen fing es von vorn an.

Am lebenden Spiel nachgesehen: `/api/buildings` **liefert** `enabled` mit
`true`/`false`. Das Feld wurde nur beim Abmagern verworfen. Es steht jetzt in
`slimBuilding`.

Dazu eine Sperre: ist der Ist-Zustand kein Wahrheitswert, wird **nicht**
geschaltet, sondern gemeldet. Bei einem Endpunkt, der kippt statt zu setzen,
trifft eine Vermutung in der Hälfte der Fälle das Gegenteil — und niemand merkt
es, weil danach der geglaubte Wert dasteht.

## D-66 Belegte Bauplätze werden nicht ein zweites Mal gekauft (v0.50.0)

Zwei Fehler in `analyseIntern`, beide kosten Credits und sind nicht rückholbar.

Die Liste hieß `free` und war es nicht: sie enthielt **jede** Katalogstelle mit
der gesuchten Bezeichnung, auch längst bebaute. `buildExtensions` nimmt davon
die ersten `n` — also wurde auf besetzte Plätze bestellt. Bei einer Bezeichnung
auf den Plätzen 4-7, von denen 4 und 5 stehen, ging die Bestellung an 4 und 5.

Und gerechnet wurde gegen `builtExtensions`, das noch im Bau befindliche
Ausbauten überspringt. Das ist für die Stellplatzzahl richtig — ein unfertiger
Ausbau bringt keine Plätze — für die **Bestellung** aber falsch: eine Stunde
später wurde derselbe Ausbau noch einmal gekauft.

Deshalb jetzt zwei Sichten statt eines Schalters: `builtExtensions` bleibt, wie
es ist, und `belegteAusbauten` zählt alles, was einen Platz besetzt — gebaut, im
Bau oder abgeschaltet. Gefiltert wird nur dort, wo eine Bezeichnung **mehrere
eigene** Katalogstellen hat; mehrfach baubare Ausbauten wie die „Zelle" teilen
sich eine einzige Nummer, dort bliebe sonst keine Stelle übrig.

Bewußt **nicht** mitgeändert: `Math.min(e.n, e.ids.length)` in
`buildExtensions` deckelt mehrfach baubare Ausbauten weiterhin auf einen Kauf je
Lauf. Zehn Zellen brauchen zehn Läufe. Das ist lästig, aber es kauft nichts
Falsches — und es gehört in dieselbe Arbeit wie die Oberfläche, nicht in eine
Sperre.

## D-67 Der Haken prüft beide Anforderungskanäle (v0.50.0)

`anforderung()` liefert zwei getrennte Forderungen: `alle` verlangt einen
Lehrgang von **jedem** Sitz, `mind` verlangt eine **Anzahl** je Lehrgang.
`hakenAbgleichen` prüfte nur `alle` und zählte danach Köpfe gegen
`mindestBedarf`.

Ein Dekon-P kam damit mit einer ungelernten Person auf den Haken: `alle` ist
dort leer, ein Kopf reicht für `min 1`. `planeWache` verlangt für dasselbe
Fahrzeug 6× `dekon_p` — zwei Antworten auf dieselbe Frage, und die falsche
gewann, weil sie den Punkt setzt. Über `geschuetzt()` fror sie den falschen
Zustand dann fest: genau der Lauf, der die Besatzung richten würde, meldete
„grüne Fahrzeuge unangetastet".

Neu ist `fehltAn(v, besatzung)`. Es prüft Kopfzahl, `alle` und `mind` in dieser
Reihenfolge und liefert **den Grund als Text** — dieselbe Funktion beantwortet
also „hat es den Haken verdient?" und „warum nicht?". Zwei Quellen für eine
Aussage können damit nicht wieder auseinanderlaufen, und die Meldung nennt jetzt
den fehlenden Lehrgang statt nur eine Kopfzahl.

`fehltAn` liegt innerhalb der dritten Schnittmarke, ist also von
`test-planung.js` erreichbar. Probe 22 deckt es ab; gegen die alte Fassung
(mind-Kanal ignoriert) fallen davon drei Proben um.

## D-68 Drei Adressen am lebenden Spiel nachgemessen (v0.50.0)

Alle drei Fehler waren aus der Quelle nicht zu sehen: der Code war schlüssig,
nur die Seite dahinter eine andere. Nachgesehen wurde mit einem angemeldeten
Browser, rein lesend.

**Der Ausbaukatalog lag nie am richtigen Ort.**
`ausbauKatalogLesen(b)` holte `/buildings/<wache>/leitstelle-extensions`. Dieser
Pfad antwortet auf einer Wache mit **HTTP 500**; er gehört der **Leitstelle**.
Dort steht er dafür für alle eigenen Gebäude auf einmal — 890 Zeilen, die
Bauplatznummer am Verweis, die Gebäudeart über die Gebäude-Id im selben
Verweis. Der Katalog konnte also nie gelesen werden, was erklärt, warum der
Reiter „Ausbauten" hinter seiner Übernahmeseite feststeckte.

Aus N vergeblichen Abrufen wird damit **ein** Abruf, der alle Gebäudearten
trägt. `leitstelle_building_id` bleibt jetzt in `slimBuilding`, sonst ist die
Adresse nicht bildbar.

**Die Kaufliste steht nicht auf der Wachenseite.**
`kaufbareLesen` suchte `/vehicle/<id>/<typ>/credits` in `/buildings/<id>`.
Gemessen: dort **null** Treffer, auf `/buildings/<id>/vehicles/new` **99**. Der
Abruf warf also immer „keine Kaufliste gefunden" — deshalb blieb
`lssplaner.kaufbar` stets leer und die Ersatzkette in `kaufbareTypen` trug die
ganze Last.

**Die Anker des Wachen-Hinweises gibt es nicht.**
Von `#building_panel`, `.col-md-12`, `#content`, `.content` existiert **keiner**;
die Seite hängt alles unter `#iframe-inside-container`. Dazu ein zweiter Fehler
in derselben Zeile: ein Selektor mit Komma nimmt nicht den erstgenannten
Treffer, sondern den ersten in **Dokumentreihenfolge** — die gedachte Rangfolge
war wirkungslos, und `.col-md-12` hätte fast jede Bootstrap-Spalte gewonnen.
Jetzt wird der Reihe nach probiert, und wenn keiner paßt, wird das gesagt,
statt stumm zurückzukehren.

## D-69 Was die Messung NICHT bestätigt hat (v0.50.0)

Der Vollständigkeit halber, weil ein zurückgezogener Befund mehr wert ist als
ein stillschweigend fallengelassener:

- **Das Spiel setzt weggelassene Formularfelder nicht zurück.** Zwei
  Leerlauf-Schreibversuche (nur `building[name]`, nur `vehicle[caption]`) ließen
  `personal_count_target`, `leitstelle_building_id`, `personal_max` und die
  Dienstzeiten unberührt. Der Kommentar bei `umbenennenFahrzeug`, das Formular
  müsse vollständig zurückgeschickt werden, ist damit **falsch** — der zweite
  Abruf je Umbenennung kauft nichts. Nicht in dieser Runde geändert, weil er
  nichts kaputtmacht; gehört in die Aufräumarbeit.
- **`lehrgaenge()` liest richtig.** Die Übersicht `/schoolings` hat zwei
  Tabellen: `#schooling_own_table` (laufende, Spalten Lehrgang · Spätestens
  Fertig · Ausführer) und `#schooling_opened_table` (offene, mit **Freie
  Plätze** als zweiter Spalte). Die Funktion prüft `t.id === 'schooling_opened_table'`
  und rechnet nur dort — genau richtig. Eine erste Messung hatte die falsche
  Tabelle erwischt und einen Fehler gemeldet, den es nicht gibt.
- **`readRoster` stimmt in jedem Selektor**, ebenso die Kauf-URL (D-37 damit
  geklärt) und die Behandlung von `building[name]` (D-20 bestätigt).

## D-70 „Bedarf anhaken" rechnet über den geprüften Kern (v0.50.0)

`needFor()` war die dritte Fassung derselben Formel und die einzige ohne
`anhaengerZaehlt`. Sie zählte die Besatzung eines Anhängers doppelt — einmal am
Anhänger, einmal am Zugfahrzeug, das dieselben Leute fährt.

Nachgerechnet über alle 89 Kurs/Profil-Paare des eingebauten Wunschbilds weichen
genau zwei ab, beide beim `gw_wasserrettung`:

| Gebäudeart | needFor max | courseNeed max | needFor min | courseNeed min |
|---|---|---|---|---|
| 15 Wasserrettung | 20 | 12 | 10 | **2** |
| 12 SEG | 10 | 6 | 5 | **1** |

Die `min`-Spalte ist die teure: der erste Durchgang von `fill()` rechnet über
`sollMin` und buchte an einer Wasserrettungswache also das **Fünffache**. Das
Konto hat zehn solche Wachen.

`needFor` fragt jetzt `bedarfDerWache` — dieselbe Funktion, die `test-planung.js`
in Probe 17 auf 12 festnagelt. Mitgenommen: `T.target` geht über `T.profiles`
und damit über NICHT_PLANEN (D-40), und es liest `S.modell` frisch statt der
Kopie, die beim Seitenaufbau gezogen wurde und nie nachzog.

## D-71 Nicht gemessen heißt nicht gebucht (v0.50.0)

`offen === null` heißt „Ausbildungsstand nie erfaßt". `fill()` nahm solche
Wachen als Kandidaten und setzte über `offen ?? soll` **das volle Ziel** an, als
wäre dort niemand ausgebildet. Für einen frischen Stand ist das der Normalfall,
und die Beschriftung sagte dazu nur „Stand unbekannt".

Sasha, 27.08., auf die Frage: *erst erfassen*. Diese Wachen werden jetzt
übersprungen, gezählt und benannt.

Zwei weitere Auskünfte aus derselben Runde sind eingebaut:

- **Ausgebildete dürfen in einen weiteren Lehrgang, aber nur bei mindestens
  50 % Überdeckung** ihres bisherigen Kurses an dieser Wache — gemessen an dem,
  was die Fahrzeuge brauchen, die ihn fordern. Sonst wird übersprungen und der
  Grund genannt. Ungelernte gehen weiterhin zuerst (D-07).
- **Der grüne Punkt schützt auch gegen Ausbildung.** Ein Lehrgang zieht die
  Person für Tage vom Fahrzeug, und D-27 sagt, Grünes wird nicht angetastet.
  Von der Lehrgangsseite aus ist allerdings nicht zu sehen, WER auf welchem
  Fahrzeug sitzt — die Ankreuzfelder nennen nur die Wache. Entschieden wird
  deshalb nur der eindeutige Fall: trägt eine Wache **überall** den Punkt, wird
  sie übergangen. Die gemischte Wache bleibt offen und steht in
  `NAECHSTER_SCHRITT.md`; sie braucht die Zuweisungsseite.

## D-72 Was die Lehrgangsseite wirklich hergibt (v0.50.0)

Vier Fehler, die erst am geöffneten Spiel sichtbar wurden — alle in
`Notizen/SPIELSEITEN.md` belegt.

**Der Filter ist nicht der des Spiels.** Auf `/schoolings/<id>` gibt es gar kein
Suchfeld; gefiltert wird vom LSS-Manager, Klasse
`lssmv4-buildingListFilter-filter-hidden`. `sichtbar()` prüfte drei geratene
Namen, von denen keiner vorkommt — eine im Manager ausgeblendete Wache wurde
also mitangehakt.

**Ungelernt war nicht erkennbar.** Die Trennung lief über
`#school_personal_education_<id>`; das Element steht da, ist aber **leer**, also
galten alle als ungelernt und die Reihenfolge aus D-07 war wirkungslos. Die
Ankreuzfelder tragen jeden Lehrgangsschlüssel selbst als Wahrheitswert — daraus
ergibt sich der Stand ohne Umweg, und daraus rechnet auch die 50-%-Regel.

**Zehn erfundene Plätze.** Fehlten Zähler und Wachenliste, riet `freiePlaetze()`
„10 je Klassenraum". Genau so sieht die Seite eines **laufenden** Lehrgangs aus:
der Knopf meldete zehn freie Plätze für einen Kurs, der niemanden mehr aufnimmt,
und schob es anschließend auf den Filter des Spiels. Jetzt gibt die Funktion
`null` zurück, und `fill()` nennt den wahren Grund.

**Die Schulart war fast nie bekannt.** `S.byId` wird aus `/api/buildings`
gebaut, enthält also nur eigene Gebäude — von 28 Schulen dieses Kontos gehören
27 dem Verband. `schulTyp` war damit auf so gut wie jeder Schulseite `null` und
die Zweigtrennung aus D-48 abgeschaltet: der Fall mit den 225
Verpflegungshelfern, dauerhaft. Auf `/schoolings/<id>` steht die Schule
überhaupt nicht im Pfad.

Beides über `/api/alliance_buildings` gelöst: jedes Gebäude nennt unter
`schoolings[]` die Kennungen seiner laufenden Kurse, darüber ist die Schule zu
einem Lehrgang zu finden. Der Abruf läuft nach und zeichnet einmal neu — bis
dahin wird ungefiltert gerechnet. Lieber kurz ungefiltert als dauerhaft falsch.

Dazu die Ersatztabelle `SCHULE_NOTFALLS`: die THW-Schule ist Gebäudeart **10**
und fehlte ganz, die Wasserrettung (15) stand in keiner Liste, obwohl
`gw_wasserrettung` nachweislich an der Rettungsschule läuft. Beides nachgetragen.

## D-73 Die vier Seenotrettungs-Lehrgänge (v0.50.0)

`NAECHSTER_SCHRITT.md` führte vier fehlende Klartextnamen. Aus dem Kurskatalog
des Spiels (Wiki, gegengeprüft mit der Übersetzungsdatei des LSS-Managers):

| Schlüssel | Kursname | Name in der Personalliste |
|---|---|---|
| `coastal_rescue` | Seenotretter | Seenotretter |
| `coastal_helicopter` | Hubschrauberpilot (Seenotrettung) | dito |
| `coastal_helicopter_lift` | Windenoperator | dito |
| `emergency_paramedic_water_rescue` | Wasserrettungsausbildung für Notfallsanitäter | **Notfallsanitäter mit Wasserrettungsausbildung** |

Zwei Dinge, die in `CLAUDE.md` nachgezogen wurden: „Windenoperator" heißt jetzt
**drei** Schlüssel, nicht zwei — `coastal_helicopter_lift` kommt dazu. Und der
Kursname der Schule ist nicht der Name in der Personalliste; beim letzten der
vier stehen die Wörter sogar in umgekehrter Reihenfolge. Gerechnet wird ohnehin
über Schlüssel (D-09), die Namen sind Beschriftung.

## D-74 Vor dem Ausliefern im Spiel angesehen (v0.50.0)

`CLAUDE.md` verlangt es, und bei 526 geänderten Zeilen im Planer wäre alles
andere leichtsinnig: die Oberfläche hat keine Testabdeckung, und `main` wird
jeder Installation als Aktualisierung angeboten.

Angesehen wurde mit einem angemeldeten Browser, das Skript wie von Tampermonkey
eingespielt. Schreibende Anfragen waren dabei auf Netzebene **abgeschaltet** —
ein Rauchtest darf das Konto nicht anfassen, auch nicht versehentlich.

Ergebnis (`Notizen/rauchtest-0.50.0.txt`):

- Panel zeichnet, alle sechs Gruppen und elf Reiter mit Inhalt, kein leerer Rumpf.
- Bestand lädt in ~12 s über drei Abrufe; die Zeiger-Blätterung (`after=…`)
  greift, danach `/api/alliance_buildings` für die Schulnamen.
- **Häkchen „Nur Vorschau" abgewählt → Rahmen scharf, Marke sichtbar; wieder
  angehakt → zurück.** Damit ist D-64 im Spiel bestätigt, nicht nur im Code.
- Ein Lauf „Personal zuweisen" mit Vorschau: 112 Aktionen angekündigt, 16
  Fahrzeuge wegen des grünen Punktes übergangen.
- **Null Schreibversuche, null Skriptfehler.** Die Vorschau schreibt also
  wirklich nichts mehr — D-63 im Spiel bestätigt.

Nebenbei aufgefallen und mitgenommen: die Schutzmeldung schickte den Menschen
„in die Kopfzeile", wo der Schalter nie war. Er sitzt unten neben „Nur
Vorschau". Das ist die Meldung, die genau dann erscheint, wenn ein Lauf weniger
getan hat als erwartet — die falsche Wegbeschreibung darin ist teurer als sie
aussieht.

Nicht abgedeckt und weiterhin offen: der scharfe Lauf selbst, das eigene Fenster
(⇱), der Hinweis auf der Wachenseite und die Lehrgangsseite im Lightbox-Rahmen.
Die stehen in `NAECHSTER_SCHRITT.md`.

## D-75 SEG: Anh TeSi gehört dazu, also 2/2/2 (v0.51.0)

Der Anh TeSi galt im Wunschbild als entbehrlich und fehlte. Er wird aber
getrennt angefordert — GW TeSi, MTW TeSi und Anh TeSi braucht es in gleicher
Zahl.

Die SEG war dabei schon voll: 28 Stellplätze bei vollem Ausbau
(1 fest + 1+4+3+2+1+10+6 aus den sieben Ausbauten), und der Plan füllte sie
genau aus. Am Spiel nachgesehen: alle drei SEG-Wachen haben 7 von 7 Ausbauten,
die Zahl stimmt also.

Drei Wege standen zur Wahl; entschieden wurde für **2/2/2**, weil dabei kein
anderes Fahrzeug weichen muß:

| | Stellplätze | TeSi-Lehrgang min/max |
|---|---|---|
| vorher 3/3/0 | 28/28 | 6 / 36 |
| **jetzt 2/2/2** | **28/28** | **4 / 24** |
| 3/3/3 | 31/28 ✗ | 6 / 36 |

Bemerkenswert und der Grund, warum der Anhänger überhaupt hineinpaßt: er kostet
**keine zusätzliche Ausbildung**. `anhaengerZaehlt` (D-19) deckelt seine
Anforderung auf die Sitze des Zugfahrzeugs — seine zwei Leute sind die Besatzung
des GW oder MTW, nicht zusätzliche Köpfe. Zugfahrzeuge gibt es mit 2+2 genug für
zwei Anhänger.

Geändert wurde `MODELL_STANDARD` im Userscript, der Auszug in
`daten/lss-modell-standard.json` ist nachgezogen.

**Wichtig für den Betrieb:** das ist die *eingebaute Vorlage*. Wer bereits ein
eigenes Wunschbild gespeichert hat, merkt davon nichts — sein Plan liegt in
`lssplaner.modell`. Übernommen wird die neue Fassung im Reiter „Plan" über
„Standard für SEG", und das überschreibt die eigenen Änderungen an dieser
Gebäudeart.

## D-76 Der Punkt der Wache folgt den Punkten ihrer Fahrzeuge (v0.51.0)

Bisher bekam eine Wache den grünen Punkt erst, wenn **alles** stimmte: Ausbauten
gebaut, Fahrzeuge gekauft, nichts überzählig, niemand unterbesetzt, jeder
Anhänger gekoppelt, jede Ausbildung erledigt. Und ohne erfaßten
Ausbildungsstand gab es gar kein Urteil — die Wache wurde übersprungen.

Neu, auf Wunsch: **eine Wache trägt den Punkt, wenn jedes ihrer Fahrzeuge ihn
trägt.** Sonst nichts.

Das hat drei Folgen, die alle gewollt sind:

- Der Punkt sagt jetzt dasselbe wie die Punkte darunter — er ist ihre Summe,
  keine zweite, strengere Rechnung. Zwei Antworten auf dieselbe Frage können
  damit nicht mehr auseinanderlaufen.
- Personal- und Lehrgangszahlen entscheiden **nicht mehr** über den Punkt.
  Damit fällt auch die Sperre „nicht beurteilbar, weil der Ausbildungsstand
  fehlt": das Urteil braucht sie nicht mehr. Was an der Wache sonst noch
  aussteht, steht weiterhin in der Meldung — es entscheidet nur nicht mehr.
- Fehlende Fahrzeuge und ungebaute Ausbauten hindern den Punkt nicht. Eine
  halb ausgebaute Wache, deren vorhandene Fahrzeuge alle besetzt sind, ist
  jetzt grün. Das ist der Preis der Vereinfachung und war der Wunsch.

Umgesetzt in **einer** Funktion, `stationsPunkt(b, frisch)`, die sowohl
`fortschritt()` als auch der Haken-Lauf benutzt. Gelesen wird am Namen der
Fahrzeuge, nicht aus einer zweiten Rechnung. Der Haken-Lauf reicht zusätzlich
die gerade erst ermittelten Punkte herein, weil sie in der Vorschau noch nicht
im Namen stehen — ohne das urteilte die Vorschau über den Stand von vorher.

Zwei Feinheiten, absichtlich so:
- `mineOf` statt `echteVon`: ein eben gekauftes, noch vorgemerktes Fahrzeug
  trägt keinen Punkt und soll die Wache nicht fertig aussehen lassen.
- Eine Wache **ohne** Fahrzeuge ist nicht fertig, sondern leer. Ohne diese
  Ausnahme wäre die Aussage „alle Fahrzeuge tragen den Punkt" leer wahr.

`offen` in `fortschritt()` bleibt unverändert und zählt weiter alles auf — davon
leben die Listen, die Übersicht und der Hinweis auf der Wachenseite.

### Wirkung am eigenen Konto, gemessen (27.08.)

103 Gebäude: 9 ohne Fahrzeuge (nach neuer Regel nie fertig), 47 mit lauter
grünen Fahrzeugen (bekommen den Punkt), 47 nur teilweise grün. Den Punkt tragen
heute 49 Wachen.

Neu grün werden **SEG 01** (28/28 Fahrzeuge) und **PolHub** (8/8) — beide waren
bisher wegen offener Ausbauten oder Ausbildungen zurückgehalten. Umgekehrt
erfüllen zwei Wachen mit Punkt die Regel nicht mehr; sie behalten ihn trotzdem,
weil `geschuetzt()` das Wegnehmen sperrt, solange „Grüne freigeben" nicht
angehakt ist (D-27). Das ist gewollt: den Punkt nimmt der Mensch weg, nicht der
Lauf nebenbei.

Im Vorschaulauf über 94 Wachen nachgesehen: die Meldung nennt jetzt den neuen
Grund — „Feuer 11: kein Punkt — 6 von 20 Fahrzeugen ohne Punkt (außerdem offen:
30 Fahrzeuge fehlen, 6 überzählig, 22 Ausbildungen)". Null Schreibversuche,
null Skriptfehler.

## D-77 Die eingebaute Vorlage IST eine gültige Einstellung (v0.51.1)

Rücknahme einer Änderung aus derselben Sitzung, in der sie entstand.

In `fill()` stand eine Prüfung `Object.keys(modell).length` mit dem Hinweis
„Kein Wunschbild vorhanden". Sie war **tot**: der Getter `S.modell` fällt auf
`MODELL_STANDARD` zurück, das Ergebnis ist also nie leer. Beim Aufräumen wurde
daraus eine **erreichbare** Prüfung — „wurde je ein eigenes Wunschbild
gespeichert?" —, mit der Begründung, sonst werde gegen fremde Vorgaben gebucht.

Das war falsch gedacht. Es gibt drei normale Arbeitsweisen, und zwei davon legen
nie ein „eigenes" Wunschbild an:

1. die eingebaute Vorlage unverändert benutzen,
2. sie an Ort und Stelle anpassen — der Plan-Editor schreibt zwar in
   `lssplaner.modell`, aber wer nichts anfaßt, hat dort nichts stehen,
3. ein eigenes Wunschbild aufbauen.

Die Prüfung sperrte die ersten beiden aus, und zwar hart: „Bedarf anhaken" tat
gar nichts mehr und meldete stattdessen, es fehle etwas, das gar nicht fehlt.
Dazu ein roter Kasten in der Werkzeugleiste, der auf jeder Schulseite behauptete,
die Einstellung sei unvollständig.

Beides ersatzlos entfernt. Es gibt hier nichts zu prüfen: ein Ziel liegt immer
vor, entweder das gespeicherte oder die Vorlage. Welches von beiden gilt, ist
für die Rechnung ohne Belang.

Die Lehre, weil sie sich wiederholen könnte: eine tote Prüfung ist nicht
automatisch eine, die man beleben sollte. Erst prüfen, ob die Bedingung
überhaupt einen Fehler beschreibt — hier beschrieb sie einen völlig normalen
Zustand.

## D-78 Der importierte Plan ist weg (v0.52.0)

Seit D-51 bis D-55 stammt alles, was der Plan einmal mitbrachte, aus dem Skript
oder aus dem Spiel. Übrig waren vier Ersatzgriffe — und jeder hatte längst eine
bessere Quelle:

| las aus dem Plan | Ersatz | geprüft |
|---|---|---|
| `vehicleTypes` | `PB` | `PB` kennt 186 Typen; der Bestand benutzt 84, **keinen unbekannten** |
| `buildingTypes` | `GEBAEUDE_NAMEN` | gedeckt |
| `layouts` | `LAYOUTS_STANDARD` | gedeckt |
| `extensionCatalog` | `extCatVon` + `ausbauKatalogLesen` | seit D-68 überhaupt erst benutzbar |

Der Rest war Oberfläche: das Einfügefeld, „Plan ersetzen", der Speicher-Horcher
und die Übernahmeseite des Ausbaureiters. Zusammen 102 Zeilen weg, 27 dazu.

Mitgegangen ist `geraten`. D-01 hatte die Notquelle mit „sichtbar an
`geraten: true`, deshalb tragbar" gerechtfertigt — das Feld wurde gesetzt und
**nie gelesen**, die Rechtfertigung war also nie eingelöst. Jetzt gibt `vehMeta`
für einen unbekannten Typ schlicht `null` zurück, und die Rechnungen übergehen
ihn; Probe 7 deckt genau das ab. Ein neuer Fahrzeugtyp wird in `PB` nachgetragen,
nicht über einen Plan hereingereicht.

**Nebenwirkung, und der eigentliche Anlaß:** auf `/schoolings` hing der Knopf
„Bestand jetzt laden" an `S.plan`. Ausgerechnet der Knopf, den nur jemand ohne
geladenen Bestand braucht, erschien also nur für Leute, die einen Plan
importiert hatten — genau verkehrt herum. Ohne Bestand bleibt die
Bedarfsspalte leer und „Alle füllen" gesperrt; für einen Mitspieler ohne Plan
sah die ganze Übersicht kaputt aus. Mit dem Plan fällt die Bedingung weg.

Ein Wort zur Sprache: „Plan" meinte in diesem Skript drei Dinge — den
importierten Plan, das Wunschbild und die Personalverteilung einer Wache. Eines
davon ist jetzt fort, und die Texte der Oberfläche („Fahrzeuge, die gegenüber
dem Plan fehlen") meinen eindeutig das Wunschbild im Reiter „Plan".

## D-79 Fünf Anhänger bekommen ihre Einsatzstellen-Stärke (v0.52.0)

`sitzeFuerKurs` gibt für einen Anhänger `meta.est` zurück — fehlt das Feld, ist
der Bedarf **null**, für immer. Fünf Anhänger im Wunschbild forderten einen
Lehrgang, nannten aber keine Zahl:

| Typ | Fahrzeug | Lehrgang | est | Quelle |
|---|---|---|---|---|
| 92 | Anh Hund | `thw_rescue_dogs` | 4 | Wiki: „für den MTW-O braucht man vier Personen mit Fachgruppe Rettungshundeführer" |
| 96 | Außenlastbehälter | `police_firefighting` | 1 | Sasha |
| 112 | NEA200 (THW) | `thw_energy_supply` | 1 | Sasha |
| 113 | NEA200 (Feuerwehr) | `energy_supply` | 1 | Sasha |
| 180 | AB-NEA200 | `energy_supply` | 1 | Sasha („wie das normale NEA") |

Bei zweien wäre die Zahl ohnehin folgenlos geblieben — `Anh SwPu` und `Anh 7`
werden von Fahrzeugen gezogen, die denselben Kurs schon fordern, also greift
D-19 und der Anhänger zählt nicht doppelt. Bei den fünf oben fordert **kein**
zugelassenes Zugfahrzeug den Kurs; ihr Bedarf ging deshalb verloren.

Wirkung: die Kursauswahl beschriftet jetzt **59 von 60** Lehrgängen statt 55.
`thw_rescue_dogs` 8, `energy_supply` 2, `police_firefighting` 1,
`thw_energy_supply` 1.

Ohne Bedarf bleibt allein `police_helicopter_lift` — dafür müßte
`156 Polizeihubschrauber mit verbauter Winde` in einem Profil stehen. Das ist
eine Entscheidung über das Wunschbild, keine Datenlücke.

Nicht eingetragen: `est` ist **nicht** die Sitzzahl des Zugfahrzeugs. Der
AB-Dekon-P steht mit 6 auf einem WLF mit drei Plätzen, der Anh MzB mit 4 auf
einem Zweisitzer. Die Zahl ist eine Spielregel und wird erfragt, nicht
hergeleitet.

## D-80 „Nicht erfaßt" ist eine Angabe, kein Loch (v0.52.0)

Sechs Anhänger fordern einen Lehrgang, ohne die Einsatzstellen-Stärke zu nennen.
Fünf davon sind folgenlos — ihr Zugfahrzeug verlangt denselben Kurs, also greift
D-19 und der Anhänger zählt ohnehin nicht mit. Einer verliert wirklich Bedarf:
`155 Anh Höhenrettung (Bergrettung)` mit `mountain_height_rescue`, gezogen von
Fahrzeugen, die den Kurs nicht fordern.

Alle sechs stehen jetzt auf `est: null`. Das heißt ausdrücklich **nachgesehen,
Spielregel nicht bekannt** — im Unterschied zum fehlenden Feld, das heißt
*niemand hat hingesehen*.

Warum `null` und nicht der Text „not tracked", wie zuerst gedacht: `est` geht
direkt in eine Multiplikation. `"not tracked" * 2` ergibt `NaN`, und ein NaN
wandert unbemerkt durch jede Summe bis in eine Kaufzahl. Genau diese Art von
still falscher Zahl räumen wir gerade aus dem Skript; sie zur Kennzeichnung
einer Lücke einzuführen wäre widersinnig. `null` rechnet wie 0 und ist im
Klartext trotzdem vom Weggelassenen zu unterscheiden.

`pruefer.js` hat dafür eine neue Prüfung. Sie meldet **nur**, was wirklich
Bedarf verliert, und unterscheidet dabei:

- Feld fehlt ganz → **Fund**, jemand muß hinsehen;
- `est: null` → aufgezählt, aber kein Fund;
- Zugfahrzeug deckt den Kurs → gar nicht erwähnt.

So bleibt die Lücke sichtbar, ohne daß die Prüfung dauerhaft meckert — eine
Prüfung, die niemand schließen kann, wird nach kurzer Zeit überlesen, und dann
ist sie schlimmer als keine.

## D-81 Der Sitzplan wird mitgeführt, nicht einmal abgelesen (v0.53.0)

Sasha, aus dem Spiel: „einige meiner Fahrzeuge haben niemanden zugewiesen oder
die falschen." Das ist genau die Vorhersage dieses Fehlers.

`assignStaff` baute `istAuf` **einmal** aus dem Roster und führte es nie nach;
`p.assignedTo` blieb ebenfalls auf dem Stand des Lesens. `zuweisungDo` ist aber
ein **Umschalter** (`PROJECT_CONTEXT.md:184`), und die Ausführung lief in der
Reihenfolge des Bestands — die mit der Reihenfolge des Plans nichts zu tun hat.

Person P sitzt auf A, der Plan will sie auf B:

- **B zuerst:** P von A lösen, P auf B setzen — richtig. Dann kommt A an die
  Reihe, dessen `ist`-Liste P **immer noch** enthält, findet P nicht im `soll`
  und schickt ein weiteres `zuweisungDo` — der Umschalter zieht P von B zurück
  auf A. **B bleibt leer**, das Protokoll behauptet „P → B", und der nächste
  Lauf fängt von vorn an.
- **A zuerst:** der Endzustand stimmt, kostet aber eine dritte Anfrage und
  führt durch einen falschen Zwischenzustand.

Behoben mit einem lebenden Sitzplan. `sitzplanSchritte(personen, zuweisung,
fahrzeuge, lahmIds)` rechnet die Schrittfolge aus und führt dabei mit, wo jede
Person nach jedem Schritt sitzt. `ist` ergibt sich daraus, nicht mehr aus dem
Roster. Geschlüsselt wird über die Personen-Id, weil Roster und Plan
verschiedene Kopien derselben Person halten.

Die Funktion ist **rein** und liegt innerhalb der dritten Schnittmarke, ist also
von `test-planung.js` erreichbar — der Fehler hat vier Jahre überlebt, weil
diese zwanzig Zeilen die einzigen im Personalweg ohne Abdeckung waren. Probe 23
spielt die Schritte mit echter Umschalt-Wirkung nach und prüft den
**Endzustand**, nicht die Schrittfolge. Gegen die alte Fassung fallen drei ihrer
acht Proben um, darunter „Umzug A→B, B vor A".

Zwei Kleinigkeiten sind mitgegangen: die Schleife prüft jetzt `abgebrochen()`
zwischen den Schritten — vorher liefen die Zuweisungen einer Wache ohne
Haltepunkt durch —, und die Warnung „mehr Personen als Sitze" wird einmal vorab
aus dem gelesenen Stand gebildet statt aus einer Liste, die sich unterwegs
ändert.


## D-82 — „Zuweisungen lösen" verschont grüne Fahrzeuge (v0.54.0)

Sasha will Wache für Wache vorgehen: fertig bauen, leeren, sauber neu zuweisen,
grün markieren. Genau in diesem Ablauf war `zuweisungenLoeschen` eine Falle. Sie
war die **einzige** Schreibstelle im Skript, die `geschuetzt()` nicht fragte.

Warum das mehr ist als eine Unsauberkeit: `planeWache` besetzt ein grünes
Fahrzeug nicht neu, sondern **friert** seine Besatzung ein (`fest`) und läßt
danach nur noch den Auffüll-Durchgang darüber laufen — und der bedient sich
ausschließlich aus Spalten, die nichts kosten. Steht nach dem Leeren niemand
mehr darauf, friert der Planer also die **leere** Besatzung ein. Ein grünes
Fahrzeug mit Fachkraftbedarf kommt danach leer zurück, und der Haken, der es
schützen sollte, hat es leergeräumt. Wer den Ablauf ausführt, um Gewißheit zu
gewinnen, bekommt das Gegenteil.

Geschützt wird auf beiden Ebenen — grüne Wache: gar nichts, grünes Fahrzeug:
übersprungen und mitgezählt. `„Grüne freigeben"` hebt beides auf, wie überall
sonst. Damit gilt jetzt ausnahmslos, was oben bei `geschuetzt` steht: kein
Personal abziehen.

**Verworfen:** einen Neuaufbau-Haken in den Personallauf einbauen (erst alles
lösen, dann setzen). Er hätte dieselbe Falle nur an eine zweite Stelle getragen,
und er wird nicht gebraucht — der Abgleich läuft seit D-81 von selbst auf den
Sollzustand zu. Wer trotzdem von Null anfangen will, hat mit „Zuweisungen lösen"
den Knopf dafür, mit Rückfrage und auf **eine** Wache begrenzt.

Zwei Kleinigkeiten mitgenommen: die gemerkte `besatzung` der geleerten Fahrzeuge
wird auf 0 gezogen (sonst hält „Haken abgleichen" die Wache für besetzt und
hakt leere Fahrzeuge ab), und das Protokoll nennt den Fahrzeugnamen statt der
nackten Nummer. Nachgezogen wird nur, was der Lauf wirklich angefaßt hat — ein
Abbruch soll nicht behaupten, er sei durchgelaufen.


## D-83 Überzählig ist ein Typ, nicht ein Fahrzeug (v0.55.0)

**Lage.** Sasha berichtete, der Verkauf wolle „diesen einen RTW" loswerden,
obwohl drei gleichwertige auf der Wache stehen. Nachgemessen war das nicht der
Fall: `sellSurplus` filterte schon immer über **alle** Fahrzeuge des Typs und
übersprang Unverkäufliches mit `continue`, nicht `break`. Der Eindruck kam von
drei anderen Stellen.

`fms_real !== 2` schloß Status **6** mit aus. Status 6 heißt aber *abgestellt
auf der Wache*, nicht unterwegs — das Skript wußte es an drei eigenen Stellen
schon (`abgestellt`, `bereit`, und die Überzähligen-Liste im Bereitschaftslauf
prüft `[2, 6]`). Ein außer Dienst geparkter RTW wurde also übergangen und dabei
als „ist unterwegs (FMS 6)" gemeldet.

Diese Begründung ging danach verloren: sie landete in `res.blocked`, und
`res.blocked` hatte im ganzen Skript **keinen Leser**. Übrig blieb die
Sammelmeldung „Fahrzeuge nicht auf der Wache" — die bei *jedem* Grund feuerte,
auch bei grün markiert und bei gerade gekauft. Wer daneben drei RTW stehen
sieht, liest daraus zwangsläufig „es will diesen einen".

**Entschieden.** Die Auswahl wandert in `verkaufsKandidaten(b, typId, anzahl)`
und liefert `{ fallen, bleiben }` — bleiben je mit eigenem Grund. Eine Quelle
für Vorschau, Wachenkasten und Verkauf; liefen sie getrennt, könnte die
Bestätigung ein anderes Fahrzeug nennen als der Verkauf trifft (dieselbe Falle
wie bei „zwei Quellen für dieselbe Zahl").

Vier Regeln stecken darin:

- **Status 2 und 6 sind beide greifbar.** 6 zuerst: ein abgestelltes Fahrzeug
  fehlt gerade niemandem.
- **Ungrün vor grün.** Grün heißt fertig, also der teurere Verlust. Greift nur
  bei gesetztem „Grüne freigeben" — sonst bleiben grüne ohnehin stehen.
- **Ein Zugfahrzeug mit Anhänger bleibt stehen.** Fällt es weg, hängt der
  Anhänger an nichts mehr und verliert seinen Punkt. Über den Rang rutscht
  ohnehin zuerst ein freies Fahrzeug nach vorn; bleibt keins, bleibt die
  Überzahl bestehen. Lieber ein Fahrzeug zu viel als eine Waise.
- **Jeder Grund steht am Fahrzeug**, nicht als Pauschale an der Zahl. Die
  Schutzmeldung zählt nur die grünen, die den Ausfall auch verursachen — nicht
  jedes grüne, das gar nicht an der Reihe war.

`res.blocked` ist gestrichen. Es war eine stille Senke: beschrieben, nie
gelesen, und bei wiederholtem Lauf wuchs es in das gemerkte Analyseergebnis
hinein.

**Nicht gebaut: die Überzahl gegen `echteVon` rechnen** statt gegen den Bestand
samt Platzhaltern — weil es nichts zu beheben gibt. Nachgerechnet an
`buyVehicles`: `vehMissing` führt `n = soll − have`, gekauft wird
`Math.min(n, frei)`, also gilt danach `have ≤ soll`. Ein Kauf des Planers kann
**keine Überzahl erzeugen**, und Platzhalter entstehen nur beim Kauf. Die
befürchtete Phantommeldung „x nicht verkauft" nach einem Kauf ist auf diesem
Weg nicht erreichbar.

Erreichbar bleibt ein enger Fall: kaufen, dann **Profil wechseln**, dann
verkaufen — alles vor dem nächsten Bestandsladen. Dann sind Platzhalter
überzählig. Dafür ist die Sperre richtig (eine negative Nummer darf in keine
Anfrage), und die Meldung nennt den Grund: „gerade gekauft, dem Server noch
unbekannt".

Zwei frühere Begründungen hier waren falsch und sind ersetzt: daß die
Phantommeldung im Normalbetrieb auftrete, und daß eine eigene Zählung aus
`echteVon` zu einem Doppelkauf führen müßte. Sie hätte `have` und damit
`vehMissing` gar nicht angefaßt — sie wird nur einfach nicht gebraucht.
Festgehalten, weil eine plausible Fehlerursache, die es nicht gibt, sonst beim
nächsten Lesen erneut „behoben" wird.

**Statt eines Fehlers ein Nachweis (v0.57.0).** „Kann nicht passieren" ist eine
Begründung, kein Netz. Die Rechnung, an der Kauf und Zerstören gemeinsam
hängen, steht deshalb jetzt als `bestandGegenSoll(have, sollFahrzeuge)` für
sich und ist in `test-planung.js` (Abschnitt 26) festgenagelt: ein Typ ist
nie fehlend **und** überzählig, und **ein Kauf vergrößert die Überzahl nicht**.
Die zweite Probe war beim ersten Anlauf selbst falsch — sie verlangte „danach
keine Überzahl", obwohl eine schon vorher bestehende Überzahl zu Recht
stehenbleibt. Die Invariante lautet: der Kauf macht sie nicht größer.

**Verworfen: den Rang einstellbar machen.** Es gibt keinen Fall, in dem man das
einsatzbereite vor dem abgestellten Fahrzeug verkaufen will.

**Eingelöst in D-84:** die Anfrage ist nachgemessen und war richtig — falsch
war das Wort ‚verkaufen‘. Der ursprüngliche Vermerk lautete: `POST
/vehicles/<id>` mit `_method=delete` steht seit je im Code, ist aber **nie
nachgemessen** — sie fehlt in `SPIELSEITEN.md`. Genau die Kategorie, die hier
schon dreimal jahrelang falsch war, und diesmal auf dem unumkehrbaren Pfad.
Diese Änderung verbreitert nur die Kandidatenauswahl; der abgeschickte Aufruf
ist Zeichen für Zeichen der alte. Vor dem nächsten scharfen Lauf gehört er
nachgemessen (siehe [[NAECHSTER_SCHRITT]]).


## D-84 Das Spiel kennt keinen Verkauf — es heißt zerstören (v0.56.0)

**Lage.** D-83 ließ den Endpunkt offen: `POST /vehicles/<id>` mit
`_method=delete` stand seit je im Code, aber nie in `SPIELSEITEN.md`.
Nachgemessen mit Playwright und angemeldetem Browser, rein lesend.

Der Aufruf **stimmt**. Auf `/vehicles/<id>` steht genau ein Verweis mit
`data-method="delete"` auf dieselbe Adresse; Rails-UJS baut daraus ein `POST`
mit `_method=delete` und `authenticity_token`, und `postForm` schickt beides.
Nach drei Adressen, die hier jahrelang falsch waren, war diese richtig.

**Falsch war das Wort.** Die Rückfrage des Spiels lautet „Wirklich das
Fahrzeug **zerstören**?", der Knopf trägt einen Papierkorb mit `title="Löschen"`.
Der Planer nannte dieselbe Handlung durchgehend „verkaufen" — Reiter,
Knopfbeschriftung, Protokoll („VERKAUFE …"), und die letzte Rückfrage vor der
Tat: „Wirklich Fahrzeuge verkaufen?". Wer das liest, rechnet mit Credits
zurück und trifft eine andere Entscheidung als bei „zerstören".

Gesucht wurde ausdrücklich nach einem Verkauf: `/vehicles/<id>`,
`/vehicles/<id>/edit` und `/buildings/<id>`, jeder Verweis, Knopf und
Textabschnitt mit *verkauf*, *sell*, *erlös*, *credits*. Getroffen wurden nur
die **Kauf**-Verweise der Wachenseite. Es gibt keinen Verkauf.

**Entschieden.** Die Oberfläche sagt, was passiert: Reiter „Zerstören", Knopf
„Überzählige zerstören", Protokoll „ZERSTÖRE", und die Rückfrage nennt beides —
daß nichts zurückkommt und daß es nicht rückgängig zu machen ist.

Der Endpunkt bleibt unangetastet; er war richtig. `SPIELSEITEN.md` trägt die
Messung jetzt, samt dem negativen Befund.

**Nicht gemessen, deshalb nicht behauptet:** ob beim Zerstören Credits
zurückfließen. Das wäre nur zu erfahren, indem man ein Fahrzeug zerstört. Die
Rückfrage des Spiels nennt keinen Betrag, also verspricht der Planer auch
keinen. Die Oberfläche sagt genau zwei Dinge, und beide sind gemessen: einen
Verkauf kennt das Spiel nicht, und einen Erlös nennt es nicht. Ein flaches
„es kommt nichts zurück" stand kurz im Knopftext und ist wieder heraus — das
wäre geraten gewesen, und geraten wird hier nicht.

**Verworfen: `sellSurplus` und `verkaufsKandidaten` umbenennen.** Der
Reiterschlüssel `verkauf` hängt an gemerkten Antworten und an
`TABGRUPPEN`/`TABNAME`; ein Umbenennen hätte nur Reibung erzeugt. Statt dessen
steht über `sellSurplus` ein Kommentar, der sagt, daß die Funktion `destroy`
tut. Die Oberfläche ist die Stelle, an der die Wahrheit zählt.

**Verworfen: `/vehicles/<id>/sell` und ähnliche Adressen probeweise aufrufen.**
In diesem Spiel lösen auch `GET`-Verweise Handlungen aus — der Kauf läuft über
`GET .../credits`. Ein Probeaufruf wäre selbst die Tat gewesen. Gemessen wurde
ausschließlich, was der Planer ohnehin liest.

**Mitgenommen.** Dieselbe Messung hat zwei Annahmen aus D-83 belegt:
`tractive_vehicle_id` trägt echte Kopplungen (86 Anhänger an 72
Zugfahrzeugen, 10 mit mehreren), und **16 von 1583** Fahrzeugen standen auf
Status 6. Der alte Filter `fms_real !== 2` hat also nicht theoretisch, sondern
laufend Fahrzeuge liegenlassen.
