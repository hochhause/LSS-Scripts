# Fahrzeugprofile — Soll-Modell

Erzeugt aus dem Soll/Ist-Tool. Grundlage sind die Spiel-Stammdaten und die
gemeinsam erarbeiteten Profile.

**Regeln, die überall gelten**

- Löschfahrzeuge ausschließlich HLF 20, Einsatzleitung ausschließlich ELW 2,
  Schlauchwagen ausschließlich SW 2000-Tr
- Lehrgangsfahrzeuge werden voll besetzt
- Anhänger sind fest einem Zugfahrzeug zugeordnet
- Rettungsdienst und Wasserrettung stehen nur in eigenen Gebäuden, nie in Feuerwachen
- Bergrettung führt keinen RTW
- MZB nur an GW-Wasserrettung koppeln, nicht an GW-Taucher
- Wiederholbare Ausbauten zuletzt bauen

**Spalten der Fahrzeugtabellen**

| Spalte | Bedeutung |
|---|---|
| Anzahl | Stück je Wache |
| Topf | Stellplatz-Art |
| Besatzung | min / max laut Stammdaten |
| Ausbildung | `alle` = jede zugewiesene Person · `min N` = mindestens N an Bord · `nur an der EST` = keine Vorgabe an Bord, dafür Spalte EST |
| EST | an der Einsatzstelle gefordert, gilt für Anhänger |

---

## Feuerwache  `Typ 0`

Im Bestand: **23** Gebäude, Stufe 19

### Profil `crafted` — Standardwache

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Normal | Stufe 19, +10 je Großwache | 20 |
| Abrollbehälter | Abrollbehälter-Stellplatz × 1 | 14 |
| Anhänger | Anhänger-Stellplatz × 1 | 5 |
| Drohne | Drohneneinheit × 1 | 1 |
| Verpflegung | Verpflegungsdienst × 2 | 2 |
| Bahnrettung | Bahnrettung × 1 | 1 |
| Tierrettung | Tierrettung × 1 | 1 |
| NEA200 | Netzersatzanlage 200 × 2 | 0 |
| **gesamt** | | **44** |

**Ausbauten**

Abrollbehälter-Stellplatz ×14 · Anhänger-Stellplatz ×5 · Netzersatzanlage 50 · Großlüfter · Drohneneinheit · Verpflegungsdienst · Bahnrettung · Tierrettung

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| HLF 20 | 6 | normal | 1 / 9 | — | — |
| DLK 23 | 2 | normal | 1 / 3 | — | — |
| GW-L2 | 3 | normal | 1 / 6 | — | — |
| WLF | 2 | normal | 1 / 3 | wechsellader: alle | — |
| ELW 2 | 1 | normal | 1 / 6 | elw2: alle | — |
| TLF 3000 | 1 | normal | 1 / 3 | — | — |
| MTW | 1 | normal | 1 / 9 | — | — |
| GW-Messtechnik | 1 | normal | 1 / 3 | gw_messtechnik: alle | — |
| GW-Gefahrgut | 1 | normal | 1 / 3 | gw_gefahrgut: alle | — |
| Dekon-P | 1 | normal | 1 / 6 | dekon_p: nur an der EST | 6 |
| FwK | 1 | normal | 1 / 2 | fwk: alle | — |
| AB-Rüst | 1 | ab | 0 / 0 | — | — |
| AB-Atemschutz | 1 | ab | 0 / 0 | — | — |
| AB-Öl | 1 | ab | 0 / 0 | — | — |
| AB-Schlauch | 1 | ab | 0 / 0 | — | — |
| AB-Tank | 1 | ab | 0 / 0 | — | — |
| AB-Lösch | 1 | ab | 0 / 0 | — | — |
| AB-L | 1 | ab | 0 / 0 | — | — |
| AB-Lüfter | 1 | ab | 0 / 0 | — | — |
| AB-Sonderlöschmittel | 1 | ab | 0 / 0 | — | — |
| AB-Wasser/Schaum | 1 | ab | 0 / 0 | — | — |
| AB-Küche | 1 | ab | 0 / 0 | — | — |
| AB-Schiene | 1 | ab | 0 / 0 | — | — |
| AB-Einsatzleitung | 1 | ab | 0 / 0 | elw2: alle | 1 |
| AB-Gefahrgut | 1 | ab | 0 / 0 | gw_gefahrgut: alle | 1 |
| NEA50 | 1 | anh | 0 / 0 | — | — |
| Anh Lüfter | 1 | anh | 0 / 0 | — | — |
| Anh Schlauch | 1 | anh | 0 / 0 | — | — |
| Anh Sonderlöschmittel | 1 | anh | 0 / 0 | — | — |
| Anh Tierrettung | 1 | anh | 0 / 0 | — | — |
| ELW2 Drohne | 1 | drohne | 4 / 6 | fire_drone: alle<br>elw2: alle | — |
| GW-Küche | 1 | vpfl | 3 / 3 | fire_care_service: min 1<br>care_service_equipment: min 2 | — |
| GW-Verpflegung | 1 | vpfl | 3 / 6 | fire_care_service: min 1<br>care_service_equipment: min 2 | — |
| HLF Schiene | 1 | bahn | 1 / 9 | railway_fire: alle | — |
| GW-Tierrettung | 1 | tier | 2 / 6 | — | — |

 Fahrzeuge gesamt **44**, Vollbesetzung **146** Personen

