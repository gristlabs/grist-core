import {ObjSnapshot, ObjSnapshotWithMetadata} from 'app/common/DocSnapshot';
import {SnapshotWindow} from 'app/common/Features';
import {DocSnapshotPruner, IInventory} from 'app/server/lib/DocSnapshots';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {assert} from 'chai';
import moment from 'moment';
import * as sinon from 'sinon';

describe('DocSnapshots', async function() {
  describe('DocSnapshotPruner', async function() {

    function makeStore(snapshots: ObjSnapshot[]): ExternalStorage {
      return {
        versions() { return Promise.resolve(snapshots); },
        exists() { throw new Error('not implemented'); },
        head() { throw new Error('not implemented'); },
        upload() { throw new Error('not implemented'); },
        download() { throw new Error('not implemented'); },
        remove() { throw new Error('not implemented'); },
        url() { throw new Error('not implemented'); },
        isFatalError() { throw new Error('not implemented'); },
        close() { throw new Error('not implemented'); },
      };
    }

    // Crude estimation of how many versions to expect with current strategy.
    function estimateVersionCount(snapshots: ObjSnapshot[]): number {
      const diff = maxDiff([snapshots[0], snapshots[snapshots.length - 1]], 'days');
      let total: number = 5;                                    // first 5 versions saved
      total += Math.min(25, Math.ceil(diff * 24));              // per-hour for first 25 hours
      total += Math.min(31, Math.max(0, Math.ceil(diff) - 1));  // per-day for next 31 days
      total += Math.min(8, Math.max(0, Math.ceil(diff / 7) - 4));   // per-week for next 8 weeks
      total += Math.min(33, Math.max(0, Math.ceil(diff / 32) - 3)); // per-month for next 33 months
      total += Math.max(0, Math.max(0, Math.ceil(diff / 365) - 3)); // per-year after first 3 years
      return total;
    }

    function maxDiff(snapshots: ObjSnapshot[], scale: 'days'|'hours'): number {
      let result: number = 0;
      for (const [index, snapshot] of snapshots.slice(1).entries()) {
        const prev = snapshots[index];
        const diff = moment(prev.lastModified).diff(snapshot.lastModified, scale, true);
        assert.isAtLeast(diff, 0.0);
        result = Math.max(result, diff);
      }
      return result;
    }

    /**
     * given a string of form ['+time1', '+time2', '-time3', ....], check that
     * with snapshots created at the specified times, pruning will end up keeping
     * the ones marked with a '+' and removing the ones marked with a '-'.
     */
    async function checkDecisions(times: string[], options: { timezone?: string, window?: SnapshotWindow } = {}) {
      const snapshotsWithMetadata: ObjSnapshotWithMetadata[] = times.map(t => ({
        lastModified: moment(t.split(' | ')[0].slice(1)).toISOString(),
        snapshotId: t,
        metadata: {
          ...(t.includes('|') ? {label: t.split(' | ')[1]} : undefined),
          ...options.timezone && {tz: options.timezone},
        }
      }));

      // Check that versions are classified as we expect.
      const inventory: IInventory = {
        getSnapshotWindow: async () => options.window,
        async versions() { return snapshotsWithMetadata; },
        async remove() { /* nothing to do */ }
      };
      const pruner = new DocSnapshotPruner(inventory);
      const versions = await pruner.classify('doc');
      // Versions are of form '+time1', '-time2', etc.
      // If we take a version name, like '-time2', strip the first character to get 'time2'
      // and then prefix a '+' or a '-' based on whether the version was kept, then we should
      // end up back where we started - IF the expected classification was made.
      assert.deepEqual(times, versions.map(v => (v.keep ? '+' : '-') + v.snapshot.snapshotId.slice(1)));

      // Check that ext.remove is called with the versions we expect to be removed.
      const remove = sinon.stub(inventory, 'remove');
      pruner.requestPrune('doc');
      await pruner.wait();
      assert.deepEqual(remove.getCall(0).args[1], versions.filter(v => !v.keep).map(v => v.snapshot.snapshotId));
    }

    it('selects reasonable versions to prune in a 10 day history', async function() {
      // Create versions over 10 days in minute intervals
      const snapshots: ObjSnapshot[] = [...Array(10 * 24 * 60).keys()].reverse().map((t, i) => ({
        lastModified: new Date(1600000000 + t * 60 * 1000).toISOString(),
        snapshotId: `v${i}`,
      }));
      // Prune versions
      const pruner = new DocSnapshotPruner(makeStore(snapshots));
      const versions = await pruner.classify('doc');
      const remaining = versions.filter(v => v.keep).map(v => v.snapshot);
      // Check there are a sane number of versions
      const count = estimateVersionCount(snapshots);
      assert.isAtMost(remaining.length, count * 1.1);
      assert.isAtLeast(remaining.length, count * 0.9);
      assert.equal(remaining.length, 39);  // Here's what it is in tests.
      // Check the maximum difference between successive versions is 1 day
      assert.isAtMost(maxDiff(remaining, 'days'), 1.0);
      // Check that the newest versions match exactly
      assert.equal(snapshots[0].snapshotId, remaining[0].snapshotId);
      // Check that the oldest versions differ by at most a day
      assert.isAtMost(maxDiff([remaining[remaining.length - 1],
                               snapshots[snapshots.length - 1]], 'days'), 1.0);
    });

    it('selects reasonable versions to prune in a 100 day history', async function() {
      // Create versions over 100 days in hourly intervals
      const snapshots: ObjSnapshot[] = [...Array(100 * 24).keys()].reverse().map((t, i) => ({
        lastModified: new Date(1404040400 + t * 60 * 60 * 1000).toISOString(),
        snapshotId: `v${i}`,
      }));
      // Prune versions
      const pruner = new DocSnapshotPruner(makeStore(snapshots));
      const versions = await pruner.classify('doc');
      const remaining = versions.filter(v => v.keep).map(v => v.snapshot);
      // Check there are a sane number of versions
      const count = estimateVersionCount(snapshots);
      assert.isAtMost(remaining.length, count * 1.1);
      assert.isAtLeast(remaining.length, count * 0.9);
      assert.equal(remaining.length, 66);  // Here's what it is in tests.
      // Check the maximum difference between successive versions is 1 month
      assert.isAtMost(maxDiff(remaining, 'days'), 31.0);
      // Check that the newest versions match exactly
      assert.equal(snapshots[0].snapshotId, remaining[0].snapshotId);
      // Check that the oldest versions differ by at most a month
      assert.isAtMost(maxDiff([remaining[remaining.length - 1],
                               snapshots[snapshots.length - 1]], 'days'), 31.0);
    });

    it('selects versions that allow gaps', async function() {
      // Construct a test case where versions in different hours are scattered in bursts.
      // Some preamble first:
      const times = [
        '+2000-09-09 09:30Z',  // most recent five versions will be kept
        '+2000-09-09 09:29Z',
        '+2000-09-09 09:28Z',
        '+2000-09-09 09:27Z',
        '+2000-09-09 09:26Z',
        '-2000-09-09 09:25Z',  // dropped since same hour as a kept version
        '+2000-09-09 08:59Z',  // kept since in a new hour - first use of this rule.
        '-2000-09-09 08:58Z',  // dropped since same hour as a kept version
      ];
      // Twelve versions in different hours the day before should be preserved
      for (let i = 0; i < 12; i++) {
        const hour = String(23 - i).padStart(2, '0');
        times.push(`+2000-09-08 ${hour}:15Z`);
      }
      // Twelve versions in different hours many days ago should be preserved
      for (let i = 0; i < 12; i++) {
        const hour = String(23 - i).padStart(2, '0');
        times.push(`+2000-05-08 ${hour}:15Z`);
      }
      // But that's it!  We used up our quota of 25 hours.
      times.push(`-2000-05-08 00:15Z`);
      await checkDecisions(times);
    });

    it('selects versions that match human reading of rules on a test case', async function() {
      const times = [
        // 2000-09-09 was a Saturday.
        '+2000-09-09 09:30Z',
        '+2000-09-09 09:29Z',
        '+2000-09-09 09:28Z',
        '+2000-09-09 09:27Z',
        '+2000-09-09 09:26Z',
        '-2000-09-09 09:25Z',
        '-2000-09-09 09:24Z',
        '-2000-09-09 09:23Z',
        '-2000-09-09 09:00Z',
        '+2000-09-09 08:59Z',  // because: new hour
        '-2000-09-09 08:58Z',
        '-2000-09-09 08:01Z',
        '+2000-09-09 07:30Z',  // because: new hour
        '-2000-09-09 07:20Z',
        '+2000-09-09 00:10Z',  // because: new hour
        '-2000-09-09 00:00Z',
        '+2000-09-08 23:59Z',  // because: new hour, day
        '-2000-09-08 23:50Z',
        '-2000-09-08 23:20Z',
        '+2000-09-08 18:50Z',  // because: new hour
        '-2000-09-08 18:20Z',
        '+2000-09-08 09:00Z',  // because: new hour
        '+2000-09-08 08:00Z',  // because: new hour
        '+2000-09-08 07:00Z',  // because: new hour
        '+2000-09-08 00:30Z',  // because: new hour
        '+2000-09-07 23:45Z',  // because: new hour, day
        '-2000-09-07 23:44Z',
        '+2000-09-07 05:44Z',  // because: new hour
        '+2000-09-06 05:44Z',  // because: new hour, day
        '+2000-09-03 12:00Z',  // because: new hour, day, isoWeek
        '+2000-09-03 06:00Z',  // because: new hour
        '+2000-08-31 15:44Z',  // because: new hour, day, month
        '+2000-08-31 12:00Z',  // because: new hour
        '+2000-08-22 15:44Z',  // because: new hour, day, isoWeek
        '+2000-08-09 15:44Z',  // because: new hour, day, isoWeek
        '+2000-08-08 07:44Z',  // because: new hour, day
        '+2000-08-07 15:44Z',  // because: new hour, day
        '+2000-08-06 15:44Z',  // because: new hour, day, isoWeek
        '+2000-08-05 15:44Z',  // because: new hour, day
        '+2000-08-01 15:44Z',  // because: new hour, day
        '+2000-07-31 15:44Z',  // because: new hour, day, month
        '+2000-07-30 15:44Z',  // because: new hour, day, isoWeek
        '+2000-07-28 15:44Z',  // because: new day
        '+2000-07-24 15:44Z',  // because: new day
        '+2000-07-23 15:44Z',  // because: new day, isoWeek
        '+2000-07-14 15:44Z',  // because: new day, isoWeek
        '+2000-07-11 15:44Z',  // because: new day
        '+2000-07-01 15:44Z',  // because: new day, isoWeek
        '+2000-06-28 15:44Z',  // because: new day, month
        '+2000-06-26 00:00Z',  // because: new day
        '+2000-06-19 00:00Z',  // because: new day, isoWeek
        '+2000-06-02 00:00Z',  // because: new day, isoWeek
        '+2000-05-25 00:00Z',  // because: new day, isoWeek, month
        '+2000-05-15 00:00Z',  // because: new day, isoWeek
        '+2000-05-05 00:00Z',  // because: new day
        '+2000-04-30 23:59Z',  // because: new day, month
        '+2000-04-15 00:00Z',  // because: new day
        '+2000-04-01 00:00Z',  // because: new day
        '+2000-03-10 12:00Z',  // because: new day, month
        '+2000-02-01 12:00Z',  // because: new day, month
        '+2000-01-20 12:00Z',  // because: new month
        '-2000-01-01 00:00Z',
        '+1999-12-31 23:59Z',  // because: new month, year
        '-1999-12-03 23:59Z',
        '+1999-11-20 23:59Z',  // because: new month
        '+1999-06-20 23:59Z',  // because: new month
        '-1999-06-01 00:00Z',
        '+1999-01-20 23:59Z',  // because: new month
        '-1999-01-05 00:00Z',
        '+1998-12-15 23:59Z',  // because: new month, year
        '+1998-06-15 23:59Z',  // because: new month
        '+1998-02-15 23:59Z',  // because: new month
        '-1998-02-03 23:59Z',
        '+1997-10-03 23:59Z',  // because: new month, year
        '+1997-09-12 23:59Z',  // because: new month
        '+1997-08-03 23:59Z',  // because: new month
        '+1997-05-05 23:59Z',  // because: new month
        '+1997-01-01 00:00Z',  // because: new month
        '+1996-01-01 00:00Z',  // because: new month, year
        '+1995-05-01 00:00Z',  // because: new month, year
        '+1995-01-01 00:00Z',  // because: new month
        '+1990-04-05 00:00Z',  // because: new month, year
        '+1990-01-02 00:00Z',  // because: new month
        '+1980-04-05 07:50Z',  // because: new month, year
        '-1980-04-05 07:40Z'
      ];
      await checkDecisions(times);
    });

    it('respects document timezone', async function() {
      const times = [
        '+2000-09-08 09:30Z',
        '+2000-09-08 09:29Z',
        '+2000-09-08 09:28Z',
        '+2000-09-08 09:27Z',
        '+2000-09-08 09:26Z',

        '+2000-09-08 08:26Z',
      ];
      for (let i = 23; i >= 0; i--) {
        times.push(`+2000-09-07 ${i.toString().padStart(2, '0')}:12Z`);
      }

      times.push('+2000-09-05 01:00Z');
      times.push('+2000-09-04 23:00Z');
      times.push('-2000-09-04 12:00Z');

      // The above +/- decisions hold in UTC.
      await checkDecisions(times);

      // In a timezone that is 5 hours behind UTC, the day threshold is different.
      times.pop();
      times.pop();
      times.push('-2000-09-04 23:00Z');
      times.push('+2000-09-04 12:00Z');
      await checkDecisions(times, {timezone: 'Etc/GMT-5'});
    });

    it('favors labelled versions', async function() {
      const times = [
        '+2000-09-08 09:30Z',
        '+2000-09-08 09:29Z',
        '+2000-09-08 09:28Z',
        '+2000-09-08 09:27Z',
        '+2000-09-08 09:26Z',

        '+2000-09-08 08:26Z',
        '+2000-09-08 08:25Z | save',
        '-2000-09-08 08:24Z',
        '+2000-09-08 08:23Z | me',
        '-2000-09-08 08:22Z',
      ];
      await checkDecisions(times);
    });

    it('eventually discards labelled versions', async function() {
      const times = [
        '+2000-09-08 09:30Z',
        '+2000-09-08 09:29Z',
        '+2000-09-08 09:28Z',
        '+2000-09-08 09:27Z',
        '+2000-09-08 09:26Z',
        '+1990-09-09 08:25Z',
        '-1990-09-09 08:24Z | save',
      ];
      await checkDecisions(times);
    });

    it('enforces the snapshot window', async function() {
      const times = [
        '+2000-09-08 09:30Z',
        '+2000-09-08 09:29Z',
        '+2000-09-01 09:28Z',
        '-2000-08-08 09:27Z',
        '-2000-08-08 09:26Z',
        '-1990-09-09 08:25Z',
        '-1990-09-09 08:24Z',
      ];
      await checkDecisions(times, {window: {count: 1, unit: 'month'}});
    });
});
});
