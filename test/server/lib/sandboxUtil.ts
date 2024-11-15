import {assert} from 'chai';
import * as sandboxUtil from 'app/server/lib/sandboxUtil';
import {captureLog} from 'test/server/testUtils';

describe('sandboxUtil', function() {

  describe('makeLinePrefixer', function() {
    it('should not interpret placeholders', async function() {
      const messages = await captureLog('debug', () => {
        const prefixer = sandboxUtil.makeLinePrefixer('My prefix: ', {foo: 'bar'});
        prefixer(Buffer.from(
          "Hello!\n" +
          "My name is %s!\n"
        ));
      });
      assert.deepEqual(messages, [
        'info: My prefix: Hello! foo=bar',
        'info: My prefix: My name is %s! foo=bar',
      ]);
    });
  });

  describe('makeLogLinePrefixer', function() {
    it('should escape non-printable characters', async function() {
      const messages = await captureLog('debug', () => {
        const prefixer = sandboxUtil.makeLogLinePrefixer('My prefix: ', {foo: 'bar'});
        prefixer(Buffer.from("Some chars: \n \t \0 \b π Ї 🙂\n"));
      });
      assert.deepEqual(messages, [
        'info: My prefix: Some chars: \n \\t \\u0000 \\b π Ї 🙂 foo=bar',
      ]);
    });

    it('should break up log messages but not other lines', async function() {
      const messages = await captureLog('debug', () => {
        const prefixer = sandboxUtil.makeLogLinePrefixer('My prefix: ', {foo: 'bar'});
        prefixer(Buffer.from(
          "[INFO] [engine] Hello!\n" +
          "[WARNING] [engine] World, with\n" +
          "  extra\n" +
          "lines\n" +
          "[WARNING] another message\n" +
          "with two lines\n"
        ));
      });
      assert.deepEqual(messages, [
        'info: My prefix: [INFO] [engine] Hello! foo=bar',
        'info: My prefix: [WARNING] [engine] World, with\n  extra\nlines foo=bar',
        'info: My prefix: [WARNING] another message\nwith two lines foo=bar',
      ]);
    });
  });
});
