This is a collection of scripts for running a pyodide-based "sandbox" for
Grist.

I put "sandbox" in quotes since pyodide isn't built with sandboxing
in mind. It was written to run in a browser, where the browser does
sandboxing. I don't know how much of node's API ends up being exposed
to the "sandbox" - in previous versions of pyodide it seems the answer is
"a lot". See the back-and-forth between dalcde and hoodmane in:
  https://github.com/pyodide/pyodide/issues/960
See specifically:
  https://github.com/pyodide/pyodide/issues/960#issuecomment-752305257
I looked at hiwire and its treatment of js globals has changed a
lot. On the surface it looks like there is good control of what is
exposed, but there may be other routes.

Still, some wasm-based solution is likely to be helpful, whether from
pyodide or elsewhere, and this is good practice for that.

***

To run, we need specific versions of the Python packages that Grist uses
to be prepared. It should suffice to do:

```
make setup
```

In this directory. See the `Makefile` for other options.
