import { createSandbox } from 'app/server/lib/NSandbox';
import {assert} from 'chai';
import * as moment from 'moment-timezone';
import { setupCleanup } from 'test/server/testCleanup';
import * as testUtils from 'test/server/testUtils';

describe("PyMomentTest", function() {
  testUtils.setTmpLogLevel('warn');
  const cleanup = setupCleanup();

  it("should use correct timezone data", async function() {
    this.timeout(5000);
    const jsZones = moment.tz.names().map(name => {
      const z = moment.tz.zone(name)!;
      return [z.name, z.abbrs, z.offsets, z.untils];
    });

    const sandbox = createSandbox('sandboxed', {});
    cleanup.addAfterEach(async () => { await sandbox.shutdown(); });

    const pyZones = await sandbox.pyCall("test_tz_data");
    try {
      assert.deepEqual(jsZones, pyZones);
    } catch (e) {
      console.log("Timezone data in sandbox/grist/tzdata does not match " +
        "node_modules/moment-timezone/data/unpacked/latest.json");
      e.message += ": Perhaps re-run 'node sandbox/install_tz.js && ./build python'?";
      e.showDiff = false;
      throw e;
    }
  });
});
