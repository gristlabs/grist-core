import { TableDataAction } from "app/common/DocActions";
import { RecordView } from "app/common/RecordView";
import { User } from "app/common/User";

import { assert } from "chai";

// `SystemOnly` holds values that grant privileges - notably the ability to edit locked tables - so
// it must never appear in a payload sent to the client, while the sandbox relies on receiving it.
// These tests pin both halves of that boundary.
describe("User", function() {
  const userTable: TableDataAction = ["TableData", "Users", [7], {
    name: ["Bob"],
    org: ["Acme"],
  }];

  function makeUser() {
    return new User({
      Name: "Bob",
      Email: "bob@example.com",
      Access: "owners",
      UserID: 7,
      IsLoggedIn: true,
      SystemOnly: { CanEditLockedTables: true },
      Org: new RecordView(userTable, 0),
    });
  }

  it("should strip SystemOnly from the client payload and keep the rest", function() {
    const userInfo = makeUser().toUserInfo();
    assert.notProperty(userInfo, "SystemOnly");
    assert.deepInclude(userInfo, {
      Name: "Bob",
      Email: "bob@example.com",
      Access: "owners",
      UserID: 7,
      IsLoggedIn: true,
    });
    assert.deepEqual(userInfo.Org, { id: 0, name: "Bob", org: "Acme" });
  });

  it("should keep SystemOnly in the sandbox payload", function() {
    const json = makeUser().toJSON();
    assert.deepEqual(json.SystemOnly, { CanEditLockedTables: true });
    assert.equal(json.Name, "Bob");
    assert.deepEqual(json.Org, ["Users", 7]);
  });
});
