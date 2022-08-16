// Cache configuration for typeorm does not seem available via ormconfig.env, so
// we use ormconfig.js style.

const {codeRoot} = require('./_build/app/server/lib/places');

module.exports = {
  "name": process.env.TYPEORM_NAME || "default",
  "type": process.env.TYPEORM_TYPE || "sqlite",  // officially, TYPEORM_CONNECTION -
                                                 // but if we use that, this file will never
                                                 // be read, and we can't configure
                                                 // caching otherwise.
  "database": process.env.TYPEORM_DATABASE || "landing.db",
  "username": process.env.TYPEORM_USERNAME || null,
  "password": process.env.TYPEORM_PASSWORD || null,
  "host": process.env.TYPEORM_HOST || null,
  "port": process.env.TYPEORM_PORT || null,
  "synchronize": false,
  "migrationsRun": false,
  "logging": process.env.TYPEORM_LOGGING === "true",
  "entities": [
    `${codeRoot}/app/gen-server/entity/*.js`
  ],
  "migrations": [
    `${codeRoot}/app/gen-server/migration/*.js`        // migration files don't actually get packaged.
  ],
  "subscribers": [
    `${codeRoot}/app/gen-server/subscriber/*.js`
  ],
  "cli": {
    "entitiesDir": `${codeRoot}/app/gen-server/entity`,
    "migrationsDir": `${codeRoot}/app/gen-server/migration`,
    "subscribersDir": `${codeRoot}/app/gen-server/subscriber`
  }
};

// If we have a redis server available, tell typeorm.  Then any queries built with
// .cache() called on them will be cached via redis.
// We use a separate environment variable for the moment so that we don't have to
// enable this until we really need it.
if (process.env.TYPEORM_REDIS_URL) {
  const url = require('url').parse(process.env.TYPEORM_REDIS_URL);
  module.exports.cache = {
    type: "redis",
    options: {
      host: url.hostname,
      port: parseInt(url.port || "6379", 10)
    }
  };
}
