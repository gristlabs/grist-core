/* global describe, it */

import { timezoneOptionsImpl } from "app/client/widgets/TZAutocomplete";
import { assert } from "chai";
import * as momentTimezone from 'moment-timezone';

describe('DocumentSettings', function() {

  describe("timezoneOptionsImpl", function() {
    it("should return zones in correct order", function() {
      // let's test ordering of zones at time the test was written (Tue Jul 18 12:04:56.641 2017)
      const now = 1500393896641;
      assert.deepEqual(timezoneOptionsImpl(now, [
        "Pacific/Marquesas",
        "US/Aleutian",
        "America/Juneau",
        "America/Anchorage",
        "Antarctica/Mawson",
        "Asia/Calcutta",
        "Asia/Colombo",
        "Africa/Accra",
        "Antarctica/Casey"
      ], momentTimezone).map(({label}) => label), [
        "(GMT-09:30) Pacific/Marquesas",
        "(GMT-09:00) US/Aleutian",
        "(GMT-08:00) America/Anchorage",
        "(GMT-08:00) America/Juneau",
        "(GMT+00:00) Africa/Accra",
        "(GMT+05:00) Antarctica/Mawson",
        "(GMT+05:30) Asia/Calcutta",
        "(GMT+05:30) Asia/Colombo",
        "(GMT+11:00) Antarctica/Casey"
        ]);
    });
  });

});
