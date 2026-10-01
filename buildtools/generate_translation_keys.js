/**
 * Generating translations keys:
 *
 * This code walk through all the files in client directory and its children
 * Get the all keys called by our makeT utils function
 * And add only the new one on our en.client.json file
 *
 */

const fs = require("fs");
const path = require("path");
const Parser = require("i18next-scanner").Parser;
const _ = require("lodash");

// Where to read and write the English keys. Defaults to the core file that weblate uses;
// ext and app pass their own file with --out.
const outFile = readOutFile() || "assets/locales/en.client.json";
const englishKeys = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf-8")) : {};

// Joins the section (file name) with the key. Any character that never appears in UI text
// works; a real character such as "/" would split the text itself into nested keys.
const SECTION_SEPARATOR = "\u0001";

const parser = new Parser({
  keySeparator: SECTION_SEPARATOR,
  nsSeparator: null,
});

async function* walk(dirs) {
  for (const dir of dirs) {
    for await (const d of await fs.promises.opendir(dir)) {
      const entry = path.join(dir, d.name);
      if (d.isDirectory()) yield* walk([entry]);
      else if (d.isFile()) yield entry;
    }
  }
}

const customHandler = (fileName) => (key, options) => {
  const keyWithFile = `${fileName}${SECTION_SEPARATOR}${key}`;
  if (Object.keys(options).includes("count") === true) {
    const keyOne = `${keyWithFile}_one`;
    const keyOther = `${keyWithFile}_other`;
    parser.set(keyOne, key);
    parser.set(keyOther, key);
  } else {
    parser.set(keyWithFile, key);
  }
};

function sort(obj) {
  if (typeof obj !== "object" || Array.isArray(obj))
    return obj;
  const sortedObject = {};
  const keys = Object.keys(obj).sort();
  keys.forEach(key => sortedObject[key] = sort(obj[key]));
  return sortedObject;
}

const getKeysFromFile = (filePath, fileName) => {
  const content = fs.readFileSync(filePath, "utf-8");
  parser.parseFuncFromString(
    content,
    {
      list: [
        "i18next.t",
        "t", // To match the file-level t function created with makeT
      ],
    },
    customHandler(fileName)
  );
  const keys = parser.get({ sort: true });
  return keys;
};

// It is highly desirable to retain existing order, to not generate
// unnecessary merges/conflicts, so we do a specialized merge.
function merge(target, scanned, newKeys = []) {
  let merges = 0;
  for (const key of Object.keys(scanned)) {
    if (!(key in target)) {
      console.log("Merging key", {key});
      newKeys.push(key);
      target[key] = scanned[key];
      merges++;
    } else if (typeof target[key] === "object") {
      merges += merge(target[key], scanned[key], newKeys);
    } else if (scanned[key] !== target[key]) {
      if (!key.endsWith("_one")) {
        console.log("Value difference", {key, value: target[key]});
      }
    }
  }
  return merges;
}

// Look for keys that are listed in json file but not found in source
// code. These may be stale and need deleting in weblate.
function reportUnrecognizedKeys(originalKeys, foundKeys) {
  let unknowns = 0;
  for (const section of Object.keys(originalKeys)) {
    if (!(section in foundKeys)) {
      console.log("Unknown section found", {section});
      unknowns++;
    } else {
      for (const key of Object.keys(originalKeys[section])) {
        if (!(key in foundKeys[section])) {
          console.log("Unknown key found", {section, key});
          unknowns++;
        }
      }
    }
  }
  return unknowns;
}

async function walkTranslation(dirs) {
  const originalKeys = _.cloneDeep(englishKeys);
  for await (const p of walk(dirs)) {
    const { name } = path.parse(p);
    if (p.endsWith(".map")) { continue; }
    getKeysFromFile(p, name);
  }
  const keys = parser.get({ sort: true });
  const foundKeys = _.cloneDeep(keys.en.translation);
  const newKeys = [];
  const mergeCount = merge(englishKeys, sort(keys.en.translation), newKeys);
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  await fs.promises.writeFile(
    outFile,
    JSON.stringify(englishKeys, null, 4) + "\n",  // match weblate's default
    "utf-8"
  );
  // Now, print a report of unrecognized keys - candidates
  // for deletion in weblate.
  const unknownCount = reportUnrecognizedKeys(originalKeys, foundKeys);
  console.log(`Found ${unknownCount} unknown key(s).`);
  console.log(`Make ${mergeCount} merge(s).`);
  // Print a summary for use in PR descriptions.
  if (newKeys.length > 0) {
    console.log("TRANSLATION_SUMMARY_START");
    console.log(`Added ${newKeys.length} new translation key(s):\n`);
    for (const key of newKeys.slice(0, 20)) {
      console.log(`- \`${key}\``);
    }
    if (newKeys.length > 20) {
      console.log(`- ... and ${newKeys.length - 20} more`);
    }
    console.log("TRANSLATION_SUMMARY_END");
  }
}

walkTranslation(readDirs());

// Reads the --out option, which says which file to update.
function readOutFile() {
  const index = process.argv.indexOf("--out");
  return index === -1 ? null : process.argv[index + 1];
}

// Reads the directories to scan. The core client directory is scanned by default, but with
// --out only the given directories are scanned.
function readDirs() {
  const args = process.argv.slice(2).filter((arg, i, all) =>
    arg !== "--out" && all[i - 1] !== "--out");
  return readOutFile() ? args : ["_build/app/client", ...args];
}
