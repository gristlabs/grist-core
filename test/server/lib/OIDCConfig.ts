import {OIDCConfig} from "app/server/lib/OIDCConfig";
import {assert} from "chai";
import {EnvironmentSnapshot} from "../testUtils";
import Sinon from "sinon";
import {Client, generators} from "openid-client";
import express from "express";
import log from "app/server/lib/log";
import {Sessions} from "app/server/lib/Sessions";

class OIDCConfigStubbed extends OIDCConfig {
  public static async build(clientStub?: Client): Promise<OIDCConfigStubbed> {
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
  public static FAKE_REDIRECT_URL = 'FAKE_REDIRECT_URL';
  public authorizationUrl = Sinon.stub().returns(ClientStub.FAKE_REDIRECT_URL);
  public callbackParams = Sinon.stub().returns(undefined);
  public callback = Sinon.stub().returns(undefined);
  public userinfo = Sinon.stub().returns(undefined);
  public issuer: {
    metadata: {
      end_session_endpoint: string | undefined;
    }
  } = {
    metadata: {
      end_session_endpoint: 'http://localhost:8484/logout',
    }
  };
  public asClient() {
    return this as unknown as Client;
  }
  public getAuthorizationUrlStub() {
    return this.authorizationUrl;
  }
}

describe('OIDCConfig', () => {
  let oldEnv: EnvironmentSnapshot;
  let sandbox: Sinon.SinonSandbox;
  let logInfoStub: Sinon.SinonStub;
  let logErrorStub: Sinon.SinonStub;

  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  beforeEach(() => {
    sandbox = Sinon.createSandbox();
    logInfoStub = sandbox.stub(log, 'info');
    logErrorStub = sandbox.stub(log, 'error');
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

    it('should create a client with passed information', async () => {
      setEnvVars();
      const client = new ClientStub();
      const config = await OIDCConfigStubbed.build(client.asClient());
      assert.isTrue(config._initClient.calledOnce);
      assert.deepEqual(config._initClient.firstCall.args, [{
        clientId: process.env.GRIST_OIDC_IDP_CLIENT_ID,
        clientSecret: process.env.GRIST_OIDC_IDP_CLIENT_SECRET,
        issuerUrl: process.env.GRIST_OIDC_IDP_ISSUER,
      }]);
      assert.isTrue(logInfoStub.calledOnce);
      assert.deepEqual(
        logInfoStub.firstCall.args,
        [`OIDCConfig: initialized with issuer ${process.env.GRIST_OIDC_IDP_ISSUER}`]
      );
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
          const promise = OIDCConfigStubbed.build(client.asClient());
          if (ctx.errorMsg) {
            await assert.isRejected(promise, ctx.errorMsg);
            assert.isFalse(logInfoStub.calledOnce);
          } else {
            await assert.isFulfilled(promise);
            assert.isTrue(logInfoStub.calledOnce);
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
      const config = await OIDCConfigStubbed.build((new ClientStub()).asClient());
      assert.isTrue(config.supportsProtection("NONCE"));
      assert.isFalse(config.supportsProtection("PKCE"));
      assert.isFalse(config.supportsProtection("STATE"));
    });

    it('should successfully accept an empty string', async function () {
      setEnvVars();
      process.env.GRIST_OIDC_IDP_ENABLED_PROTECTIONS = '';
      const config = await OIDCConfigStubbed.build((new ClientStub()).asClient());
      assert.isFalse(config.supportsProtection("NONCE"));
      assert.isFalse(config.supportsProtection("PKCE"));
      assert.isFalse(config.supportsProtection("STATE"));
    });

    it('if omitted, should defaults to "STATE,PKCE"', async function () {
      setEnvVars();
      const config = await OIDCConfigStubbed.build((new ClientStub()).asClient());
      assert.isFalse(config.supportsProtection("NONCE"));
      assert.isTrue(config.supportsProtection("PKCE"));
      assert.isTrue(config.supportsProtection("STATE"));
    });
  });

  describe('getLoginRedirectUrl', () => {
    const FAKE_NONCE = 'fake-nonce';
    const FAKE_STATE = 'fake-state';
    const FAKE_CODE_VERIFIER = 'fake-code-verifier';
    const FAKE_CODE_CHALLENGE = 'fake-code-challenge';
    const TARGET_URL = 'http://localhost:8484/';

    beforeEach(() => {
      sandbox.stub(generators, 'nonce').returns(FAKE_NONCE);
      sandbox.stub(generators, 'state').returns(FAKE_STATE);
      sandbox.stub(generators, 'codeVerifier').returns(FAKE_CODE_VERIFIER);
      sandbox.stub(generators, 'codeChallenge').returns(FAKE_CODE_CHALLENGE);
    });

    [
      {
        itMsg: 'should forge the url with default values',
        expectedCalledWith: [{
          scope: 'openid email profile',
          acr_values: undefined,
          code_challenge: FAKE_CODE_CHALLENGE,
          code_challenge_method: 'S256',
          state: FAKE_STATE,
        }],
        expectedSession: {
          oidc: {
            codeVerifier: FAKE_CODE_VERIFIER,
            state: FAKE_STATE,
            targetUrl: TARGET_URL,
          }
        }
      },
      {
        itMsg: 'should forge the URL with passed GRIST_OIDC_IDP_SCOPES',
        env: {
          GRIST_OIDC_IDP_SCOPES: 'my scopes',
        },
        expectedCalledWith: [{
          scope: 'my scopes',
          acr_values: undefined,
          code_challenge: FAKE_CODE_CHALLENGE,
          code_challenge_method: 'S256',
          state: FAKE_STATE,
        }],
        expectedSession: {
          oidc: {
            codeVerifier: FAKE_CODE_VERIFIER,
            state: FAKE_STATE,
            targetUrl: TARGET_URL,
          }
        }
      },
      {
        itMsg: 'should pass the nonce when GRIST_OIDC_IDP_ENABLED_PROTECTIONS includes NONCE',
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: 'STATE,NONCE,PKCE',
        },
        expectedCalledWith: [{
          scope: 'openid email profile',
          acr_values: undefined,
          code_challenge: FAKE_CODE_CHALLENGE,
          code_challenge_method: 'S256',
          state: FAKE_STATE,
          nonce: FAKE_NONCE,
        }],
        expectedSession: {
          oidc: {
            codeVerifier: FAKE_CODE_VERIFIER,
            nonce: FAKE_NONCE,
            state: FAKE_STATE,
            targetUrl: TARGET_URL,
          }
        }
      },
      {
        itMsg: 'should not pass the code_challenge when PKCE is omitted in GRIST_OIDC_IDP_ENABLED_PROTECTIONS',
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: 'STATE,NONCE',
        },
        expectedCalledWith: [{
          scope: 'openid email profile',
          acr_values: undefined,
          state: FAKE_STATE,
          nonce: FAKE_NONCE,
        }],
        expectedSession: {
          oidc: {
            nonce: FAKE_NONCE,
            state: FAKE_STATE,
            targetUrl: TARGET_URL,
          }
        }
      },
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        setEnvVars();
        Object.assign(process.env, ctx.env);
        const clientStub = new ClientStub();
        const config = await OIDCConfigStubbed.build(clientStub.asClient());
        const session = {};
        const req = {
          session
        } as unknown as express.Request;
        const url = await config.getLoginRedirectUrl(req, new URL(TARGET_URL));
        assert.equal(url, ClientStub.FAKE_REDIRECT_URL);
        assert.isTrue(clientStub.authorizationUrl.calledOnce);
        assert.deepEqual(clientStub.authorizationUrl.firstCall.args, ctx.expectedCalledWith);
        assert.deepEqual(session, ctx.expectedSession);
      });
    });
  });

  describe('handleCallback', () => {
    const FAKE_STATE = 'fake-state';
    const FAKE_CODE_VERIFIER = 'fake-code-verifier';
    const FAKE_USER_INFO = {
      email: 'fake-email',
      name: 'fake-name',
      email_verified: true,
    };
    const DEFAULT_SESSION = {
      oidc: {
        codeVerifier: FAKE_CODE_VERIFIER,
        state: FAKE_STATE
      }
    };
    let fakeRes: {
      status: Sinon.SinonStub;
      send: Sinon.SinonStub;
      redirect: Sinon.SinonStub;
    };
    let fakeSessions: {
      getOrCreateSessionFromRequest: Sinon.SinonStub
    };
    let fakeScopedSession;

    beforeEach(() => {
      fakeRes = {
        redirect: sandbox.stub(),
        status: sandbox.stub().returnsThis(),
        send: sandbox.stub().returnsThis(),
      };
      fakeScopedSession = {
        operateOnScopedSession: sandbox.stub().resolves(),
      };
      fakeSessions = {
        getOrCreateSessionFromRequest: sandbox.stub().returns(fakeScopedSession),
      };
    });

    [
      {
        itMsg: 'should reject when the state is not found in the session',
        session: {},
        expectedErrorMsg: /Login or logout failed to complete/,
      },
      {
        itMsg: 'should resolve when the state is not found in the session but ' +
          'GRIST_OIDC_IDP_ENABLED_PROTECTIONS omits STATE',
        session: DEFAULT_SESSION,
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: '',
        },
      }
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        setEnvVars();
        Object.assign(process.env, ctx.env);
        const clientStub = new ClientStub();
        const fakeParams = {
          state: FAKE_STATE,
        };
        clientStub.callbackParams.returns(fakeParams);
        clientStub.userinfo.returns(FAKE_USER_INFO);
        const config = await OIDCConfigStubbed.build(clientStub.asClient());
        const req = {
          session: ctx.session,
          query: {
            state: FAKE_STATE,
            codeVerifier: FAKE_CODE_VERIFIER,
          }
        } as unknown as express.Request;

        await config.handleCallback(
          fakeSessions as unknown as Sessions,
          req,
          fakeRes as unknown as express.Response
        );

        if (ctx.expectedErrorMsg) {
          assert.isTrue(logErrorStub.calledOnce);
          assert.match(logErrorStub.firstCall.args[0], ctx.expectedErrorMsg);
          assert.isTrue(fakeRes.status.calledOnceWith(500));
          assert.isTrue(fakeRes.send.calledOnceWith('OIDC callback failed.'));
        } else {
          assert.isFalse(logErrorStub.called, 'no error should be logged');
          assert.isTrue(fakeRes.redirect.calledOnce, 'should redirect');
          assert.isTrue(clientStub.callback.calledOnce);
          assert.deepEqual(clientStub.callback.firstCall.args, [
            'http://localhost:8484/oauth2/callback',
            fakeParams,
            { state: FAKE_STATE, code_verifier: FAKE_CODE_VERIFIER }
          ]);
        }
      });
    });
  });

});
