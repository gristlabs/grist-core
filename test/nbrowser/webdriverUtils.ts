import log from 'app/server/lib/log';
import {assert, driver} from 'mocha-webdriver';
import * as path from 'path';
import * as fs from 'fs/promises';


export async function fetchScreenshotAndLogs(test: Mocha.Runnable|undefined) {
  const dir = process.env.MOCHA_WEBDRIVER_LOGDIR!;
  assert.isOk(dir, "driverLogging: MOCHA_WEBDRIVER_LOGDIR not set");
  const testName = test?.file ? path.basename(test.file, path.extname(test.file)) : "unnamed";
  const logPath = path.resolve(dir, `${testName}-driverLogging.log`);
  await fs.mkdir(dir, {recursive: true});
  await driver.saveScreenshot(`${testName}-driverLoggingScreenshot-{N}.png`);
  const messages = await driver.fetchLogs('driver');
  await fs.appendFile(logPath, messages.join("\n") + "\n");
}

export async function withDriverLogging(
  test: Mocha.Runnable|undefined, periodMs: number, timeoutMs: number,
  callback: () => Promise<void>
) {
  let running = false;
  async function repeat() {
    if (running) {
      log.warn("driverLogging: skipping because previous repeat still running");
      return;
    }
    running = true;
    try {
      await fetchScreenshotAndLogs(test);
    } finally {
      running = false;
    }
  }

  const periodic = setInterval(repeat, periodMs);
  const timeout = setTimeout(() => clearInterval(periodic), timeoutMs);
  try {
    return await callback();
  } finally {
    clearInterval(periodic);
    clearTimeout(timeout);
  }
}
