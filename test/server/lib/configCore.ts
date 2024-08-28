import * as sinon from 'sinon';
import { assert } from 'chai';
import { IGristCoreConfig, loadGristCoreConfig, loadGristCoreConfigFile } from "app/server/lib/configCore";
import { createConfigValue, Deps, IWritableConfigValue } from "app/server/lib/config";

describe('loadGristCoreConfig', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('can be used with an in-memory store if no file config is provided', async () => {
    const config = loadGristCoreConfig();
    await config.edition.set("enterprise");
    assert.equal(config.edition.get(), "enterprise");
  });

  it('will function correctly when no config file is present', async () => {
    sinon.replace(Deps, 'pathExists', sinon.fake.returns(false));
    sinon.replace(Deps, 'readFile', sinon.fake.returns("" as any));
    const writeFileFake = sinon.fake.resolves(undefined);
    sinon.replace(Deps, 'writeFile', writeFileFake);

    const config = loadGristCoreConfigFile("doesntmatter.json");
    assert.exists(config.edition.get());

    await config.edition.set("enterprise");
    // Make sure that the change was written back to the file.
    assert.isTrue(writeFileFake.calledOnce);
  });

  it('can be extended', async () => {
    // Extend the core config
    type NewConfig = IGristCoreConfig & {
      newThing: IWritableConfigValue<number>
    };

    const coreConfig = loadGristCoreConfig();

    const newConfig: NewConfig = {
      ...coreConfig,
      newThing: createConfigValue(3)
    };

    // Ensure that it's backwards compatible.
    const gristConfig: IGristCoreConfig = newConfig;
    return gristConfig;
  });
});
