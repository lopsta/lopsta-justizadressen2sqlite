---
name: justizadressen-sqlite
description: Erzeugt Lopsta-Justizadressen-JSON per Chrome DevTools Protocol aus justizadressen.nrw.de und baut daraus die projektkonforme SQLite-Datenbank. Use when Codex needs to run, inspect, repair, or extend the Justizadressen grabber, JSON run folders, SQLite import, logging, or the bundled scripts for lopsta-justizadressen2sqlite.
---

# Justizadressen SQLite

Arbeite mit den Skripten in `scripts/` dieses Skills, wenn eine portable Skill-Kopie benötigt wird. Im Projekt selbst sind die Root-Skripte unter `scripts/` die primäre Ausführungsquelle.

## Workflow

1. JSON erzeugen:
   ```powershell
   node scripts/cdp__justizadressen__grabber.js
   ```
2. SQLite erzeugen:
   ```powershell
   node scripts/sqlite__justizadressen__erstellen.js
   ```
3. Komplettlauf im Projekt bevorzugt über:
   ```powershell
   npm run all
   ```

## Konventionen

- JSON-Run-Ordner: `justizadressen__json/<YYYY-MM-DD__HHmmss>/`.
- SQLite-Run-Ordner: `justizadressen__SQLite/<YYYY-MM-DD__HHmmss>/justizadressen.sqlite`.
- Logs: `__log/`.
- Bundeslandcodes: `BUND`, `BW`, `BY`, `BE`, `BB`, `HB`, `HH`, `HE`, `MV`, `NI`, `NW`, `RP`, `SL`, `SN`, `ST`, `SH`, `TH`.
- `BUND` ist ein eigener `--state`-Wert und wird per CDP aus `lkz=00` abgerufen; die Ausgabe wird auf die projekterwarteten XJustiz-IDs gefiltert.
- Das JSON-Schema ist exakt durch `assets/justizadresse.example.json` vorgegeben.
- Der Grabber erzeugt `lopsta-id` selbst.
- Datensätze ohne `xjustiz-id` nicht schreiben, sondern loggen.
- Das SQLite-Schema aus `sqlite__justizadressen__erstellen.js` nicht ohne ausdrückliche Anforderung ändern.

## Validierung

Nach Änderungen Hilfeausgaben und JSON-Syntax prüfen:

```powershell
node scripts/cdp__justizadressen__grabber.js --help
node scripts/sqlite__justizadressen__erstellen.js --help
```

Wenn Dependencies installiert sind, kleine Laeufe mit `--state BUND` und `--state BUND,NW --typ 2 --max-pages 1` testen und anschließend den SQLite-Import gegen den erzeugten Run ausführen.
