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
$ yarn run build:prod
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
 - `yarn test:smoke` to run the minimal test checking Grist can open, create and edit a document
 - `yarn test:nbrowser` to run the end-to-end tests
 - `yarn test:client` to run the tests for the client libraries
 - `yarn test:common` to run the tests for the common libraries shared between the client and the server
 - `yarn test:server` to run the backend tests
 - `yarn test:docker` to run some end-to-end tests under docker
 - `yarn test:python` to run the data engine tests

## Develop widgets

Check out this repository: https://github.com/gristlabs/grist-widget#readme

## Documentation

Some documentation to help you starting developing:
 - [Overview of Grist Components](./overview.md)
 - [GrainJS & Grist Front-End Libraries](./grainjs.md)
 - [GrainJS Documentation](https://github.com/gristlabs/grainjs/) (The library used to build the DOM)
 - [The user support documentation](https://support.getgrist.com/)
