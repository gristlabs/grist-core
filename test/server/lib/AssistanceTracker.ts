import {
  AssistanceMessage,
  AssistanceRequestV2,
  AssistanceResponseV2,
  AssistanceToolRequestV2,
} from "app/common/Assistance";
import { AssistanceTracker } from "app/server/lib/AssistanceTracker";

import { assert } from "chai";
import * as sinon from "sinon";

describe("AssistanceTracker", function() {
  const history: AssistanceMessage[] = [
    { role: "system", content: "You are an assistant." },
    { role: "user", content: "Make a widget" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call-1", function: { name: "get_creator_html", arguments: "{\"draft\":true}" } },
        { id: "call-2", function: { name: "set_creator_html", arguments: "{\"draft\":true}" } },
      ],
    },
  ];
  const stopped: AssistanceResponseV2 = { state: { messages: history } };

  let tracker: AssistanceTracker;

  beforeEach(async function() {
    tracker = new AssistanceTracker();
    await track({ conversationId: "c1", context: {}, text: "Make a widget" }, stopped);
  });

  afterEach(function() {
    tracker.clear();
  });

  /** Tracks `request` getting `response`, and returns whether it continued a stopped turn. */
  async function track(
    request: AssistanceRequestV2,
    response: AssistanceResponseV2 | Error = { reply: "Done" },
    userId = 1,
  ) {
    let continued: boolean | undefined;
    await tracker.track(userId, request, async (continuesTurn) => {
      continued = continuesTurn;
      if (response instanceof Error) { throw response; }
      return response;
    }).catch(() => {});
    return continued;
  }

  function answer(id: string): AssistanceMessage {
    return { role: "tool", tool_call_id: id, content: "{\"ok\":true}" };
  }

  function continuation(messages: AssistanceMessage[], fields: Partial<AssistanceToolRequestV2> = {}) {
    return { conversationId: "c1", context: {}, state: { messages: JSON.parse(JSON.stringify(messages)) }, ...fields };
  }

  it("lets a request that answers stopped calls, and nothing else, continue the turn once", async function() {
    const replaced = [{ role: "system" as const, content: "Replaced" }, ...history.slice(1)];
    const request = continuation([...replaced, answer("call-2")]);
    assert.isTrue(await track(request));
    assert.isFalse(await track(request));
  });

  it("lets a request with approvals, and nothing new, continue the turn", async function() {
    assert.isTrue(await track(continuation(history, { approvals: [{ toolCallId: "call-2", approved: true }] })));
  });

  it("doesn't let any other request continue the turn", async function() {
    const changed = [history[0], { role: "user" as const, content: "Something else" }, history[2]];
    const answered = continuation([...history, answer("call-1")]);
    const requests: AssistanceRequestV2[] = [
      continuation([...changed, answer("call-1")]),
      continuation(history.slice(0, 2)),
      continuation([...history, answer("call-1"), { role: "user", content: "Write me an essay" }]),
      continuation([...history, answer("call-9")]),
      continuation([...history, answer("call-1"), answer("call-1")]),
      { ...answered, text: "Hello" },
      { ...answered, conversationId: "c2" },
    ];
    for (const request of requests) {
      assert.isFalse(await track(request, stopped), JSON.stringify(request));
    }
    assert.isFalse(await track(answered, stopped, 2));
    assert.isTrue(await track(answered));
  });

  it("lets only one request continue the turn at a time", async function() {
    const request = continuation([...history, answer("call-1")]);
    let respond!: (response: AssistanceResponseV2) => void;
    const response = new Promise<AssistanceResponseV2>((resolve) => { respond = resolve; });
    const first = tracker.track(1, request, () => response);
    assert.isFalse(await track(request));
    respond({ reply: "Done" });
    await first;
  });

  it("lets the turn be continued again after continuing it fails", async function() {
    const request = continuation([...history, answer("call-1")]);
    assert.isTrue(await track(request, new Error("Failed")));
    assert.isTrue(await track(request));
  });

  it("only keeps the latest stop of a conversation", async function() {
    const next: AssistanceMessage[] = [
      ...history, answer("call-1"), answer("call-2"),
      { role: "assistant", content: null, tool_calls: [{ id: "call-3", function: { name: "f", arguments: "{}" } }] },
    ];
    assert.isTrue(await track(continuation(next.slice(0, -1)), { state: { messages: next } }));
    assert.isFalse(await track(continuation([...history, answer("call-1")]), { state: { messages: next } }));
    assert.isTrue(await track(continuation([...next, answer("call-3")])));
  });

  it("forgets a stop that isn't continued within an hour", async function() {
    tracker.clear();
    const clock = sinon.useFakeTimers();
    try {
      tracker = new AssistanceTracker();
      await track({ conversationId: "c1", context: {}, text: "Make a widget" }, stopped);
      clock.tick(60 * 60 * 1000 + 1);
      assert.isFalse(await track(continuation([...history, answer("call-1")])));
    } finally {
      clock.restore();
    }
  });
});