Lager: `"all"`

Ausrüstung: `"all"`

### Profil `crafted-big` — Schwerpunktwache — je 10 Feuerwachen eine

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Normal | Stufe 19, +10 je Großwache | 30 |
| Abrollbehälter | Abrollbehälter-Stellplatz × 1 | 14 |
| Anhänger | Anhänger-Stellplatz × 1 | 5 |
| Drohne | Drohneneinheit × 1 | 1 |
| Verpflegung | Verpflegungsdienst × 2 | 2 |
| Bahnrettung | Bahnrettung × 1 | 1 |
| Tierrettung | Tierrettung × 1 | 1 |
| NEA200 | Netzersatzanlage 200 × 2 | 2 |
| **gesamt** | | **56** |

**Ausbauten**

Abrollbehälter-Stellplatz ×14 · Anhänger-Stellplatz ×5 · Netzersatzanlage 50 · Großlüfter · Drohneneinheit · Verpflegungsdienst · Bahnrettung · Tierrettung · Großwache · Flughafenfeuerwehr · Netzersatzanlage 200 · Werkfeuerwehr

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| HLF 20 | 6 | normal | 1 / 9 | — | — |
| GW-L2 | 4 | normal | 1 / 6 | — | — |
| WLF | 3 | normal | 1 / 3 | wechsellader: alle | — |
| DLK 23 | 2 | normal | 1 / 3 | — | — |
| FLF | 2 | normal | 2 / 3 | arff: alle | — |
| ELW 2 | 1 | normal | 1 / 6 | elw2: alle | — |
| TLF 3000 | 1 | normal | 1 / 3 | — | — |
| MTW | 1 | normal | 1 / 9 | — | — |
| GW-Messtechnik | 1 | normal | 1 / 3 | gw_messtechnik: alle | — |
| GW-Gefahrgut | 1 | normal | 1 / 3 | gw_gefahrgut: alle | — |
| Dekon-P | 1 | normal | 1 / 6 | dekon_p: nur an der EST | 6 |
| FwK | 1 | normal | 1 / 2 | fwk: alle | — |
| GW-Höhenrettung | 1 | normal | 1 / 9 | gw_hoehenrettung: alle | — |
| Rettungstreppe | 1 | normal | 2 / 2 | rettungstreppe: alle | — |
| GW-Werkfeuerwehr | 1 | normal | 1 / 9 | werkfeuerwehr: alle | — |
| ULF mit Löscharm | 1 | normal | 1 / 3 | werkfeuerwehr: alle | — |
| TM 50 | 1 | normal | 1 / 3 | werkfeuerwehr: alle | — |
| Turbolöscher | 1 | normal | 1 / 3 | werkfeuerwehr: alle | — |
| AB-Rüst | 1 | ab | 0 / 0 | — | — |
| AB-Atemschutz | 1 | ab | 0 / 0 | — | — |
| AB-Öl | 1 | ab | 0 / 0 | — | — |
| AB-Schlauch | 1 | ab | 0 / 0 | — | — |
| AB-Tank | 1 | ab | 0 / 0 | — | — |
| AB-Lösch | 1 | ab | 0 / 0 | — | — |
| AB-L | 1 | ab | 0 / 0 | — | — |
| AB-Lüfter | 1 | ab | 0 / 0 | — | — |
| AB-Sonderlöschmittel | 1 | ab | 0 / 0 | — | — |
| AB-Wasser/Schaum | 1 | ab | 0 / 0 | — | — |
| AB-Küche | 1 | ab | 0 / 0 | — | — |
| AB-Schiene | 1 | ab | 0 / 0 | — | — |
| AB-Einsatzleitung | 1 | ab | 0 / 0 | elw2: alle | 1 |
| AB-Gefahrgut | 1 | ab | 0 / 0 | gw_gefahrgut: alle | 1 |
| NEA200 | 1 | nea200 | 0 / 0 | energy_supply: min 1 | — |
| AB-NEA200 | 1 | nea200 | 0 / 0 | energy_supply: min 1 | — |
| NEA50 | 1 | anh | 0 / 0 | — | — |
| Anh Lüfter | 1 | anh | 0 / 0 | — | — |
| Anh Schlauch | 1 | anh | 0 / 0 | — | — |
| Anh Sonderlöschmittel | 1 | anh | 0 / 0 | — | — |
| Anh Tierrettung | 1 | anh | 0 / 0 | — | — |
| ELW2 Drohne | 1 | drohne | 4 / 6 | fire_drone: alle<br>elw2: alle | — |
| GW-Küche | 1 | vpfl | 3 / 3 | fire_care_service: min 1<br>care_service_equipment: min 2 | — |
| GW-Verpflegung | 1 | vpfl | 3 / 6 | fire_care_service: min 1<br>care_service_equipment: min 2 | — |
| HLF Schiene | 1 | bahn | 1 / 9 | railway_fire: alle | — |
| GW-Tierrettung | 1 | tier | 2 / 6 | — | — |

 Fahrzeuge gesamt **56**, Vollbesetzung **190** Personen

