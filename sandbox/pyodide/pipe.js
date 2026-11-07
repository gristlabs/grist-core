const path = require("path");
const fs = require("fs");

const { loadPyodide } = require("./worker/node_modules/pyodide");
const { listLibs } = require("./packages");

const isDeno = typeof Deno !== "undefined";

const INCOMING_FD = isDeno ? 0 : 4;
const OUTGOING_FD = isDeno ? 1 : 5;

// A memory snapshot of a sandbox that has loaded the data engine, to start
// from instead of loading everything again.
const SNAPSHOT_LOAD = process.env.GRIST_PYODIDE_SNAPSHOT_LOAD;
// When set, load the data engine, save a snapshot to this path, and exit.
const SNAPSHOT_MAKE = process.env.GRIST_PYODIDE_SNAPSHOT_MAKE;
// Marks the start of a snapshot file, which holds the files the sandbox
// needs (pyodide's own snapshot covers only memory, see
// https://github.com/pyodide/pyodide/pull/4720) followed by pyodide's
// snapshot.
const SNAPSHOT_MAGIC = 0x47525331;
const SNAPSHOT_HEADER_SIZE = 16;

class GristPipe {
  constructor() {
    this.pyodide = null;
    this.incomingBuffer = Buffer.alloc(65536);
    this.addedBlob = false;
    this.adminMode = false;
  }

  async init(snapshot) {
    const self = this;
    this.setAdminMode(true);
    this.pyodide = await loadPyodide({
      jsglobals: {
        Object: {},
        setTimeout: function(code, delay) {
          if (self.adminMode) {
            setTimeout(code, delay);
            // Seems to be OK not to return anything, so we don't.
          } else {
            throw new Error("setTimeout not available");
          }
        },
        sendFromSandbox: (data) => {
          return fs.writeSync(OUTGOING_FD, Buffer.from(data.toJs()));
        }
      },
      ...(SNAPSHOT_MAKE ? { _makeSnapshot: true } : {}),
      ...(snapshot ? { _loadSnapshot: snapshot } : {}),
    });
    this.setAdminMode(false);
    this.pyodide.setStdin({
      stdin: () => {
        const result = fs.readSync(INCOMING_FD, this.incomingBuffer, 0,
          this.incomingBuffer.byteLength);
        if (result > 0) {
          const buf = Buffer.allocUnsafe(result, 0, 0, result);
          this.incomingBuffer.copy(buf);
          return buf;
        }
        return null;
      },
    });
    this.pyodide.setStderr({
      batched: (data) => {
        this.log("[py]", data);
      }
    });
  }

  /**
   * Start from the snapshot named by GRIST_PYODIDE_SNAPSHOT_LOAD.
   */
  async restore() {
    const snapshot = readSnapshot(SNAPSHOT_LOAD);
    await this.init(snapshot.memory);
    const { FS } = this.pyodide;
    let offset = 0;
    for (const [fname, size] of snapshot.files.index) {
      if (size < 0) {
        FS.mkdirTree(fname);
      } else {
        FS.writeFile(fname, snapshot.files.data.subarray(offset, offset + size));
        offset += size;
      }
    }
    // Pyodide holds on to the snapshot, so free its memory by detaching it.
    snapshot.memory.buffer.transfer?.(0);
    this.log("started from snapshot");
  }

  async loadFiles() {
    // Install python packages by unpacking their wheels into site-packages.
    // Pyodide's loadPackage would leave a record of them on the JavaScript
    // side, which a memory snapshot cannot carry
    // (https://github.com/pyodide/pyodide/issues/5195).
    const src = path.join(__dirname, "_build", "packages");
    const libs = (await listLibs(src)).available;
    await this.withMount(src, "/packages", async () => {
      await this.pyodide.runPython(`
import site, zipfile
for name in ${JSON.stringify(libs.map(item => item.fileName))}:
  with zipfile.ZipFile('/packages/' + name) as wheel:
    wheel.extractall(site.getsitepackages()[0])`);
    });

    // Load Grist data engine code.
    // We mount it as /grist_src, copy to /grist, then unmount.
    await this.copyFiles(path.join(__dirname, "../grist"), "/grist_src", "/grist");
  }

