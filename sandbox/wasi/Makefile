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
CPYTHON_WASI_VERSION = 3.14.6
WASI_SDK_VERSION = 24
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
	@echo "make setup     # fetch python.wasm and wasmtime into _build/"
	@echo "make runtime   # fetch CPython wasm only"
	@echo "make wasmtime  # fetch wasmtime only"
	@echo "make clean     # remove _build/"

setup: runtime wasmtime

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

clean:
	rm -rf $(BUILD)

.PHONY: default setup runtime wasmtime clean
