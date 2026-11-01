// Entry for `pnpm dev`: sets NODE_ENV here, not with a shell prefix, so it works on every OS.
process.env.NODE_ENV ??= "development";

const { readConfig } = await import("./config.ts");
const { start } = await import("./server.ts");

await start(readConfig(process.env));
