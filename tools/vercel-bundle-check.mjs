// Loads the Vercel bundle (apps/server/dist/vercel.mjs) with no environment. It must get as far
// as its own "DATABASE_URL must be set" refusal: any other error (a CommonJS dependency bundled
// into the ESM output, "Dynamic require of ... is not supported") means the function would
// crash on every request in production. Run after `pnpm --filter @sky-brain/server build:vercel`.
const bundle = new URL("../apps/server/dist/vercel.mjs", import.meta.url);
delete process.env.DATABASE_URL;
try {
  await import(bundle.href);
  console.error("vercel-bundle-check: the bundle started without DATABASE_URL");
  process.exit(1);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("DATABASE_URL must be set")) {
    console.log("vercel-bundle-check: ok");
  } else {
    console.error(`vercel-bundle-check: the bundle fails to load: ${message}`);
    process.exit(1);
  }
}
