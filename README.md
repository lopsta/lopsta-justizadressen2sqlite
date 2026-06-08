# lopsta-justizadressen2sqlite

Dieses Projekt ruft Justizadressen von `https://www.justizadressen.nrw.de/de/justiz/suche` beziehungsweise den zugehörigen Behördenlisten per Chrome DevTools Protocol ab, speichert sie als JSON-Dateien im Lopsta-Format und erzeugt daraus eine SQLite-Datenbank.

## Projektstruktur

```text
lopsta-justizadressen2sqlite/
  package.json
  README.md
  AGENTS.md
  scripts/
    cdp__justizadressen__grabber.js
    sqlite__justizadressen__erstellen.js
    run-all.js
  skills/
    justizadressen-sqlite/
      SKILL.md
      agents/openai.yaml
      assets/justizadresse.example.json
      scripts/
        cdp__justizadressen__grabber.js
        sqlite__justizadressen__erstellen.js
  justizadressen__json/
  justizadressen__SQLite/
  __log/
  tools/sqlitebrowser/
```

## Installation

Voraussetzungen:

- Node.js 20 oder neuer
- lokal installiertes Chrome, Chromium oder Microsoft Edge
- Windows PowerShell für die dokumentierten Beispielbefehle

Installation:

```powershell
cd <dein\verzeichnis>\lopsta-justizadressen2sqlite
npm install
```

Die SQLite-Erzeugung verwendet `better-sqlite3`. Wenn die Installation native Build-Werkzeuge verlangt, müssen die üblichen Node-Gyp/VSC++ Build Tools auf Windows verfügbar sein.

## Standardablauf

Kompletter Lauf mit gemeinsamem Timestring:

```powershell
npm run all
```

Das Skript `scripts/run-all.js` erzeugt eine Run-ID im Format `YYYY-MM-DD__HHmmss`, ruft zuerst den CDP-Grabber auf und erzeugt anschließend aus exakt diesem JSON-Run die SQLite-Datenbank.

Ergebnis:

```text
justizadressen__json/<run-id>/...
justizadressen__SQLite/<run-id>/justizadressen.sqlite
__log/<run-id>__cdp.log
__log/<run-id>__sqlite.log
```

## JSON erzeugen

```powershell
npm run grab
```

Wichtige Optionen:

```powershell
node scripts/cdp__justizadressen__grabber.js --help
```

Beispiele:

```powershell
node scripts/cdp__justizadressen__grabber.js --state NW,BY --typ 2,20000,S
node scripts/cdp__justizadressen__grabber.js --state BUND
node scripts/cdp__justizadressen__grabber.js --state BUND,NW --typ 2 --max-pages 1
node scripts/cdp__justizadressen__grabber.js --run-id 2026-06-07__143012
node scripts/cdp__justizadressen__grabber.js --chrome-path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

Der Grabber startet einen lokal installierten Chrome/Edge mit Remote-Debugging. Wenn der Browser nicht automatisch gefunden wird, kann `--chrome-path` gesetzt werden.
`BUND` ist ein eigener `--state`-Wert. Ohne `--state` werden `BUND` und alle Bundeslaender erzeugt; mit `--state BUND` nur die gefilterten BUND-Datensaetze. `--typ` wirkt nur auf Nicht-BUND-Datensaetze.

## JSON-Ablage

Die JSON-Dateien werden je Lauf unter `justizadressen__json/<run-id>/` gespeichert.

Bundesländer und `BUND` verwenden xÖV-kompatible Ordnerkennungen:

```text
BUND, BW, BY, BE, BB, HB, HH, HE, MV, NI, NW, RP, SL, SN, ST, SH, TH
```

Nicht-BUND-Datensätze liegen unter:

```text
justizadressen__json/<run-id>/<bundesland>/<behoerdenkennung>/<xjustiz-id>.json
```

BUND-Datensätze liegen flach unter:

```text
justizadressen__json/<run-id>/BUND/<xjustiz-id>.json
```

Die BUND-Datensaetze werden ueber `https://www.justizadressen.nrw.de/de/justiz/behoerden?typ=&plzort=&lkz=00` abgerufen und auf die projektkonformen Bundesgerichte beziehungsweise den Generalbundesanwalt gefiltert:

