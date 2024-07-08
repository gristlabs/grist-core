`ext` is a directory that allows derivatives of Grist core to be created, without modifying any of the base files.

Files placed in here should be new files, or replacing files in the `stubs` directory.

When compiling, Typescript resolves files in `ext` before files in `stubs`, using the `ext` file instead (if it exists).
