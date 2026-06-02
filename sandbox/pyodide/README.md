This is a collection of scripts for running a pyodide-based "sandbox" for
Grist. This is only an effective sandbox (without quotes) if run within
some extra boundary, such as deno with permissions locked down.

To run, we need specific versions of the Python packages that Grist uses
to be prepared. It should suffice to do, in this directory:

```
make setup
```

See the `Makefile` for other options. All scripts in this directory
are intended to be run from the Makefile.
