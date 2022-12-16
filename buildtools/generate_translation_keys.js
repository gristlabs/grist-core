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

async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
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

async function walkTranslation(dirPath) {
  for await (const p of walk(dirPath)) {
    const { name } = path.parse(p);
    getKeysFromFile(p, name);
  }
  const keys = parser.get({ sort: true });
  const newTranslations = _.merge(keys.en.translation, englishKeys);
  await fs.promises.writeFile(
    "static/locales/en.client.json",
    JSON.stringify(newTranslations, null, 2),
    "utf-8"
  );
  return keys;
}

walkTranslation("app/client");
