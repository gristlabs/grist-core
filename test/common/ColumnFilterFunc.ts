import { makeFilterFunc } from "app/common/ColumnFilterFunc";
import { FilterState } from "app/common/FilterState";
import moment from "moment-timezone";
import { assert } from 'chai';

const format = "YYYY-MM-DD HH:mm:ss";
const timezone = 'Europe/Paris';
const parseDateTime = (dateStr: string) => moment.tz(dateStr, format, true, timezone).valueOf() / 1000;
const columnType = `DateTime:${timezone}`;

describe('ColumnFilterFunc', function() {


  [
    {date: '2023-01-01 23:59:59', expected: false},
    {date: '2023-01-02 00:00:00', expected: true},
    {date: '2023-01-02 00:00:01', expected: true},
    {date: '2023-01-02 01:00:01', expected: true},
  ].forEach(({date, expected}) => {

    const minStr = '2023-01-02';
    const state: FilterState = { min: moment.utc(minStr).valueOf() / 1000 };
    const filterFunc = makeFilterFunc(state, columnType);

    it(`${minStr} <= ${date} should be ${expected}`, function() {
      assert.equal(filterFunc(parseDateTime(date)), expected);
    });
  });

  [
    {date: '2023-01-11 00:00:00', expected: true},
    {date: '2023-01-11 23:59:59', expected: true},
    {date: '2023-01-12 00:00:01', expected: false},
  ].forEach(({date, expected}) => {

    const maxStr = '2023-01-11';
    const state: FilterState = { max: moment.utc(maxStr).valueOf() / 1000 };
    const filterFunc = makeFilterFunc(state, columnType);

    it(`${maxStr} >= ${date} should be ${expected}`, function() {
      assert.equal(filterFunc(parseDateTime(date)), expected);
    });
  });
});
