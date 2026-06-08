"use strict";

const fs = require("fs");
const path = require("path");

const DATABASE_DEFAULT = "justizadressen.sqlite";
const TYPE_TABLES = new Map([["2", "ag"], ["200", "lg"], ["20000", "olg"], ["S", "sta"], ["A", "arbg"], ["F", "fg"], ["Z", "sg"], ["W", "vg"], ["J", "jva"], ["V", "verfg"]]);
const EXCLUDED_TYPES = new Set(["AMBSOZJUST", "FUEHRAUFSI", "M", "O"]);
const BUND_TABLES = [
  { needle: "Bundesverfassungsgericht", table: "bverfg" },
  { needle: "Der Generalbundesanwalt", table: "gba" },
  { needle: "Bundesgerichtshof", table: "bgh" },
  { needle: "Bundesarbeitsgericht", table: "bag" },
  { needle: "Bundesfinanzhof", table: "bfh" },
  { needle: "Bundessozialgericht", table: "bsg" },
  { needle: "Bundesverwaltungsgericht", table: "bverwg" }
];
const BUNDESLAND_CODES = new Set(["BB", "BE", "BW", "BY", "HB", "HE", "HH", "MV", "NI", "NW", "RP", "SH", "SL", "SN", "ST", "TH", "BUND"]);

