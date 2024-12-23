// This file should be run during build. It will go through all the translations in the static/locales
// directory, and pass every key and value through the sanitizer.

const fs = require('fs');
const path = require('path');
// Initialize purifier.
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
DOMPurify.addHook('uponSanitizeAttribute', handleSanitizeAttribute);
function handleSanitizeAttribute(node) {
  if (!('target' in node)) { return; }
  node.setAttribute('target', '_blank');
}

const directoryPath = readDirectoryPath();

const fileStream = fs.readdirSync(directoryPath)
                     .map((file) => path.join(directoryPath, file))
                     // Make sure it's a file
                     .filter((file) => fs.lstatSync(file).isFile())
                     // Make sure it is json file
                     .filter((file) => file.endsWith(".json"))
                     // Read the contents and put it into an array [path, json]
                     .map((file) => [file, JSON.parse(fs.readFileSync(file, "utf8"))]);

console.debug(`Found ${fileStream.length} files to sanitize`);

const sanitized = fileStream.map(([file, json]) => {
  return [file, json, sanitizedJson(json)];
});

const onlyDifferent = sanitized.filter(([file, json, sanitizedJson]) => {
  return JSON.stringify(json) !== JSON.stringify(sanitizedJson);
});

console.debug(`Found ${onlyDifferent.length} files that need sanitizing`);

// Write the sanitized json back to the files
onlyDifferent.forEach(([file, json, sanitizedJson]) => {
  console.info(`Sanitizing ${file}`);
  fs.writeFileSync(file, JSON.stringify(sanitizedJson, null, 4) + "\n");
});

console.info("Sanitization complete");

function sanitizedJson(json) {
  // This is recursive function as some keys can be objects themselves, but all values are either
  // strings or objects.
  return Object.keys(json).reduce((acc, key) => {
    const value = json[key];
    if (typeof value === "string") {
      acc[key] = purify(value);
    } else if (typeof value === "object") {
      acc[key] = sanitizedJson(value);
    }
    return acc;
  }, {});
}


function readDirectoryPath() {
  // Directory path is optional, it defaults to static/locales, but can be passed as an argument.
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error("Too many arguments, expected at most 1 argument.");
    process.exit(1);
  }
  return args[0] || path.join(__dirname, "../static/locales");
}

function purify(inputString) {
  // This removes any html tags from the string
  return DOMPurify.sanitize(inputString);
}
