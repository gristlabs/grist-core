const path = require('path');
const fs = require('fs');

const { loadPyodide } = require('./_build/worker/node_modules/pyodide');
const { listLibs } = require('./packages');

const INCOMING_FD = 4;
const OUTGOING_FD = 5;

class GristPipe {
  constructor() {
    this.pyodide = null;
    this.incomingBuffer = Buffer.alloc(65536);
    this.addedBlob = false;
    this.adminMode = false;
  }

  async init() {
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
            throw new Error('setTimeout not available');
          }
        },
        sendFromSandbox: (data) => {
          return fs.writeSync(OUTGOING_FD, Buffer.from(data.toJs()));
        }
      },
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

  async loadCode() {
    // Load python packages.
    const src = path.join(__dirname, '_build', 'packages');
    const lsty = (await listLibs(src)).available.map(item => item.fullName);
    await this.pyodide.loadPackage(lsty, {
      messageCallback: (msg) => this.log('[package]', msg),
    });

    // Load Grist data engine code.
    // We mount it as /grist_src, copy to /grist, then unmount.
    // Note that path to source must be a realpath.
    const root = fs.realpathSync(path.join(__dirname, '../grist'));
    await this.pyodide.FS.mkdir("/grist_src");
    // careful, needs to be a realpath
    await this.pyodide.FS.mount(this.pyodide.FS.filesystems.NODEFS, { root }, "/grist_src");
    // Now want to copy /grist_src to /grist.
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
copytree('/grist_src', '/grist')`);
    await this.pyodide.FS.unmount("/grist_src");
    await this.pyodide.FS.rmdir("/grist_src");
  }

  async mountImportDirIfNeeded() {
    if (process.env.IMPORTDIR) {
      this.log("Setting up import from", process.env.IMPORTDIR);
      // Ideally would be read-only; don't see a way to do that,
      // other than copying like for Grist code.
      await this.pyodide.FS.mkdir("/import");
      await this.pyodide.FS.mount(this.pyodide.FS.filesystems.NODEFS, {
        root: process.env.IMPORTDIR,
      }, "/import");
    }
  }
  
  async runCode() {
    await this.pyodide.runPython(`
  import sys
  sys.path.append('/')
  sys.path.append('/grist')
  import grist
  import main
  import os
  os.environ['PIPE_MODE'] = 'pyodide'
  os.environ['IMPORTDIR'] = '/import'
  main.main()
`);
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
    await pipe.init();
    await pipe.loadCode();
    await pipe.mountImportDirIfNeeded();
    await pipe.runCode();
  } finally {
    process.stdin.removeAllListeners();
  }
}

main().catch(err => console.error("[pyodide error]", err));
