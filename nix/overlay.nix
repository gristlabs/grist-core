[
  (self: super: {
    pythonPackagesExtensions = [ (python-self: python-super: {
      friendly-traceback = python-self.callPackage ./deps/friendly-traceback { };
    }) ];

    grist_10 = self.callPackage ./grist_10.nix { };
  })
]
