# Spielseiten — nachgemessen, nicht geraten

Aufgenommen am 27.08.2026 mit einem angemeldeten Browser, rein lesend, plus
zwei Leerlauf-Schreibversuchen. `CLAUDE.md` verlangt, Endpunkte und Feldnamen
aus dem Spiel zu lesen statt zu vermuten — hier steht, was dabei herauskam.

**Ohne Kennungen.** Gebäude- und Personennummern und Namen aus dem Bestand
stehen absichtlich nicht hier: die Ablage ist öffentlich. Was zählt, ist die
Form der Seite, nicht der Inhalt eines Kontos.

## Wer liefert was

| Adresse | Antwort | Anmerkung |
|---|---|---|
| `/api/buildings` | JSON, 18 Felder je Gebäude | enthält **`enabled`** (`true`/`false`) und `leitstelle_building_id` — beides brauchte der Planer, beides warf `slimBuilding` weg |
| `/api/v2/vehicles` | JSON, 38 Felder je Fahrzeug | Hülle `{result, paging}`; `paging.next_page` nur, wenn `limit` gesetzt ist. Ohne Parameter kommt alles. `?page=N` wird **ignoriert** |
| `/api/alliance_buildings` | JSON, Array | trägt zusätzlich `schoolings` — die **laufenden** Kurse, nicht das Angebot |
| `/buildings/<leitstelle>/leitstelle-extensions` | HTML | Sammelseite **aller** eigenen Gebäude. Auf einer Wache: **HTTP 500** |
| `/buildings/<id>/vehicles/new` | HTML | hier steht die Kaufliste, **nicht** auf `/buildings/<id>` |
| `/vehicles/<id>/zuweisung` | HTML | die vollständige Personalquelle (D-47) |
| `/schoolings` | HTML | zwei Tabellen, siehe unten |
| `/schoolings/<id>` | HTML | Anmeldeseite eines offenen Lehrgangs |
| `/vehicles/<id>/refit` | HTML | Umrüstformular; schickt an `POST /refit_vehicle/<id>` |

Zwischenspeicher: `/api/buildings` und `/api/v2/vehicles` antworten mit
`cache-control: max-age=60, private`. Das Spiel erlaubt also ausdrücklich, eine
Minute lang nicht erneut zu fragen.

## Die Zuweisungsseite — jeder Selektor stimmt

```
#personal_table                                       vorhanden
  thead th                     Name · Ausbildung · Status · Zugewiesen an
  tbody tr[id^="personal_"]    eine Zeile je Person
    data-filterable-by         JSON-Liste der fertigen Lehrgänge
    [data-education-key]       laufender Lehrgang, Text „Im Unterricht: …"
    td:last-child a[href^="/vehicles/"]:not([personal_id])   Fahrzeugzuweisung
select.education-filter option                        Schlüssel => Klartext
```

Die Klartextnamen aus dem Filterfeld sind die **Personallisten-Namen**
(`lna` → „LNA", `seg_gw_san` → „GW-San"), nicht die Kursnamen der Schule. Genau
darüber lernt `merkeKursNamen` die zweite Namensform je Schlüssel (D-02).

## Die Lehrgangsübersicht `/schoolings`

Zwei Tabellen, und nur die zweite hat Plätze:

```
#schooling_own_table      Lehrgang · Spätestens Fertig · Lehrgangsausführer
#schooling_opened_table   Lehrgang · Freie Plätze · Kosten · Spätestens Fertig · Ausführer
```

`lehrgaenge()` prüft `t.id === 'schooling_opened_table'` und rechnet nur dort —
richtig. Wer nur die erste Tabelle ansieht, hält die Uhrzeit für eine
Platzzahl.

## Die Anmeldeseite `/schoolings/<id>`

```
#schooling_free                       nackte Zahl, z. B. "10", beim Seitenaufbau da
#building_rooms_use                   fehlt hier (steht auf der Schulseite)
#education_select                     fehlt hier
.building_list[building_type_id]      je Wache, mit building_id und search_attribute
  .panel-heading.personal-select-heading      id personal-select-heading-building-<id>
                                              Text: „<Wachenname> <N> Angestellte"
  .panel-body[building_id="<id>"]             Klasse `hidden`, solange zugeklappt
    .schooling_checkbox                       erst nach dem Aufklappen im Baum
```

Die Ankreuzfelder tragen `name="personal_ids[]"`, `value=<personal_id>`,
`building_id` — **und je einen Wahrheitswert für jeden der rund 230
Lehrgangsschlüssel**. Der vollständige Ausbildungsstand aller gelisteten Wachen
steht damit im Baum; `#school_personal_education_<id>` ist dagegen leer und
taugt nicht zur Unterscheidung von gelernt und ungelernt.

Ein **laufender** Lehrgang zeigt gar nichts davon — keine `.building_list`, kein
`#schooling_free`. Wer das nicht unterscheidet, hält ihn für offen.

Gefiltert wird auf dieser Seite **nicht vom Spiel**, sondern vom LSS-Manager,
Klasse `lssmv4-buildingListFilter-filter-hidden`. Ein eigenes Suchfeld gibt es
nicht. Ebenso stammen die Beschriftungen „N ausgebildete" und „N in Ausbildung"
vom LSS-Manager — ohne ihn nennt die Kopfzeile nur die Zahl der Angestellten.

