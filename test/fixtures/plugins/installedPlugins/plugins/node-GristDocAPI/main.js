const grist = require('grist-plugin-api');
const TestSubscribe = require('./TestSubscribe');

grist.rpc.registerImpl("testApiNode", { // todo rename to testGristDocApiNode
  invoke: (name, args) => {
    const api = grist.rpc.getStub("GristDocAPI@grist", grist.checkers.GristDocAPI);
    return api[name](...args)
    .then((result) => [`node-GristDocAPI ${name}(${args.join(",")})`, result]);
  },
});

grist.rpc.registerImpl("testDocStorage", {
  invoke: (name, args) => {
    const api = grist.rpc.getStub("DocStorage@grist", grist.checkers.Storage);
    return api[name](...args);
  },
});

grist.rpc.registerImpl("testSubscribe", new TestSubscribe());

grist.ready();
