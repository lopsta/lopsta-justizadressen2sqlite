# AGENTS.md

## Projektziel

Dieses Projekt erzeugt Justizadressen im Lopsta-JSON-Format und baut daraus eine SQLite-Datenbank. Maßgeblich sind die Skripte in `scripts/`.

## Wichtige Vorgaben

- JSON-Ausgaben liegen unter `justizadressen__json/<YYYY-MM-DD__HHmmss>/`.
- SQLite-Ausgaben liegen unter `justizadressen__SQLite/<YYYY-MM-DD__HHmmss>/justizadressen.sqlite`.
- Logs liegen unter `__log/`.
- Bundeslandordner müssen den xÖV-Kennungen entsprechen: `BUND`, `BW`, `BY`, `BE`, `BB`, `HB`, `HH`, `HE`, `MV`, `NI`, `NW`, `RP`, `SL`, `SN`, `ST`, `SH`, `TH`.
- Das JSON-Schema darf ohne ausdrückliche Freigabe nicht erweitert werden.
- Das SQLite-Schema ist im Skript `scripts/sqlite__justizadressen__erstellen.js` definiert und maßgeblich.
- Fehlende `xjustiz-id` wird geloggt; dafür wird keine JSON-Datei erzeugt.
- Fehlende `lopsta-id` ist ein Fehler beim SQLite-Import. Der Grabber muss sie erzeugen.

## Standardbefehle

```powershell
npm install
npm run grab
npm run sqlite
npm run all
```

## Prüfungen

Nach Änderungen mindestens ausführen:

```powershell
node scripts/cdp__justizadressen__grabber.js --help
node scripts/sqlite__justizadressen__erstellen.js --help
node scripts/run-all.js --help
```

Wenn `better-sqlite3` installiert ist, zusätzlich einen Import gegen einen kleinen Test-Run prüfen.
