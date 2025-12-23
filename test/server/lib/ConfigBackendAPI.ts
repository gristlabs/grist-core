import { AuthProvider } from "app/common/ConfigAPI";
import { AppSettings } from "app/server/lib/AppSettings";
import { _fillProviderInfo } from "app/server/lib/ConfigBackendAPI";

import { assert } from "chai";

function createMockSettings(opts: {
  loginSystemType?: string;
  loginSystemTypeSource?: "env" | "default" | null;
  active?: string;
  error?: string;
} = {}) {
  const settings = new AppSettings("test");

  const loginSection = settings.section("login");
  const activeFlag = loginSection.flag("active");
  if (opts.active) {
    activeFlag.set(opts.active);
  }
  const errorFlag = loginSection.flag("error");
  if (opts.error) {
    errorFlag.set(opts.error);
  }

  if (opts.loginSystemType !== undefined || opts.loginSystemTypeSource !== undefined) {
    const typeFlag = loginSection.flag("type");
    if (opts.loginSystemType) {
      typeFlag.readString = () => opts.loginSystemType;
      typeFlag.describe = () => ({ source: opts.loginSystemTypeSource ?? "default" } as any);
    }
    else {
      typeFlag.readString = () => undefined;
      typeFlag.describe = () => ({ source: null } as any);
    }
  }

  return settings;
}

describe("ConfigBackendAPI", () => {
  describe("fillProviderInfo", () => {
    it("should handle empty providers list", () => {
      const result = _fillProviderInfo({
        newSettings: createMockSettings(),
        currentSettings: createMockSettings(),
        providers: [],
      });
      assert.deepEqual(result, []);
    });

    it("should mark active configured provider", () => {
      const providers: AuthProvider[] = [
        { key: "saml", name: "SAML", isConfigured: false },
        { key: "oidc", name: "OIDC", isConfigured: true },
      ];
      const result = _fillProviderInfo({
        newSettings: createMockSettings(),
        currentSettings: createMockSettings({ active: "oidc" }),
        providers,
      });
      assert.deepEqual(result[0], {
        key: "saml",
        name: "SAML",
      });
      assert.deepEqual(result[1], {
        key: "oidc",
        name: "OIDC",
        isConfigured: true,
        isActive: true,
      });
    });

    it("should detect change by configuration", () => {
      // Now both are configured, but oidc is current, so Grist will switch to saml as it is first in preference.
      const providers: AuthProvider[] = [
        { key: "saml", name: "SAML", isConfigured: true },
        { key: "oidc", name: "OIDC", isConfigured: true },
      ];
      const result = _fillProviderInfo({
        newSettings: createMockSettings(),
        currentSettings: createMockSettings({ active: "oidc" }),
        providers,
      });
      assert.deepEqual(result[0], {
        key: "saml",
        name: "SAML",
        willBeActive: true,
        isConfigured: true,
      });
      assert.deepEqual(result[1], {
        key: "oidc",
        name: "OIDC",
        willBeDisabled: true,
        isConfigured: true,
        canBeActivated: true,
      });
    });

    it("should respect selection by database", () => {
      const providers: AuthProvider[] = [
        { key: "saml", name: "SAML", isConfigured: true },
        { key: "oidc", name: "OIDC", isConfigured: true },
      ];
      const result = _fillProviderInfo({
        newSettings: createMockSettings({ loginSystemType: "oidc" }),
        currentSettings: createMockSettings({ active: "saml" }),
        providers,
      });
      assert.deepEqual(result[0], {
        key: "saml",
        name: "SAML",
        willBeDisabled: true,
        canBeActivated: true,
        isConfigured: true,
      });
      assert.deepEqual(result[1], {
        key: "oidc",
        name: "OIDC",
        willBeActive: true,
        isConfigured: true,
      });
    });

    it("should respect selection by env variable and not offer to change the method", () => {
      const providers: AuthProvider[] = [
        { key: "saml", name: "SAML", isConfigured: true },
        { key: "oidc", name: "OIDC", isConfigured: true },
      ];
      const result = _fillProviderInfo({
        newSettings: createMockSettings({ loginSystemType: "saml", loginSystemTypeSource: "env" }),
        currentSettings: createMockSettings({ active: "oidc" }),
        providers,
      });
      assert.deepEqual(result[0], {
        key: "saml",
        name: "SAML",
        willBeActive: true,
        isConfigured: true,
        isSelectedByEnv: true,
      });
      assert.deepEqual(result[1], {
        key: "oidc",
        name: "OIDC",
        willBeDisabled: true,
        isConfigured: true,
      });
    });

    it("should show config error and prevent activation", () => {
      const providers: AuthProvider[] = [
        { key: "oidc", name: "OIDC", configError: "config error" },
        { key: "saml", name: "SAML", isConfigured: true },
      ];

      // Currently nothing is selected - so Grist is using minimal system. But user tried
      // to configure oidc but there were some errors.
      const result = _fillProviderInfo({
        newSettings: createMockSettings(),
        currentSettings: createMockSettings(),
        providers,
      });

      // OIDC has config error but will still be picked as "next" (first in list)
      assert.deepEqual(result[0], {
        key: "oidc",
        name: "OIDC",
        configError: "config error",
        willBeActive: true, // because it is first in list and has config error
      });

      // SAML is configured and can be activated, but it is not selected as it is second in list.
      assert.deepEqual(result[1], {
        key: "saml",
        name: "SAML",
        isConfigured: true,
        canBeActivated: true,
      });
    });

    it("should show runtime error for active provider that is configured properly", () => {
      const providers: AuthProvider[] = [
        { key: "oidc", name: "OIDC", isConfigured: true },
        { key: "saml", name: "SAML", isConfigured: true },
      ];
      const result = _fillProviderInfo({
        newSettings: createMockSettings(),
        currentSettings: createMockSettings({ active: "oidc", error: "Failed to initialize OIDC client" }),
        providers,
      });

      // Config error and runtime error are the same, so only runtimeError is shown
      assert.deepEqual(result[0], {
        key: "oidc",
        name: "OIDC",
        isActive: true,
        isConfigured: true,
        activeError: "Failed to initialize OIDC client",
      });

      // SAML is configured and can be activated
      assert.deepEqual(result[1], {
        key: "saml",
        name: "SAML",
        isConfigured: true,
        canBeActivated: true,
      });
    });
  });
});
