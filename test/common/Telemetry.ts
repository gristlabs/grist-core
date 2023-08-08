import {buildTelemetryEventChecker, TelemetryEvent} from 'app/common/Telemetry';
import {assert} from 'chai';

describe('Telemetry', function() {
  describe('buildTelemetryEventChecker', function() {
    it('returns a function that checks telemetry data', function() {
      assert.isFunction(buildTelemetryEventChecker('full'));
    });

    it('does not throw if event and metadata are valid', function() {
      const checker = buildTelemetryEventChecker('full');
      assert.doesNotThrow(() => checker('apiUsage', {
        method: 'GET',
        userId: 1,
        userAgent: 'node-fetch/1.0',
      }));
      assert.doesNotThrow(() => checker('siteUsage', {
        siteId: 1,
        siteType: 'team',
        inGoodStanding: true,
        stripePlanId: 'stripePlanId',
        numDocs: 1,
        numWorkspaces: 1,
        numMembers: 1,
        lastActivity: new Date('2022-12-30T01:23:45'),
        earliestDocCreatedAt: new Date('2022-12-29T00:01:02'),
      }));
      assert.doesNotThrow(() => checker('watchedVideoTour', {
        watchTimeSeconds: 30,
        userId: 1,
        altSessionId: 'altSessionId',
      }));
    });

    it("does not throw when metadata is a subset of what's expected", function() {
      const checker = buildTelemetryEventChecker('full');
      assert.doesNotThrow(() => checker('documentUsage', {
        docIdDigest: 'docIdDigest',
        siteId: 1,
        rowCount: 123,
        attachmentTypes: ['pdf'],
      }));
    });

    it('does not throw if all metadata is less than or equal to the expected telemetry level', function() {
      const checker = buildTelemetryEventChecker('limited');
      assert.doesNotThrow(() => checker('documentUsage', {
        rowCount: 123,
      }));
      assert.doesNotThrow(() => checker('siteUsage', {
        siteId: 1,
        siteType: 'team',
        inGoodStanding: true,
        numDocs: 1,
        numWorkspaces: 1,
        numMembers: 1,
        lastActivity: new Date('2022-12-30T01:23:45'),
        earliestDocCreatedAt: new Date('2022-12-29T00:01:02'),
      }));
      assert.doesNotThrow(() => checker('watchedVideoTour', {
        watchTimeSeconds: 30,
      }));
    });

    it('throws if event is invalid', function() {
      const checker = buildTelemetryEventChecker('full');
      assert.throws(
        () => checker('invalidEvent' as TelemetryEvent, {}),
        /Unknown telemetry event: invalidEvent/
      );
    });

    it('throws if metadata is invalid', function() {
      const checker = buildTelemetryEventChecker('full');
      assert.throws(
        () => checker('apiUsage', {invalidMetadata: '123'}),
        /Unknown metadata for telemetry event apiUsage: invalidMetadata/
      );
    });

    it('throws if metadata types do not match expected types', function() {
      const checker = buildTelemetryEventChecker('full');
      assert.throws(
        () => checker('siteUsage', {siteId: '1'}),
        // eslint-disable-next-line max-len
        /Telemetry metadata siteId of event siteUsage expected a value of type number but received a value of type string/
      );
      assert.throws(
        () => checker('siteUsage', {lastActivity: 1234567890}),
        // eslint-disable-next-line max-len
        /Telemetry metadata lastActivity of event siteUsage expected a value of type Date or string but received a value of type number/
      );
      assert.throws(
        () => checker('siteUsage', {inGoodStanding: 'true'}),
        // eslint-disable-next-line max-len
        /Telemetry metadata inGoodStanding of event siteUsage expected a value of type boolean but received a value of type string/
      );
      assert.throws(
        () => checker('siteUsage', {numDocs: '1'}),
        // eslint-disable-next-line max-len
        /Telemetry metadata numDocs of event siteUsage expected a value of type number but received a value of type string/
      );
      assert.throws(
        () => checker('documentUsage', {attachmentTypes: '1,2,3'}),
        // eslint-disable-next-line max-len
        /Telemetry metadata attachmentTypes of event documentUsage expected a value of type array but received a value of type string/
      );
      assert.throws(
        () => checker('documentUsage', {attachmentTypes: ['.txt', 1, true]}),
        // eslint-disable-next-line max-len
        /Telemetry metadata attachmentTypes of event documentUsage expected a value of type string\[\] but received a value of type object\[\]/
      );
    });

    it('throws if event requires an elevated telemetry level', function() {
      const checker = buildTelemetryEventChecker('limited');
      assert.throws(
        () => checker('signupVerified', {}),
        // eslint-disable-next-line max-len
        /Telemetry event signupVerified requires a minimum telemetry level of 2 but the current level is 1/
      );
    });

    it('throws if metadata requires an elevated telemetry level', function() {
      const checker = buildTelemetryEventChecker('limited');
      assert.throws(
        () => checker('watchedVideoTour', {
          watchTimeSeconds: 30,
          userId: 1,
          altSessionId: 'altSessionId',
        }),
        // eslint-disable-next-line max-len
        /Telemetry metadata userId of event watchedVideoTour requires a minimum telemetry level of 2 but the current level is 1/
      );
    });
  });
});
