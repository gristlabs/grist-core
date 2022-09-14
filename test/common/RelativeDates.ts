import {DEPS, getMatchingDoubleRelativeDate} from 'app/client/ui/RelativeDatesOptions';
import sinon from 'sinon';
import {assert} from 'chai';
import moment from 'moment-timezone';
import {diffUnit} from 'app/common/RelativeDates';

const CURRENT_TIME = moment.tz('2022-09-26T12:13:32.018Z', 'utc');
const now = () => moment(CURRENT_TIME);

describe('RelativeDates', function() {
  const sandbox = sinon.createSandbox();

  before(() => {
    sinon.stub(DEPS, 'getCurrentTime').returns(now());
  });

  after(() => {
    sandbox.restore();
  });

  describe('getMatchingDoubleRelativeDate', function() {
    it('should work correctly', function() {
      assert.deepEqual(
        getMatchingDoubleRelativeDate(getDateValue('10/1/2022'), {unit: 'month'}),
        [{unit: 'month', quantity: 1}]
      );

      assert.deepEqual(
        getMatchingDoubleRelativeDate(getDateValue('9/19/2022'), {unit: 'week'}),
        [{unit: 'week', quantity: -1}, {quantity: 1, unit: 'day'}]
      );

      assert.deepEqual(
        getMatchingDoubleRelativeDate(getDateValue('9/21/2022'), {unit: 'week'}),
        [{unit: 'week', quantity: -1}, {quantity: 3, unit: 'day'}]
      );

      assert.deepEqual(
        getMatchingDoubleRelativeDate(getDateValue('9/30/2022'), {unit: 'month'}),
        [{unit: 'month', quantity: 0}, {quantity: 29, unit: 'day'}]
      );

      assert.deepEqual(
        getMatchingDoubleRelativeDate(getDateValue('10/1/2022'), {unit: 'month'}),
        [{unit: 'month', quantity: 1}]
      );
    });
  });

  describe('diffUnit', function() {
    it('should work correctly', function() {
      assert.equal(diffUnit(moment('2022-09-30'), moment('2022-10-01'), 'month'), -1);
      assert.equal(diffUnit(moment('2022-10-01'), moment('2022-09-30'), 'month'), 1);
      assert.equal(diffUnit(moment('2022-09-30'), moment('2022-10-01'), 'week'), 0);
      assert.equal(diffUnit(moment('2022-09-30'), moment('2022-10-02'), 'week'), -1);
    });
  });
});

function getDateValue(date: string): number {
  return moment.tz(date, "MM-DD-YYYY", 'utc').valueOf()/1000;
}
