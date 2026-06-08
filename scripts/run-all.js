"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { createRunId } = require("./cdp__justizadressen__grabber");

function printHelp() {
  console.log(`Usage: node scripts/run-all.js [grabber-options] [--sqlite-args sqlite-options]

Examples:
  node scripts/run-all.js
  node scripts/run-all.js --state NW --typ 2 --max-pages 1
  node scripts/run-all.js --state NW --sqlite-args --db E:\\tmp\\justizadressen.sqlite

Alle Optionen vor --sqlite-args werden an den CDP-Grabber weitergereicht.
Alle Optionen nach --sqlite-args werden an den SQLite-Importer weitergereicht.
`);
}

function splitForwardedArgs(argv) {
  const grabArgs = [];
  const sqliteArgs = [];
  let target = grabArgs;
  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") return { help: true, grabArgs, sqliteArgs };
    if (arg === "--sqlite-args") {
      target = sqliteArgs;
      continue;
    }
    target.push(arg);
  }
  return { help: false, grabArgs, sqliteArgs };
}

function extractRunId(args) {
  const result = [];
  let runId = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--run-id") {
      if (!args[i + 1]) throw new Error("Option --run-id benoetigt einen Wert.");
      runId = args[i + 1];
      i += 1;
      continue;
    }
    result.push(arg);
  }
  return { args: result, runId };
}

function runNode(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
      cwd: path.resolve(__dirname, "..")
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} wurde mit Exit-Code ${code} beendet.`));
    });
  });
}

async function main(argv) {
  const parsed = splitForwardedArgs(argv);
  if (parsed.help) {
    printHelp();
    return;
  }

  const grab = extractRunId(parsed.grabArgs);
  const sqliteForward = extractRunId(parsed.sqliteArgs);
  if (grab.runId && sqliteForward.runId && grab.runId !== sqliteForward.runId) {
    throw new Error(`Widerspruechliche Run-IDs: Grabber=${grab.runId}, SQLite=${sqliteForward.runId}.`);
  }

  const runId = grab.runId || sqliteForward.runId || createRunId();
  const root = path.resolve(__dirname, "..");
  const grabber = path.join(__dirname, "cdp__justizadressen__grabber.js");
  const sqlite = path.join(__dirname, "sqlite__justizadressen__erstellen.js");

  console.log(`Run-ID: ${runId}`);
  await runNode(grabber, ["--run-id", runId, ...grab.args]);
  await runNode(sqlite, ["--run-id", runId, "--input", path.join(root, "justizadressen__json", runId), ...sqliteForward.args]);
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
