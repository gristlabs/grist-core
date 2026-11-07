import { appSettings } from "app/server/lib/AppSettings";
import { wrapWithKeyMappedStorage } from "app/server/lib/ExternalStorage";
import { ICreateStorageOptions } from "app/server/lib/ICreate";
import { MinIOExternalStorage } from "app/server/lib/MinIOExternalStorage";

import * as minio from "minio";

export function getMinIOStorageOption(): ICreateStorageOptions {
  return {
    name: "minio",
    check: () => checkMinIOExternalStorage() !== undefined,
    checkBackend: () => checkMinIOBucket(),
    create: configureMinIOExternalStorage,
  };
}

export function configureMinIOExternalStorage(purpose: "doc" | "meta" | "attachments", extraPrefix: string) {
  const options = checkMinIOExternalStorage();
  if (!options?.bucket) { return undefined; }
  return wrapWithKeyMappedStorage(new MinIOExternalStorage(options.bucket, options), {
    basePrefix: options.prefix,
    extraPrefix,
    purpose,
  });
}

// GRIST_DOCS_MINIO_* is the older name for each setting.
export function s3EnvVars(name: string) {
  return [`GRIST_DOCS_S3_${name}`, `GRIST_DOCS_MINIO_${name}`];
}

export function checkMinIOExternalStorage() {
  const settings = appSettings.section("externalStorage").section("minio");
  const bucket = settings.flag("bucket").readString({
    envVar: [...s3EnvVars("BUCKET"), "TEST_MINIO_BUCKET"],
    preferredEnvVar: "GRIST_DOCS_S3_BUCKET",
  });
  if (!bucket) { return undefined; }
  const region = settings.flag("bucketRegion").requireString({
    envVar: s3EnvVars("BUCKET_REGION"),
    preferredEnvVar: "GRIST_DOCS_S3_BUCKET_REGION",
    defaultValue: "us-east-1",
  });
  const prefix = settings.flag("prefix").requireString({
    envVar: s3EnvVars("PREFIX"),
    preferredEnvVar: "GRIST_DOCS_S3_PREFIX",
    defaultValue: "docs/",
  });
  const endPoint = settings.flag("endpoint").readString({
    envVar: s3EnvVars("ENDPOINT"),
    preferredEnvVar: "GRIST_DOCS_S3_ENDPOINT",
  });
  if (!endPoint) {
    // Fail rather than run without the storage the bucket setting asks for.
    throw new Error("missing GRIST_DOCS_S3_ENDPOINT (for AWS, use s3.amazonaws.com)");
  }
  const port = settings.flag("port").read({
    envVar: s3EnvVars("PORT"),
    preferredEnvVar: "GRIST_DOCS_S3_PORT",
  }).getAsInt();
  const useSSL = settings.flag("useSsl").read({
    envVar: s3EnvVars("USE_SSL"),
    preferredEnvVar: "GRIST_DOCS_S3_USE_SSL",
  }).getAsBool();
  const useAwsCredentialChain = settings.flag("useAwsCredentialChain").read({
    envVar: s3EnvVars("USE_AWS_CREDENTIAL_CHAIN"),
    preferredEnvVar: "GRIST_DOCS_S3_USE_AWS_CREDENTIAL_CHAIN",
  }).getAsBool();
  const accessKeyQuery = {
    envVar: s3EnvVars("ACCESS_KEY"),
    preferredEnvVar: "GRIST_DOCS_S3_ACCESS_KEY",
    censor: true,
  };
  const secretKeyQuery = {
    envVar: s3EnvVars("SECRET_KEY"),
    preferredEnvVar: "GRIST_DOCS_S3_SECRET_KEY",
    censor: true,
  };
  let credentials: { accessKey?: string, secretKey?: string, credentialsProvider?: minio.IamAwsProvider };
  if (useAwsCredentialChain) {
    // Credentials come from the AWS chain (IRSA, ECS task role, EC2 instance metadata).
    if (settings.flag("accessKey").readString(accessKeyQuery) ||
      settings.flag("secretKey").readString(secretKeyQuery)) {
      throw new Error("GRIST_DOCS_S3_USE_AWS_CREDENTIAL_CHAIN cannot be combined with " +
        "GRIST_DOCS_S3_ACCESS_KEY or GRIST_DOCS_S3_SECRET_KEY");
    }
    credentials = { credentialsProvider: new minio.IamAwsProvider({}) };
  } else {
    credentials = {
      accessKey: settings.flag("accessKey").requireString(accessKeyQuery),
      secretKey: settings.flag("secretKey").requireString(secretKeyQuery),
    };
  }
  settings.flag("url").set(`minio://${bucket}/${prefix}`);
  settings.flag("active").set(true);
  return {
    endPoint,
    port,
    bucket, prefix,
    useSSL,
    region,
    ...credentials,
  };
}

export async function checkMinIOBucket() {
  const options = checkMinIOExternalStorage();
  if (!options) {
    throw new Error("Configuration check failed for S3-compatible backend storage.");
  }

  const externalStorage = new MinIOExternalStorage(options.bucket, options);
  if (!await externalStorage.hasVersioning()) {
    await externalStorage.close();
    throw new Error(`FATAL: the bucket "${options.bucket}" does not have versioning enabled`);
  }
}
