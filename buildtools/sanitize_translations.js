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

// If the the first arg is test, do the self test.
if (process.argv[2] === "test") {
  selfTest();
  process.exit(0);
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

const sanitized = fileStream.map(([file, json]) => {
  return [file, json, invalidValues(json)];
});

const onlyDifferent = sanitized.filter(([file, json, invalidKeys]) => {
  return invalidKeys.length > 0;
});

if (onlyDifferent.length > 0) {
  console.error("The following files contain invalid values:");
  onlyDifferent.forEach(([file, json, invalidKeys]) => {
    console.error(`File: ${file}`);
    console.error(`Values: ${invalidKeys.join(", ")}`);
  });
  process.exit(1);
}

function invalidValues(json) {
  // This is recursive function as some keys can be objects themselves, but all values are either
  // strings or objects.
  return Object.values(json).reduce((acc, value) => {
    if (typeof value === "string") {
      const sanitized = purify(value);
      if (value !== sanitized) {
        acc.push(value);
      }
    } else if (typeof value === "object") {
      acc.push(...invalidValues(value));
    }
    return acc;
  }, []);
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
  return DOMPurify.sanitize(inputString, { ALLOWED_TAGS: [] });
}

function selfTest() {
  const okDir = createTmpDir();
  const okFile = path.join(okDir, "ok.json");
  fs.writeFileSync(okFile, JSON.stringify({ "key": "value" }));

  const badDir = createTmpDir();
  const badFile = path.join(badDir, "bad.json");
  fs.writeFileSync(badFile, JSON.stringify({ "key": "<script>alert('xss')</script>" }));

  // Run this script in the okDir, it should pass (return value 0)
  const okResult = exitCode(`node ${__filename} ${okDir}`);
  if (okResult !== 0) {
    console.error("Self test failed, expected 0 for okDir");
    process.exit(1);
  }

  // Run this script in the badDir, it should fail (return value 1)
  const badResult = exitCode(`node ${__filename} ${badDir}`);
  if (badResult !== 1) {
    console.error("Self test failed, expected 1 for badDir");
    process.exit(1);
  }

  console.log("Self test passed");

  function createTmpDir() {
    const os = require('os');
    const tmpDir = os.tmpdir();
    const prefix = path.join(tmpDir, 'tmp-folder-');
    const tmpFolderPath = fs.mkdtempSync(prefix);
    return tmpFolderPath;
  }

  function exitCode(args) {
    const {execSync} = require('child_process');
    try {
      execSync(args); // will throw if exit code is not 0
      return 0;
    } catch (e) {
      return 1;
    }
  }
}