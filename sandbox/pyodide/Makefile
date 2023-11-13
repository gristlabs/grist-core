# This number should be bumped up if making a non-additive change
# to python packages.
GRIST_PYODIDE_VERSION = 3

default:
	echo "Welcome to the pyodide sandbox"
	echo "make fetch_packages  # gets python packages prepared earlier"
	echo "make build_packages  # build python packages from scratch"
	echo "make save_packages   # upload python packages to fetch later"
	echo "make clean_packages  # remove local cache of python packages"
	echo "setup  # get pyodide node package, and python packages"

fetch_packages:
	node ./packages.js https://s3.amazonaws.com/grist-pynbox/pyodide/packages/v$(GRIST_PYODIDE_VERSION)/ _build/packages/

build_packages:
	./build_packages.sh

save_packages:
	aws s3 sync _build/packages s3://grist-pynbox/pyodide/packages/v$(GRIST_PYODIDE_VERSION)

clean_packages:
	rm -rf _build/packages
	rm -rf _build/pyodide/grist-packages

setup:
	./setup.sh
	make fetch_packages
