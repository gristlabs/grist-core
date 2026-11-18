const fs = require("fs");
const fetch = require("node-fetch");
const path = require("path");

const {listLibs} = require("./packages");

async function findOnDisk(src, dest) {
  console.log(`Organizing packages on disk`, {src, dest});
  fs.mkdirSync(dest, {recursive: true});
  let libs = (await listLibs(src));
  for (const lib of libs.available) {
    fs.copyFileSync(lib.fullName, path.join(dest, lib.fileName));
    fs.writeFileSync(path.join(dest, `${lib.name}-${lib.version}.json`),
      JSON.stringify({
        name: lib.name,
        version: lib.version,
        fileName: lib.fileName,
      }, null, 2));
    console.log("Copied", {
      content: path.join(dest, lib.fileName),
      meta: path.join(dest, `${lib.name}-${lib.version}.json`),
    });
  }
  libs = await listLibs(dest);
  fs.writeFileSync(path.join(__dirname, `package_filenames.json`),
    JSON.stringify(libs.available.map(lib => lib.fileName), null, 2));
  console.log(`Cached`, {libs: libs.available.map(lib => lib.name)});
  console.log(`Missing`, {libs: libs.misses.map(lib => lib.name)});
}

async function findOnNet(src, dest) {
  console.log(`Caching packages on disk`, {src, dest});
  fs.mkdirSync(dest, {recursive: true});
  let libs = await listLibs(dest);
  console.log(`Cached`, {libs: libs.available.map(lib => lib.name)});
  for (const lib of libs.misses) {
    console.log("Fetching", lib);
    const meta = JSON.parse(await download(src, `${lib.name}-${lib.version}.json`));
    const payload = await download(src, meta.fileName);
    fs.writeFileSync(path.join(dest, meta.fileName), payload);
    fs.writeFileSync(path.join(dest, `${lib.name}-${lib.version}.json`),
      JSON.stringify(meta, null, 2));
  }
  libs = await listLibs(dest);
  if (libs.misses.length) {
    throw new Error(`Missing packages: ${libs.misses.map(lib => lib.name).join(", ")}`);
  }
}

// Fetch a file from the package host. Network errors such as ECONNRESET are
// retried a few times; anything else, or a status other than 200, is fatal.
async function download(src, fileName) {
  const url = new URL(src);
  url.pathname = url.pathname + fileName;
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fetch(url.href);
      if (result.status !== 200) {
        throw new Error(`Failed to fetch ${url.href}: status ${result.status}`);
      }
      return await result.buffer();
    } catch (e) {
      if (e.name !== "FetchError" || attempt >= 3) { throw e; }
      console.warn(`Retrying after ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function main(src, dest) {
  if (!src) {
    console.error("please supply a source");
    process.exit(1);
  }
  if (!dest) {
    console.error("please supply a destination");
    process.exit(1);
  }
  if (src.startsWith("http:") || src.startsWith("https:")) {
    await findOnNet(src, dest);
    return;
  }
  await findOnDisk(src, dest);
}

if (require.main === module) {
  main(...process.argv.slice(2)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
