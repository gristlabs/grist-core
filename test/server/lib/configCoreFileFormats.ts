import { assert } from 'chai';
import { convertToCoreFileContents, IGristCoreConfigFileLatest } from "app/server/lib/configCoreFileFormats";

describe('convertToCoreFileContents', () => {
  it('fails with a malformed config', () => {
    const badConfig = {
      version: "This is a random version number that will never exist",
    };

    assert.throws(() => convertToCoreFileContents(badConfig));
  });

  // This is necessary to handle users who don't have a config file yet.
  it('will upgrade an empty object to a valid config', () => {
    const validConfig = convertToCoreFileContents({});
    assert.exists(validConfig?.version);
  });

  it('will validate the latest config file format', () => {
    const validRawObject: IGristCoreConfigFileLatest = {
      version: "1",
      edition: "enterprise",
    };

    const validConfig = convertToCoreFileContents(validRawObject);
    assert.exists(validConfig?.version);
    assert.exists(validConfig?.edition);
  });
});
