const path = require('path');
const fs = require('fs');

async function listLibs(src) {
  const txt = fs.readFileSync(path.join(__dirname, '..', 'requirements.txt'), 'utf8');
  const libs = {};
  for (const line of txt.split(/\r?\n/)) {
    const raw = line.split('#')[0];
    if (!raw.includes('==')) { continue; }
    const [name, version] = line.split('==');
    libs[name] = version;
  }
  const hits = [];
  const misses = [];
  const toLoad = [];
  const material = fs.readdirSync(src);
  for (const [lib, version] of Object.entries(libs)) {
    const nlib = lib.replace(/-/g, '_');
    const info = {
      name: lib,
      standardName: nlib,
      version: version,
    };
    try {
      const found = material.filter(m => m.startsWith(`${nlib}-${version}-`));
      if (found.length !== 1) {
        throw new Error('did not find 1');
      }
      const fname = found[0];
      info.fullName = path.join(src, fname);
      info.fileName = fname;
      toLoad.push(info);
      hits.push(lib);
    } catch (e) {
      misses.push(info);
    }
  }
  return {
    available: toLoad,
    misses,
  };
}
exports.listLibs = listLibs;
