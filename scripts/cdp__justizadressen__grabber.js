"use strict";

let CDP;
function getCDP() {
  if (!CDP) CDP = require("chrome-remote-interface");
  return CDP;
}
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const BASE_URL = "https://www.justizadressen.nrw.de/de/justiz/behoerden";
const START_URL = "https://www.justizadressen.nrw.de/de/justiz/suche";
const UID_CHARS = "lopsta0123456789";
const SEGMENT_LENGTHS = [8, 4, 4, 4, 12];

const BEHOERDEN_TYPEN = [
  { typ: "2", name: "Amtsgerichte" },
  { typ: "200", name: "Landgerichte" },
  { typ: "20000", name: "Oberlandesgerichte" },
  { typ: "S", name: "Staatsanwaltschaften" },
  { typ: "A", name: "Arbeitsgerichte" },
  { typ: "F", name: "Finanzgerichte" },
  { typ: "Z", name: "Sozialgerichte" },
  { typ: "W", name: "Verwaltungsgerichte" },
  { typ: "J", name: "Justizvollzugsanstalten" },
  { typ: "V", name: "Verfassungsgerichte" }
];

const BUNDESLAENDER = [
  { lkz: "01", code: "SH", name: "Schleswig-Holstein" },
  { lkz: "02", code: "HH", name: "Hamburg" },
  { lkz: "03", code: "NI", name: "Niedersachsen" },
  { lkz: "04", code: "HB", name: "Bremen" },
  { lkz: "05", code: "NW", name: "Nordrhein-Westfalen" },
  { lkz: "06", code: "HE", name: "Hessen" },
  { lkz: "07", code: "RP", name: "Rheinland-Pfalz" },
  { lkz: "08", code: "BW", name: "Baden-Wuerttemberg" },
  { lkz: "09", code: "BY", name: "Bayern" },
  { lkz: "10", code: "SL", name: "Saarland" },
  { lkz: "11", code: "BE", name: "Berlin" },
  { lkz: "20", code: "BB", name: "Brandenburg" },
  { lkz: "21", code: "MV", name: "Mecklenburg-Vorpommern" },
  { lkz: "22", code: "SN", name: "Sachsen" },
  { lkz: "23", code: "ST", name: "Sachsen-Anhalt" },
  { lkz: "24", code: "TH", name: "Thueringen" }
];

const BUND_STATE = { lkz: "00", code: "BUND", name: "Bundesbehoerden" };
const BUND_XJUSTIZ_IDS = ["A1000", "Y6010", "D6263", "M6246", "B6232", "U8572", "A1000S"];
const BUND_XJUSTIZ_ID_SET = new Set(BUND_XJUSTIZ_IDS);

