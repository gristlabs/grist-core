# This number should be bumped up if making a non-additive change
# to python packages.
GRIST_PYODIDE_VERSION = 4

default:
	echo "Welcome to the pyodide sandbox"
	echo "make fetch_packages  # gets python packages prepared earlier"
	echo "make build_packages  # build python packages from scratch"
	echo "make save_packages   # upload python packages to fetch later"
	echo "make clean_packages  # remove local cache of python packages"
	echo "setup  # get pyodide node package, and python packages"

fetch_packages:
	node ./preparePackages.js https://s3.amazonaws.com/grist-pynbox/pyodide/packages/v$(GRIST_PYODIDE_VERSION)/ _build/packages/

build_packages:
	./check_version_change.sh $(GRIST_PYODIDE_VERSION)
	./build_packages.sh

save_packages:
	aws s3 sync _build/packages s3://grist-pynbox/pyodide/packages/v$(GRIST_PYODIDE_VERSION)

clean: clean_packages clean_code

clean_packages:
	rm -rf _build/packages
	rm -rf _build/pyodide/grist-packages

clean_code:
	rm -rf worker/node_modules
	rm -rf _build/worker # old path
	rm -rf _build/pyodide

# Run setup.sh through bash rather than directly: on Windows make falls back to
# cmd, which cannot execute a .sh, but can run bash - the same reason the
# fetch_packages recipe below is fine as it is.
#   https://github.com/actions/runner-images/issues/7253
setup:
	bash ./setup.sh
	make fetch_packages