  async importEngine() {
    // Import the data engine, so a snapshot has it ready to go. The C version
    // of lazy_object_proxy (used by astroid) is blocked in favor of its
    // pure-Python fallback, since a snapshot cannot carry native modules
    // (https://github.com/pyodide/pyodide/pull/4720).
    await this.pyodide.runPython(`
import sys
sys.modules['lazy_object_proxy.cext'] = None
sys.path.append('/')
sys.path.append('/grist')
import grist
import main
`);
  }

  async makeSnapshot(dest, files) {
    // Any native module loaded now would crash on first use after a restore.
    const native = this.pyodide.runPython(`
import sys
','.join(name for name, mod in list(sys.modules.items())
         if (getattr(mod, '__file__', None) or '').endswith('.so'))`);
    if (native) {
      throw new Error(`cannot snapshot with native modules loaded: ${native}`);
    }
    const memory = this.pyodide.makeMemorySnapshot();
    const index = Buffer.from(JSON.stringify(files.index));
    // Pyodide needs its snapshot aligned in memory.
    const memoryOffset = Math.ceil((SNAPSHOT_HEADER_SIZE + index.length + files.size) / 16) * 16;
    const header = Buffer.alloc(SNAPSHOT_HEADER_SIZE);
    header.writeUInt32LE(SNAPSHOT_MAGIC, 0);
    header.writeUInt32LE(index.length, 4);
    header.writeUInt32LE(memoryOffset, 8);
    header.writeUInt32LE(memoryOffset + memory.length, 12);
    const padding = Buffer.alloc(memoryOffset - SNAPSHOT_HEADER_SIZE - index.length - files.size);
    fs.writeFileSync(dest, Buffer.concat([header, index, ...files.data, padding, memory]));
  }

  /**
   * Gather the files a sandbox restored from a snapshot will need.
   */
  collectFiles() {
    const { FS } = this.pyodide;
    const sitePackages = this.pyodide.runPython("import site; site.getsitepackages()[0]");
    const files = { index: [], data: [], size: 0 };
    const collect = (fname) => {
      if (FS.isDir(FS.stat(fname).mode)) {
        files.index.push([fname, -1]);
        for (const name of FS.readdir(fname)) {
          if (name !== "." && name !== "..") { collect(`${fname}/${name}`); }
        }
      } else {
        const data = FS.readFile(fname);
        files.index.push([fname, data.length]);
        files.data.push(data);
        files.size += data.length;
      }
    };
    collect(sitePackages);
    collect("/grist");
    return files;
  }

  async mountImportDirIfNeeded() {
    if (process.env.IMPORTDIR) {
      this.log("Setting up import from", process.env.IMPORTDIR);
      // All imports for a given doc live in the same root directory.
      // Copying import files in and dropping read permissions isn't
      // workable in that case, since the same sandbox is re-used for
      // subsequent imports. The files would only be copied once on
      // startup, meaning the files for these later imports won't be
      // available to Pyodide, resulting in errors.
      await this.pyodide.FS.mkdir("/import");
      await this.pyodide.FS.mount(this.pyodide.FS.filesystems.NODEFS, {
        root: process.env.IMPORTDIR,
      }, "/import");
    }
  }

  async runCode() {
    await this.pyodide.runPython(`
  import main
  import os
  os.environ['PIPE_MODE'] = 'pyodide'
  os.environ['IMPORTDIR'] = '/import'
  main.main()
`);
  }

  async copyFiles(srcDir, tmpDir, destDir) {
    // Load file system data.
    // We mount it as tmpDir, copy to destDir, then unmount.
    // Note that path to source must be a realpath.
    await this.withMount(srcDir, tmpDir, async () => {
      // Now want to copy tmpDir to destDir.
      // For some reason shutil.copytree doesn't work on Windows in this situation, so
      // we reimplement it crudely.
      await this.pyodide.runPython(`
import os, shutil
def copytree(src, dst):
  os.makedirs(dst, exist_ok=True)
  for item in os.listdir(src):
    s = os.path.join(src, item)
    d = os.path.join(dst, item)
    if os.path.isdir(s):
      copytree(s, d)
    else:
      shutil.copy2(s, d)
copytree('${tmpDir}', '${destDir}')`);
    });
  }

