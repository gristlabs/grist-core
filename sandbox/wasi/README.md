# WASI sandbox flavor

This is an **experimental** sandbox flavor that runs the Grist data engine on a
CPython interpreter compiled to `wasm32-wasi`, executed by
[wasmtime](https://wasmtime.dev/).

It is a sibling to the `pyodide` flavor (which also runs the engine on a
WebAssembly build of Python), but takes a different route to the same place:

| | pyodide | wasi |
|---|---|---|
| Python build | Emscripten (browser/Node target) | `wasm32-wasi` (server target) |
| Host runtime | Node or Deno + Emscripten JS glue | wasmtime (embedding host or CLI) |
| Data channel | stdin/stdout via JS pump | stdin/stdout, inherited directly |
| Filesystem | Emscripten FS + NODEFS mounts | wasmtime preopens (read-only via host) |
| Network | none | none |
| CPU/memory caps | none | available via wasmtime (not yet wired) |

The engine itself runs **unmodified**. The only engine-side change is a
`PIPE_MODE=wasi` branch in `sandbox/grist/sandbox.py` (`Sandbox.use_wasi`),
needed because WASI preview1 has no `os.dup2`, so the side-channel file
descriptors the other flavors use are not available. Data flows over stdin and
stdout instead.

## How it runs

There are two launchers:

- **Embedding host** (`sandbox/wasi/host`, a small Rust program built with
  `make host`): opens the engine and dependency directories **read-only**, so
  sandboxed formula code cannot modify the engine source on the host. This is
  the secure mode and is used automatically when the binary is present.
- **wasmtime CLI** (fallback): simpler, but its `--dir` grants read-write
  access to every preopened directory, so the engine source is writable from
  inside the sandbox. A warning is logged when this path is used. Not a real
  isolation boundary; intended only for quick local experiments.

CPython is pinned to **3.11** (see the Makefile) because the engine and its
astroid dependency target 3.9-3.11 and still use a few AST node names removed in
3.12+ (e.g. `ast.Str`).

## Setup

```bash
make -C sandbox/wasi setup   # fetch the runtime AND build the read-only host
```

This populates `sandbox/wasi/_build/` (not committed):

- `python.wasm` + `lib/` — a prebuilt CPython `wasm32-wasi` interpreter and its
  standard library (from [cpython-wasi-build](https://github.com/brettcannon/cpython-wasi-build)).

and builds `sandbox/wasi/host/target/release/grist-wasi-host` (needs `cargo`).

`make runtime` fetches just the interpreter; `make wasmtime` additionally
fetches the wasmtime CLI if you want the (insecure) CLI launcher; `make host`
builds just the embedding host.

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

The launcher and runtime are located automatically. To override pieces:

- `GRIST_WASI_HOST` — path to a prebuilt embedding host binary.
- `GRIST_WASI_WASMTIME` — path to a `wasmtime` binary for the CLI fallback.

## Testing

The wasi flavor runs through the standard sandbox suite. Point the suite at it
with the flavor env var:

```bash
GRIST_SANDBOX_FLAVOR=wasi GREP_TESTS=Sandbox yarn test:server
```

`test/server/Sandbox.ts` covers lifecycle and the isolation guarantees
(read-only engine files, no host writes via mapped dirs, no fork, etc.) for
every flavor, wasi included.

## Status and limitations

- **Experimental.** Not wired into the default fallback chain (`sandboxed`);
  select it explicitly with `GRIST_SANDBOX_FLAVOR=wasi`.
- **No CPU/memory limits yet.** wasmtime can enforce these (fuel or epoch-based
  interruption for CPU, a linear-memory cap for memory), but they are not yet
  configured here. Grist relies on its own throttling today; revisit once the
  basics are solid.
- **Dependencies reuse `sandbox_venv3`.** A dedicated wasi requirements install
  could replace this, but is unnecessary while every dependency is pure Python.
- **Boot is slower than native** (wasm instantiation, no precompiled `.cwasm`
  cache yet). Fine for correctness; an optimization for later.

See `app/server/lib/SandboxWasi.ts` for how the launcher command is built,
`app/server/lib/NSandbox.ts` for the `wasi` spawner, and `host/src/main.rs` for
the read-only embedding host.
