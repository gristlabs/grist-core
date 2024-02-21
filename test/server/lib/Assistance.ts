import {createDocTools} from "test/server/docTools";
import {ActiveDoc} from "app/server/lib/ActiveDoc";
import {DEPS, OpenAIAssistant, sendForCompletion} from "app/server/lib/Assistance";
import {assert} from 'chai';
import * as sinon from 'sinon';
import {Response} from 'node-fetch';
import {DocSession} from "app/server/lib/DocSession";
import {AssistanceState} from "app/common/AssistancePrompts";

// For some reason, assert.isRejected is not getting defined,
// though test/chai-as-promised.js should be taking care of this.
// So test/chai-as-promised.js is just repeated here.
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

describe('Assistance', function () {
  this.timeout(10000);

  const docTools = createDocTools({persistAcrossCases: true});
  const table1Id = "Table1";
  const table2Id = "Table2";
  let session: DocSession;
  let doc: ActiveDoc;
  before(async () => {
    process.env.OPENAI_API_KEY = "fake";
    session = docTools.createFakeSession();
    doc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", table1Id, [{id: "A"}, {id: "B"}, {id: "C"}]],
      ["AddTable", table2Id, [{id: "A"}, {id: "B"}, {id: "C"}]],
    ]);
  });

  const colId = "C";
  const userMessageContent = "Sum of A and B";

  function checkSendForCompletion(state?: AssistanceState) {
    return sendForCompletion(session, doc, {
      conversationId: 'conversationId',
      context: {type: 'formula', tableId: table1Id, colId},
      state,
      text: userMessageContent,
    });
  }

  let fakeResponse: () => any;
  let fakeFetch: sinon.SinonSpy;

  beforeEach(() => {
    fakeFetch = sinon.fake(() => {
      const body = fakeResponse();
      return new Response(
        JSON.stringify(body),
        {status: body.status},
      );
    });
    sinon.replace(DEPS, 'fetch', fakeFetch as any);
    sinon.replace(DEPS, 'delayTime', 1);
  });

  afterEach(function () {
    sinon.restore();
  });

  function checkModels(expectedModels: string[]) {
    assert.deepEqual(
      fakeFetch.getCalls().map(call => JSON.parse(call.args[1].body).model),
      expectedModels,
    );
  }

  it('can suggest a formula', async function () {
    const reply = "Here's a formula that adds columns A and B:\n\n"
      + "```python\na = int(rec.A)\nb=int(rec.B)\n\nreturn str(a + b)\n```"
      + "\n\nLet me know if there's anything else I can help with.";
    const replyMessage = {"role": "assistant", "content": reply};

    fakeResponse = () => ({
      "choices": [{
        "index": 0,
        "message": replyMessage,
        "finish_reason": "stop"
      }],
      status: 200,
    });
    const result = await checkSendForCompletion();
    checkModels([OpenAIAssistant.DEFAULT_MODEL]);
    const callInfo = fakeFetch.getCall(0);
    const [url, request] = callInfo.args;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(request.method, 'POST');
    const {messages: requestMessages} = JSON.parse(request.body);
    const systemMessageContent = requestMessages[0].content;
    assert.match(systemMessageContent, /def C\(rec: Table1\)/);
    assert.deepEqual(requestMessages, [
        {
          role: "system",
          content: systemMessageContent,
        },
        {
          role: "user",
          content: userMessageContent,
        }
      ]
    );
    const suggestedFormula = "a = int($A)\nb=int($B)\n\nstr(a + b)";
    const replyWithSuggestedFormula = "Here's a formula that adds columns A and B:\n\n"
      + "```python\na = int($A)\nb=int($B)\n\nstr(a + b)\n```"
      + "\n\nLet me know if there's anything else I can help with.";
    assert.deepEqual(result, {
        suggestedActions: [
          ["ModifyColumn", table1Id, colId, {formula: suggestedFormula}]
        ],
        suggestedFormula,
        reply: replyWithSuggestedFormula,
        state: {
          messages: [...requestMessages, replyMessage]
        }
      }
    );
  });

  it('does not suggest anything if formula is invalid', async function () {
    const reply = "This isn't valid Python code:\n```python\nclass = 'foo'\n```";
    const replyMessage = {
      "role": "assistant",
      "content": reply,
    };

    fakeResponse = () => ({
      "choices": [{
        "index": 0,
        "message": replyMessage,
        "finish_reason": "stop"
      }],
      status: 200,
    });
    const result = await checkSendForCompletion();
    const callInfo = fakeFetch.getCall(0);
    const [, request] = callInfo.args;
    const {messages: requestMessages} = JSON.parse(request.body);
    const suggestedFormula = undefined;
    assert.deepEqual(result, {
        suggestedActions: [],
        suggestedFormula,
        reply,
        state: {
          messages: [...requestMessages, replyMessage],
        },
      }
    );
  });

  it('tries 3 times in case of network errors', async function () {
    fakeResponse = () => {
      throw new Error("Network error");
    };
    await assert.isRejected(
      checkSendForCompletion(),
      "Sorry, the assistant is unavailable right now. " +
      "Try again in a few minutes. \n" +
      "(Error: Network error)",
    );
    assert.equal(fakeFetch.callCount, 3);
  });

  it('tries 3 times in case of bad status code', async function () {
    fakeResponse = () => ({status: 500});
    await assert.isRejected(
      checkSendForCompletion(),
      "Sorry, the assistant is unavailable right now. " +
      "Try again in a few minutes. \n" +
      '(Error: OpenAI API returned status 500: {"status":500})',
    );
    assert.equal(fakeFetch.callCount, 3);
  });

  it('handles exceeded billing quota', async function () {
    fakeResponse = () => ({
      error: {
        code: "insufficient_quota",
      },
      status: 429,
    });
    await assert.isRejected(
      checkSendForCompletion(),
      "Sorry, the assistant is facing some long term capacity issues. " +
      "Maybe try again tomorrow.",
    );
    assert.equal(fakeFetch.callCount, 1);
  });

  it('switches to a longer model with no retries if the prompt is too long', async function () {
    fakeResponse = () => ({
      error: {
        code: "context_length_exceeded",
      },
      status: 400,
    });
    await assert.isRejected(
      checkSendForCompletion(),
      /You'll need to either shorten your message or delete some columns/
    );
    checkModels([
      OpenAIAssistant.DEFAULT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
    ]);
  });

  it('switches to a shorter prompt if the longer model exceeds its token limit', async function () {
    fakeResponse = () => ({
      error: {
        code: "context_length_exceeded",
      },
      status: 400,
    });
    await assert.isRejected(
      checkSendForCompletion(),
      /You'll need to either shorten your message or delete some columns/
    );
    fakeFetch.getCalls().map((callInfo, i) => {
      const [, request] = callInfo.args;
      const {messages} = JSON.parse(request.body);
      const systemMessageContent = messages[0].content;
      const shortCallIndex = 2;
      if (i === shortCallIndex) {
        assert.match(systemMessageContent, /class Table1/);
        assert.notMatch(systemMessageContent, /class Table2/);
        assert.notMatch(systemMessageContent, /def lookupOne/);
        assert.lengthOf(systemMessageContent, 1001);
      } else {
        assert.match(systemMessageContent, /class Table1/);
        assert.match(systemMessageContent, /class Table2/);
        assert.match(systemMessageContent, /def lookupOne/);
        assert.lengthOf(systemMessageContent, 1982);
      }
    });
  });

  it('switches to a longer model with no retries if the model runs out of tokens while responding', async function () {
    fakeResponse = () => ({
      "choices": [{
        "index": 0,
        "message": {},
        "finish_reason": "length"
      }],
      status: 200,
    });
    await assert.isRejected(
      checkSendForCompletion(),
      /You'll need to either shorten your message or delete some columns/
    );
    checkModels([
      OpenAIAssistant.DEFAULT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
    ]);
  });

  it('suggests restarting conversation if the prompt is too long and there are past messages', async function () {
    fakeResponse = () => ({
      error: {
        code: "context_length_exceeded",
      },
      status: 400,
    });
    await assert.isRejected(
      checkSendForCompletion({
        messages: [
          {role: "system", content: "Be good."},
          {role: "user", content: "Hi."},
          {role: "assistant", content: "Hi!"},
        ]
      }),
      /You'll need to either shorten your message, restart the conversation, or delete some columns/
    );
    checkModels([
      OpenAIAssistant.DEFAULT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
    ]);
  });

  it('can switch to a longer model, retry, and succeed', async function () {
    fakeResponse = () => {
      if (fakeFetch.callCount === 1) {
        return {
          error: {
            code: "context_length_exceeded",
          },
          status: 400,
        };
      } else if (fakeFetch.callCount === 2) {
        return {
          status: 500,
        };
      } else {
        return {
          "choices": [{
            "index": 0,
            "message": {role: "assistant", content: "123"},
            "finish_reason": "stop"
          }],
          status: 200,
        };
      }
    };
    const result = await checkSendForCompletion();
    checkModels([
      OpenAIAssistant.DEFAULT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
      OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL,
    ]);
    assert.deepEqual(result.suggestedActions, [
      ["ModifyColumn", table1Id, colId, {formula: "123"}]
    ]);
  });
});
