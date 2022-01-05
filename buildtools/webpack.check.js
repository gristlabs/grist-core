const path = require('path');

module.exports = {
  target: 'web',
  mode: 'production',
  entry: "./_build/app/client/browserCheck.js",
  output: {
    path: path.resolve("./static"),
    filename: "browser-check.js"
  },
};
