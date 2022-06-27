const path = require('path');

module.exports = {
  target: 'web',
  mode: 'production',
  entry: "./app/client/browserCheck",
  output: {
    path: path.resolve("./static"),
    filename: "browser-check.js"
  },
  resolve: {
    extensions: ['.ts', '.js'],
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
