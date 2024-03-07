import {EnvironmentSnapshot} from "../testUtils";
import {OIDCConfig} from "app/server/lib/OIDCConfig";
import {SessionObj} from "app/server/lib/BrowserSession";
import {Sessions} from "app/server/lib/Sessions";
import log from "app/server/lib/log";
import {assert} from "chai";
import Sinon from "sinon";
import {Client, generators} from "openid-client";
import express from "express";
import _ from "lodash";
import {RequestWithLogin} from "app/server/lib/Authorizer";

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
  public endSessionUrl = Sinon.stub().returns(undefined);
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
  let logDebugStub: Sinon.SinonStub;

  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  beforeEach(() => {
    sandbox = Sinon.createSandbox();
    logInfoStub = sandbox.stub(log, 'info');
    logErrorStub = sandbox.stub(log, 'error');
    logDebugStub = sandbox.stub(log, 'debug');
  });

  afterEach(() => {
    oldEnv.restore();
    sandbox.restore();
  });

  function setEnvVars() {
    // Prevent any environment variable from leaking into the test:
    for (const envVar in process.env) {
      if (envVar.startsWith('GRIST_OIDC_')) {
        delete process.env[envVar];
      }
    }
    process.env.GRIST_OIDC_SP_HOST = 'http://localhost:8484';
    process.env.GRIST_OIDC_IDP_CLIENT_ID = 'client id';
    process.env.GRIST_OIDC_IDP_CLIENT_SECRET = 'secret';
    process.env.GRIST_OIDC_IDP_ISSUER = 'http://localhost:8000';
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
        extraMetadata: {},
      }]);
      assert.isTrue(logInfoStub.calledOnce);
      assert.deepEqual(
        logInfoStub.firstCall.args,
        [`OIDCConfig: initialized with issuer ${process.env.GRIST_OIDC_IDP_ISSUER}`]
      );
    });

    it('should create a client with passed information with extra configuration', async () => {
      setEnvVars();
      const extraMetadata = {
        userinfo_signed_response_alg: 'RS256',
      };
      process.env.GRIST_OIDC_IDP_EXTRA_CLIENT_METADATA = JSON.stringify(extraMetadata);
      const client = new ClientStub();
      const config = await OIDCConfigStubbed.build(client.asClient());
      assert.isTrue(config._initClient.calledOnce);
      assert.deepEqual(config._initClient.firstCall.args, [{
        clientId: process.env.GRIST_OIDC_IDP_CLIENT_ID,
        clientSecret: process.env.GRIST_OIDC_IDP_CLIENT_SECRET,
        issuerUrl: process.env.GRIST_OIDC_IDP_ISSUER,
        extraMetadata,
      }]);
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
    const FAKE_NONCE = 'fake-nonce';
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
    } as SessionObj;
    const DEFAULT_EXPECTED_CALLBACK_CHECKS = {
      state: FAKE_STATE,
      code_verifier: FAKE_CODE_VERIFIER
    };
    let fakeRes: {
      status: Sinon.SinonStub;
      send: Sinon.SinonStub;
      redirect: Sinon.SinonStub;
    };
    let fakeSessions: {
      getOrCreateSessionFromRequest: Sinon.SinonStub
    };
    let fakeScopedSession: {
      operateOnScopedSession: Sinon.SinonStub
    };

    beforeEach(() => {
      fakeRes = {
        redirect: Sinon.stub(),
        status: Sinon.stub().returnsThis(),
        send: Sinon.stub().returnsThis(),
      };
      fakeScopedSession = {
        operateOnScopedSession: Sinon.stub().resolves(),
      };
      fakeSessions = {
        getOrCreateSessionFromRequest: Sinon.stub().returns(fakeScopedSession),
      };
    });

    function checkUserProfile(expectedUserProfile: object) {
      return function ({user}: {user: any}) {
        assert.deepEqual(user.profile, expectedUserProfile,
          `user profile should have been populated with ${JSON.stringify(expectedUserProfile)}`);
      };
    }

    function checkRedirect(expectedRedirection: string) {
      return function ({fakeRes}: {fakeRes: any}) {
        assert.deepEqual(fakeRes.redirect.firstCall.args, [expectedRedirection],
          `should have redirected to ${expectedRedirection}`);
      };
    }

    [
      {
        itMsg: 'should resolve when the state and the code challenge are found in the session',
        session: DEFAULT_SESSION,
      },
      {
        itMsg: 'should reject when the state is not found in the session',
        session: {},
        expectedErrorMsg: /Login or logout failed to complete/,
      },
      {
        itMsg: 'should resolve when the state is missing and its check has been disabled',
        session: DEFAULT_SESSION,
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: '',
        },
      },
      {
        itMsg: 'should reject when the codeVerifier is missing from the session',
        session: {
          oidc: {
            state: FAKE_STATE
          }
        },
        expectedErrorMsg: /Login is stale/,
      },
      {
        itMsg: 'should resolve when the codeVerifier is missing and its check has been disabled',
        session: {
          oidc: {
            state: FAKE_STATE,
            nonce: FAKE_NONCE
          }
        },
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: 'STATE,NONCE',
        },
        expectedCbChecks: {
          state: FAKE_STATE,
          nonce: FAKE_NONCE
        },
      },
      {
        itMsg: 'should reject when nonce is missing from the session despite its check being enabled',
        session: DEFAULT_SESSION,
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: 'STATE,NONCE,PKCE',
        },
        expectedErrorMsg: /Login is stale/,
      }, {
        itMsg: 'should resolve when nonce is present in the session and its check is enabled',
        session: {
          oidc: {
            state: FAKE_STATE,
            nonce: FAKE_NONCE,
          },
        },
        env: {
          GRIST_OIDC_IDP_ENABLED_PROTECTIONS: 'STATE,NONCE',
        },
        expectedCbChecks: {
          state: FAKE_STATE,
          nonce: FAKE_NONCE,
        },
      },
      {
        itMsg: 'should reject when the userinfo mail is not verified',
        session: DEFAULT_SESSION,
        userInfo: {
          ...FAKE_USER_INFO,
          email_verified: false,
        },
        expectedErrorMsg: /email not verified for/,
      },
      {
        itMsg: 'should resolve when the userinfo mail is not verified but its check disabled',
        session: DEFAULT_SESSION,
        userInfo: {
          ...FAKE_USER_INFO,
          email_verified: false,
        },
        env: {
          GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED: 'true',
        }
      },
      {
        itMsg: 'should resolve when the userinfo mail is not verified but its check disabled',
        session: DEFAULT_SESSION,
        userInfo: {
          ...FAKE_USER_INFO,
          email_verified: false,
        },
        env: {
          GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED: 'true',
        },
      },
      {
        itMsg: 'should fill user profile with email and name',
        session: DEFAULT_SESSION,
        userInfo: FAKE_USER_INFO,
        extraChecks: checkUserProfile({
          email: FAKE_USER_INFO.email,
          name: FAKE_USER_INFO.name,
        })
      },
      {
        itMsg: 'should fill user profile with name constructed using ' +
          'given_name and family_name when GRIST_OIDC_SP_PROFILE_NAME_ATTR is not set',
        session: DEFAULT_SESSION,
        userInfo: {
          ...FAKE_USER_INFO,
          given_name: 'given_name',
          family_name: 'family_name',
        },
        extrachecks: checkUserProfile({
          email: 'fake-email',
          name: 'given_name family_name',
        })
      },
      {
        itMsg: 'should fill user profile with email and name when ' +
          'GRIST_OIDC_SP_PROFILE_NAME_ATTR and GRIST_OIDC_SP_PROFILE_EMAIL_ATTR are set',
        session: DEFAULT_SESSION,
        userInfo: {
          ...FAKE_USER_INFO,
          fooMail: 'fake-email2',
          fooName: 'fake-name2',
        },
        env: {
          GRIST_OIDC_SP_PROFILE_NAME_ATTR: 'fooName',
          GRIST_OIDC_SP_PROFILE_EMAIL_ATTR: 'fooMail',
        },
        extraChecks: checkUserProfile({
          email: 'fake-email2',
          name: 'fake-name2',
        }),
      },
      {
        itMsg: 'should redirect by default to the root page',
        session: DEFAULT_SESSION,
        extraChecks: checkRedirect('/'),
      },
      {
        itMsg: 'should redirect to the targetUrl when it is present in the session',
        session: {
          oidc: {
            ...DEFAULT_SESSION.oidc,
            targetUrl: 'http://localhost:8484/some/path'
          }
        },
        extraChecks: checkRedirect('http://localhost:8484/some/path'),
      },
      {
        itMsg: "should redact confidential information in the tokenSet in the logs",
        session: DEFAULT_SESSION,
        tokenSet: {
          id_token: 'fake-id-token',
          access_token: 'fake-access',
          whatever: 'fake-whatever',
          token_type: 'fake-token-type',
          expires_at: 1234567890,
          expires_in: 987654321,
          scope: 'fake-scope',
        },
        extraChecks: function () {
          assert.isTrue(logDebugStub.called);
          assert.deepEqual(logDebugStub.firstCall.args, [
            'Got tokenSet: %o', {
              id_token: 'REDACTED',
              access_token: 'REDACTED',
              whatever: 'REDACTED',
              token_type: this.tokenSet.token_type,
              expires_at: this.tokenSet.expires_at,
              expires_in: this.tokenSet.expires_in,
              scope: this.tokenSet.scope,
            }
          ]);
        }
      },
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        setEnvVars();
        Object.assign(process.env, ctx.env);
        const clientStub = new ClientStub();
        const fakeParams = {
          state: FAKE_STATE,
        };
        const config = await OIDCConfigStubbed.build(clientStub.asClient());
        const session = _.clone(ctx.session); // session is modified, so clone it
        const req = {
          session,
          query: {
            state: FAKE_STATE,
            codeVerifier: FAKE_CODE_VERIFIER,
          }
        } as unknown as express.Request;
        clientStub.callbackParams.returns(fakeParams);
        const tokenSet = { id_token: 'id_token', ...ctx.tokenSet };
        clientStub.callback.resolves(tokenSet);
        clientStub.userinfo.returns(_.clone(ctx.userInfo ?? FAKE_USER_INFO));
        const user: { profile?: object } = {};
        fakeScopedSession.operateOnScopedSession.yields(user);

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
          assert.isFalse(logErrorStub.called, 'no error should be logged. Got: ' + logErrorStub.firstCall?.args[0]);
          assert.isTrue(fakeRes.redirect.calledOnce, 'should redirect');
          assert.isTrue(clientStub.callback.calledOnce);
          assert.deepEqual(clientStub.callback.firstCall.args, [
            'http://localhost:8484/oauth2/callback',
            fakeParams,
            ctx.expectedCbChecks ?? DEFAULT_EXPECTED_CALLBACK_CHECKS
          ]);
          assert.deepEqual(session, {
            oidc: {
              state: FAKE_STATE,
              idToken: tokenSet.id_token,
            }
          }, 'oidc info should only keep state and id_token in the session and for the logout');
          ctx.extraChecks?.({fakeRes, user});
        }
      });
    });

    it('should log err.response when userinfo fails to parse response body', async () => {
      // See https://github.com/panva/node-openid-client/blob/47a549cb4e36ffe2ebfe2dc9d6b69a02643cc0a9/lib/client.js#L1293
      setEnvVars();
      const clientStub = new ClientStub();
      const config = await OIDCConfigStubbed.build(clientStub.asClient());
      const req = {
        session: DEFAULT_SESSION,
        query: {
          state: FAKE_STATE,
          codeVerifier: FAKE_CODE_VERIFIER,
        }
      } as unknown as express.Request;
      clientStub.callbackParams.returns({state: FAKE_STATE});

      const err: Error & {response?: {body: string }} = new Error('userinfo failed');
      err.response = { body: 'response here' };
      clientStub.userinfo.rejects(err);

      await config.handleCallback(
        fakeSessions as unknown as Sessions,
        req,
        fakeRes as unknown as express.Response
      );

      assert.isTrue(logErrorStub.calledTwice);
      assert.include(logErrorStub.firstCall.args[0], err.message);
      assert.include(logErrorStub.secondCall.args[0], err.response.body);
      assert.isTrue(fakeRes.status.calledOnceWith(500));
    });
  });

  describe('getLogoutRedirectUrl', () => {
    const REDIRECT_URL = new URL('http://localhost:8484/docs/signed-out');
    const URL_RETURNED_BY_CLIENT = 'http://localhost:8484/logout_url_from_issuer';
    const ENV_VALUE_GRIST_OIDC_IDP_END_SESSION_ENDPOINT = 'http://localhost:8484/logout';
    const FAKE_SESSION = {
      oidc: {
        idToken: 'id_token',
        state: 'state',
      }
    } as SessionObj;

    [
      {
        itMsg: 'should skip the end session endpoint when GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true',
        env: {
          GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT: 'true',
        },
        expectedUrl: REDIRECT_URL.href,
      }, {
        itMsg: 'should use the GRIST_OIDC_IDP_END_SESSION_ENDPOINT when it is set',
        env: {
          GRIST_OIDC_IDP_END_SESSION_ENDPOINT: ENV_VALUE_GRIST_OIDC_IDP_END_SESSION_ENDPOINT
        },
        expectedUrl: ENV_VALUE_GRIST_OIDC_IDP_END_SESSION_ENDPOINT
      }, {
        itMsg: 'should call the end session endpoint with the expected parameters',
        expectedUrl: URL_RETURNED_BY_CLIENT,
        expectedLogoutParams: {
          post_logout_redirect_uri: REDIRECT_URL.href,
          id_token_hint: FAKE_SESSION.oidc!.idToken,
          state: FAKE_SESSION.oidc!.state,
        }
      }
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        setEnvVars();
        Object.assign(process.env, ctx.env);
        const clientStub = new ClientStub();
        clientStub.endSessionUrl.returns(URL_RETURNED_BY_CLIENT);
        const config = await OIDCConfigStubbed.build(clientStub.asClient());
        const req = {
          session: FAKE_SESSION
        } as unknown as RequestWithLogin;
        const url = await config.getLogoutRedirectUrl(req, REDIRECT_URL);
        assert.equal(url, ctx.expectedUrl);
        if (ctx.expectedLogoutParams) {
          assert.isTrue(clientStub.endSessionUrl.calledOnce);
          assert.deepEqual(clientStub.endSessionUrl.firstCall.args, [ctx.expectedLogoutParams]);
        }
      });
    });
  });
});
