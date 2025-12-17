import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {createDocTools} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

import {assert} from 'chai';
import range = require('lodash/range');

describe("BundleActions", function() {

  // Comment this out to see debug-log output when debugging tests.
  testUtils.setTmpLogLevel('error');

  const docTools = createDocTools();

  it('should bundle actions emitted without waiting', async function() {
    this.timeout(4000);

    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');

    // Try a few bundled actions, including some that don't wait for the previous one to complete.
    doc.startBundleUserActions(session);
    const actions1 = await Promise.all([
      doc.applyUserActions(session, [["AddTable", "Lamps1", [{id: "Color"}, {id: "Lumens"}]]]),
      doc.applyUserActions(session, [["AddColumn", "Lamps1", "Price", {type: 'Numeric'}]]),
      doc.applyUserActions(session, [["AddColumn", "Lamps1", "Weight", {type: 'Numeric'}]]),
    ]);
    actions1.push(await doc.applyUserActions(session, [["AddColumn", "Lamps1", "Quantity", {type: 'Int'}]]));
    doc.stopBundleUserActions(session);

    const expectedActionNums1 = range(actions1[0].actionNum, actions1[0].actionNum + 4);
    assert.deepEqual(actions1.map(a => a.actionNum), expectedActionNums1);

    async function getRecentActions(count: number) {
      return (await doc.getRecentActions(session, false)).actions.slice(-count);
    }

    assert.deepEqual((await getRecentActions(4)).map(a => a.actionNum), expectedActionNums1);
    assert.deepEqual((await getRecentActions(4)).map(a => a.linkId), [0, ...expectedActionNums1.slice(0, -1)]);

    // Try similar actions but unbundled.
    const actions2 = await Promise.all([
      doc.applyUserActions(session, [["AddTable", "Lamps2", [{id: "Color"}, {id: "Lumens"}]]]),
      doc.applyUserActions(session, [["AddColumn", "Lamps2", "Price", {type: 'Numeric'}]]),
      doc.applyUserActions(session, [["AddColumn", "Lamps2", "Weight", {type: 'Numeric'}]]),
      doc.applyUserActions(session, [["AddColumn", "Lamps2", "Quantity", {type: 'Int'}]]),
    ]);
    const expectedActionNums2 = range(actions2[0].actionNum, actions2[0].actionNum + 4);
    assert.deepEqual((await getRecentActions(4)).map(a => a.actionNum), expectedActionNums2);
    assert.deepEqual((await getRecentActions(4)).map(a => a.linkId), [0, 0, 0, 0]);
  });
});