Lager: `"all"`

Ausrüstung: `"all"`

**Ausbauten, die das Spiel anbietet** (30 insgesamt)

Nicht im Profil: Rettungsdienst `#0` · Wasserrettung `#6`

---

## Rettungswache  `Typ 2`

Im Bestand: **25** Gebäude, Stufe 14

### Profil `crafted` — Standard — 15 Plätze auf Stufe 14

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 14, +10 je Großwache | 15 |
| **gesamt** | | **15** |

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| RTW | 7 | normal | 1 / 2 | — | — |
| KTW | 2 | normal | 1 / 2 | — | — |
| NEF | 3 | normal | 1 / 2 | notarzt: alle | — |
| NAW | 1 | normal | 3 / 3 | notarzt: min 1 | — |
| KdoW-LNA | 1 | normal | 1 / 1 | lna: alle | — |
| KdoW-OrgL | 1 | normal | 1 / 1 | orgl: alle | — |

 Fahrzeuge gesamt **15**, Vollbesetzung **29** Personen

### Profil `crafted-big` — Schwerpunkt — mit Großwache, 25 Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 14, +10 je Großwache | 25 |
| **gesamt** | | **25** |

**Ausbauten**

Großwache

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| RTW | 10 | normal | 1 / 2 | — | — |
| KTW | 4 | normal | 1 / 2 | — | — |
| NEF | 6 | normal | 1 / 2 | notarzt: alle | — |
| NAW | 1 | normal | 3 / 3 | notarzt: min 1 | — |
| GRTW | 1 | normal | 6 / 6 | notarzt: min 1 | — |
| ITW | 1 | normal | 3 / 3 | intensive_care: min 2<br>notarzt: min 1 | — |
| KdoW-LNA | 1 | normal | 1 / 1 | lna: alle | — |
| KdoW-OrgL | 1 | normal | 1 / 1 | orgl: alle | — |

 Fahrzeuge gesamt **25**, Vollbesetzung **54** Personen

