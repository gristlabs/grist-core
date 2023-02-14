import {wrapWithKeyMappedStorage} from 'app/server/lib/ExternalStorage';
import {appSettings} from 'app/server/lib/AppSettings';
import {MinIOExternalStorage} from 'app/server/lib/MinIOExternalStorage';

export function configureMinIOExternalStorage(purpose: 'doc'|'meta', extraPrefix: string) {
  const options = checkMinIOExternalStorage();
  if (!options?.bucket) { return undefined; }
  return wrapWithKeyMappedStorage(new MinIOExternalStorage(options.bucket, options), {
    basePrefix: options.prefix,
    extraPrefix,
    purpose,
  });
}

export function checkMinIOExternalStorage() {
  const settings = appSettings.section('externalStorage').section('minio');
  const bucket = settings.flag('bucket').readString({
    envVar: ['GRIST_DOCS_MINIO_BUCKET', 'TEST_MINIO_BUCKET'],
    preferredEnvVar: 'GRIST_DOCS_MINIO_BUCKET',
  });
  if (!bucket) { return undefined; }
  const region = settings.flag('bucket_region').requireString({
    envVar: ['GRIST_DOCS_MINIO_BUCKET_REGION'],
    preferredEnvVar: 'GRIST_DOCS_MINIO_BUCKET_REGION',
    defaultValue: 'us-east-1'
  });
  const prefix = settings.flag('prefix').requireString({
    envVar: ['GRIST_DOCS_MINIO_PREFIX'],
    preferredEnvVar: 'GRIST_DOCS_MINIO_PREFIX',
    defaultValue: 'docs/',
  });
  const endPoint = settings.flag('endpoint').requireString({
    envVar: ['GRIST_DOCS_MINIO_ENDPOINT'],
    preferredEnvVar: 'GRIST_DOCS_MINIO_ENDPOINT',
  });
  const port = settings.flag('port').read({
    envVar: ['GRIST_DOCS_MINIO_PORT'],
    preferredEnvVar: 'GRIST_DOCS_MINIO_PORT',
  }).getAsInt();
  const useSSL = settings.flag('useSsl').read({
    envVar: ['GRIST_DOCS_MINIO_USE_SSL'],
  }).getAsBool();
  const accessKey = settings.flag('accessKey').requireString({
    envVar: ['GRIST_DOCS_MINIO_ACCESS_KEY'],
    censor: true,
  });
  const secretKey = settings.flag('secretKey').requireString({
    envVar: ['GRIST_DOCS_MINIO_SECRET_KEY'],
    censor: true,
  });
  settings.flag('url').set(`minio://${bucket}/${prefix}`);
  settings.flag('active').set(true);
  return {
    endPoint,
    port,
    bucket, prefix,
    useSSL,
    accessKey,
    secretKey,
    region
  };
}
