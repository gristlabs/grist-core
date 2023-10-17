/**
 * Test of the importing logic in the DocMenu page.
 */
import * as fs from 'fs';
import {assert, driver, Key} from 'mocha-webdriver';
import * as tmp from 'tmp-promise';
import * as util from 'util';

import { SQLiteDB } from 'app/server/lib/SQLiteDB';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import { copyFixtureDoc } from 'test/server/testUtils';

const write = util.promisify(fs.write);

describe('UploadLimits', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  const cleanupCbs: Array<() => void> = [];

  async function generateFile(postfix: string, size: number): Promise<string> {
    const obj = await tmp.file({postfix, mode: 0o644});
    await write(obj.fd, Buffer.alloc(size, 't'));
    cleanupCbs.push(obj.cleanup);
    return obj.path;
  }

  // Create a valid Grist file of at least the desired length.  The file may be
  // slightly larger than requested.
  async function generateGristFile(minSize: number): Promise<string> {
    const obj = await tmp.file({postfix: '.grist', mode: 0o644});
    await copyFixtureDoc('Hello.grist', obj.path);
    const size = fs.statSync(obj.path).size;
    const db = await SQLiteDB.openDBRaw(obj.path);
    // Make a string that is long enough to push the doc over the required size.
    const longString = 'x'.repeat(Math.max(1, minSize - size));
    // Add the string somewhere in the doc.  For now we place it in a separate
    // table - this may eventually become invalid, but it works for now.
    // There'll be a little overhead so we'll overshoot the target length a bit,
    // but that's fine.
    await db.exec('CREATE TABLE _gristsys_extra(txt)');
    await db.run('INSERT INTO _gristsys_extra(txt) VALUES(?)', [longString]);
    await db.close();
    const size2 = fs.statSync(obj.path).size;
    if (size2 < minSize || size2 > minSize * 1.2) {
      throw new Error(`generateGristFile size is off, wanted ${minSize}, got ${size2}`);
    }
    cleanupCbs.push(obj.cleanup);
    return obj.path;
  }

  after(function() {
    for (const cleanup of cleanupCbs) {
      cleanup();
    }
  });

  afterEach(async function() {
    await gu.checkForErrors();
  });

  const maxImport = 1024 * 1024;            // See GRIST_MAX_UPLOAD_IMPORT_MB = 1 in testServer.ts
  const maxAttachment = 2 * 1024 * 1024;    // See GRIST_MAX_UPLOAD_ATTACHMENT_MB = 2 in testServer.ts

  it('should prevent large uploads for imports', async function() {
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu('/');

    // Generate and upload a large csv file. It should by blocked on the client side.
    const largeFilePath = await generateFile(".csv", maxImport + 1000);
    await gu.docMenuImport(largeFilePath);

    // Ensure an error is shown.
    assert.match(await driver.findWait('.test-notifier-toast-message', 1000).getText(),
      /Imported files may not exceed 1.0MB/);

    // Now try to import directly to server, and verify that the server enforces this limit too.
    const p = gu.importFixturesDoc('Chimpy', 'nasa', 'Horizon', largeFilePath, {load: false});
    await assert.isRejected(p, /Payload Too Large/);
    const err = await p.catch((e) => e);
    assert.equal(err.status, 413);
    assert.isObject(err.details);
    assert.match(err.details.userError, /Imported files must not exceed 1.0MB/);
  });

  it('should allow large uploads of .grist docs', async function() {
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu('/');

    // Generate and upload a large .grist file. It should not be subject to limits.
    const largeFilePath = await generateGristFile(maxImport * 2 + 1000);
    await gu.docMenuImport(largeFilePath);

    await gu.waitForDocToLoad();
    assert.equal(await gu.getCell(0, 1).getText(), 'hello');
  });

  it('should prevent large uploads for attachments', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');

    // Clear the first cell.
    await gu.getCell(0, 1).click();
    await driver.sendKeys(Key.DELETE);
    await gu.waitForServer();

    // Change column to Attachments.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await gu.setType(/Attachment/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();

    // We can upload multiple smaller files (the limit is per-file here).
    const largeFilePath1 = await generateFile(".png", maxAttachment - 1000);
    const largeFilePath2 = await generateFile(".jpg", maxAttachment - 1000);
    await gu.fileDialogUpload([largeFilePath1, largeFilePath2].join(","),
      () => gu.getCell(0, 1).find('.test-attachment-icon').click());
    await gu.getCell(0, 1).findWait('.test-attachment-widget > [class*=test-pw-]', 2000);

    // We don't expect any errors here.
    assert.lengthOf(await driver.findAll('.test-notifier-toast-wrapper'), 0);

    // Expect to find two attachments in the cell.
    assert.lengthOf(await gu.getCell(0, 1).findAll('.test-attachment-widget > [class*=test-pw-]'), 2);

    // But we can't upload larger files, even one at a time.
    const largeFilePath3 = await generateFile(".jpg", maxAttachment + 1000);
    await gu.fileDialogUpload(largeFilePath3,
      () => gu.getCell(0, 2).find('.test-attachment-icon').click());
    await driver.sleep(200);
    await gu.waitForServer();

    // Check that there is a warning and the cell hasn't changed.
    assert.match(await driver.findWait('.test-notifier-toast-message', 1000).getText(),
      /Attachments may not exceed 2.0MB/);
    assert.lengthOf(await gu.getCell(0, 2).findAll('.test-attachment-widget > [class*=test-pw-]'), 0);

    // TODO We should try to add attachment via API and verify that the server enforces the limit
    // too, but at the moment we don't have an endpoint to add attachments via the API.
  });
});