**Ausbauten, die das Spiel anbietet** (1 insgesamt)

Alle im Profil enthalten.

---

## Polizeiwache  `Typ 6`

Im Bestand: **24** Gebäude, Stufe 14

### Profil `crafted` — Standard — 15 Plätze auf Stufe 14

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Normal | Stufe 14, +10 je Großwache | 15 |
| Diensthunde | Diensthundestaffel × 1 | 1 |
| DGL | Dienstgruppenleitung × 1 | 1 |
| Motorrad | Motorradstaffel × 2 | 2 |
| Autobahn | Autobahnpolizei × 2 | 2 |
| Gewahrsam | Großgewahrsam × 1 | 0 |
| **gesamt** | | **21** |

**Ausbauten**

Zelle ×10 · Diensthundestaffel · Kriminalpolizei · Dienstgruppenleitung · Motorradstaffel · Autobahnpolizei

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| FuStW | 12 | normal | 1 / 2 | — | — |
| Zivilstreifenwagen | 3 | normal | 1 / 2 | criminal_investigation: alle | — |
| DHuFüKW | 1 | hund | 1 / 2 | k9: alle | — |
| FuStW (DGL) | 1 | dgl | 1 / 2 | police_service_group_leader: min 1 | — |
| Polizeimotorrad | 2 | motorrad | 1 / 1 | police_motorcycle: alle | — |
| FuStW (AP) | 2 | ap | 2 / 2 | highway_police: alle | — |

 Fahrzeuge gesamt **21**, Vollbesetzung **40** Personen

### Profil `crafted-big` — Schwerpunkt — Großwache und Großgewahrsam, 25 Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Normal | Stufe 14, +10 je Großwache | 25 |
| Diensthunde | Diensthundestaffel × 1 | 1 |
| DGL | Dienstgruppenleitung × 1 | 1 |
| Motorrad | Motorradstaffel × 2 | 2 |
| Autobahn | Autobahnpolizei × 2 | 2 |
| Gewahrsam | Großgewahrsam × 1 | 1 |
| **gesamt** | | **32** |

**Ausbauten**

Zelle ×10 · Diensthundestaffel · Kriminalpolizei · Dienstgruppenleitung · Motorradstaffel · Autobahnpolizei · Großwache · Großgewahrsam

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| FuStW | 20 | normal | 1 / 2 | — | — |
| Zivilstreifenwagen | 5 | normal | 1 / 2 | criminal_investigation: alle | — |
| DHuFüKW | 1 | hund | 1 / 2 | k9: alle | — |
| FuStW (DGL) | 1 | dgl | 1 / 2 | police_service_group_leader: min 1 | — |
| Polizeimotorrad | 2 | motorrad | 1 / 1 | police_motorcycle: alle | — |
| FuStW (AP) | 2 | ap | 2 / 2 | highway_police: alle | — |
| GefKw | 1 | gefkw | 1 / 2 | — | — |

 Fahrzeuge gesamt **32**, Vollbesetzung **62** Personen

**Ausbauten, die das Spiel anbietet** (17 insgesamt)

Alle im Profil enthalten.

---

## THW-Ortsverband  `Typ 9`

Im Bestand: **4** Gebäude, Stufe 0

