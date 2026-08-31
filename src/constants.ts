export const CHARACTER_LIMIT = 25000;
export const DEFAULT_TIMEOUT_MS = 30000;
export const SOCKET_TIMEOUT_MS = 15000;

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const MONITOR_TYPES = [
  "http",
  "port",
  "ping",
  "keyword",
  "dns",
  "push",
  "steam",
  "mqtt",
  "sqlserver",
  "postgres",
  "mysql",
  "grpc-keyword",
  "docker",
] as const;

export function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function getUptimeKumaUrl(): string {
  const url = process.env.UPTIME_KUMA_URL || process.env.UPTIME_KUMA_URI;
  if (!url) throw new Error("UPTIME_KUMA_URL is required (e.g. http://localhost:3001)");
  return url.replace(/\/$/, "");
}
