import {OIDCConfig} from "app/server/lib/OIDCConfig";
import {assert} from "chai";
import {EnvironmentSnapshot} from "../testUtils";


describe('OIDCConfig', () => {
  let oldEnv: EnvironmentSnapshot;

  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  afterEach(() => {
    oldEnv.restore();
  });

  function setEnvVars() {
    process.env.GRIST_OIDC_SP_HOST = 'http://localhost:8484';
    process.env.GRIST_OIDC_IDP_CLIENT_ID = 'client id';
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = 'secret';
    process.env.GRIST_OIDC_IDP_ISSUER = 'http://localhost:8000';
    process.env.GRIST_OIDC_IDP_SCOPES = 'openid email profile';
    process.env.GRIST_OIDC_SP_PROFILE_NAME_ATTR = ''; // use the default behavior
    process.env.GRIST_OIDC_SP_PROFILE_EMAIL_ATTR = ''; // use the default behavior
    process.env.GRIST_OIDC_IDP_END_SESSION_ENDPOINT = 'http://localhost:8484/logout';
    process.env.GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT = 'false';
    process.env.GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED = 'false';
  }

  it('should throw when required env variables are not passed', async () => {
    for (const envVar of [
      'GRIST_OIDC_SP_HOST',
      'GRIST_OIDC_IDP_ISSUER',
      'GRIST_OIDC_IDP_CLIENT_ID',
      'GRIST_OIDC_IDP_CLIENT_SECRET',
    ]) {
      setEnvVars();
      delete process.env[envVar];
      const promise = OIDCConfig.build();
      await assert.isRejected(promise, `missing environment variable: ${envVar}`);
    }
  });

  it('should throw when required env variables are empty', async () => {
});

