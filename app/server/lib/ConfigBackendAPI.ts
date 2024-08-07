import * as express from 'express';
import {expressWrap} from 'app/server/lib/expressWrap';

import {getGlobalConfig} from 'app/server/lib/globalConfig';

import log from "app/server/lib/log";

export class ConfigBackendAPI {
  public addEndpoints(app: express.Express, requireInstallAdmin: express.RequestHandler) {
    app.get('/api/config/:key', requireInstallAdmin, expressWrap((req, resp) => {
      log.debug('config: requesting configuration', req.params);

      // Only one key is valid for now
      if (req.params.key === 'edition') {
        resp.send({value: getGlobalConfig().edition.get()});
      } else {
        resp.status(404).send({ error: 'Configuration key not found.' });
      }
    }));

    app.patch('/api/config', requireInstallAdmin, expressWrap(async (req, resp) => {
      const config = req.body.config;
      log.debug('config: received new configuration item', config);

      // Only one key is valid for now
      if(config.edition !== undefined) {
        await getGlobalConfig().edition.set(config.edition);

        resp.send({ msg: 'ok' });
      } else {
        resp.status(400).send({ error: 'Invalid configuration key' });
      }
    }));
  }
}
