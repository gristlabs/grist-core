import { AppSettings } from "app/server/lib/AppSettings";
import { GristLoginSystem } from "app/server/lib/GristServer";

/**
 * Get the selected login system type from app settings.
 * This checks the GRIST_LOGIN_SYSTEM_TYPE environment variable.
 * Returns undefined if not explicitly set.
 */
export function getActiveLoginSystemType(settings: AppSettings) {
  const flag = settings.section("login").flag("type");
  // Just trigger the read, notice that this does cache the result.
  const value = flag.readString({
    envVar: "GRIST_LOGIN_SYSTEM_TYPE",
  });
  return value;
}

/**
 * Get the source of the active login system type from app settings.
 */
export function getActiveLoginSystemTypeSource(settings: AppSettings) {
  const flag = settings.section("login").flag("type");
  // Just trigger the read, notice that this does cache the result.
  const value = flag.readString({
    envVar: "GRIST_LOGIN_SYSTEM_TYPE",
  });
  if (value) {
    const source = flag.describe().source;
    return source;
  }
  return null;
}

/**
 * Exception thrown by the login system configuration readers when the system is not configured.
 */
export class NotConfiguredError extends Error {

}

/**
 * Helper to get a login provider if it is selected or no other provider is selected.
 */
export function createLoginProviderFactory(
  key: string,
  builder: (settings: AppSettings) => Promise<GristLoginSystem>,
): (settings: AppSettings) => Promise<GristLoginSystem | null> {
  return async (settings: AppSettings) => {
    // First check what provider is selected explicitly.
    const selected = getActiveLoginSystemType(settings);

    // If some other provider is explicitly selected, skip this one.
    if (selected && selected !== key) {
      return null;
    }

    // No other is selected, or we are the selected one, try to build our provider.
    try {
      const system = await builder(settings);
      // If we are here, the provider is configured, set it as active.
      settings.section("login").flag("active").set(key);
      return system;
    } catch (e) {
      // Otherwise, ignore NotConfiguredError to allow fallback.
      if (e instanceof NotConfiguredError) {
        return null;
      }
      // Since some configuration is present, but there was some other error, set this provider as active
      // to avoid trying other providers, as user implicitly selected this one.
      settings.section("login").flag("active").set(key);
      throw e;
    }
  };
}

/**
 * Helper to get a login provider as a fallback option.
 * This will always try to build the provider, and if it fails, it will re-throw the exception.
 */
export function getFallbackLoginProvider(
  key: string,
  builder: (settings: AppSettings) => Promise<GristLoginSystem>,
): (settings: AppSettings) => Promise<GristLoginSystem> {
  return async (settings: AppSettings) => {
    const system = await builder(settings);
    // If we are here, the provider is configured, set it as active.
    settings.section("login").flag("active").set(key);
    return system;
  };
}
