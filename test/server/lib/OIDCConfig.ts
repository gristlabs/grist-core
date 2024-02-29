import {OIDCConfig} from "app/server/lib/OIDCConfig";
import {assert} from "chai";
import {EnvironmentSnapshot} from "../testUtils";
import Sinon from "sinon";
import {Client} from "openid-client";

class OIDCConfigStubbed extends OIDCConfig {
  public static async build(clientStub?: Client): Promise<OIDCConfig> {
    const result = new OIDCConfigStubbed();
    if (clientStub) {
      result._initClient = Sinon.spy(() => {
        result._client = clientStub!;
      });
    }
    await result.initOIDC();
    return result;
  }

  public _initClient: Sinon.SinonSpy;
}

class ClientStub {
  public issuer: {
    metadata: {
      end_session_endpoint: string | undefined;
    }
  } = {
    metadata: {
      end_session_endpoint: 'http://localhost:8484/logout',
    }
  };
}

describe('OIDCConfig', () => {
  let oldEnv: EnvironmentSnapshot;
  let sandbox: Sinon.SinonSandbox;

  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  beforeEach(() => {
    sandbox = Sinon.createSandbox();
  });

  afterEach(() => {
    oldEnv.restore();
    sandbox.restore();
  });

  function setEnvVars() {
    process.env.GRIST_OIDC_SP_HOST = 'http://localhost:8484';
    process.env.GRIST_OIDC_IDP_CLIENT_ID = 'client id';
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = 'secret';
    process.env.GRIST_OIDC_IDP_ISSUER = 'http://localhost:8000';
    process.env.GRIST_OIDC_IDP_SCOPES = 'openid email profile';
    process.env.GRIST_OIDC_SP_PROFILE_NAME_ATTR = ''; // use the default behavior
    process.env.GRIST_OIDC_SP_PROFILE_EMAIL_ATTR = ''; // use the default behavior
  }

  describe('build', () => {
    it('should reject when required env variables are not passed', async () => {
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

    it('should reject when the client initialization fails', async () => {
      setEnvVars();
      sandbox.stub(OIDCConfigStubbed.prototype, '_initClient').rejects(new Error('client init failed'));
      const promise = OIDCConfigStubbed.build();
      await assert.isRejected(promise, 'client init failed');
    });

    describe('End Session Endpoint', () => {
      [
        {
          itMsg: 'should fulfill when the end_session_endpoint is not known ' +
            'and GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true',
          end_session_endpoint: undefined,
          env: {
            GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: 'true'
          }
        },
        {
          itMsg: 'should fulfill when the end_session_endpoint is not known ' +
            'and GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true',
          end_session_endpoint: undefined,
          env: {
            GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: 'true'
          }
        },
        {
          itMsg: 'should fulfill when the end_session_endpoint is provided with GRIST_OIDC_IDP_END_SESSION_ENDPOINT',
          end_session_endpoint: undefined,
          env: {
            GRIST_OIDC_IDP_END_SESSION_ENDPOINT: 'http://localhost:8484/logout'
          }
        },
        {
          itMsg: 'should fulfill when the end_session_endpoint is provided with the issuer',
          end_session_endpoint: 'http://localhost:8484/logout',
        },
        {
          itMsg: 'should reject when the end_session_endpoint is not known',
          errorMsg: /If that is expected, please set GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT/,
          end_session_endpoint: undefined,
        }
      ].forEach((ctx) => {
        it(ctx.itMsg, async () => {
          setEnvVars();
          Object.assign(process.env, ctx.env);
          const client = new ClientStub();
          client.issuer.metadata.end_session_endpoint = ctx.end_session_endpoint;
          const promise = OIDCConfigStubbed.build(client as Client);
          if (ctx.errorMsg) {
            await assert.isRejected(promise, ctx.errorMsg);
          } else {
            await assert.isFulfilled(promise);
          }
        });
      });
    });
  });

  describe('GRIST_OIDC_IDP_ENABLED_PROTECTIONS', () => {
    it('should throw when GRIST_OIDC_IDP_ENABLED_PROTECTIONS contains unsupported values', async () => {
      setEnvVars();
      process.env.GRIST_OIDC_IDP_ENABLED_PROTECTIONS = 'STATE,NONCE,PKCE,invalid';
      const promise = OIDCConfig.build();
      await assert.isRejected(promise, 'OIDC: Invalid protection in GRIST_OIDC_IDP_ENABLED_PROTECTIONS: invalid');
    });

    it('should successfully change the supported protections', async function () {
      setEnvVars();
      process.env.GRIST_OIDC_IDP_ENABLED_PROTECTIONS = 'NONCE';
      const config = await OIDCConfigStubbed.build(new ClientStub() as Client);
      assert.isTrue(config.supportsProtection("NONCE"));
      assert.isFalse(config.supportsProtection("PKCE"));
      assert.isFalse(config.supportsProtection("STATE"));
    });

    it('if omitted, should defaults to "STATE,PKCE"', async function () {
      setEnvVars();
      const config = await OIDCConfigStubbed.build(new ClientStub() as Client);
      assert.isFalse(config.supportsProtection("NONCE"));
      assert.isTrue(config.supportsProtection("PKCE"));
      assert.isTrue(config.supportsProtection("STATE"));
    });
  });
});
