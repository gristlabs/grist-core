import { makeFilterFunc } from "app/common/ColumnFilterFunc";
import { FilterState } from "app/common/FilterState";
import { CURRENT_DATE, relativeDateToUnixTimestamp } from "app/common/RelativeDates";

import { assert } from "chai";
import moment from "moment-timezone";

const format = "YYYY-MM-DD HH:mm:ss";
const timezone = "Europe/Paris";
const parseDateTime = (dateStr: string) => moment.tz(dateStr, format, true, timezone).valueOf() / 1000;
const columnType = `DateTime:${timezone}`;

describe("ColumnFilterFunc", function() {
  [
    { date: "2023-01-01 23:59:59", expected: false },
    { date: "2023-01-02 00:00:00", expected: true },
    { date: "2023-01-02 00:00:01", expected: true },
    { date: "2023-01-02 01:00:01", expected: true },
  ].forEach(({ date, expected }) => {
    const minStr = "2023-01-02";
    const state: FilterState = { min: moment.utc(minStr).valueOf() / 1000 };
    const filterFunc = makeFilterFunc(state, columnType);

    it(`${minStr} <= ${date} should be ${expected}`, function() {
      assert.equal(filterFunc(parseDateTime(date)), expected);
    });
  });

  [
    { date: "2023-01-11 00:00:00", expected: true },
    { date: "2023-01-11 23:59:59", expected: true },
    { date: "2023-01-12 00:00:01", expected: false },
  ].forEach(({ date, expected }) => {
    const maxStr = "2023-01-11";
    const state: FilterState = { max: moment.utc(maxStr).valueOf() / 1000 };
    const filterFunc = makeFilterFunc(state, columnType);

    it(`${maxStr} >= ${date} should be ${expected}`, function() {
      assert.equal(filterFunc(parseDateTime(date)), expected);
    });
  });

  describe("in a timezone west of UTC", function() {
    const tz = "America/New_York";
    const colType = `DateTime:${tz}`;
    const parse = (dateStr: string) => moment.tz(dateStr, format, true, tz).valueOf() / 1000;
    const calendarDate = (str: string) => moment.utc(str).valueOf() / 1000;

    it("should select the picked calendar date", function() {
      const state: FilterState = { min: calendarDate("2026-10-03"), max: calendarDate("2026-10-03") };
      const filterFunc = makeFilterFunc(state, colType);
      assert.isFalse(filterFunc(parse("2026-10-02 10:00:00")));
      assert.isFalse(filterFunc(parse("2026-10-02 23:59:59")));
      assert.isTrue(filterFunc(parse("2026-10-03 00:00:00")));
      assert.isTrue(filterFunc(parse("2026-10-03 10:00:00")));
      assert.isTrue(filterFunc(parse("2026-10-03 23:59:59")));
      assert.isFalse(filterFunc(parse("2026-10-04 00:00:00")));
    });

    it("should select today for a relative bound", function() {
      const today = moment.utc(relativeDateToUnixTimestamp(CURRENT_DATE) * 1000);
      const at = (offset: number) => parse(today.clone().add(offset, "day").format("YYYY-MM-DD") + " 10:00:00");
      const state: FilterState = { min: CURRENT_DATE, max: CURRENT_DATE };
      const filterFunc = makeFilterFunc(state, colType);
      assert.isFalse(filterFunc(at(-1)));
      assert.isTrue(filterFunc(at(0)));
      assert.isFalse(filterFunc(at(1)));
    });

    it("should keep typed bounds, which are instants in the column's timezone", function() {
      const state: FilterState = { min: parse("2026-10-03 00:00:00"), max: parse("2026-10-03 00:00:00") };
      const filterFunc = makeFilterFunc(state, colType);
      assert.isFalse(filterFunc(parse("2026-10-02 10:00:00")));
      assert.isTrue(filterFunc(parse("2026-10-03 10:00:00")));
      assert.isFalse(filterFunc(parse("2026-10-04 10:00:00")));
    });
  });
});
