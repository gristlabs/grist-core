import { collectDefaultMetrics, register } from 'prom-client';
import http from 'http';

collectDefaultMetrics();

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  register.metrics().then((metrics) => {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(metrics);
  }).catch((e) => {
    res.writeHead(500);
    res.end(e.message);
  });
});

const port = parseInt(process.env.GRIST_PROMCLIENT_PORT!, 10);
if (isNaN(port)) {
  throw new Error(`Invalid port: ${process.env.GRIST_PROMCLIENT_PORT}`);
}
server.listen(port, '0.0.0.0');

console.log("---------------------------------------------");
console.log(`Prometheus exporter listening on port ${port}`);
console.log("---------------------------------------------");
