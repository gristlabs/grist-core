/**
 * Stratégie de traduction :
 * - valider sur la convention proposée par Yohan sur https://github.com/gristlabs/grist-core/issues/336
 * - migrer les anciennes clefs vers la nouvelle convention
 *   - soit à la main
 *   - soit en utilisant un script (en itérant sur le json)
 * - pour les nouvelles clefs, utiliser la nouvelle convention
 * - de cette manière l'anglais devrait fonctionner "tout seul", modulo éventuellement une amélioration de makeT notamment dans le cas des interpolations
 * - pour les autres langues, il faudra extraire toutes les clefs dans les en.*.json
 * - ci-dessous un tout début de script pour le faire sur un fichier unique
 * - il faudra ensuite itérer sur tous les fichiers, et merger l'extraction avec les en.*.json existants
 */


const fs = require('fs');
const path = require('path');
const Parser = require('i18next-scanner').Parser;
const englishKeys = require('../static/locales/en.client.json');
const _ = require('lodash');


const parser = new Parser({
  keySeparator: '/',
  nsSeparator: null,
});

async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    // d.isDirectory() && console.log(d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
  }
}

const customHandler = (fileName) => (key, options) => {
  const keyWithFile = `${fileName}/${key}`;
  // console.log({key, options});
  if (Object.keys(options).includes('count') === true) {
    const keyOne = `${keyWithFile}_one`;
    const keyOther = `${keyWithFile}_other`;
    parser.set(keyOne, key);
    parser.set(keyOther, key);
  } else {
    parser.set(keyWithFile, key);
  }
};

const getKeysFromFile = (filePath, fileName) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  parser.parseFuncFromString(content, { list: [
    'i18next.t',
    't' // To match the file-level t function created with makeT
  ]}, customHandler(fileName))
  const keys = parser.get({ sort: true });
  return keys
}

async function walkTranslation(dirPath) {
  for await (const p of walk(dirPath)) {
    const { name } = path.parse(p);
    getKeysFromFile(p, name);
  }
  const keys = parser.get({sort: true});
  const newTranslations = _.merge(keys.en.translation, englishKeys);
  await fs.promises.writeFile('static/locales/en.client.json', JSON.stringify(newTranslations, null, 2), 'utf-8');
  return keys;
}

const keys = walkTranslation("app/client")
// console.log({englishKeys});
// const keys = getKeysFromFile('app/client/ui/errorPages.ts', 'errorPages');


// console.log(JSON.stringify(keys, null, 2));