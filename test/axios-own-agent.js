/**
 * Give axios its own connection pool, keeping the sockets it uses out of the shared one.
 *
 * Through follow-redirects, axios leaves a socket.destroy listener on the 'timeout'
 * event of each keep-alive socket it uses, and does not remove it. Node sets a five
 * second idle timeout on pooled sockets, so the next caller to reuse one -- node-fetch,
 * and hence our API client -- has it closed five seconds into any request the server is
 * slow to answer, reported as "socket hang up". The nbrowser suites run into this by
 * uploading a fixture document through axios in a before hook; that socket is then
 * reused for the first applyUserActions of the suite.
 *
 * A separate pool is enough because axios disables the socket timeout for the duration
 * of its own requests, leaving nothing to trigger the listener. See axios#6113, and
 * remove this once it is fixed upstream.
 */

// axios.create() merges the defaults as an instance is made, so this has to run before
// anything that makes one, which is what mocha's require list is for.
const http = require("http");
const https = require("https");
const axios = require("axios");

axios.defaults.httpAgent = new http.Agent({ keepAlive: true });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true });
