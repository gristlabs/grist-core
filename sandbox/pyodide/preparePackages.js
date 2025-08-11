const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');

const {listLibs} = require('./packages');

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
    console.log('Fetching', lib);
    const url = new URL(src);
    url.pathname = url.pathname + lib.name + '-' + lib.version + '.json';
    const result = await fetch(url.href);
    if (result.status === 200) {
      const data = await result.json();
      const url2 = new URL(src);
      url2.pathname = url2.pathname + data.fileName;
      const result2 = await fetch(url2.href);
      if (result2.status === 200) {
        fs.writeFileSync(path.join(dest, `${lib.name}-${lib.version}.json`),
                         JSON.stringify(data, null, 2));
        fs.writeFileSync(path.join(dest, data.fileName),
                         await result2.buffer());
      } else {
        console.error("No payload available", {lib});
      }
    } else {
      console.error("No metadata available", {lib});
    }
  }
  libs = await listLibs(dest);
  console.log(`Missing`, {libs: libs.misses.map(lib => lib.name)});
}

async function main(src, dest) {
  if (!src) {
    console.error('please supply a source');
    process.exit(1);
  }
  if (!dest) {
    console.error('please supply a destination');
    process.exit(1);
  }
  if (src.startsWith('http:') || src.startsWith('https:')) {
    await findOnNet(src, dest);
    return;
  }
  await findOnDisk(src, dest);
}

if (require.main === module) {
  main(...process.argv.slice(2)).catch(e => console.error(e));
}
