const grist = require('grist-plugin-api');

grist.rpc.registerFunc("yo", (name) => `yo ${name}`);
grist.rpc.registerFunc("yoSafePython", (name) => grist.rpc.callRemoteFunc("yo@sandbox/main.py", name));
grist.ready();
