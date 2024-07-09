import configCoreTI from './configCoreFileFormats-ti';
import { CheckerT, createCheckers } from "ts-interface-checker";

/**
 * Latest core config file format
 */
export type IGristCoreConfigFileLatest = IGristCoreConfigFileV1;

/**
 * Format of config files on disk - V1
 */
export interface IGristCoreConfigFileV1 {
  version: "1"
  edition?: "core" | "enterprise"
}

/**
 * Format of config files on disk - V0
 */
export interface IGristCoreConfigFileV0 {
  version: undefined;
}

export const checkers = createCheckers(configCoreTI) as
  {
    IGristCoreConfigFileV0: CheckerT<IGristCoreConfigFileV0>,
    IGristCoreConfigFileV1: CheckerT<IGristCoreConfigFileV1>,
    IGristCoreConfigFileLatest: CheckerT<IGristCoreConfigFileLatest>,
  };

function upgradeV0toV1(config: IGristCoreConfigFileV0): IGristCoreConfigFileV1 {
  return {
    ...config,
    version: "1",
  };
}

export function convertToCoreFileContents(input: any): IGristCoreConfigFileLatest | null {
  if (!(input instanceof Object)) {
    return null;
  }

  let configObject = { ...input };

  if (checkers.IGristCoreConfigFileV0.test(configObject)) {
    configObject = upgradeV0toV1(configObject);
  }

  // This will throw an exception if the config object is still not in the correct format.
  checkers.IGristCoreConfigFileLatest.check(configObject);

  return configObject;
}