## Die Schulseite `/buildings/<schule>`

Drei Reiter: **Unterricht** · **Bestehender Unterricht** · **Erweiterungen**.

Das Kursangebot ist nur lesbar, solange die Schule **freie Klassenräume** hat:
mit freiem Platz steht dort `#education_select` (Werte `<schlüssel>:<nummer>`,
Text mit Dauer), bei voller Schule statt dessen `#building_schooling_table` mit
den laufenden Kursen. Höchstens vier Klassenräume je Schule, zehn Plätze je
Raum.

Das Angebot hängt an der **Schulart**, nicht am einzelnen Gebäude — eine eigene
und eine Verbandsschule desselben Typs bieten dasselbe an. Deshalb genügt es,
je Schulart eine Schule zu lesen, und deshalb ist eine feste Tabelle die
ehrlichere Quelle als ein Abruf, der an einer vollen Schule nichts hergibt.

## Formulare

```
/buildings/<id>/edit    building[name] · building[personal_count_target]
                        building[leitstelle_building_id] · building[vehicle_graphic_id]
                        building[image]              _method=patch
/vehicles/<id>/edit     vehicle[caption] · vehicle[personal_max] · vehicle[start_delay]
                        vehicle[ignore_aao] · vehicle[working_hour_start|end]
                        vehicle[vehicle_type_caption] · vehicle[vehicle_type_ignore_default_aao]
                        bei Anhängern zusätzlich: vehicle[tractive_random]
                                                  vehicle[tractive_vehicle_id]
```

`<select>`-Felder tragen `selected` am gewählten `<option>`, sind also aus dem
Papier lesbar.

**Weggelassene Felder werden nicht zurückgesetzt.** Zwei Leerlaufversuche —
einmal nur `building[name]`, einmal nur `vehicle[caption]` — ließen alles
Übrige unberührt. Ein Teil-Formular ist damit unbedenklich, und der zweite
Abruf in `umbenennenFahrzeug` kauft nichts.

Gekoppelt wird **am Anhänger**, nicht am Zugfahrzeug: `tractive_vehicle_id`
steht im Formular des Anhängers.

## Wachenseite

Von den vier früher geratenen Ankern existiert **keiner**. Der Rumpf der Seite
hat als Kinder nur `script`, `img#ajax-loader`,
`div#iframe-inside-container.container-fluid` und einen Popup-Behälter.
Bauplatznummern sind **nicht** fortlaufend — an einer Wache traten 0, 6, 8, 14,
15, 16, 18, 19 auf.

## Die Umrüstseite `/vehicles/<id>/refit`

Nachgemessen am 29.08.2026, rein lesend — jeder POST wurde im Browser
abgefangen, es wurde nichts umgerüstet.

```
GET  /vehicles/<id>/refit          HTML, form#refit_form
POST /refit_vehicle/<id>           dorthin geht die Umrüstung
```

Felder des Formulars:

```
utf8                                  ✓
authenticity_token                    aus der Seite, nicht erfindbar
vehicle_fitting_template[id]          leer = neue Umrüstung, sonst Vorlage
vehicle_fitting_template[template_caption]   Pflicht, minlength=2, bei neuer Vorlage
cabin_size_new_value                  versteckt, vom Schieber gespeist
water_tank_capacity_new_value         "
pump_capacity_new_value               "
foam_capacity_new_value               "
commit                                der gedrückte Knopf, siehe unten
```

**Die vier Wertfelder gibt es nur bei Löschfahrzeugen.** Bei DLK 23 und RTW
enthält dasselbe Formular ausschließlich die beiden Vorlagenfelder — eine
Umrüstung ist dort gegenstandslos. Die Grenzen hängen am Typ:

| Typ | Personen | Wasser | Pumpe | Sonderlöschmittel |
|---|---|---|---|---|
| LF 20 | 1–9 (jetzt 9) | 0–4000 (2000) | 0–4000 (2000) | 0–1500 (150) |
| HLF 20 | 1–9 (jetzt 9) | 0–**5000** (1600) | 0–4000 (2000) | 0–1500 (150) |

Die Vorgabewerte sind der **Istzustand** des Fahrzeugs. Wer ein Feld wegläßt,
darf sich also nicht darauf verlassen, daß es bleibt — die Werte gehören
vollständig mitgeschickt.

### Der gefährlichste Teil: `commit`

Es gibt **zwei** Absendeknöpfe, beide heißen `commit`. Unterschieden werden sie
allein durch ihren Text — und in dem Text steht der Preis:

```html
<input name="commit" type="submit" value="Fahrzeug umrüsten (10 Coins)"
       class="… coins_activate …">
<input name="commit" type="submit" value="Fahrzeug umrüsten (5.000 Credits)"
       id="refit_with_credits_button">
```

Coins sind gekaufte Währung. Wer den String selbst zusammensetzt, verschreibt
sich irgendwann. Der Wert wird **aus `#refit_with_credits_button` gelesen**,
niemals gebaut.

