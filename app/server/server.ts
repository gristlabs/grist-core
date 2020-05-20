import * as express from 'express';
import * as http from 'http';
import {AddressInfo} from 'net';

const G = {
  port: parseInt(process.env.PORT!, 10) || 8484,
  host: process.env.HOST || 'localhost',
};

export async function main() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.static('static'));

  // Start listening.
  await new Promise((resolve, reject) => server.listen(G.port, G.host, resolve).on('error', reject));
  const address = server.address() as AddressInfo;
  console.warn(`Server listening at http://${address.address}:${address.port}`);
}

if (require.main === module) {
  main().catch((err) => console.error(err));
}
