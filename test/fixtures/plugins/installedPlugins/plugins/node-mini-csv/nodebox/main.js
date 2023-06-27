/**
 *
 * A minimal CSV reader with no type detection.
 * All communication done by hand - real plugins should have helper code for
 * RPC.
 *
 */

const csv = require('csv');
const fs = require('fs');
const path = require('path');

function readCsv(data, replier) {
  csv.parse(data, {}, function(err, output) {
    const result = {
      parseOptions: {
        options: ""
      },
      tables: [
        {
          table_name: "space-monkey" + require('dependency_test'),
          column_metadata: output[0].map(name => {
            return {
              id: name,
              type: 'Text'
            };
          }),
          table_data: output[0].map((name, idx) => {
            return output.slice(1).map(row => row[idx]);
          })
        }
      ]
    };
    replier(result);
  });
}

function processMessage(msg, replier, error_replier) {
  if (msg.meth == 'parseFile') {
    var dir = msg.dir;
    var fname = msg.args[0].path;
    var data = fs.readFileSync(path.resolve(dir, fname));
    readCsv(data, replier);
  } else {
    error_replier('unknown method');
  }
}

process.on('message', (m) => {
  const sendReply = (result) => {
    process.send({
      mtype: 2, /* RespData */
      reqId: m.reqId,
      data: result
    });
  };
  const sendError = (txt) => {
    process.send({
      mtype: 3, /* RespErr */
      reqId: m.reqId,
      mesg: txt
    });
  };
  processMessage(m, sendReply, sendError);
});

// Once we have a handler for 'message' set up, send home a ready
// message to give the all-clear.
process.send({ mtype: 4, data: {ready: true }});