### Profil `crafted` — Vollausbau — alle 16 Ausbauten

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | fest 1, +2 je 1. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung, +1 je 1. Technischer Zug: Zugtrupp, +1 je 2. Technischer Zug - Bergungsgruppe, +2 je 2. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung, +1 je 2. Technischer Zug: Zugtrupp, +4 je Fachgruppe Räumen, +5 je Fachgruppe Wassergefahren, +4 je Fachgruppe Ortung, +4 je Fachgruppe Wasserschaden/Pumpen, +1 je Fachgruppe Schwere Bergung, +2 je Fachgruppe Elektroversorgung, +2 je Ortsverbands-Mannschaftstransportwagen, +1 je Trupp Unbemannte Luftfahrtsysteme, +5 je Fachzug Führung und Kommunikation, +3 je Fachgruppe Logistik-Verpflegung, +3 je Fachgruppe Brückenbau | 42 |
| **gesamt** | | **42** |

**Ausbauten**

1. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung · 1. Technischer Zug: Zugtrupp · 2. Technischer Zug - Bergungsgruppe · 2. Technischer Zug: Fachgruppe Notversorgung/Notinstandsetzung · 2. Technischer Zug: Zugtrupp · Fachgruppe Räumen · Fachgruppe Wassergefahren · Fachgruppe Ortung · Fachgruppe Wasserschaden/Pumpen · Fachgruppe Schwere Bergung · Fachgruppe Elektroversorgung · Ortsverbands-Mannschaftstransportwagen · Trupp Unbemannte Luftfahrtsysteme · Fachzug Führung und Kommunikation · Fachgruppe Logistik-Verpflegung · Fachgruppe Brückenbau

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| GKW | 2 | gesamt | 1 / 9 | — | — |
| MzGW (FGr N) | 2 | gesamt | 1 / 9 | — | — |
| NEA50 | 2 | gesamt | 0 / 0 | — | — |
| MTW-TZ | 2 | gesamt | 1 / 4 | thw_zugtrupp: alle | — |
| MTW-OV | 2 | gesamt | 1 / 7 | — | — |
| MTW-O | 2 | gesamt | 4 / 5 | — | — |
| Anh Hund | 2 | gesamt | 0 / 0 | thw_rescue_dogs: alle | — |
| MLW 5 | 1 | gesamt | 1 / 6 | thw_raumen: alle | — |
| LKW K 9 | 1 | gesamt | 1 / 3 | thw_raumen: alle | — |
| BRmG R | 1 | gesamt | 0 / 0 | — | — |
| Anh DLE | 1 | gesamt | 0 / 0 | — | — |
| LKW 7 Lkr 19 tm | 1 | gesamt | 1 / 2 | — | — |
| Anh MzB | 1 | gesamt | 0 / 0 | gw_wasserrettung: alle | 4 |
| Anh SchlB | 1 | gesamt | 0 / 0 | gw_wasserrettung: alle | 4 |
| Anh MzAB | 1 | gesamt | 0 / 0 | gw_wasserrettung: alle | 4 |
| Tauchkraftwagen | 1 | gesamt | 1 / 2 | gw_taucher: alle | — |
| MLW 4 | 1 | gesamt | 1 / 7 | water_damage_pump: alle | — |
| LKW 7 Lbw (FGr WP) | 1 | gesamt | 1 / 3 | — | — |
| Anh SwPu | 1 | gesamt | 0 / 0 | water_damage_pump: min 1 | — |
| Anh 7 | 1 | gesamt | 0 / 0 | water_damage_pump: min 1 | — |
| MzGW SB | 1 | gesamt | 1 / 9 | heavy_rescue: alle | — |
| LKW 7 Lbw (FGr E) | 1 | gesamt | 1 / 3 | — | — |
| NEA200 | 1 | gesamt | 0 / 0 | thw_energy_supply: min 1 | — |
| MTW-Tr UL | 1 | gesamt | 4 / 4 | thw_drone: alle | — |
| FüKW (THW) | 1 | gesamt | 1 / 4 | thw_command: alle | — |
| FüKomKW | 1 | gesamt | 1 / 7 | thw_command: alle | — |
| Anh FüLa | 1 | gesamt | 0 / 0 | — | — |
| FmKW | 1 | gesamt | 1 / 7 | thw_command: alle | — |
| MTW-FGr K | 1 | gesamt | 4 / 4 | thw_command: alle | — |
| LKW 7 Lbw (FGr Log-V) | 1 | gesamt | 3 / 3 | thw_care_service: min 1<br>care_service_equipment: min 2 | — |
| MTW-FGr Log-V | 1 | gesamt | 5 / 5 | thw_care_service: alle | — |
| Anh 12 Lbw (FGr Log-V) | 1 | gesamt | 0 / 0 | — | — |
| MzGW (FGr BrB) | 1 | gesamt | 6 / 9 | thw_bridge_construction: alle | — |
| Mobilkran | 1 | gesamt | 1 / 1 | thw_bridge_construction_crane: alle | — |
| Anh Plattform (FGr BrB) | 1 | gesamt | 0 / 0 | thw_bridge_construction: min 6 | — |

 Fahrzeuge gesamt **42**, Vollbesetzung **147** Personen

