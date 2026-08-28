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

## Größen, am eigenen Konto gemessen

103 Gebäude · 1.449 Fahrzeuge · 28 Schulen, davon 27 im Verband über vier
Schularten. `loadAll` kostet drei Abrufe (≈ 4 s), der Bestand im Speicher rund
232 KB JSON — etwa ein Zehntel der Browserquote, nicht ein Viertel.
