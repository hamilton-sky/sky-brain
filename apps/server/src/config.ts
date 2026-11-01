export interface Config {
  port: number;
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const raw = env.PORT ?? "3000";
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port > 65535) {
    throw new Error(
      `PORT must be a whole number from 0 to 65535, got "${raw}"`,
    );
  }
  return { port };
}
