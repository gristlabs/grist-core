// Minimal wasmtime embedding host for the Grist "wasi" sandbox flavor.
//
// The wasmtime CLI grants every preopened directory read-write access, which
// lets sandboxed formula code modify the engine source on the host. This host
// instead opens directories with explicit permissions: the engine and its
// dependencies are preopened read-only, and only an import directory (if any)
// is writable. Everything else matches the CLI: stdio is inherited (the data
// engine speaks its marshal protocol over stdin/stdout), and there is no
// network.
//
// Usage:
//   grist-wasi-host <python.wasm> \
//       [--ro HOST::GUEST]... [--rw HOST::GUEST]... [--env K=V]... \
//       -- <guest argv>...
//
// The guest argv is passed to the interpreter after a synthetic argv[0].

use anyhow::{anyhow, bail, Context, Result};
use wasmtime::{Config, Engine, Linker, Module, Store, WasmBacktraceDetails};
use wasmtime_wasi::p1::{self, WasiP1Ctx};
use wasmtime_wasi::{DirPerms, FilePerms, I32Exit, WasiCtxBuilder};

struct Preopen {
    host: String,
    guest: String,
}

fn parse_mapping(spec: &str) -> Result<Preopen> {
    let (host, guest) = spec
        .split_once("::")
        .ok_or_else(|| anyhow!("expected HOST::GUEST, got {spec:?}"))?;
    Ok(Preopen {
        host: host.to_string(),
        guest: guest.to_string(),
    })
}

// wasmtime 45 has its own error type that does not implement std::error::Error,
// so convert it into an anyhow error (preserving the chain via Debug) at the
// boundary.
fn wt<T>(r: wasmtime::Result<T>) -> Result<T> {
    r.map_err(|e| anyhow!("{e:?}"))
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let wasm_path = args
        .next()
        .ok_or_else(|| anyhow!("missing path to python.wasm"))?;

    let mut ro: Vec<Preopen> = Vec::new();
    let mut rw: Vec<Preopen> = Vec::new();
    let mut envs: Vec<(String, String)> = Vec::new();
    let mut guest_argv: Vec<String> = Vec::new();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--ro" => ro.push(parse_mapping(&args.next().context("--ro needs a value")?)?),
            "--rw" => rw.push(parse_mapping(&args.next().context("--rw needs a value")?)?),
            "--env" => {
                let kv = args.next().context("--env needs a value")?;
                let (k, v) = kv
                    .split_once('=')
                    .ok_or_else(|| anyhow!("expected K=V, got {kv:?}"))?;
                envs.push((k.to_string(), v.to_string()));
            }
            "--" => {
                guest_argv.extend(args.by_ref());
                break;
            }
            other => bail!("unexpected argument {other:?}"),
        }
    }

    let mut config = Config::new();
    config.wasm_backtrace_details(WasmBacktraceDetails::Disable);
    let engine = wt(Engine::new(&config))?;
    let module = wt(Module::from_file(&engine, &wasm_path))
        .with_context(|| format!("loading wasm module {wasm_path:?}"))?;

    let mut linker: Linker<WasiP1Ctx> = Linker::new(&engine);
    wt(p1::add_to_linker_sync(&mut linker, |t| t))?;

    let mut builder = WasiCtxBuilder::new();
    builder.inherit_stdin().inherit_stdout().inherit_stderr();

    // argv[0] is a synthetic program name; the interpreter reads argv[1..] as
    // its own arguments (the entry script and any trailing args).
    builder.arg("python.wasm");
    for a in &guest_argv {
        builder.arg(a);
    }
    for (k, v) in &envs {
        builder.env(k, v);
    }

    // Read-only: list, read, traverse; no create/write/delete.
    for p in &ro {
        wt(builder.preopened_dir(&p.host, &p.guest, DirPerms::READ, FilePerms::READ))
            .with_context(|| format!("preopen (ro) {}::{}", p.host, p.guest))?;
    }
    // Read-write: full access (used for an import staging directory, if any).
    for p in &rw {
        wt(builder.preopened_dir(&p.host, &p.guest, DirPerms::all(), FilePerms::all()))
            .with_context(|| format!("preopen (rw) {}::{}", p.host, p.guest))?;
    }
    // Note: no inherit_network(), so the guest has no socket access.

    let wasi = builder.build_p1();
    let mut store = Store::new(&engine, wasi);

    let instance = wt(linker.instantiate(&mut store, &module))?;
    let start = wt(instance.get_typed_func::<(), ()>(&mut store, "_start"))?;

    match start.call(&mut store, ()) {
        Ok(()) => Ok(()),
        Err(err) => {
            // A clean exit() from the guest surfaces as an I32Exit trap.
            if let Some(exit) = err.downcast_ref::<I32Exit>() {
                std::process::exit(exit.0);
            }
            Err(anyhow!("{err:?}"))
        }
    }
}