**Ausbauten, die das Spiel anbietet** (16 insgesamt)

Alle im Profil enthalten.

---

## Bereitschaftspolizei  `Typ 11`

Im Bestand: **2** Gebäude, Stufe 0

### Profil `crafted` — Vollausbau — jede BePol identisch

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | fest 4, +4 je 2. Zug der 1. Hundertschaft, +5 je 3. Zug der 1. Hundertschaft, +1 je Sonderfahrzeug: Gefangenenkraftwagen, +4 je Technischer Zug: Wasserwerfer, +5 je SEK: 1. Zug, +5 je SEK: 2. Zug, +5 je MEK: 1. Zug, +5 je MEK: 2. Zug, +3 je Diensthundestaffel, +6 je Reiterstaffel, +1 je Sonderfahrzeug: Lautsprecherkraftwagen | 48 |
| **gesamt** | | **48** |

**Ausbauten**

2. Zug der 1. Hundertschaft · 3. Zug der 1. Hundertschaft · Sonderfahrzeug: Gefangenenkraftwagen · Technischer Zug: Wasserwerfer · SEK: 1. Zug · SEK: 2. Zug · MEK: 1. Zug · MEK: 2. Zug · Diensthundestaffel · Reiterstaffel · Sonderfahrzeug: Lautsprecherkraftwagen

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| GruKw | 9 | gesamt | 1 / 9 | — | — |
| leBefKw | 4 | gesamt | 1 / 3 | police_einsatzleiter: alle | — |
| FüKW (Polizei) | 5 | gesamt | 1 / 3 | police_fukw: alle | — |
| WaWe 10 | 3 | gesamt | 5 / 5 | police_wasserwerfer: alle | — |
| GefKw | 1 | gesamt | 1 / 2 | — | — |
| SEK - MTF | 2 | gesamt | 9 / 9 | police_sek: alle | — |
| SEK - ZF | 6 | gesamt | 3 / 4 | police_sek: alle | — |
| MEK - MTF | 2 | gesamt | 9 / 9 | police_mek: alle | — |
| MEK - ZF | 6 | gesamt | 3 / 4 | police_mek: alle | — |
| DHuFüKW | 3 | gesamt | 1 / 2 | k9: alle | — |
| Pferdetransporter groß | 3 | gesamt | 2 / 2 | police_horse: nur an der EST | 4 |
| Zugfahrzeug Pferdetransport | 3 | gesamt | 1 / 6 | — | — |
| LauKw | 1 | gesamt | 5 / 5 | police_speaker_operator: alle | — |

 Fahrzeuge gesamt **48**, Vollbesetzung **244** Personen

**Ausbauten, die das Spiel anbietet** (11 insgesamt)

Alle im Profil enthalten.

---

## Schnelleinsatzgruppe (SEG)  `Typ 12`

Im Bestand: **3** Gebäude, Stufe 0

### Profil `crafted` — Vollausbau

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | fest 1, +1 je Führung, +4 je Sanitätsdienst, +3 je Wasserrettung, +2 je Rettungshundestaffel, +1 je SEG Drohne, +10 je Betreuungs- und Verpflegungsdienst, +6 je Technik und Sicherheit | 28 |
| **gesamt** | | **28** |