  async withMount(srcDir, tmpDir, callback) {
    // careful, needs to be a realpath
    const root = fs.realpathSync(srcDir);
    await this.pyodide.FS.mkdir(tmpDir);
    await this.pyodide.FS.mount(this.pyodide.FS.filesystems.NODEFS, { root }, tmpDir);
    try {
      await callback();
    } finally {
      await this.pyodide.FS.unmount(tmpDir);
      await this.pyodide.FS.rmdir(tmpDir);
    }
  }

  setAdminMode(active) {
    this.adminMode = active;
    // Lack of Blob may result in a message on console.log that hurts us.
    if (active && !globalThis.Blob) {
      globalThis.Blob = String;
      this.addedBlob = true;
    }
    if (!active && this.addedBlob) {
      delete globalThis.Blob;
      this.addedBlob = false;
    }
  }

  log(...args) {
    console.error("[pyodide sandbox]", ...args);
  }
}

async function main() {
  try {
    const pipe = new GristPipe();
    if (SNAPSHOT_MAKE) {
      await pipe.init();
      await pipe.loadFiles();
      const files = pipe.collectFiles();
      await pipe.importEngine();
      await pipe.makeSnapshot(SNAPSHOT_MAKE, files);
      return;
    }
    if (SNAPSHOT_LOAD) {
      await pipe.restore();
    } else {
      await pipe.init();
      await pipe.loadFiles();
      await pipe.importEngine();
    }
    await pipe.mountImportDirIfNeeded();

    if (isDeno) {
      // Read access has been limited quite a lot already.
      // We need to keep access to the import directory, but can shed
      // everything else. See --allow-read in SandboxPyodide.ts
      const readDir = fs.realpathSync(__dirname);
      const gristDir = fs.realpathSync(path.join(__dirname, "..", "grist"));
      const reqFile = fs.realpathSync(path.join(__dirname, "..", "requirements.txt"));
      const snapshotFile = SNAPSHOT_LOAD ? [SNAPSHOT_LOAD] : [];
      for (const dir of [readDir, gristDir, reqFile, ...snapshotFile]) {
        // eslint-disable-next-line no-undef
        await Deno.permissions.revoke({
          name: "read",
          path: dir
        });
      }
      console.error("[pyodide sandbox]", "revoked read permissions.");
    }

    await pipe.runCode();
  } finally {
    process.stdin.removeAllListeners();
  }
}

/**
 * Read a snapshot, checking that it is one of ours and complete, since
 * pyodide aborts without explanation on a damaged one.
 */
function readSnapshot(fname) {
  const data = fs.readFileSync(fname);
  const word = i => (data.length >= SNAPSHOT_HEADER_SIZE ? data.readUInt32LE(i * 4) : 0);
  const indexSize = word(1);
  const memoryOffset = word(2);
  if (word(0) !== SNAPSHOT_MAGIC || word(3) !== data.length ||
      SNAPSHOT_HEADER_SIZE + indexSize > memoryOffset || memoryOffset >= data.length) {
    throw new Error(`not a complete snapshot: ${fname}`);
  }
  const index = JSON.parse(data.subarray(SNAPSHOT_HEADER_SIZE, SNAPSHOT_HEADER_SIZE + indexSize).toString());
  // Use Uint8Arrays rather than Buffers. Pyodide copies file contents with
  // slice(), which for a Buffer makes a view that would hold on to the
  // whole snapshot.
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.length);
  return {
    files: { index, data: bytes.subarray(SNAPSHOT_HEADER_SIZE + indexSize, memoryOffset) },
    memory: bytes.subarray(memoryOffset),
  };
}

main().catch((err) => {
  console.error("[pyodide error]", err);
  process.exitCode = 1;
});
