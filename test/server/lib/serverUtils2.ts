import {exitPromise} from 'app/server/lib/serverUtils';
import {spawn} from 'child_process';
import {assert} from 'test/server/testUtils';

describe("serverUtils2", function() {
  describe("exitPromise", function() {
    it("should resolve to exit code when child process exits", async function() {
      const child = spawn('echo', ['hello', 'world']);
      assert.strictEqual(await exitPromise(child), 0);

      const child2 = spawn('exit 4', [], {shell: true});
      assert.strictEqual(await exitPromise(child2), 4);
    });

    it("should resolve to signal when child process is killed", async function() {
      const child = spawn('sleep', ['1']);
      child.kill();
      assert.strictEqual(await exitPromise(child), 'SIGTERM');

      const child2 = spawn('sleep', ['1']);
      child2.kill('SIGINT');
      assert.strictEqual(await exitPromise(child2), 'SIGINT');
    });

    it("should be rejected when child process can't start", async function() {
      const child = spawn('non-existent-command-83714', ['hello']);
      await assert.isRejected(exitPromise(child), /ENOENT/);
    });
  });
});
