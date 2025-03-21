# Development

Please as a first start, tell the community about your intent to develop a feature or fix a bug. Search for the associated issue if it exists or open one with steps to reproduce (for bugs) or a [user story](https://en.wikipedia.org/wiki/User_story#Principle) (for features).

## Setup

### Prerequisites

To setup your environment, you would need to install the following dependencies:
 - git
 - [nvm](https://github.com/nvm-sh/nvm/blob/master/README.md) (recommended) or nodejs installed on your system
 - Chromium to run the end-to-end tests
 - Python (preferably Python 3.11, minimum 3.9) and virtualenv

### Clone the repository

```bash
$ git clone https://github.com/gristlabs/grist-core
```

And then, enter the grist-core root directory:

```bash
$ cd grist-core/
```

### Setup nodejs

#### Using nvm (recommanded)

You need to install the supported nodejs version as well as yarn. To do so, in the grist-core root directory, run the following command to install nodejs via nvm:

```bash
$ nvm install
```

Now check that node is installed in the version specified in the `.nvmrc` file:

```bash
$ node --version
```

Then install yarn (the `-g` flag here means that yarn will be available globally):
```bash
$ npm install -g yarn
```

Now each time you want to load nodejs and yarn in your environment, just run the following command at grist-core root directory:

```bash
$ nvm use
```

#### Using nodejs

You can also use nodejs installed in your system. To prevent incompatibilities, ensure that the `node --version` command reports a version equal or greater to the one in `.nvmrc`.

### Install the python packages

Be sure to have Python and virtualenv installed. On debian-based Linux distributions, you can simply run the following command as root:

```bash
# apt install python3.11 python3.11-venv
```

### Install the project dependencies and build

First install the nodejs dependencies:

```bash
$ yarn install
```

Then prepare the virtual environment with all the python dependencies:

```bash
$ yarn install:python
```

Finally run this to do an initial build:

```bash
$ yarn run build
```

## Start the server in development mode

Just run the following command:
```bash
$ yarn start
```

Each time you change something, just reload the webpage in your browser.

Happy coding!

### Pick an issue

Lost on what you can do to help? If you are new to Grist, you may just pick one of the issues labelled `good first issue`:

https://github.com/gristlabs/grist-core/labels/good%20first%20issue

## Debug the server

You can debug the NodeJS application using this command:

```bash
$ yarn start:debug
```

And start using your nodejs debugger client (like the Chrome Devtools). See https://nodejs.org/en/docs/guides/debugging-getting-started#inspector-clients

## Run tests

You may run the tests using one of these commands:
 - `yarn test` to run all the tests
 - `yarn test:debug` to run the tests in debug mode, which will stop after first failure, not clean up after tests and will provide more detailed output (with screenshots) in the `_build/test_output` directory
 - `yarn test:smoke` to run the minimal test checking Grist can open, create and edit a document
 - `yarn test:nbrowser` to run the end-to-end tests (⚠️ see warning below)
 - `yarn test:nbrowser:ci` to run the end-to-end tests in headless mode, suitable for continuous integration environments
 - `yarn test:nbrowser:debug` to run the end-to-end tests in debug mode
 - `yarn test:client` to run the tests for the client libraries
 - `yarn test:common` to run the tests for the common libraries shared between the client and the server
 - `yarn test:server` and `yarn test:gen-server` to run the backend tests depending on where the feature you would like to test resides (respectively `app/server` or `app/gen-server`)
 - `yarn test:docker` to run some end-to-end tests under docker
 - `yarn test:python` to run the data engine tests
 - `yarn test:stubs` to run the end-to-end tests with stubs, which are simplified versions of the tests for faster execution   

Also some options that may interest you:
 - `GREP_TESTS="pattern"` in order to filter the tests to run, for example: `GREP_TESTS="Boot" yarn test:nbrowser`
 - `VERBOSE=1` in order to view logs when a server is spawned (especially useful to debug the end-to-end and backend tests)
 - `SERVER_NODE_OPTIONS="node options"` in order to pass options to the server being tested,
   for example: `SERVER_NODE_OPTIONS="--inspect --inspect-brk" GREP_TESTS="Boot" yarn test:nbrowser`
   to run the tests with the debugger (you should close the debugger each time the node process should stop)
 - `MOCHA_WEBDRIVER_HEADLESS=1` to run the end-to-end tests in headless mode, meaning a browser window won't be opened
 - `NO_CLEANUP=1` to not restart/clean state after test ends, used with `DEBUG=1`
 - `DEBUG=1` to keep the server running after the tests are done and to provide more detailed output
 - `MOCHA_WEBDRIVER_LOGDIR=/tmp/grist-tests` to specify the directory where the logs of the end-to-end tests will be stored (together with screenshots of the browser at the time of failure)

## End-to-end tests

End-to-end tests work by simulating user mouse clicks and keyboard inputs in an actual chrome browser. By default, running `yarn test:nbrowser` opens a new browser window where automated "user" interactions happen.

### Headless mode

You can use the `MOCHA_WEBDRIVER_HEADLESS` env var to start the tests in headless mode, meaning a browser window won't be opened:

```
MOCHA_WEBDRIVER_HEADLESS=1 yarn run test:nbrowser
```

Running in headless mode allows you to run the tests in background, without the risk of automated tests catching window focus while you are doing something else.

Running in normal mode helps you understand better what happens when writing or debugging tests.

### Browser version issues

End-to-end tests are run in the GitHub CI with a specific _Chrome_ version that is known to run the tests smoothly.

⚠️ A current issue is that tests don't run properly with _Chrome for Testing_ binaries, or with _Chrome_ starting with version 134.

**If you don't have any tests randomly failing while running them locally: great! You can move on.**

Otherwise, you should make sure that the local test suite uses _Chrome v132_ or _Chrome v133_, and not a _Chrome for Testing_ variant.

In order to do that, you can use an env var to let the script know about a specific chrome binary to use. For example, if your Chrome (v132 or 133) path is `/usr/bin/google-chrome`:

```
TEST_CHROME_BINARY_PATH="/usr/bin/google-chrome" yarn run test:nbrowser
```

#### Using an older Chrome version than the one you have already installed

You might already have Chrome v134+ installed and feel stuck!

One solution is to build yourself a docker container matching what the GitHub actions does. Meaning, with node, python etc, an integrated Chrome v133 binary, and run tests inside that container.

Another solution on Linux, is to just install an old Chrome version on your system directly.

A simple trick is to install an old Chrome _Beta_ binary, in order to not mess with your current Chrome install.

#### Debian-based distro

You can do the same as the `buildtools/install_chrome_for_tests.sh` script, but target an old version of Chrome _Beta_ like this:

```bash
curl -sS -o /tmp/chrome.deb http://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-beta/google-chrome-beta_133.0.6943.35-1_amd64.deb \
  && sudo apt-get install --allow-downgrades -y /tmp/chrome.deb \
  && rm /tmp/chrome.deb \
```

Open `google-chrome-beta` one time manually to confirm any first-loads modals that would prevent tests to run correctly.

Then run tests with:

```
SE_BROWSER_VERSION=133.0.6943.35 \
SE_DRIVER_VERSION=133.0.6943.141 \
TEST_CHROME_BINARY_PATH="/usr/bin/google-chrome-beta" \
yarn run test:nbrowser
```

#### Archlinux

Download the google-chrome-beta aur tarball matching the needed version and manually install it:

- download and extract [this aur tarball](https://aur.archlinux.org/cgit/aur.git/snapshot/aur-56ac6350a4f727c76f7e0c406233e7cad0a45b5f.tar.gz) (matching Chrome Beta [v133](https://aur.archlinux.org/cgit/aur.git/commit/PKGBUILD?h=google-chrome-beta&id=56ac6350a4f727c76f7e0c406233e7cad0a45b5f))
- `cd` in the extracted directory and `makepkg -si`.

Open `google-chrome-beta` one time manually to confirm any first-loads modals that would prevent tests to run correctly.

Then run tests with:

```
SE_BROWSER_VERSION=133.0.6943.35 \
SE_DRIVER_VERSION=133.0.6943.141 \
TEST_CHROME_BINARY_PATH="/usr/bin/google-chrome-beta" \
yarn run test:nbrowser
```

#### macOS

Unfortunately there is no easy way in macOS to pin Chrome version without it auto-updating. If you absolutely need to run tests locally for now:

- create a docker image matching the GitHub CI environment in order to run the tests inside a Linux environment having a pinned Chrome version
- or… help us fix the tests (sorry)!

Note that tests are always run against pull requests and you can also rely on the GitHub CI instead.

## Develop widgets

Check out this repository: https://github.com/gristlabs/grist-widget#readme

## Documentation

Some documentation to help you starting developing:
 - [Overview of Grist Components](./overview.md)
 - [The database](./database.md)
 - [GrainJS & Grist Front-End Libraries](./grainjs.md)
 - [GrainJS Documentation](https://github.com/gristlabs/grainjs/) (The library used to build the DOM)
 - [The user support documentation](https://support.getgrist.com/)