### Preis und Dauer

Die Hälfte des Kaufpreises: LF 20 → 5.000, HLF 20 → 20.000 Credits. Der
Knopftext änderte sich **nicht**, als der Personenschieber von 9 auf 4 gezogen
wurde — der Einleitungssatz der Seite („beruhen auf dem ursprünglichen
Kaufpreis des Fahrzeugs **und den vorgenommenen Veränderungen**") verspricht
also mehr Feinheit, als die Seite zeigt. Dauer laut Seite: 48 Stunden.

**Nicht gemessen:** ob das Fahrzeug während der 48 Stunden aus dem Dienst geht,
und was `POST /refit_vehicle/<id>` antwortet. Beides ließe sich nur durch eine
echte Umrüstung erfahren.

### Was die API dazu sagt

`/api/v2/vehicles` führt die Werte bereits mit:

```
custom_personal_max      die tatsächliche Sitzzahl
custom_water_amount · custom_pump_amount · custom_foam_amount
max_personnel_override   Deckel, sonst null
```

Am eigenen Konto stimmt `custom_personal_max` bei **allen 1.567 Fahrzeugen** mit
`PB[typ].max` überein, und die 294 gesetzten `max_personnel_override` sind
durchweg gleich groß. Solange nichts umgerüstet ist, rechnet der Planer also
richtig — mit der ersten Umrüstung der Kabinengröße gilt das nicht mehr.

## Größen, am eigenen Konto gemessen

103 Gebäude · 1.449 Fahrzeuge (29.08.2026: 1.567) · 28 Schulen, davon 27 im Verband über vier
Schularten. `loadAll` kostet drei Abrufe (≈ 4 s), der Bestand im Speicher rund
232 KB JSON — etwa ein Zehntel der Browserquote, nicht ein Viertel.


## Fahrzeug abstoßen — es gibt keinen Verkauf

Nachgemessen am 03.09.2026 mit Playwright und angemeldetem Browser, rein
lesend. Es wurde nichts geklickt und nichts abgeschickt.

**Auf `/vehicles/<id>` steht genau eine verändernde Aktion:**

```
a  data-method="delete"  href="/vehicles/<id>"
   class="btn btn-danger"
   data-confirm="Wirklich das Fahrzeug zerstören?"
   innen: <span title="Löschen" class="glyphicon glyphicon-trash"></span>
```

Kein `<form>` auf der Seite (0 Formulare). Der Verweis ist ein
Rails-UJS-Verweis: UJS baut daraus ein `POST` auf dieselbe Adresse mit den
versteckten Feldern `_method=delete` und `authenticity_token`. Genau das
schickt `postForm('/vehicles/<id>', { _method: 'delete' })` — der Aufruf im
Planer ist richtig. `<meta name="csrf-param">` trägt `authenticity_token`,
`<meta name="csrf-token">` ist vorhanden, und `csrf()` liest genau dieses Feld.

**Der negative Befund ist der wichtigere:** durchsucht wurden
`/vehicles/<id>`, `/vehicles/<id>/edit` und `/buildings/<id>` nach jedem
Verweis, Knopf und Textstück mit *verkauf*, *sell*, *erlös*, *credits*.
Getroffen wurden nur die **Kauf**-Verweise der Wachenseite
(`POST /buildings/<id>/extension/credits/<nr>`, `POST /building_specializations`).
Eine Verkaufsmöglichkeit existiert an keiner dieser Stellen. Das Spiel kennt
nur „zerstören".

Ob beim Zerstören Credits zurückfließen, ist **nicht gemessen** — dafür müßte
man ein Fahrzeug zerstören. Die Rückfrage des Spiels nennt keinen Betrag.
Deshalb sagt der Planer seit v0.56.0 „zerstören" und verspricht nichts (D-84).

**Nicht geraten:** Adressen wie `/vehicles/<id>/sell` wurden **nicht**
probeweise aufgerufen. In diesem Spiel lösen auch `GET`-Verweise Handlungen
aus — der Kauf läuft über `GET .../credits` —, ein Probeaufruf wäre also
selbst die Tat gewesen.

### Feldnamen in `/api/v2/vehicles`, gegengeprüft

Alle Felder, auf die der Planer baut, sind da: `id`, `vehicle_type`,
`building_id`, `fms_real`, `fms_show`, `caption`, `tractive_vehicle_id`.

Im gemessenen Bestand (1583 Fahrzeuge):

| | |
|---|---|
| Status 1 / 2 / 3 / 4 / 6 / 7 | 7 / 1456 / 24 / 76 / **16** / 4 |
| Anhänger mit Zugfahrzeug | 86 an 72 Zugfahrzeugen |
| Zugfahrzeuge mit mehr als einem Anhänger | 10 |

**Status 6 ist kein Randfall** — 16 Fahrzeuge standen abgestellt auf ihrer
Wache. Der alte Filter `fms_real !== 2` hat sie alle als „unterwegs"
liegenlassen (D-83). Und `tractive_vehicle_id` trägt echte Kopplungen, die
Anhänger-Sperre aus D-83 greift also nicht ins Leere.
