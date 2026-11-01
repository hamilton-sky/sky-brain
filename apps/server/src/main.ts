import { readConfig } from "./config.ts";
import { closeOnSignals, start } from "./server.ts";

try {
  closeOnSignals(await start(readConfig(process.env)));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
