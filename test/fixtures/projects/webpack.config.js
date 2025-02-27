/**
 * Test and develop a widget by running the following at the root of the git checkout:
 *
 *    bin/webpack-dev-server --config test/fixtures/projects/webpack.config.js
 *
 * To open a browser other than Chrome by default, prefix with OPEN_BROWSER=Firefox.
 * To avoid opening any browser, add --no-open flag.
 *
 * It will build and serve the demo code with live-reload at
 *
 *    http://localhost:8900/
 */


const fs = require('fs');
const glob = require('glob');
const path = require('path');

// Build each *.ts[x] project as its own bundle.
const entries = {};
for (const fixture of glob.sync(`test/fixtures/projects/*.{js,ts}`)) {
  const name = path.basename(fixture, path.extname(fixture));
  if (name.startsWith('webpack')) { continue; }
  entries[name] = fixture;
}

// Generic trivial html template for all projects.
const htmlTemplate = fs.readFileSync(`test/fixtures/projects/template.html`, 'utf8');

module.exports = {
  mode: "development",
  entry: entries,
  output: {
    path: path.resolve(__dirname),
    filename: "build/[name].bundle.js",
    // Distinguish auto-generated chunks from top-level bundles, so that
    // buildtools/publish_test_projects doesn't treat them as stand-alone projects.
    chunkFilename: "build/[name].chunk.js",
    // credit to: https://github.com/webpack/webpack/issues/9732#issuecomment-555461786
    sourceMapFilename: "build/[file].map[query]",
  },
  devtool: "source-map",
  resolve: {
    extensions: ['.ts', '.js'],
    modules: [
      path.resolve('.'),
      path.resolve('./node_modules'),
      path.resolve('./stubs'),
      path.resolve('./ext'),
    ],
    fallback: {
      'path': require.resolve("path-browserify"),
    },
  },
  module: {
    rules: [
      {
        test: /\.(js|ts)?$/,
        loader: 'esbuild-loader',
        options: {
          loader: 'ts',
          target: 'es2017',
          sourcemap: true,
        },
        exclude: /node_modules/
      },
      { test: /\.js$/,
        use: ["source-map-loader"],
        enforce: "pre"
      }
    ]
  },
  devServer: {
    static: [
      {
        directory: './test/fixtures/projects',
      },
      {
        directory: './bower_components',
      },
      {
        directory: './static/locales',
        publicPath: '/locales',
      },
    ],
    port: parseInt(process.env.PORT || '8900', 10),
    open: process.env.OPEN_BROWSER || 'Google Chrome',

    // Serve a trivial little index page with a directory, and a template for each project.
    setupMiddlewares: (middlewares, devServer) => {
      // app is an express app; we get a chance to add custom endpoints to it.
      devServer.app.get('/', (req, res) =>
        res.send(Object.keys(entries).map((e) => `<a href="${e}">${e}</a><br>\n`).join('')));
      devServer.app.get(Object.keys(entries).map((e) => `/${e}`), (req, res) => {
        return res.send(htmlTemplate.replace('<NAME>', path.basename(req.url.split('?')[0])))
      });
      return middlewares;
    },
  },
  externals: {
    // silence webpack when it's looking for jquery. It's available when it's needed.
    jquery: 'jQuery'
  }
}
