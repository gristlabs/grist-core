import {DEPS, relativeDatesOptions} from 'app/client/ui/RelativeDatesOptions';

import sinon, { SinonStub } from 'sinon';
import {assert} from 'chai';
import moment from 'moment-timezone';

const valueFormatter = (val: any) => moment(val * 1000).format('YYYY-MM-DD');
const toGristDate = (val: moment.Moment) => Math.floor(val.valueOf() / 1000);


function getOptions(date: string) {
  const m = moment(date);
  const dateUTC = moment.utc([m.year(), m.month(), m.date()]);
  return relativeDatesOptions(toGristDate(dateUTC), valueFormatter);
}

function checkOption(options: Array<{label: string, spec: any}>, label: string, spec: any) {
  try {
    assert.deepInclude(options, {label, spec});
  } catch (e) {
    const json = `{\n  ${options.map(o => JSON.stringify({label: o.label, spec: o.spec})).join('\n  ')}\n}`;
    assert.fail(`expected ${json} to include\n  ${JSON.stringify({label, spec})}`);
  }
}

function optionNotIncluded(options: any[], label: string) {
  assert.notInclude(options.map(o => o.label), label);
}

describe('RelativeDatesOptions', function() {

  const sandbox = sinon.createSandbox();
  let getCurrentTimeSub: SinonStub;

  function setCurrentDate(now: string) {
    getCurrentTimeSub.returns(moment(now));
  }

  before(() => {
    getCurrentTimeSub = sandbox.stub(DEPS, 'getCurrentTime');
  });

  after(() => {
    sandbox.restore();
  });

  describe('relativeDateOptions', function() {
    it('should limit \'X days ago/from now\' to 90 days ago/from now', function() {
      setCurrentDate('2022-09-26');

      checkOption(getOptions('2022-09-10'), '16 days ago', [{quantity: -16, unit: 'day'}]);

      checkOption(getOptions('2022-06-28'), '90 days ago', [{quantity: -90, unit: 'day'}]);


      // check no options of the form 'X days ago'
      optionNotIncluded(getOptions('2022-06-27'), '91 days ago');
      assert.notOk(getOptions('2022-06-27').find(o => /^[0-9]+ days ago$/.test(o.label)));

      checkOption(getOptions('2022-09-26'), 'Today', [{quantity: 0, unit: 'day'}]);
      checkOption(getOptions('2022-09-27'), 'Tomorrow', [{quantity: 1, unit: 'day'}]);
      checkOption(getOptions('2022-10-02'), '6 days from now', [{quantity: 6, unit: 'day'}]);
    });

    it('should limit \'WEEKDAY of X weeks ago/from now\' to 4 weeks ago/from now', function() {
      setCurrentDate('2022-09-26');

      checkOption(getOptions('2022-09-20'), 'Tuesday of last week', [
        {quantity: -1, unit: 'week'}, {quantity: 2, unit: 'day'}]);

      checkOption(getOptions('2022-09-21'), 'Wednesday of last week', [
        {quantity: -1, unit: 'week'}, {quantity: 3, unit: 'day'}]);

      checkOption(getOptions('2022-08-31'), 'Wednesday of 4 weeks ago', [
        {quantity: -4, unit: 'week'}, {quantity: 3, unit: 'day'}]);

      assert.notDeepInclude(getOptions('2022-08-24'), {
        label: 'Wednesday of 5 weeks ago',
        spec: [{quantity: -5, unit: 'week'}, {quantity: 3, unit: 'day'}]
      });
      assert.notOk(getOptions('2022-08-24').find(o => /Wednesday/.test(o.label)));

      checkOption(getOptions('2022-09-29'), 'Thursday of this week', [
        {quantity: 0, unit: 'week'}, {quantity: 4, unit: 'day'}]);

      checkOption(getOptions('2022-10-13'), 'Thursday of 2 weeks from now', [
        {quantity: 2, unit: 'week'}, {quantity: 4, unit: 'day'}]);

    });

    it('should limit \'N day of X month ago/from no\' to 3 months ago/from now', function() {
      setCurrentDate('2022-09-26');

      checkOption(getOptions('2022-09-27'), '27th day of this month', [
        {quantity: 0, unit: 'month'}, {quantity: 26, unit: 'day'}]);

      checkOption(getOptions('2022-06-16'), '16th day of 3 months ago', [
        {quantity: -3, unit: 'month'}, {quantity: 15, unit: 'day'}]);

      assert.notOk(getOptions('2022-05-16').find(o => /months? ago/.test(o.label)));

      checkOption(getOptions('2022-10-16'), '16th day of next month', [
        {quantity: 1, unit: 'month'}, {quantity: 15, unit: 'day'}]);

      checkOption(getOptions('2022-11-16'), '16th day of 2 months from now', [
        {quantity: 2, unit: 'month'}, {quantity: 15, unit: 'day'}]);

      assert.notOk(getOptions('2023-01-16').find(o => /months? from now/.test(o.label)));
    });

    it('should limit \'1st day of year\' to 1st of Jan', function() {
      setCurrentDate('2022-09-26');

      checkOption(getOptions('2022-01-01'), '1st day of this year', [
        {quantity: 0, unit: 'year'}]);

      checkOption(getOptions('2021-01-01'), '1st day of last year', [
        {quantity: -1, unit: 'year'}]);

      checkOption(getOptions('2024-01-01'), '1st day of 2 years from now', [
        {quantity: 2, unit: 'year'}]);
    });

    it('should limit \'Last day of X year ago/from now\' to 31st of Dec', function() {
      setCurrentDate('2022-09-26');

      checkOption(getOptions('2022-12-31'), 'Last day of this year', [
        {quantity: 0, unit: 'year', endOf: true}]);

      checkOption(getOptions('2019-12-31'), 'Last day of 3 years ago', [
        {quantity: -3, unit: 'year', endOf: true}]);

      checkOption(getOptions('2027-12-31'), 'Last day of 5 years from now', [
        {quantity: 5, unit: 'year', endOf: true}]);

    });

    it('should offer 1st day of any month, limited to 12 months ago/from now', function() {
      setCurrentDate('2022-09-29');

      checkOption(getOptions('2022-09-01'), '1st day of this month', [
        {quantity: 0, unit: 'month'}]);

      checkOption(getOptions('2021-09-01'), '1st day of 12 months ago', [
        {quantity: -12, unit: 'month'}]);

      assert.notOk(getOptions('2021-08-01').find(o => /1st day of [0-9]+ months? ago/.test(o.label)));

      checkOption(getOptions('2022-11-01'), '1st day of 2 months from now', [{
        quantity: 2, unit: 'month'}]);
    });

    it('should offer last day of the month, limited to 12 months ago/from now', function() {
      setCurrentDate('2022-09-29');

      checkOption(getOptions('2022-09-30'), 'Last day of this month', [
        {quantity: 0, unit: 'month', endOf: true}]);

      checkOption(getOptions('2022-08-31'), 'Last day of last month', [
        {quantity: -1, unit: 'month', endOf: true}]);

      assert.notOk(getOptions('2021-08-31').find(o => /Last day of [0-9]+ months? ago/.test(o.label)));

      checkOption(getOptions('2022-12-31'), 'Last day of 3 months from now', [
        {quantity: 3, unit: 'month', endOf: true}]);
    });


  });
});
