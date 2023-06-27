const grist = require('grist-plugin-api');

grist.rpc.registerFunc("func1", (name) => `Yo: ${name}`);
grist.ready();
