import { getStorage } from "app/client/lib/storage";
import {
  armSetupReturnFromGetGristCom,
  clearSetupReturnFromGetGristCom,
  peekSetupReturnFromGetGristCom,
  SETUP_RETURN_KEY,
} from "app/client/ui/GetGristComProvider";
import { setTmpMochaGlobals } from "test/client/clientUtil";

import { assert } from "chai";

describe("GetGristComProvider setup-return breadcrumb", function() {
  setTmpMochaGlobals();

  beforeEach(() => {
    getStorage().removeItem(SETUP_RETURN_KEY);
  });

  it("should not be armed by default", function() {
    assert.strictEqual(peekSetupReturnFromGetGristCom(), null);
  });

  it("arm() sets the breadcrumb and peek() reads it without consuming", function() {
    armSetupReturnFromGetGristCom("auth");
    assert.strictEqual(peekSetupReturnFromGetGristCom(), "auth");
    assert.strictEqual(peekSetupReturnFromGetGristCom(), "auth");
  });

  it("clear() removes the breadcrumb", function() {
    armSetupReturnFromGetGristCom("auth");
    clearSetupReturnFromGetGristCom();
    assert.strictEqual(peekSetupReturnFromGetGristCom(), null);
  });

  it("peek() returns null when storage holds an unrecognized value", function() {
    // Defensive: stale/forward-compat values in storage should not be
    // surfaced as valid steps.
    getStorage().setItem(SETUP_RETURN_KEY, "something-else");
    assert.strictEqual(peekSetupReturnFromGetGristCom(), null);
  });

  it("re-arming overwrites the previous value", function() {
    armSetupReturnFromGetGristCom("auth");
    armSetupReturnFromGetGristCom("auth");
    assert.strictEqual(peekSetupReturnFromGetGristCom(), "auth");
  });
});