**Ausbauten**

Führung · Sanitätsdienst · Wasserrettung · Rettungshundestaffel · SEG Drohne · Betreuungs- und Verpflegungsdienst · Technik und Sicherheit

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| ELW 1 (SEG) | 1 | gesamt | 1 / 2 | seg_elw: alle | — |
| GW-San | 1 | gesamt | 6 / 6 | seg_gw_san: alle | — |
| RTW | 1 | gesamt | 1 / 2 | — | — |
| KTW Typ B | 3 | gesamt | 1 / 2 | — | — |
| GW-Wasserrettung | 1 | gesamt | 1 / 6 | gw_wasserrettung: alle | — |
| GW-Taucher | 1 | gesamt | 2 / 2 | gw_taucher: alle | — |
| MZB | 1 | gesamt | 0 / 0 | gw_wasserrettung: alle | 4 |
| Rettungshundefahrzeug | 2 | gesamt | 4 / 5 | seg_rescue_dogs: alle | — |
| GW UAS | 1 | gesamt | 4 / 4 | seg_drone: alle | — |
| Bt LKW | 4 | gesamt | 3 / 3 | care_service: min 1<br>care_service_equipment: min 2 | — |
| FKH | 1 | gesamt | 0 / 0 | — | — |
| GW-Bt | 2 | gesamt | 3 / 3 | care_service: min 1<br>care_service_equipment: min 2 | — |
| Bt-Kombi | 3 | gesamt | 1 / 9 | care_service: alle | — |
| GW TeSi | 2 | gesamt | 1 / 5 | disaster_response_technology: alle | — |
| MTW TeSi | 1 | gesamt | 1 / 7 | disaster_response_technology: min 1 | — |
| Anh TeSi | 1 | gesamt | 0 / 0 | disaster_response_technology: min 2 | — |
| LKW Technik (Notstrom) | 1 | gesamt | 2 / 6 | disaster_response_technology: min 1 | — |
| NEA50 | 1 | gesamt | 0 / 0 | disaster_response_technology: min 2 | — |

 Fahrzeuge gesamt **28**, Vollbesetzung **106** Personen

**Ausbauten, die das Spiel anbietet** (7 insgesamt)

Alle im Profil enthalten.

---

## Wasserrettung  `Typ 15`

Im Bestand: **10** Gebäude, Stufe 5

### Profil `crafted` — Wasserrettungswache

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 5 | 6 |
| **gesamt** | | **6** |

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| GW-Wasserrettung | 2 | normal | 1 / 6 | gw_wasserrettung: alle | — |
| GW-Taucher | 2 | normal | 2 / 2 | gw_taucher: alle | — |
| MZB | 2 | normal | 0 / 0 | gw_wasserrettung: alle | 4 |

 Fahrzeuge gesamt **6**, Vollbesetzung **16** Personen

---

## Polizei-Sondereinheiten  `Typ 17`

Im Bestand: **0** Gebäude

### Profil `crafted` — Vollausbau — 2 SEK-Züge, 2 MEK-Züge, Diensthunde

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | fest 0, +5 je SEK: 1. Zug, +5 je SEK: 2. Zug, +5 je MEK: 1. Zug, +5 je MEK: 2. Zug, +3 je Diensthundestaffel | 23 |
| **gesamt** | | **23** |

**Ausbauten**

SEK: 1. Zug · SEK: 2. Zug · MEK: 1. Zug · MEK: 2. Zug · Diensthundestaffel

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| FüKW (Polizei) | 4 | gesamt | 1 / 3 | police_fukw: alle | — |
| SEK - ZF | 6 | gesamt | 3 / 4 | police_sek: alle | — |
| SEK - MTF | 2 | gesamt | 9 / 9 | police_sek: alle | — |
| MEK - ZF | 6 | gesamt | 3 / 4 | police_mek: alle | — |
| MEK - MTF | 2 | gesamt | 9 / 9 | police_mek: alle | — |
| DHuFüKW | 3 | gesamt | 1 / 2 | k9: alle | — |

 Fahrzeuge gesamt **23**, Vollbesetzung **102** Personen

