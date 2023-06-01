import {LogSanitizer} from "app/server/utils/LogSanitizer";
import {assert} from "chai";

describe("LogSanitizer", () => {

  it("should return neutral logs untouched", done => {
    const exampleLog
      = 'DocTriggers: Webhook responded with non-200 status status=404, attempt=1, docId=8x9U6xe4hNz8WaJCzAjDBM,' +
      ' queueLength=8, drainingQueue=false, shuttingDown=false, sending=true, redisClient=true';
    const sanitizer = new LogSanitizer();
    const sanitizedLog = sanitizer.sanitize(exampleLog);
    assert.equal(sanitizedLog, exampleLog);
    done();
  });

  it("should not crashed when empty log was passed to sanitizer", done => {
    const exampleLog = undefined;
    const sanitizer = new LogSanitizer();
    const sanitizedLog = sanitizer.sanitize(exampleLog);
    assert.equal(sanitizedLog, exampleLog);
    done();
  });




  it("should sanitize redis webhooks rpush logs", done => {
    const exampleLog = {
      command: "RPUSH",
      code: "NR_CLOSED",
      args: [
        "webhook-queue-8x9U6xe4hNz8WaJCzAjDBM",
        // Data send to redis is kept there in string format, therefore in our solution we are stringify them before
        // sending. we know that the payload is a json though, so here we are trying to reproduce that data structure.
        JSON.stringify({
          id: "f3517b07-9846-4fe3-bcb2-d26cc07e40bd",
          payload: {
            id: 355,
            manualSort: 355,
            Name: "Johny",
            InsuranceNumber: "12345"
          }
        }),
        // in thie redis those are json, but send as a strings, so we need to parse them
        JSON.stringify({
          id: "b3091e47-00a0-4614-a58f-cb1ae383ea43",
          payload: {
            id: 355,
            manualSort: 355,
            Name: "Mark",
            InsuranceNumber: "65844"
          }
        })
      ]
    };

    const sanitizer = new LogSanitizer();
    const sanitizedLogObj = sanitizer.sanitize(exampleLog);
    const sanitizedLog = JSON.stringify(sanitizedLogObj);

    // tests on stringify object, to make it fast to search in.
    assert.isTrue(sanitizedLog.includes("[sanitized]"));
    assert.isFalse(sanitizedLog.includes("InsuranceNumber"));
    assert.isFalse(sanitizedLog.includes("Name"));

    done();
  });

});
