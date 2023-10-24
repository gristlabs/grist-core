import { collectDefaultMetrics, register } from 'prom-client';
import http from 'http';

const reqListener = (req: http.IncomingMessage, res: http.ServerResponse) => {
  register.metrics().then((metrics) => {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(metrics);
  }).catch((e) => {
    res.writeHead(500);
    res.end(e.message);
  });
};

export function runPrometheusExporter(port: number) {
  collectDefaultMetrics();

  if (isNaN(port)) {
    throw new Error(`Invalid port: ${process.env.GRIST_PROMCLIENT_PORT}`);
  }
  const server = http.createServer(reqListener);
  server.listen(port, '0.0.0.0');

  console.log(`Prometheus exporter listening on port ${port}.`);
  return server;
}