function rndChar() { return UID_CHARS.charAt(Math.floor(Math.random() * UID_CHARS.length)); }
function generateUID() {
  return `X${SEGMENT_LENGTHS.map((len) => Array.from({ length: len }, rndChar).join("")).join("-")}X`;
}
function pad(value) { return String(value).padStart(2, "0"); }
function createRunId(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}__${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function splitList(value) { return value.split(",").map((part) => part.trim()).filter(Boolean); }
function mkdirp(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeFileName(value) { return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_"); }

function parseArgs(argv) {
  const projectRoot = path.resolve(__dirname, "..");
  const options = {
    runId: createRunId(),
    jsonRoot: path.join(projectRoot, "justizadressen__json"),
    logDir: path.join(projectRoot, "__log"),
    host: "127.0.0.1",
    port: 9222,
    chromePath: "",
    keepBrowser: false,
    delayMs: 150,
    states: null,
    types: null,
    maxPages: 100,
    saveHtml: false,
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--run-id" && next) options.runId = next, i += 1;
    else if ((arg === "--json-root" || arg === "--out") && next) options.jsonRoot = path.resolve(next), i += 1;
    else if (arg === "--log-dir" && next) options.logDir = path.resolve(next), i += 1;
    else if (arg === "--host" && next) options.host = next, i += 1;
    else if (arg === "--port" && next) options.port = Number(next), i += 1;
    else if ((arg === "--chrome-path" || arg === "--chrome") && next) options.chromePath = path.resolve(next), i += 1;
    else if (arg === "--delay" && next) options.delayMs = Number(next), i += 1;
    else if (arg === "--max-pages" && next) options.maxPages = Number(next), i += 1;
    else if (arg === "--state" && next) options.states = splitList(next), i += 1;
    else if (arg === "--typ" && next) options.types = splitList(next), i += 1;
    else if (arg === "--keep-browser") options.keepBrowser = true;
    else if (arg === "--save-html") options.saveHtml = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unbekannte Option: ${arg}`);
  }
  options.runDir = path.join(options.jsonRoot, options.runId);
  options.logPath = path.join(options.logDir, `${options.runId}__cdp.log`);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/cdp__justizadressen__grabber.js [options]

Options:
  --run-id <id>          Timestring fuer diesen Lauf (Default: YYYY-MM-DD__HHmmss)
  --json-root <dir>      Basisordner fuer JSON-Laeufe (Default: justizadressen__json)
  --out <dir>            Alias fuer --json-root
  --log-dir <dir>        Log-Verzeichnis (Default: __log)
  --state <codes>        Kommagetrennte Bundeslandcodes, z.B. BUND,NW,BY oder 00,05,09
  --typ <typen>          Kommagetrennte Behoerdenkennungen, z.B. 2,20000,S
  --port <port>          CDP-Port (Default: 9222)
  --host <host>          CDP-Host (Default: 127.0.0.1)
  --chrome-path <path>   Chrome/Chromium-Pfad, falls automatische Suche scheitert
  --keep-browser         Gestarteten Chrome nach dem Lauf offen lassen
  --delay <ms>           Pause zwischen Seitenaufrufen (Default: 150)
  --max-pages <n>        Sicherheitslimit pro Bundesland/Typ (Default: 100)
  --save-html            HTML-Snapshots in .html-Unterordnern speichern
  --help, -h             Hilfe anzeigen
`);
}

function appendLog(options, message) {
  mkdirp(options.logDir);
  fs.appendFileSync(options.logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
async function canConnect(options) {
  try {
    const version = await getCDP().Version({ host: options.host, port: options.port });
    return Boolean(version && version.Browser);
  } catch (_) { return false; }
}
function findChromeExecutable(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error("Chrome/Edge wurde nicht gefunden. Bitte mit --chrome-path <pfad> angeben.");
}
async function ensureBrowser(options) {
  if (await canConnect(options)) {
    appendLog(options, `[browser] Vorhandene CDP-Verbindung: ${options.host}:${options.port}`);
    return { launched: null };
  }
  const chromePath = findChromeExecutable(options.chromePath);
  const userDataDir = path.join(os.tmpdir(), `lopsta-cdp-${Date.now()}`);
  mkdirp(userDataDir);
  const launched = spawn(chromePath, [`--remote-debugging-port=${options.port}`, `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", START_URL], { detached: false, stdio: "ignore" });
  appendLog(options, `[browser] Starte: ${chromePath}`);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await canConnect(options)) return { launched };
    await wait(250);
  }
  throw new Error(`Chrome wurde gestartet, CDP auf ${options.host}:${options.port} ist aber nicht erreichbar.`);
}
function buildUrl(state, type, page) {
  const params = new URLSearchParams();
  params.set("typ", type.typ);
  params.set("plzort", "");
  params.set("lkz", state.lkz);
  params.set("s", String(page));
  return `${BASE_URL}?${params.toString()}`;
}
function buildBundUrl() {
  const params = new URLSearchParams();
  params.set("typ", "");
  params.set("plzort", "");
  params.set("lkz", BUND_STATE.lkz);
  return `${BASE_URL}?${params.toString()}`;
}
function repairMojibake(value) {
  if (typeof value === "string") return /[ÃƒÃ‚]/.test(value) ? Buffer.from(value, "latin1").toString("utf8") : value;
  if (Array.isArray(value)) return value.map(repairMojibake);
  if (value && typeof value === "object") for (const key of Object.keys(value)) value[key] = repairMojibake(value[key]);
  return value;
}
function getSelectedStates(options) {
  const allStates = [BUND_STATE, ...BUNDESLAENDER];
  if (!options.states) return allStates;
  const selected = new Set(options.states.map((value) => value.toUpperCase()));
  const states = allStates.filter((state) => selected.has(state.code) || selected.has(state.lkz));
  if (states.length === 0) throw new Error(`Keine passenden Bundeslaender fuer --state ${options.states.join(",")} gefunden.`);
  return states;
}
function getSelectedTypes(options) {
  if (!options.types) return BEHOERDEN_TYPEN;
  const selected = new Set(options.types);
  const types = BEHOERDEN_TYPEN.filter((type) => selected.has(type.typ));
  if (types.length === 0) throw new Error(`Keine passenden Behoerdenkennungen fuer --typ ${options.types.join(",")} gefunden.`);
  return types;
}
async function navigateAndExtract(client, url, stateCode) {
  const { Page, Runtime } = client;
  const loadPromise = Page.loadEventFired();
  await Page.navigate({ url });
  await loadPromise.catch(() => null);
  const result = await Runtime.evaluate({ awaitPromise: true, returnByValue: true, expression: `(${pageExtractor.toString()})(${JSON.stringify(stateCode)})` });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Fehler bei Runtime.evaluate");
  return repairMojibake(result.result.value);
}
function pageExtractor(stateCode) {
  function clean(value) { return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim(); }
  function linesFrom(element) { return clean(element ? element.innerText : "").split(/\n+/).map(clean).filter(Boolean); }
  function parsePostalLine(value) { const match = clean(value).match(/^(\d{5})\s+(.+)$/); return match ? { plz: match[1], ort: clean(match[2]) } : { plz: "", ort: "" }; }
  function parseAddress(address, label) {
    const lines = linesFrom(address);
    if (lines[0] && lines[0].toLowerCase() === label.toLowerCase()) lines.shift();
    const postalIndex = lines.findIndex((line) => /^\d{5}\s+/.test(line));
    const postal = parsePostalLine(postalIndex >= 0 ? lines[postalIndex] : "");
    return { beforePostal: postalIndex > 0 ? lines.slice(0, postalIndex).join(", ") : "", plz: postal.plz, ort: postal.ort };
  }
  function parseContact(address) {
    const kontakt = { telefon: "", fax: "", email: "", www: "" };
    for (const line of linesFrom(address)) {
      let match = line.match(/^Telefon:\s*(.+)$/i); if (match) kontakt.telefon = clean(match[1]);
      match = line.match(/^Fax:\s*(.+)$/i); if (match) kontakt.fax = clean(match[1]);
      match = line.match(/^Internet:\s*(.+)$/i); if (match) kontakt.www = clean(match[1]).replace(/\s+/g, "");
      match = line.match(/^E-Mail:\s*(.+)$/i); if (match) kontakt.email = clean(match[1]);
    }
    const mailLink = address && address.querySelector('a[href^="mailto:"]');
    if (mailLink) kontakt.email = clean(mailLink.getAttribute("href").replace(/^mailto:/i, ""));
    const webLink = address && Array.from(address.querySelectorAll("a[href]")).map((link) => link.getAttribute("href")).find((href) => /^https?:\/\//i.test(href || ""));
    if (webLink) kontakt.www = clean(webLink);
    return kontakt;
  }
  function findAddress(row, label) { return Array.from(row.querySelectorAll("address")).find((address) => clean(address.querySelector("strong") && address.querySelector("strong").innerText).toLowerCase() === label.toLowerCase()); }
  function findContact(row) { return Array.from(row.querySelectorAll("address")).find((address) => clean(address.querySelector("strong") && address.querySelector("strong").innerText).toLowerCase() === "kontakt"); }
  function findXJustiz(row) { const match = clean(row.innerText).match(/XJustiz-ID:\s*([A-Z0-9._-]+)/i); return match ? clean(match[1]) : ""; }
  const main = document.querySelector("main") || document.body;
  const html = main ? main.outerHTML : document.documentElement.outerHTML;
  const records = [];
  const missingXjustiz = [];
  for (const heading of Array.from(main.querySelectorAll("h6"))) {
    const row = heading.nextElementSibling;
    if (!row || !row.classList.contains("row")) continue;
    const lieferanschrift = parseAddress(findAddress(row, "Lieferanschrift"), "Lieferanschrift");
    const postanschrift = parseAddress(findAddress(row, "Postanschrift"), "Postanschrift");
    const record = {
      "xjustiz-id": findXJustiz(row), "lopsta-id": "", name: clean(heading.innerText), zusatz: "",
      hausanschrift: { strasse: lieferanschrift.beforePostal, plz: lieferanschrift.plz, ort: lieferanschrift.ort },
      postanschrift: { postfach: postanschrift.beforePostal, plz: postanschrift.plz, ort: postanschrift.ort },
      kontakt: parseContact(findContact(row)), bundesland: stateCode
    };
    if (record["xjustiz-id"]) records.push(record);
    else missingXjustiz.push({ name: record.name, bundesland: stateCode, rawText: clean(row.innerText) });
  }
  return { html, records, missingXjustiz, title: clean(document.title), url: location.href };
}
function writeRecord(filePath, record) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
async function writeBundRecords(client, options) {
  const extracted = await navigateAndExtract(client, buildBundUrl(), BUND_STATE.code);
  const bundDir = path.join(options.runDir, BUND_STATE.code);
  const htmlDir = path.join(bundDir, ".html");
  if (options.saveHtml) {
    mkdirp(htmlDir);
    fs.writeFileSync(path.join(htmlDir, "001.html"), extracted.html, "utf8");
  }

  const recordsByXjustiz = new Map();
  for (const record of extracted.records || []) {
    const xjustizId = record["xjustiz-id"];
    if (!BUND_XJUSTIZ_ID_SET.has(xjustizId)) continue;
    if (recordsByXjustiz.has(xjustizId)) throw new Error(`BUND-Datensatz doppelt gefunden: ${xjustizId}.`);
    recordsByXjustiz.set(xjustizId, record);
  }

  const missing = BUND_XJUSTIZ_IDS.filter((xjustizId) => !recordsByXjustiz.has(xjustizId));
  if (missing.length > 0) throw new Error(`BUND-Datensaetze fehlen in der Quelle: ${missing.join(", ")}.`);

  let count = 0;
  for (const xjustizId of BUND_XJUSTIZ_IDS) {
    const record = recordsByXjustiz.get(xjustizId);
    record["lopsta-id"] = generateUID();
    writeRecord(path.join(bundDir, `${safeFileName(xjustizId)}.json`), record);
    count += 1;
  }
  appendLog(options, `[bund] ${count} Datensaetze geschrieben`);
  return { count, htmlPages: options.saveHtml ? 1 : 0 };
}
async function run(options) {
  mkdirp(options.runDir);
  mkdirp(options.logDir);
  appendLog(options, `[start] runId=${options.runId} output=${options.runDir}`);
  const states = getSelectedStates(options);
  const includeBund = states.some((state) => state.code === BUND_STATE.code);
  const normalStates = states.filter((state) => state.code !== BUND_STATE.code);
  const types = normalStates.length > 0 ? getSelectedTypes(options) : [];
  let jsonFiles = 0;
  let htmlPages = 0;
  let missingXjustiz = 0;
  const browser = await ensureBrowser(options);
  const cdp = getCDP();
  const target = await cdp.New({ host: options.host, port: options.port });
  const client = await cdp({ host: options.host, port: options.port, target });
  const { Page, Runtime } = client;
  try {
    await Page.enable();
    await Runtime.enable();
    if (includeBund) {
      const written = await writeBundRecords(client, options);
      jsonFiles += written.count;
      htmlPages += written.htmlPages;
    }
    for (const state of normalStates) {
      for (const type of types) {
        const typeDir = path.join(options.runDir, state.code, type.typ);
        const htmlDir = path.join(typeDir, ".html");
        mkdirp(typeDir);
        if (options.saveHtml) mkdirp(htmlDir);
        for (let page = 1; page <= options.maxPages; page += 1) {
          const url = buildUrl(state, type, page);
          const extracted = await navigateAndExtract(client, url, state.code);
          for (const missing of extracted.missingXjustiz || []) {
            missingXjustiz += 1;
            appendLog(options, `[missing-xjustiz] ${state.code}/${type.typ} Seite ${page}: ${JSON.stringify(missing)}`);
          }
          if (extracted.records.length === 0) { appendLog(options, `[leer] ${state.code}/${type.typ} Seite ${page}`); break; }
          if (options.saveHtml) { fs.writeFileSync(path.join(htmlDir, `${String(page).padStart(3, "0")}.html`), extracted.html, "utf8"); htmlPages += 1; }
          for (const record of extracted.records) {
            record["lopsta-id"] = generateUID();
            writeRecord(path.join(typeDir, `${safeFileName(record["xjustiz-id"])}.json`), record);
            jsonFiles += 1;
          }
          appendLog(options, `[ok] ${state.code}/${type.typ} Seite ${page}: ${extracted.records.length} Datensaetze`);
          await wait(options.delayMs);
        }
      }
    }
  } finally {
    await client.close().catch(() => null);
    await cdp.Close({ host: options.host, port: options.port, id: target.id }).catch(() => null);
    if (browser.launched && !options.keepBrowser) browser.launched.kill();
  }
  appendLog(options, `[done] jsonFiles=${jsonFiles} htmlPages=${htmlPages} missingXjustiz=${missingXjustiz}`);
  return { runId: options.runId, runDir: options.runDir, logPath: options.logPath, jsonFiles, htmlPages, missingXjustiz };
}
async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  const result = await run(options);
  console.log(`Fertig. Run-ID: ${result.runId}`);
  console.log(`JSON-Dateien: ${result.jsonFiles}`);
  console.log(`Ausgabe: ${result.runDir}`);
  console.log(`Log: ${result.logPath}`);
}
if (require.main === module) {
  main(process.argv).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
module.exports = { BEHOERDEN_TYPEN, BUNDESLAENDER, BUND_STATE, BUND_XJUSTIZ_IDS, buildBundUrl, buildUrl, createRunId, generateUID, pageExtractor, parseArgs, run };



