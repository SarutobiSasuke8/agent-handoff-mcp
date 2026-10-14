import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";

mkdirSync("coverage", { recursive: true });

const tests = [
  ...readdirSync("dist/test").filter((name) => name.endsWith(".test.js")).map((name) => `dist/test/${name}`),
  "dist/test/e2e/parity.test.js",
  "dist/test/e2e/recovery.test.js",
];

const result = spawnSync(process.execPath, [
  "--enable-source-maps",
  "--test",
  "--experimental-test-coverage",
  "--test-reporter=spec",
  "--test-reporter-destination=coverage/spec.txt",
  "--test-reporter=lcov",
  "--test-reporter-destination=coverage/lcov.info",
  ...tests,
], { stdio: "inherit" });

process.stdout.write(readFileSync("coverage/spec.txt", "utf8"));
if (result.status !== 0) process.exit(result.status ?? 1);

const gate = spawnSync(process.execPath, ["scripts/check-src-coverage.mjs", "coverage/lcov.info", "80"], { stdio: "inherit" });
process.exit(gate.status ?? 1);
