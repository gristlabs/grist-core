{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShell {
  name = "grist-core.dev";
  packages = [
    pkgs.nodejs_22
    pkgs.python3
    pkgs.python3.pkgs.venvShellHook
    pkgs.yarn
    pkgs.chromedriver
    pkgs.gvisor
    pkgs.deno
  ];
  venvDir = "./sandbox_venv3";
  postVenvCreation = ''
    pip install --no-deps -r sandbox/requirements.txt
  '';
}
