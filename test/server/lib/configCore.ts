import * as sinon from 'sinon';
import { assert } from 'chai';
import { loadGristCoreConfig, loadGristCoreConfigFile } from "app/server/lib/configCore";
import { Deps } from "app/server/lib/config";

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
    sinon.replace(Deps, 'pathExists', sinon.fake.resolves(false));
    sinon.replace(Deps, 'readFile', sinon.fake.resolves(""));
    const writeFileFake = sinon.fake.resolves(undefined);
    sinon.replace(Deps, 'writeFile', writeFileFake);

    const config = await loadGristCoreConfigFile("doesntmatter.json");
    assert.exists(config.edition.get());

    await config.edition.set("enterprise");
    // Make sure that the change was written back to the file.
    assert.isTrue(writeFileFake.calledOnce);
  });
});
