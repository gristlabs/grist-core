# Runtime for the "wasi" sandbox flavor.
#
# This fetches two prebuilt artifacts into _build/:
#   - python.wasm : CPython compiled to wasm32-wasi (+ its stdlib under lib/)
#   - wasmtime    : the WebAssembly runtime that executes python.wasm
#
# Neither is committed to the repo (see .gitignore). Run `make setup` once to
# populate _build/, the same way sandbox/pyodide fetches its packages.
#
# The data engine in sandbox/grist runs unmodified inside this; see
# app/server/lib/SandboxWasi.ts for how the sandbox is launched.

# Pinned versions. Bump together and re-run `make setup`.
#
# CPython is pinned to 3.11 deliberately: the data engine and its astroid
# dependency target 3.9-3.11, and the engine still uses a few AST node names
# (e.g. ast.Str in formula_prompt.py) that were removed in 3.12+. Moving to a
# newer interpreter would need those call sites updated first.
CPYTHON_WASI_VERSION = 3.11.13
WASI_SDK_VERSION = 16
WASMTIME_VERSION = 45.0.1

# Host platform detection for the wasmtime download (the python.wasm is portable).
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    WASMTIME_PLATFORM = aarch64-macos
  else
    WASMTIME_PLATFORM = x86_64-macos
  endif
else
  ifeq ($(UNAME_M),aarch64)
    WASMTIME_PLATFORM = aarch64-linux
  else
    WASMTIME_PLATFORM = x86_64-linux
  endif
endif

CPYTHON_URL = https://github.com/brettcannon/cpython-wasi-build/releases/download/v$(CPYTHON_WASI_VERSION)/python-$(CPYTHON_WASI_VERSION)-wasi_sdk-$(WASI_SDK_VERSION).zip
WASMTIME_URL = https://github.com/bytecodealliance/wasmtime/releases/download/v$(WASMTIME_VERSION)/wasmtime-v$(WASMTIME_VERSION)-$(WASMTIME_PLATFORM).tar.xz

BUILD = _build

default:
	@echo "Welcome to the wasi sandbox"
	@echo "make setup     # fetch runtime + build the read-only host"
	@echo "make runtime   # fetch CPython wasm only"
	@echo "make wasmtime  # fetch wasmtime CLI only"
	@echo "make host      # build the read-only embedding host (needs cargo)"
	@echo "make clean     # remove _build/ and host build artifacts"

setup: runtime host

runtime: $(BUILD)/python.wasm

$(BUILD)/python.wasm:
	mkdir -p $(BUILD)
	curl -sL "$(CPYTHON_URL)" -o $(BUILD)/cpython-wasi.zip
	unzip -q -o $(BUILD)/cpython-wasi.zip -d $(BUILD)
	rm -f $(BUILD)/cpython-wasi.zip
	@test -f $(BUILD)/python.wasm || (echo "python.wasm not found after unpack" && exit 1)
	@echo "Fetched CPython $(CPYTHON_WASI_VERSION) WASI build."

wasmtime: $(BUILD)/wasmtime

$(BUILD)/wasmtime:
	mkdir -p $(BUILD)
	curl -sL "$(WASMTIME_URL)" -o $(BUILD)/wasmtime.tar.xz
	tar xf $(BUILD)/wasmtime.tar.xz -C $(BUILD)
	cp $(BUILD)/wasmtime-v$(WASMTIME_VERSION)-$(WASMTIME_PLATFORM)/wasmtime $(BUILD)/wasmtime
	rm -rf $(BUILD)/wasmtime.tar.xz $(BUILD)/wasmtime-v$(WASMTIME_VERSION)-$(WASMTIME_PLATFORM)
	@echo "Fetched wasmtime $(WASMTIME_VERSION) for $(WASMTIME_PLATFORM)."

host: host/target/release/grist-wasi-host

host/target/release/grist-wasi-host:
	cd host && cargo build --release
	@echo "Built read-only embedding host."

clean:
	rm -rf $(BUILD)
	cd host && cargo clean 2>/dev/null || true

.PHONY: default setup runtime wasmtime host clean
