import { readFileSync, readdirSync } from "node:fs";

const reportPath = process.argv[2] ?? "coverage/lcov.info";
const threshold = Number(process.argv[3] ?? "80");
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  process.stderr.write("Threshold must be a percentage between 0 and 100.\n");
  process.exit(1);
}

const records = new Map();
let current;
for (const line of readFileSync(reportPath, "utf8").split("\n")) {
  if (line.startsWith("SF:")) current = line.slice(3).trim();
  else if (line.startsWith("LF:") && current) {
    const record = records.get(current) ?? { hit: 0, found: 0 };
    record.found = Number(line.slice(3));
    records.set(current, record);
  } else if (line.startsWith("LH:") && current) {
    const record = records.get(current) ?? { hit: 0, found: 0 };
    record.hit = Number(line.slice(3));
    records.set(current, record);
  } else if (line === "end_of_record") current = undefined;
}

function unloadedLines(source) {
  return source.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed === "*/") return false;
    return true;
  }).length;
}

let hit = 0;
let found = 0;
const rows = [];
for (const name of readdirSync("src").filter((entry) => entry.endsWith(".ts")).sort()) {
  const key = `src/${name}`;
  const record = records.get(key);
  if (record && record.found > 0) {
    hit += record.hit;
    found += record.found;
    rows.push({ key, hit: record.hit, found: record.found, loaded: true });
  } else {
    const lines = unloadedLines(readFileSync(key, "utf8"));
    found += lines;
    rows.push({ key, hit: 0, found: lines, loaded: false });
  }
}

const percent = found === 0 ? 100 : (100 * hit) / found;
for (const row of rows) {
  const pct = row.found === 0 ? 100 : (100 * row.hit) / row.found;
  const note = row.loaded ? "" : " (not loaded)";
  process.stdout.write(`${pct.toFixed(1).padStart(6)}%  ${String(row.hit).padStart(4)}/${String(row.found).padStart(4)}  ${row.key}${note}\n`);
}
process.stdout.write(`src line coverage ${percent.toFixed(1)}% (${hit}/${found}), threshold ${threshold}%\n`);
if (percent + 1e-9 < threshold) {
  process.stderr.write(`src line coverage ${percent.toFixed(1)}% is below ${threshold}%.\n`);
  process.exit(1);
}
