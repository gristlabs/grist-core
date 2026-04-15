#!/usr/bin/env node
/**
 * Verifies that the `:nbrowser-...:` test-group regexes in
 * .github/workflows/main.yml form an exhaustive, non-overlapping partition of
 * every top-level describe() block under _build/test/nbrowser.
 *
 * Run after building (so _build/test/nbrowser/*.js exists):
 *   yarn build && node buildtools/check_test_groups.js
 *
 * Exits non-zero and prints offending names if any describe block matches zero
 * groups (would silently not run) or more than one (would run twice).
 *
 * The intent: someone can add a new nbrowser test file without worrying.
 * CI fails loudly if the regexes no longer cover the test namespace.
 *
 * This script only checks coverage, not balance.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const WORKFLOW = ".github/workflows/main.yml";
const TEST_DIR = "_build/test/nbrowser";

function extractGroupPatterns(workflowText) {
  // Matches lines like:  - ':nbrowser-^[A-D]:'   or   - ":nbrowser-^[A-D]:"
  const re = /['"]:nbrowser-([^:'"]+):['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(workflowText))) {
    out.push(m[1]);
  }
  if (out.length === 0) {
    throw new Error(`No :nbrowser-...: patterns found in ${WORKFLOW}`);
  }
  return out;
}

function findTopLevelDescribes(filePath) {
  // Top-level describe() in the compiled JS sits at column 0; nested ones are
  // indented. Match both quote styles.
  const text = fs.readFileSync(filePath, "utf8");
  const re = /^describe\s*\(\s*(['"`])([^'"`]+)\1/gm;
  const names = [];
  let m;
  while ((m = re.exec(text))) {
    names.push(m[2]);
  }
  return names;
}

function listTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(p));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

function main() {
  const workflowText = fs.readFileSync(WORKFLOW, "utf8");
  const patterns = extractGroupPatterns(workflowText);
  const regexes = patterns.map((p) => new RegExp(p));

  if (!fs.existsSync(TEST_DIR)) {
    console.error(`${TEST_DIR} not found — run \`yarn build\` first.`);
    process.exit(2);
  }

  const describeToFile = new Map();
  for (const file of listTestFiles(TEST_DIR)) {
    for (const name of findTopLevelDescribes(file)) {
      if (describeToFile.has(name) && describeToFile.get(name) !== file) {
        console.error(`Duplicate top-level describe '${name}' in ${file} and ${describeToFile.get(name)}`);
        process.exit(1);
      }
      describeToFile.set(name, file);
    }
  }

  const groupCount = patterns.map(() => 0);
  const unmatched = [];
  const multiMatched = [];

  for (const name of Array.from(describeToFile.keys()).sort()) {
    const hits = [];
    regexes.forEach((re, i) => { if (re.test(name)) { hits.push(i); } });
    if (hits.length === 0) { unmatched.push(name); continue; }
    if (hits.length > 1) { multiMatched.push({name, groups: hits.map((i) => patterns[i])}); continue; }
    groupCount[hits[0]] += 1;
  }

  console.log(`Patterns from ${WORKFLOW}:`);
  patterns.forEach((p, i) => {
    console.log(`  ${String(i+1).padStart(2)}. /${p}/  -> ${String(groupCount[i]).padStart(3)} describes`);
  });
  console.log(`  total: ${describeToFile.size} describes`);

  let ok = true;
  if (unmatched.length) {
    ok = false;
    console.error(`\n${unmatched.length} describe(s) match NO group (would not run in CI):`);
    for (const n of unmatched) { console.error(`  ${n}`); }
  }
  if (multiMatched.length) {
    ok = false;
    console.error(`\n${multiMatched.length} describe(s) match MULTIPLE groups (would run more than once):`);
    for (const {name, groups} of multiMatched) {
      console.error(`  ${name}: matches ${groups.map((g) => `/${g}/`).join(", ")}`);
    }
  }
  if (!ok) {
    console.error(`\nFix the :nbrowser-...: regexes in ${WORKFLOW} so every describe matches exactly one.`);
    process.exit(1);
  }
  console.log("\nOK: every top-level describe is in exactly one group.");
}

main();