**Ausbauten, die das Spiel anbietet** (5 insgesamt)

Alle im Profil enthalten.

---

## Rettungshundestaffel  `Typ 21`

Im Bestand: **0** Gebäude

### Profil `crafted` — Vollausbau — 6 Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 0 | 1 |
| **gesamt** | | **1** |

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| Rettungshundefahrzeug | 6 | normal | 4 / 5 | seg_rescue_dogs: alle | — |

 Fahrzeuge gesamt **6**, Vollbesetzung **30** Personen

---

## Bergrettungswache  `Typ 25`

Im Bestand: **0** Gebäude

### Profil `crafted` — Vollausbau — 15 normale + 4 reservierte Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Normal | Stufe 0 | 1 |
| Höhenrettung | Höhenrettung × 2 | 2 |
| Hundestaffel | Rettungshundestaffel × 2 | 2 |
| **gesamt** | | **5** |

**Ausbauten**

Höhenrettung · Rettungshundestaffel · Drohneneinheit

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| GW-Bergrettung | 5 | normal | 3 / 6 | — | — |
| GW-Bergrettung (NEF) | 4 | normal | 3 / 6 | notarzt: min 1 | — |
| ELW Bergrettung | 1 | normal | 1 / 3 | mountain_command: alle | — |
| ATV | 3 | normal | 1 / 1 | — | — |
| Schneefahrzeug | 2 | normal | 1 / 1 | — | — |
| GW-Höhenrettung (Bergrettung) | 1 | hoehe | 4 / 4 | mountain_height_rescue: alle | — |
| Anh Höhenrettung (Bergrettung) | 1 | hoehe | 0 / 0 | mountain_height_rescue: min 4 | — |
| Hundestaffel (Bergrettung) | 2 | hunde | 4 / 5 | seg_rescue_dogs: alle | — |

 Fahrzeuge gesamt **19**, Vollbesetzung **76** Personen

**Ausbauten, die das Spiel anbietet** (4 insgesamt)

Nicht im Profil: Rettungsdienst `#3`

---

## Seenotrettungswache  `Typ 26`

Im Bestand: **0** Gebäude

### Profil `crafted` — Vollausbau — 5 Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 0 | 1 |
| **gesamt** | | **1** |

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| Seenotrettungskreuzer | 2 | normal | 4 / 9 | coastal_rescue: alle | — |
| Seenotrettungsboot | 3 | normal | 1 / 2 | — | — |

 Fahrzeuge gesamt **5**, Vollbesetzung **24** Personen

---

## Hubschrauberstation (Seenotrettung)  `Typ 28`

Im Bestand: **0** Gebäude

### Profil `crafted` — Ein Hubschrauber je Station

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Landeplatz | fest 1 | 1 |
| **gesamt** | | **1** |

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| Hubschrauber (Seenotrettung) | 1 | normal | 3 / 4 | coastal_helicopter: min 1<br>coastal_helicopter_lift: min 1<br>emergency_paramedic_water_rescue: min 1 | — |

 Fahrzeuge gesamt **1**, Vollbesetzung **4** Personen

---

## Autobahnpolizei  `Typ 29`

Im Bestand: **0** Gebäude

### Profil `crafted` — Vollausbau — Stufe 9, 10 Plätze

**Stellplätze**

| Topf | Herkunft | Plätze |
|---|---|---|
| Stellplätze | Stufe 0 | 1 |
| **gesamt** | | **1** |

**Ausbauten**

Zelle ×10

**Fahrzeuge**

| Fahrzeug | Anzahl | Topf | Besatzung | Ausbildung | EST |
|---|---|---|---|---|---|
| FuStW (AP) | 10 | normal | 2 / 2 | highway_police: alle | — |

 Fahrzeuge gesamt **10**, Vollbesetzung **20** Personen

**Ausbauten, die das Spiel anbietet** (10 insgesamt)

Alle im Profil enthalten.

---

