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
const englishKeys = require("../static/locales/en.client.json");
const _ = require("lodash");

const parser = new Parser({
  keySeparator: "/",
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
  const keyWithFile = `${fileName}/${key}`;
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
function merge(target, scanned) {
  let merges = 0;
  for (const key of Object.keys(scanned)) {
    if (!(key in target)) {
      console.log("Merging key", {key});
      target[key] = scanned[key];
      merges++;
    } else if (typeof target[key] === 'object') {
      merges += merge(target[key], scanned[key]);
    } else if (scanned[key] !== target[key]) {
      if (!key.endsWith('_one')) {
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
    if (p.endsWith('.map')) { continue; }
    getKeysFromFile(p, name);
  }
  const keys = parser.get({ sort: true });
  const foundKeys = _.cloneDeep(keys.en.translation);
  const mergeCount = merge(englishKeys, sort(keys.en.translation));
  await fs.promises.writeFile(
    "static/locales/en.client.json",
    JSON.stringify(englishKeys, null, 4) + '\n',  // match weblate's default
    "utf-8"
  );
  // Now, print a report of unrecognized keys - candidates
  // for deletion in weblate.
  const unknownCount = reportUnrecognizedKeys(originalKeys, foundKeys);
  console.log(`Found ${unknownCount} unknown key(s).`);
  console.log(`Make ${mergeCount} merge(s).`);
}

walkTranslation(["_build/app/client", ...process.argv.slice(2)]);
