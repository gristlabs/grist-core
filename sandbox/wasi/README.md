# WASI sandbox flavor

This is an **experimental** sandbox flavor that runs the Grist data engine on a
CPython interpreter compiled to `wasm32-wasi`, executed by
[wasmtime](https://wasmtime.dev/).

It is a sibling to the `pyodide` flavor (which also runs the engine on a
WebAssembly build of Python), but takes a different route to the same place:

| | pyodide | wasi |
|---|---|---|
| Python build | Emscripten (browser/Node target) | `wasm32-wasi` (server target) |
| Host runtime | Node or Deno + Emscripten JS glue | wasmtime (no JS layer) |
| Data channel | stdin/stdout via JS pump | stdin/stdout, inherited directly |
| Filesystem | Emscripten FS + NODEFS mounts | wasmtime `--dir` preopens |
| Network | none | none |
| CPU/memory caps | none | available via wasmtime (not yet wired) |

The engine itself runs **unmodified**. The only engine-side change is a
`PIPE_MODE=wasi` branch in `sandbox/grist/sandbox.py` (`Sandbox.use_wasi`),
needed because WASI preview1 has no `os.dup2`, so the side-channel file
descriptors the other flavors use are not available. Data flows over stdin and
stdout instead.

## Setup

```bash
make -C sandbox/wasi setup
```

This fetches two artifacts into `sandbox/wasi/_build/` (neither is committed):

- `python.wasm` + `lib/` — a prebuilt CPython `wasm32-wasi` interpreter and its
  standard library (from [cpython-wasi-build](https://github.com/brettcannon/cpython-wasi-build)).
- `wasmtime` — the runtime that executes it.

The engine's Python dependencies are taken from the existing `sandbox_venv3`
virtualenv (built by `yarn install:python`). They are all pure Python, so the
same source works under the wasm interpreter even though the virtualenv targets
a different CPython minor version.

Versions are pinned at the top of the `Makefile`; bump them together and re-run
`make setup`.

## Use

```bash
GRIST_SANDBOX_FLAVOR=wasi yarn start
```

The runtime is located automatically. To override pieces:

- `GRIST_WASI_WASMTIME` — path to a specific `wasmtime` binary. Otherwise the
  copy in `_build/` is used, falling back to one on `PATH`.

## Status and limitations

- **Experimental.** Not wired into the default fallback chain (`sandboxed`);
  select it explicitly with `GRIST_SANDBOX_FLAVOR=wasi`.
- **No CPU/memory limits yet.** wasmtime can enforce these (fuel or epoch-based
  interruption for CPU, a linear-memory cap for memory), but they are not yet
  configured here. Grist relies on its own throttling today; revisit once the
  basics are solid.
- **Preopened directories are read-write.** Tightening these to read-only is a
  straightforward follow-up.
- **Dependencies reuse `sandbox_venv3`.** A dedicated wasi requirements install
  could replace this, but is unnecessary while every dependency is pure Python.

See `app/server/lib/SandboxWasi.ts` for how the wasmtime command line is built
and `app/server/lib/NSandbox.ts` for the `wasi` spawner.
