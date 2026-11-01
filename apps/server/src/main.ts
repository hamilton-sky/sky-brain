import { readConfig } from "./config.ts";
import { start } from "./server.ts";

await start(readConfig(process.env));
