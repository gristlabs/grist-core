const path = require('path');

module.exports = {
  target: 'web',
  entry: {
    "grist-plugin-api": "app/plugin/grist-plugin-api",
  },
  output: {
    sourceMapFilename: "[file].map",
    path: path.resolve("./static"),
    library: "grist"
  },
  devtool: "source-map",
  node: false,
  resolve: {
    extensions: ['.ts', '.js'],
    modules: [
      path.resolve('.'),
      path.resolve('./ext'),
      path.resolve('./stubs'),
      path.resolve('./node_modules')
    ],
    fallback: {
      'path': require.resolve("path-browserify"),
    },
  },
  optimization: {
    minimize: false, // keep class names in code
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
    ]
  }
};
