import * as express from 'express';
import {assert, driver} from 'mocha-webdriver';
import {itemValue, toggleItem} from 'test/nbrowser/AdminPanelTools';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {serveSomething, Serving} from 'test/server/customUtil';
import * as testUtils from 'test/server/testUtils';

describe('AuthProvider', function() {
  this.timeout('2m');
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let serving: Serving;
  const user = gu.translateUser('user1');

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = user.email;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
    await server.restart();

    serving = await serveSomething(app => {
      app.use(express.json());
      app.get('/.well-known/openid-configuration', (req, res) => {
        res.json({
          issuer: serving.url + '?provider=getgrist.com',
        });
      });
      app.use((req) => {
        assert.fail(`Unexpected request to test OIDC server: ${req.method} ${req.url}`);
      });
    });
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true); // clear database changes
    await serving?.shutdown();
  });

  it('should show some providers', async function() {
    await server.simulateLogin(user.name, user.email, 'docs');
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem('authentication');

    // Be default we should see "no authentication" value, as no provider is configured and the default
    // fallback to MinimalProvider is used, which Grists reports as "no authentication".
    await gu.waitToPass(async () => {
      assert.equal(await itemValue('authentication'), 'no authentication');
    }, 500);

    // We should see couple of providers, including "OIDC and SAML".
    await driver.findWait('.test-admin-auth-provider-row', 2000); // wait for it to appear
    const providerItems = await driver.findAll('.test-admin-auth-provider-row');
    assert.isAtLeast(providerItems.length, 3); // We expect to see OIDC provider as well.

    // First one should be "OIDC".
    assert.match(await providerItems[0].getText(), /OIDC/);
    // Second one should be "SAML".
    assert.match(await providerItems[1].getText(), /SAML/);
    // Third one should be "Forwarded Headers".
    assert.match(await providerItems[2].getText(), /Forwarded headers/);
    // And some others, depending on the build we are in.
  });

  it('all providers should not be configured by default', async function() {
    const providerRows = await driver.findAll('.test-admin-auth-provider-row');
    assert.isAtLeast(providerRows.length, 1);

    // Check that none of the providers have any badges
    for (const row of providerRows) {
      const badges = await row.findAll('.test-admin-auth-badge');
      assert.lengthOf(badges, 0);
    }
  });

  it('all providers should have `configure` buttons`', async function() {
    const providerRows = await driver.findAll('.test-admin-auth-provider-row');

    for (const row of providerRows) {
      const configureButtons = await row.findAll('.test-admin-auth-configure-button');
      assert.lengthOf(configureButtons, 1);

      await configureButtons[0].click();

      const modalHeader = await driver.findWait('.test-admin-auth-modal-header', 2000);
      assert.isTrue(await modalHeader.isDisplayed());

      const cancelButton = await driver.find('.test-admin-auth-modal-cancel');
      await cancelButton.click();

      await gu.checkForErrors();

      await driver.wait(async () => {
        const modals = await driver.findAll('.test-admin-auth-modal-header');
        return modals.length === 0;
      }, 100);
    }
  });

  async function restartAdmin() {
    await server.restart();
    await server.simulateLogin(user.name, user.email, 'docs');
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitForAdminPanel();
    await toggleItem('authentication');
  }

  it('should detect misconfigured oidc configuration', async function() {
    // This is minimal thing to make Grist think that OIDC is configured.
    process.env.GRIST_OIDC_IDP_ISSUER = 'invalid-url';
    // Now after restarting, Grist should noticed that we attempted to configure OIDC, but failed.
    await restartAdmin();

    // Now check the badge of the OIDC provider, it should be misconfigured.
    await gu.waitToPass(async () => {
      assert.deepEqual(await badges('OIDC'), ['ACTIVE', 'ERROR']);
      // And a warning message should be present in the first row about one of the required env vars.
      assert.include(await errorMessage('OIDC').getText(), 'GRIST_OIDC_');
    }, 1000);

    // The label says "auth error" now (as no valid login is possible).
    assert.equal(await itemValue('authentication'), 'auth error');

    // There should be no 'Set as active method' button.
    assert.isFalse(await activeButton('OIDC').isPresent());

    // Also check other 2 providers we know about.
    assert.deepEqual(await badges('SAML'), []);
    assert.isFalse(await activeButton('SAML').isPresent());

    assert.deepEqual(await badges('Forwarded headers'), []);
    assert.isFalse(await activeButton('Forwarded headers').isPresent());
  });

  it('should detect properly configured oidc provider', async function() {
    // Configure OIDC provider properly with all required environment variables, it will
    // fail during initialization phase, but from the UI perspective it is properly configured.
    process.env.GRIST_OIDC_IDP_ISSUER = 'https://maybe.valid.issu.er';
    process.env.GRIST_OIDC_IDP_CLIENT_ID = 'test-client-id';
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = 'test-client-secret';
    process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = 'true';
    process.env.GRIST_OIDC_SP_HOST = 'localhost';

    // Restart to pick up the new configuration.
    await restartAdmin();

    // We now see that there is some auth error, as OIDC appears to be configured, nothing is selected by the
    // user so this was picked as the active method, but the test OIDC server is not responding properly.
    await gu.waitToPass(async () => {
      assert.equal(await itemValue('authentication'), 'auth error');
    });

    // We see 3 badges on OIDC provider: CONFIGURED, ACTIVE ON RESTART, and ERROR
    assert.deepEqual(await badges('OIDC'), ['CONFIGURED', 'ACTIVE', 'ERROR']);

    // The 'Set as active method' button is not present, as it is already active.
    assert.isFalse(await activeButton('OIDC').isPresent(), 'Set as active method button should not be present');

    // Other providers should remain unchanged.
    assert.deepEqual(await badges('SAML'), []);
    assert.isFalse(await activeButton('SAML').isPresent());

    assert.deepEqual(await badges('Forwarded headers'), []);
    assert.isFalse(await activeButton('Forwarded headers').isPresent());
  });

  it('should offer to switch to other configured providers', async function() {
    // Now let's configure another provider (ForwardAuth is simpler than SAML)
    process.env.GRIST_FORWARD_AUTH_HEADER = 'x-forwarded-user';
    process.env.GRIST_FORWARD_AUTH_LOGOUT_PATH = '/logout';

    // Restart to pick up the new configuration
    await restartAdmin();

    // OIDC should still be active (but with error)
    assert.deepEqual(await badges('OIDC'), ['CONFIGURED', 'ACTIVE', 'ERROR']);

    // ForwardAuth should now be configured and offer to switch
    await gu.waitToPass(async () => {
      assert.deepEqual(await badges('Forwarded headers'), ['CONFIGURED']);
    }, 1000);

    // ForwardAuth should have "Set as active method" button since it's configured but not active
    assert.isTrue(await activeButton('Forwarded headers').isPresent());

    // SAML should still be unconfigured
    assert.deepEqual(await badges('SAML'), []);
    assert.isFalse(await activeButton('SAML').isPresent());
  });

  it('should switch to ForwardAuth provider', async function() {
    const setActiveButton = await activeButton('Forwarded headers');
    await setActiveButton.click();

    // Confirm in the modal
    const confirmButton = await driver.findWait('.test-modal-confirm', 2000);
    await confirmButton.click();
    await gu.waitForServer();

    // The "Set as active method" button should disappear
    assert.isFalse(await activeButton('Forwarded headers').isPresent());

    // We should see "Active on restart" badge
    const forwardAuthBadges = await badges('Forwarded headers');
    assert.includeMembers(forwardAuthBadges, ['CONFIGURED', 'ACTIVE ON RESTART']);

    // OIDC should still be configured, and disabled on restart
    const oidcBadges = await badges('OIDC');
    assert.includeMembers(oidcBadges, ['CONFIGURED', 'DISABLED ON RESTART', 'ERROR']);

    // But there should be a button to set it active again
    assert.isTrue(await activeButton('OIDC').isPresent());
  });

});

const providerRow = (text: string) => driver.findContentWait('.test-admin-auth-provider-row', text, 1000);

const badges = (text: string) => providerRow(text).findAll('.test-admin-auth-badge', e => e.getText());

const errorMessage = (text: string) => providerRow(text).find('.test-admin-auth-error-message');

const activeButton = (text: string) => providerRow(text).find('.test-admin-auth-set-active-button');
