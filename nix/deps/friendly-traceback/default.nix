# SPDX-FileCopyrightText: 2025 Maurice Debray <maurice.debray@dgnum.eu>
#
# SPDX-License-Identifier: EUPL-1.2
{
  lib,
  buildPythonPackage,
  fetchFromGitHub,
  setuptools,
  wheel,
  asttokens,
  executing,
  pure-eval,
  stack-data,
}:

buildPythonPackage rec {
  pname = "friendly-traceback";
  version = "unstable-2025-04-13";
  pyproject = true;

  src = fetchFromGitHub {
    owner = "friendly-traceback";
    repo = "friendly-traceback";
    rev = "bba8fc43c4caa4b64e8800e0b1f7ed39e0276170";
    hash = "sha256-ThYE4JVPzTmot9mYB2LN2NmU/Wqd71Spv9+VAP9/Zp0=";
  };

  build-system = [
    setuptools
    wheel
  ];

  dependencies = [
    asttokens
    executing
    pure-eval
    stack-data
  ];

  pythonImportsCheck = [
    "friendly_traceback"
  ];

  meta = {
    description = "Friendlier Python tracebacks";
    homepage = "https://github.com/friendly-traceback/friendly-traceback";
    license = lib.licenses.mit;
    maintainers = with lib.maintainers; [ ];
  };
}
