import {
  AssistanceMessage,
  AssistanceRequestV2,
  AssistanceResponse,
  getUnansweredToolCalls,
  isToolRequest,
} from "app/common/Assistance";
import { MapWithTTL } from "app/common/AsyncCreate";

import { createHash } from "crypto";

const STOPPED_TURN_TTL_MS = 60 * 60 * 1000;

interface StoppedTurn {
  length: number;
  hash: string;
  unansweredIds: Set<string>;
}

/**
 * Tracks assistant turns that stop on unanswered tool calls (the browser's calls, or one awaiting
 * the user's approval), so that the requests continuing a turn aren't charged as new ones.
 */
export class AssistanceTracker {
  private _stoppedTurns = new MapWithTTL<string, StoppedTurn>(STOPPED_TURN_TTL_MS);

  /**
   * Returns `getResponse`'s response to `request`, telling it whether `request` continues a turn
   * that stopped: its state is the one the turn stopped with, plus answers to the stopped calls
   * and nothing else. A stopped turn can be continued once, or again if continuing it failed.
   */
  public async track<T extends AssistanceResponse>(
    userId: number,
    request: AssistanceRequestV2,
    getResponse: (continuesTurn: boolean) => Promise<T>,
  ): Promise<T> {
    const key = `${userId}:${request.conversationId}`;
    const turn = this._continue(key, request);
    let response: T;
    try {
      response = await getResponse(Boolean(turn));
    } catch (e) {
      if (turn && !this._stoppedTurns.has(key)) { this._stoppedTurns.set(key, turn); }
      throw e;
    }
    this._record(key, response);
    return response;
  }

  /** Forgets every stopped turn. */
  public clear() {
    this._stoppedTurns.clear();
  }

  private _continue(key: string, request: AssistanceRequestV2): StoppedTurn | undefined {
    const turn = this._stoppedTurns.get(key);
    if (!turn || !isToolRequest(request)) { return; }

    const messages = request.state.messages ?? [];
    const answered = new Set<string>();
    for (const { role, tool_call_id: id } of messages.slice(turn.length)) {
      if (role !== "tool" || !id || !turn.unansweredIds.has(id) || answered.has(id)) { return; }
      answered.add(id);
    }
    if (hashMessages(messages.slice(0, turn.length)) !== turn.hash) { return; }

    this._stoppedTurns.delete(key);
    return turn;
  }

  private _record(key: string, response: AssistanceResponse) {
    const unansweredCalls = getUnansweredToolCalls(response.state);
    if (unansweredCalls.length === 0) {
      this._stoppedTurns.delete(key);
      return;
    }

    const messages = response.state?.messages ?? [];
    this._stoppedTurns.set(key, {
      length: messages.length,
      hash: hashMessages(messages),
      unansweredIds: new Set(unansweredCalls.map(call => call.id)),
    });
  }
}

// The server replaces the system message on every request, so it's left out.
function hashMessages(messages: AssistanceMessage[]) {
  return createHash("sha256").update(JSON.stringify(messages.slice(1))).digest("base64");
}