function pad(value) { return String(value).padStart(2, "0"); }
function localTimeString(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  return [date.getFullYear(), "-", pad(date.getMonth() + 1), "-", pad(date.getDate()), "T", pad(date.getHours()), ":", pad(date.getMinutes()), ":", pad(date.getSeconds()), sign, pad(Math.floor(absOffset / 60)), ":", pad(absOffset % 60)].join("");
}
function mkdirp(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function appendLog(options, message) { mkdirp(options.logDir); fs.appendFileSync(options.logPath, `${new Date().toISOString()} ${message}\n`, "utf8"); }
function findLatestRunDir(jsonRoot) {
  if (!fs.existsSync(jsonRoot)) throw new Error(`JSON-Basisordner nicht gefunden: ${jsonRoot}`);
  const dirs = fs.readdirSync(jsonRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => ({ name: entry.name, fullPath: path.join(jsonRoot, entry.name) })).sort((a, b) => b.name.localeCompare(a.name));
  if (dirs.length === 0) throw new Error(`Kein JSON-Run-Ordner gefunden in: ${jsonRoot}`);
  return dirs[0].fullPath;
}
function parseArgs(argv) {
  const projectRoot = path.resolve(__dirname, "..");
  const options = { projectRoot, runId: "", inputDir: "", jsonRoot: path.join(projectRoot, "justizadressen__json"), sqliteRoot: path.join(projectRoot, "justizadressen__SQLite"), databasePath: "", logDir: path.join(projectRoot, "__log"), errorLogPath: "", help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--project-root" && next) options.projectRoot = path.resolve(next), i += 1;
    else if (arg === "--run-id" && next) options.runId = next, i += 1;
    else if ((arg === "--input" || arg === "--source") && next) options.inputDir = path.resolve(next), i += 1;
    else if (arg === "--json-root" && next) options.jsonRoot = path.resolve(next), i += 1;
    else if (arg === "--sqlite-root" && next) options.sqliteRoot = path.resolve(next), i += 1;
    else if ((arg === "--db" || arg === "--database") && next) options.databasePath = path.resolve(next), i += 1;
    else if (arg === "--log-dir" && next) options.logDir = path.resolve(next), i += 1;
    else if (arg === "--error-log" && next) options.errorLogPath = path.resolve(next), i += 1;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unbekannte Option: ${arg}`);
  }
  if (options.help) return options;
  if (!options.inputDir) options.inputDir = options.runId ? path.join(options.jsonRoot, options.runId) : findLatestRunDir(options.jsonRoot);
  if (!options.runId) options.runId = path.basename(options.inputDir);
  if (!options.databasePath) options.databasePath = path.join(options.sqliteRoot, options.runId, DATABASE_DEFAULT);
  if (!options.errorLogPath) options.errorLogPath = path.join(options.logDir, `${options.runId}__sqlite-error.log`);
  options.logPath = path.join(options.logDir, `${options.runId}__sqlite.log`);
  return options;
}
function printHelp() {
  console.log(`Usage: node scripts/sqlite__justizadressen__erstellen.js [options]

Options:
  --run-id <id>          Timestring des JSON-Laufs
  --input <dir>          Konkreter JSON-Run-Ordner; Alias: --source
  --json-root <dir>      Basisordner der JSON-Laeufe (Default: justizadressen__json)
  --sqlite-root <dir>    Basisordner der SQLite-Laeufe (Default: justizadressen__SQLite)
  --db <file>            Konkrete SQLite-Datei (Default: <sqlite-root>/<run-id>/justizadressen.sqlite)
  --log-dir <dir>        Log-Verzeichnis (Default: __log)
  --error-log <file>     Fehlerbericht bei Importabbruch
  --help, -h             Hilfe anzeigen
`);
}
function requireBetterSqlite3() {
  try { return require("better-sqlite3"); }
  catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") throw new Error("Dependency fehlt: better-sqlite3. Bitte `npm install` ausfuehren, bevor das Skript gestartet wird.");
    throw error;
  }
}
function cleanText(value) { return value === undefined || value === null ? "" : String(value).trim(); }
function repairMojibake(value) {
  if (typeof value === "string") return /[ÃƒÃ‚]/.test(value) ? Buffer.from(value, "latin1").toString("utf8") : value;
  if (Array.isArray(value)) return value.map(repairMojibake);
  if (value && typeof value === "object") for (const key of Object.keys(value)) value[key] = repairMojibake(value[key]);
  return value;
}
function normalizeRecord(record, context, stand) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("JSON-Wurzel ist kein Objekt.");
  const normalized = {
    xjustiz_id: cleanText(record["xjustiz-id"]),
    lopsta_id: cleanText(record["lopsta-id"]),
    behoerdenkennung: context.behoerdenkennung,
    bundesland: cleanText(record.bundesland || context.bundesland),
    stand,
    name: cleanText(record.name),
    zusatz: cleanText(record.zusatz),
    hausanschrift_strasse: cleanText(record.hausanschrift && record.hausanschrift.strasse),
    hausanschrift_plz: cleanText(record.hausanschrift && record.hausanschrift.plz),
    hausanschrift_ort: cleanText(record.hausanschrift && record.hausanschrift.ort),
    postanschrift_postfach: cleanText(record.postanschrift && record.postanschrift.postfach),
    postanschrift_plz: cleanText(record.postanschrift && record.postanschrift.plz),
    postanschrift_ort: cleanText(record.postanschrift && record.postanschrift.ort),
    kontakt_telefon: cleanText(record.kontakt && record.kontakt.telefon),
    kontakt_fax: cleanText(record.kontakt && record.kontakt.fax),
    kontakt_email: cleanText(record.kontakt && record.kontakt.email),
    kontakt_www: cleanText(record.kontakt && record.kontakt.www),
    raw: record
  };
  if (!normalized.xjustiz_id) throw new Error("Pflichtfeld fehlt: xjustiz-id.");
  if (!normalized.lopsta_id) throw new Error(`Pflichtfeld fehlt: lopsta-id (${normalized.xjustiz_id}).`);
  if (!normalized.name) throw new Error(`Pflichtfeld fehlt: name (${normalized.xjustiz_id}).`);
  if (!normalized.bundesland) throw new Error(`Pflichtfeld fehlt: bundesland (${normalized.xjustiz_id}).`);
  if (context.bundesland !== "BUND" && normalized.bundesland !== context.bundesland) throw new Error(`Bundesland-Konflikt: Pfad=${context.bundesland}, JSON=${normalized.bundesland}, xjustiz-id=${normalized.xjustiz_id}.`);
  if (context.bundesland === "BUND" && normalized.bundesland !== "BUND") throw new Error(`BUND-Konflikt: Pfad=BUND, JSON=${normalized.bundesland}, xjustiz-id=${normalized.xjustiz_id}.`);
  return normalized;
}
function readJsonFile(filePath, context, stand) {
  try { return normalizeRecord(repairMojibake(JSON.parse(fs.readFileSync(filePath, "utf8"))), context, stand); }
  catch (error) { throw new Error(`JSON kann nicht gelesen werden: ${error.message}`); }
}
function discoverJsonFiles(sourceDir) {
  const jobs = [];
  if (!fs.existsSync(sourceDir)) throw new Error(`Quellordner nicht gefunden: ${sourceDir}`);
  for (const stateEntry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!stateEntry.isDirectory() || stateEntry.name.startsWith(".")) continue;
    const stateName = stateEntry.name;
    const stateDir = path.join(sourceDir, stateName);
    if (!BUNDESLAND_CODES.has(stateName)) throw new Error(`Unbekannter Bundeslandordner: ${stateDir}`);
    if (stateName === "BUND") {
      for (const fileEntry of fs.readdirSync(stateDir, { withFileTypes: true })) if (fileEntry.isFile() && path.extname(fileEntry.name).toLowerCase() === ".json") jobs.push({ filePath: path.join(stateDir, fileEntry.name), context: { bundesland: "BUND", behoerdenkennung: "BUND" } });
      continue;
    }
    for (const typeEntry of fs.readdirSync(stateDir, { withFileTypes: true })) {
      if (!typeEntry.isDirectory() || typeEntry.name.startsWith(".")) continue;
      const typeName = typeEntry.name;
      if (EXCLUDED_TYPES.has(typeName)) continue;
      if (!TYPE_TABLES.has(typeName)) throw new Error(`Unbekannte oder nicht unterstuetzte Behoerdenkennung: ${path.join(stateDir, typeName)}`);
      const typeDir = path.join(stateDir, typeName);
      for (const fileEntry of fs.readdirSync(typeDir, { withFileTypes: true })) if (fileEntry.isFile() && path.extname(fileEntry.name).toLowerCase() === ".json") jobs.push({ filePath: path.join(typeDir, fileEntry.name), context: { bundesland: stateName, behoerdenkennung: typeName } });
    }
  }
  return jobs.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
function qid(identifier) { return `"${String(identifier).replace(/"/g, "\"\"")}"`; }
function allHelperTables() { return [...new Set([...TYPE_TABLES.values(), ...BUND_TABLES.map((entry) => entry.table)])]; }
function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE justizadressen (
      xjustiz_id TEXT PRIMARY KEY,
      lopsta_id TEXT UNIQUE,
      behoerdenkennung TEXT NOT NULL,
      bundesland TEXT NOT NULL,
      stand TEXT NOT NULL,
      name TEXT NOT NULL,
      zusatz TEXT,
      hausanschrift_strasse TEXT,
      hausanschrift_plz TEXT,
      hausanschrift_ort TEXT,
      postanschrift_postfach TEXT,
      postanschrift_plz TEXT,
      postanschrift_ort TEXT,
      kontakt_telefon TEXT,
      kontakt_fax TEXT,
      kontakt_email TEXT,
      kontakt_www TEXT
    );
    CREATE TABLE dubletten (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      xjustiz_id TEXT,
      lopsta_id TEXT,
      behoerdenkennung TEXT,
      bundesland TEXT,
      name TEXT,
      hausanschrift_ort TEXT,
      konflikt_typ TEXT NOT NULL,
      json_inhalt TEXT NOT NULL
    );
  `);
  for (const table of allHelperTables()) db.exec(`CREATE TABLE ${qid(table)} (xjustiz_id TEXT PRIMARY KEY, name TEXT NOT NULL, ort TEXT, FOREIGN KEY (xjustiz_id) REFERENCES justizadressen(xjustiz_id) ON DELETE CASCADE);`);
}
function createIndexes(db) {
  db.exec(`
    CREATE INDEX idx_justizadressen_name ON justizadressen(name);
    CREATE INDEX idx_justizadressen_hausanschrift_ort ON justizadressen(hausanschrift_ort);
    CREATE INDEX idx_justizadressen_bundesland ON justizadressen(bundesland);
    CREATE INDEX idx_justizadressen_behoerdenkennung ON justizadressen(behoerdenkennung);
    CREATE INDEX idx_justizadressen_bundesland_behoerdenkennung ON justizadressen(bundesland, behoerdenkennung);
    CREATE INDEX idx_justizadressen_stand ON justizadressen(stand);
    CREATE INDEX idx_dubletten_xjustiz_id ON dubletten(xjustiz_id);
    CREATE INDEX idx_dubletten_lopsta_id ON dubletten(lopsta_id);
    CREATE INDEX idx_dubletten_konflikt_typ ON dubletten(konflikt_typ);
  `);
  for (const table of allHelperTables()) db.exec(`CREATE INDEX ${qid(`idx_${table}_name`)} ON ${qid(table)}(name); CREATE INDEX ${qid(`idx_${table}_ort`)} ON ${qid(table)}(ort); CREATE INDEX ${qid(`idx_${table}_ort_name`)} ON ${qid(table)}(ort, name);`);
}
function resolveHelperTable(record) {
  if (record.bundesland === "BUND") {
    const name = record.name.toLowerCase();
    const match = BUND_TABLES.find((entry) => name.includes(entry.needle.toLowerCase()));
    if (!match) throw new Error(`BUND-Datensatz kann keiner Hilfstabelle zugeordnet werden: ${record.name} (${record.xjustiz_id}).`);
    return match.table;
  }
  return TYPE_TABLES.get(record.behoerdenkennung) || "";
}
function prepareStatements(db) {
  const insertMain = db.prepare(`INSERT INTO justizadressen (xjustiz_id, lopsta_id, behoerdenkennung, bundesland, stand, name, zusatz, hausanschrift_strasse, hausanschrift_plz, hausanschrift_ort, postanschrift_postfach, postanschrift_plz, postanschrift_ort, kontakt_telefon, kontakt_fax, kontakt_email, kontakt_www) VALUES (@xjustiz_id, @lopsta_id, @behoerdenkennung, @bundesland, @stand, @name, @zusatz, @hausanschrift_strasse, @hausanschrift_plz, @hausanschrift_ort, @postanschrift_postfach, @postanschrift_plz, @postanschrift_ort, @kontakt_telefon, @kontakt_fax, @kontakt_email, @kontakt_www)`);
  const insertDuplicate = db.prepare(`INSERT INTO dubletten (xjustiz_id, lopsta_id, behoerdenkennung, bundesland, name, hausanschrift_ort, konflikt_typ, json_inhalt) VALUES (@xjustiz_id, @lopsta_id, @behoerdenkennung, @bundesland, @name, @hausanschrift_ort, @konflikt_typ, @json_inhalt)`);
  const helperInserts = new Map();
  for (const table of allHelperTables()) helperInserts.set(table, db.prepare(`INSERT INTO ${qid(table)} (xjustiz_id, name, ort) VALUES (@xjustiz_id, @name, @ort)`));
  return { insertMain, insertDuplicate, helperInserts };
}
function duplicateType(record, seenXjustiz, seenLopsta) {
  const conflicts = [];
  if (seenXjustiz.has(record.xjustiz_id)) conflicts.push("gleiche_xjustiz_id");
  if (seenLopsta.has(record.lopsta_id)) conflicts.push("gleiche_lopsta_id");
  return conflicts.join(",");
}
function insertDuplicate(stmt, record, conflictType) {
  stmt.run({ xjustiz_id: record.xjustiz_id, lopsta_id: record.lopsta_id, behoerdenkennung: record.behoerdenkennung, bundesland: record.bundesland, name: record.name, hausanschrift_ort: record.hausanschrift_ort, konflikt_typ: conflictType, json_inhalt: JSON.stringify(record.raw, null, 2) });
}
function removeExistingDatabase(databasePath) { for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
function writeErrorReport(errorLogPath, error, filePath) {
  mkdirp(path.dirname(errorLogPath));
  fs.writeFileSync(errorLogPath, ["Import abgebrochen", `Zeit: ${localTimeString()}`, filePath ? `Datei: ${filePath}` : "Datei: -", `Fehlertyp: ${error && error.name ? error.name : "Error"}`, `Fehlerbeschreibung: ${error && error.message ? error.message : String(error)}`, ""].join("\n"), "utf8");
}
function importDatabase(options) {
  const Database = requireBetterSqlite3();
  const jobs = discoverJsonFiles(options.inputDir);
  const stand = localTimeString();
  mkdirp(path.dirname(options.databasePath));
  mkdirp(options.logDir);
  appendLog(options, `[start] input=${options.inputDir} db=${options.databasePath}`);
  removeExistingDatabase(options.databasePath);
  const db = new Database(options.databasePath);
  let currentFile = "";
  const stats = { inputDir: options.inputDir, databasePath: options.databasePath, stand, files: jobs.length, inserted: 0, duplicates: 0 };
  try {
    createSchema(db);
    const statements = prepareStatements(db);
    const seenXjustiz = new Set();
    const seenLopsta = new Set();
    db.transaction(() => {
      for (const job of jobs) {
        currentFile = job.filePath;
        const record = readJsonFile(job.filePath, job.context, stand);
        const conflictType = duplicateType(record, seenXjustiz, seenLopsta);
        if (conflictType) {
          insertDuplicate(statements.insertDuplicate, record, conflictType);
          stats.duplicates += 1;
          appendLog(options, `[duplicate] ${conflictType}: ${record.xjustiz_id}`);
          continue;
        }
        const helperTable = resolveHelperTable(record);
        statements.insertMain.run(record);
        statements.helperInserts.get(helperTable).run({ xjustiz_id: record.xjustiz_id, name: record.name, ort: record.hausanschrift_ort });
        seenXjustiz.add(record.xjustiz_id);
        seenLopsta.add(record.lopsta_id);
        stats.inserted += 1;
      }
    })();
    createIndexes(db);
    db.pragma("optimize");
    if (fs.existsSync(options.errorLogPath)) fs.unlinkSync(options.errorLogPath);
    appendLog(options, `[done] files=${stats.files} inserted=${stats.inserted} duplicates=${stats.duplicates}`);
    return stats;
  } catch (error) {
    writeErrorReport(options.errorLogPath, error, currentFile);
    appendLog(options, `[error] ${error.stack || error.message}`);
    throw error;
  } finally { db.close(); }
}
async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  const stats = importDatabase(options);
  console.log(`Fertig. Datenbank: ${stats.databasePath}`);
  console.log(`Stand: ${stats.stand}`);
  console.log(`JSON-Dateien: ${stats.files}`);
  console.log(`Importiert: ${stats.inserted}`);
  console.log(`Dubletten: ${stats.duplicates}`);
  console.log(`Log: ${options.logPath}`);
}
if (require.main === module) main(process.argv).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { BUND_TABLES, EXCLUDED_TYPES, TYPE_TABLES, allHelperTables, discoverJsonFiles, findLatestRunDir, importDatabase, localTimeString, normalizeRecord, parseArgs, resolveHelperTable };

