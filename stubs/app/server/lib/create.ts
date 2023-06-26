import { checkMinIOBucket, checkMinIOExternalStorage,
         configureMinIOExternalStorage } from 'app/server/lib/configureMinIOExternalStorage';
import { makeSimpleCreator } from 'app/server/lib/ICreate';
import { Telemetry } from 'app/server/lib/Telemetry';

export const create = makeSimpleCreator({
  deploymentType: 'core',
  // This can and should be overridden by GRIST_SESSION_SECRET
  // (or generated randomly per install, like grist-omnibus does).
  sessionSecret: 'Phoo2ag1jaiz6Moo2Iese2xoaphahbai3oNg7diemohlah0ohtae9iengafieS2Hae7quungoCi9iaPh',
  storage: [
    {
      name: 'minio',
      check: () => checkMinIOExternalStorage() !== undefined,
      checkBackend: () => checkMinIOBucket(),
      create: configureMinIOExternalStorage,
    },
  ],
  telemetry: {
    create: (dbManager, gristServer) => new Telemetry(dbManager, gristServer),
  }
});
