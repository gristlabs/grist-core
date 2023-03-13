default:
	echo "Welcome to the pyodide sandbox"
	echo "make fetch_packages  # gets python packages prepared earlier"
	echo "make build_packages  # build python packages from scratch"
	echo "make save_packages   # upload python packages to fetch later"
	echo "setup  # get pyodide node package"

fetch_packages:
	node ./packages.js https://s3.amazonaws.com/grist-pynbox/pyodide/packages/ _build/packages/

build_packages:
	./build_packages.sh

save_packages:
	aws s3 sync _build/packages s3://grist-pynbox/pyodide/packages/

setup:
	./setup.sh
	make fetch_packages
