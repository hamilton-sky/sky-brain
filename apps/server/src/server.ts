import type { Server } from "node:http";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";

export function start(config: Config): Promise<Server> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, (err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`sky-brain listening on port ${config.port}`);
      resolve(server);
    });
  });
}
