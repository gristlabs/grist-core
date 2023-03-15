#!/usr/bin/env node
"use strict";
const path = require('path');
const codeRoot = path.dirname(path.dirname(path.dirname(__dirname)));

process.env.DATA_PATH = path.join(__dirname, 'data');


require('app-module-path').addPath(path.join(codeRoot, '_build'));
require('app-module-path').addPath(path.join(codeRoot, '_build', 'core'));
require('app-module-path').addPath(path.join(codeRoot, '_build', 'ext'));
require('test/formula-dataset/runCompletion_impl').runCompletion().catch(console.error);
