const grist = require('grist-plugin-api');

const {foo} = grist.rpc.getStub('foo@grist');
let tableId = 'Table1';
const colId = 'A';
let promise = Promise.resolve(true);

grist.rpc.on('message', msg => {
  if (msg.type === "docAction") {
    if (msg.action[0] === 'RenameTable') {
      tableId = msg.action[2];
    }
    promise = getColValues(colId).then(foo);
  }
});

function getColValues(colId) {
  return grist.docApi.fetchTable(tableId).then(data => data[colId]);
}

class TestSubscribe {

  invoke(api, name, args){
    return grist[api][name](...args);
  }

  // Returns a promise that resolves when an ongoing call resolves. Resolves right-awa if plugin has
  // no pending call.
  waitForPlugin() {
    return promise.then(() => true);
  }
}

module.exports = TestSubscribe;
