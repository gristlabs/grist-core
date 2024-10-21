import {buildNumberFormat} from 'app/common/NumberFormat';
import {assert} from 'chai';

describe("NumberFormat", function() {
  const defaultDocSettings = {
    locale: 'en-US'
  };

  // useGrouping became more nuanced in recent node.
  // Its old 'true' value may now be 'always' or 'auto'.
  const useGroupingAlways = buildNumberFormat(
    {numMode: 'decimal'},
    defaultDocSettings
  ).resolvedOptions().useGrouping as boolean|string;
  const useGroupingAuto = (useGroupingAlways === 'always') ? 'auto' : true;

  it("should convert Grist options into Intr.NumberFormat", function() {
    assert.include(['true', 'always'], String(useGroupingAlways));

    assert.ownInclude(buildNumberFormat({}, defaultDocSettings).resolvedOptions(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 10,
      style: 'decimal',
      useGrouping: false,
    });
    assert.ownInclude(buildNumberFormat({numMode: 'decimal'}, defaultDocSettings).resolvedOptions(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      style: 'decimal',
      useGrouping: useGroupingAlways,
    });
    assert.ownInclude(buildNumberFormat({numMode: 'percent'}, defaultDocSettings).resolvedOptions(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      // style: 'percent',  // In node v14.17.0 style is 'decimal' (unclear why)
                            // so we check final formatting instead in this case.
      useGrouping: useGroupingAuto,
    });
    assert.equal(buildNumberFormat({numMode: 'percent'}, defaultDocSettings).format(0.5), '50%');
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, defaultDocSettings).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'USD',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'scientific'}, defaultDocSettings).resolvedOptions(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      style: 'decimal',
      // notation: 'scientific',    // Should be set, but node doesn't support it until node 12.
    });

    // Ensure we don't hit errors when max digits is less than the min (which could be implicit).
    assert.ownInclude(buildNumberFormat({numMode: 'currency', maxDecimals: 1}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.ownInclude(
      buildNumberFormat({numMode: 'currency', decimals: 0, maxDecimals: 1}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    assert.ownInclude(buildNumberFormat({decimals: 5}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 5, maximumFractionDigits: 10 });
    assert.ownInclude(buildNumberFormat({decimals: 15}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 15, maximumFractionDigits: 15 });
  });

  it('should clamp min/max decimals to valid values', function() {
    assert.ownInclude(buildNumberFormat({}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 0, maximumFractionDigits: 10 });
    assert.ownInclude(buildNumberFormat({decimals: 5}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 5, maximumFractionDigits: 10 });
    assert.ownInclude(buildNumberFormat({maxDecimals: 5}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 0, maximumFractionDigits: 5 });
    assert.ownInclude(buildNumberFormat({decimals: -10, maxDecimals: 50}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 0, maximumFractionDigits: 20 });
    assert.ownInclude(buildNumberFormat({decimals: 21, maxDecimals: 1}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 20, maximumFractionDigits: 20 });
    assert.ownInclude(buildNumberFormat({numMode: 'currency', maxDecimals: 1}, defaultDocSettings).resolvedOptions(),
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });    // Currency overrides the minimum
  });

  it('should convert locales to local currency', function() {
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'fr-BE'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'EUR',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'en-NZ'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'NZD',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'de-CH'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'CHF',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'es-AR'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'ARS',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'zh-TW'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'TWD',
    });
    assert.ownInclude(buildNumberFormat({numMode: 'currency'}, {locale: 'en-AU'}).resolvedOptions(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      style: 'currency',
      useGrouping: useGroupingAuto,
      currency: 'AUD',
    });
  });
});