```text
A1000, Y6010, D6263, M6246, B6232, U8572, A1000S
```

Wenn eine Adresse keine `xjustiz-id` enthält, wird keine JSON-Datei geschrieben. Der Vorfall wird in `__log/<run-id>__cdp.log` protokolliert.

## JSON-Format

```json
{
  "xjustiz-id": "",
  "lopsta-id": "",
  "name": "",
  "zusatz": "",
  "hausanschrift": {
    "strasse": "",
    "plz": "",
    "ort": ""
  },
  "postanschrift": {
    "postfach": "",
    "plz": "",
    "ort": ""
  },
  "kontakt": {
    "telefon": "",
    "fax": "",
    "email": "",
    "www": ""
  },
  "bundesland": ""
}
```

Die `lopsta-id` wird vom Grabber erzeugt. Das Muster ist:

```js
const UID_CHARS = 'lopsta0123456789';
const SEGMENT_LENGTHS = [8,4,4,4,12];
```

Die ID hat die Form `Xxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxxX`.

## SQLite erzeugen

```powershell
npm run sqlite
```

Ohne weitere Optionen verwendet das SQLite-Skript automatisch den neuesten Run-Ordner unter `justizadressen__json/`.

Wichtige Optionen:

```powershell
node scripts/sqlite__justizadressen__erstellen.js --help
```

Beispiele:

```powershell
node scripts/sqlite__justizadressen__erstellen.js --run-id 2026-06-07__143012
node scripts/sqlite__justizadressen__erstellen.js --input <dein\verzeichnis>\justizadressen__json\2026-06-07__143012
node scripts/sqlite__justizadressen__erstellen.js --db <dein\verzeichnis>\tmp\justizadressen.sqlite
```

Die Datenbank heißt standardmäßig immer `justizadressen.sqlite`. Das Erzeugungsdatum ergibt sich aus dem Run-Ordner.

## SQLite-Schema

Das Schema wird in `scripts/sqlite__justizadressen__erstellen.js` erzeugt. Es enthält die Haupttabelle `justizadressen`, eine Tabelle `dubletten` und Hilfstabellen für Behördenarten beziehungsweise Bundesgerichte.

Dubletten nach `xjustiz_id` oder `lopsta_id` werden nicht in die Haupttabelle importiert, sondern in `dubletten` dokumentiert.

## Logs

Alle Logdateien liegen in `__log/`.

- `<run-id>__cdp.log`: Abruf, leere Seiten, fehlende XJustiz-IDs
- `<run-id>__sqlite.log`: Importlauf, Dubletten, Abschlussstatistik
- `<run-id>__sqlite-error.log`: Fehlerbericht bei Importabbruch

## SQLite Browser

Die portable Version von DB Browser for SQLite soll hier liegen:

```text
tools/sqlitebrowser/SQLiteDatabaseBrowserPortable_3.13.1.paf.exe
```

Start über npm:

```powershell
npm run sqlite:browser
```

Die Datei ist ein PortableApps-Installer und wird nicht automatisch ausgeführt oder entpackt.

Manueller Download, falls der automatische Download nicht möglich ist:

```text
https://github.com/sqlitebrowser/sqlitebrowser/releases/download/v3.13.1/SQLiteDatabaseBrowserPortable_3.13.1.paf.exe
```

Die Datei muss anschließend exakt unter `tools\sqlitebrowser\SQLiteDatabaseBrowserPortable_3.13.1.paf.exe` abgelegt werden.

## Lokaler Codex-Skill

Der lokale Skill liegt unter:

```text
skills/justizadressen-sqlite/
```

Er enthält echte Kopien der beiden Hauptskripte und ein Beispiel-JSON unter `assets/`.

Für automatische Codex-Erkennung kann der Skill nach `%USERPROFILE%\.codex\skills\justizadressen-sqlite` kopiert oder verlinkt werden.

PowerShell-Beispiel für eine Kopie:

```powershell
Copy-Item -Recurse -Force `
  <dein\verzeichnis>\lopsta-justizadressen2sqlite\skills\justizadressen-sqlite `
  $env:USERPROFILE\.codex\skills\justizadressen-sqlite
```
