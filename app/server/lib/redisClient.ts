import { createClient, RedisClient } from "redis";

export function createRedisClient(url: string, onError: (err: Error) => void): RedisClient {
  const client = createClient(url);
  client.on("error", onError);
  return client;
}
