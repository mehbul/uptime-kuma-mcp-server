import { io, Socket } from "socket.io-client";
import axios from "axios";
import { getUptimeKumaUrl, SOCKET_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "../constants.js";
import type { SocketResponse, UptimeKumaMonitor, Heartbeat } from "../types.js";
export { getUptimeKumaUrl as getBaseUrl } from "../constants.js";

/**
 * Uptime Kuma uses Socket.IO as primary API (like the Vue frontend).
 * We replicate the frontend flow:
 *  1. connect socket
 *  2. login via `login` event (username/password) or `loginByToken` (JWT)
 *  3. emit command events and await callback
 *  4. disconnect
 */

let cachedLogin: { identity: string; token: string } | undefined;

function getAuth() {
  const username = process.env.UPTIME_KUMA_USERNAME;
  const password = process.env.UPTIME_KUMA_PASSWORD;
  const token = process.env.UPTIME_KUMA_TOKEN; // JWT from previous login
  if (token) return { type: "token" as const, token };
  if (username && password) {
    const identity = JSON.stringify([getUptimeKumaUrl(), username, password]);
    if (cachedLogin?.identity === identity) return { type: "token" as const, token: cachedLogin.token };
    return { type: "password" as const, username, password, identity };
  }
  throw new Error(
    "Authentication required: set UPTIME_KUMA_TOKEN (JWT) OR UPTIME_KUMA_USERNAME + UPTIME_KUMA_PASSWORD"
  );
}

async function createAuthenticatedSocket(): Promise<{ socket: Socket; lists: Map<string, unknown> }> {
  const auth = getAuth();
  const url = getUptimeKumaUrl();
  const socket: Socket = io(url, {
    transports: ["websocket", "polling"],
    timeout: SOCKET_TIMEOUT_MS,
    reconnection: false,
    autoConnect: false,
  });
  // afterLogin publishes these lists before login/loginByToken acknowledges.
  const lists = new Map<string, unknown>();
  for (const event of ["monitorList", "notificationList", "statusPageList"]) {
    socket.on(event, (data: unknown) => lists.set(event, data));
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for Uptime Kuma server info")), SOCKET_TIMEOUT_MS);
      // The server awaits sendInfo before registering login command handlers.
      socket.once("info", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Socket connect_error: ${err.message}`));
      });
      socket.connect();
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Login timeout")), SOCKET_TIMEOUT_MS);
      const cb = (res: SocketResponse) => {
        clearTimeout(timer);
        if (res?.ok) {
          if (auth.type === "password" && res.token) cachedLogin = { identity: auth.identity, token: res.token };
          resolve();
        }
        else reject(new Error(res?.tokenRequired ? "Two-factor code required: set UPTIME_KUMA_TOTP" : res?.msg || "Login failed — check credentials"));
      };
      if (auth.type === "token") {
        socket.emit("loginByToken", auth.token, cb);
      } else {
        const totp = process.env.UPTIME_KUMA_TOTP;
        socket.emit("login", { username: auth.username, password: auth.password, token: totp || "" }, cb);
      }
    });

    return { socket, lists };
  } catch (error) {
    cachedLogin = undefined;
    socket.disconnect();
    throw error;
  }
}

function emitWithCallback<T>(socket: Socket, event: string, ...args: unknown[]): Promise<SocketResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Event '${event}' timed out`)), SOCKET_TIMEOUT_MS);
    const callback = (res: SocketResponse<T>) => {
      clearTimeout(timer);
      resolve(res);
    };
    // socket.emit(event, ...args, callback)
    (socket.emit as unknown as (...a: unknown[]) => void)(event, ...args, callback);
  });
}

async function withSocket<T>(fn: (socket: Socket, lists: Map<string, unknown>) => Promise<T>): Promise<T> {
  const { socket, lists } = await createAuthenticatedSocket();
  try {
    return await fn(socket, lists);
  } finally {
    try {
      socket.disconnect();
    } catch {}
  }
}

// ---------- High-level API wrappers ----------

export async function listMonitors(): Promise<Record<string, UptimeKumaMonitor>> {
  return withSocket(async (_socket, lists) => {
    if (!lists.has("monitorList")) throw new Error("Kuma did not send monitorList during login");
    return lists.get("monitorList") as Record<string, UptimeKumaMonitor>;
  });
}

export async function getMonitor(monitorID: number): Promise<UptimeKumaMonitor> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback<UptimeKumaMonitor>(socket, "getMonitor", monitorID);
    if (!res.ok || !res.monitor) throw new Error(res.msg || `Monitor ${monitorID} not found`);
    return res.monitor;
  });
}

export async function createMonitor(monitor: Record<string, unknown>): Promise<{ monitorID: number }> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback(socket, "add", monitor);
    if (!res.ok) throw new Error(res.msg || "Failed to create monitor");
    if (!res.monitorID) throw new Error("No monitorID returned");
    return { monitorID: res.monitorID };
  });
}

export async function editMonitor(monitor: Record<string, unknown>): Promise<void> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback(socket, "editMonitor", monitor);
    if (!res.ok) throw new Error(res.msg || "Failed to edit monitor");
  });
}

export async function deleteMonitor(monitorID: number): Promise<void> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback(socket, "deleteMonitor", monitorID);
    if (!res.ok) throw new Error(res.msg || "Failed to delete monitor");
  });
}

export async function pauseMonitor(monitorID: number): Promise<void> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback(socket, "pauseMonitor", monitorID);
    if (!res.ok) throw new Error(res.msg || "Failed to pause monitor");
  });
}

export async function resumeMonitor(monitorID: number): Promise<void> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback(socket, "resumeMonitor", monitorID);
    if (!res.ok) throw new Error(res.msg || "Failed to resume monitor");
  });
}

export async function getMonitorBeats(monitorID: number, periodHours = 24): Promise<Heartbeat[]> {
  return withSocket(async (socket) => {
    const res = await emitWithCallback<Heartbeat[]>(socket, "getMonitorBeats", monitorID, periodHours);
    if (!res.ok) throw new Error(res.msg || "Failed to get heartbeats");
    return (res.data as unknown as Heartbeat[]) || [];
  });
}

export async function getMonitorStatus(monitorID: number, periodHours = 24): Promise<{ uptime: number | null; avgPing: number | null }> {
  return withSocket(async (socket) => {
    // Kuma 2.x aggregates successful/failed checks into chart buckets.
    // Weight pings by successful checks, rather than averaging bucket averages.
    const res = await emitWithCallback<Array<{ up: number; down: number; avgPing: number | null }>>(
      socket, "getMonitorChartData", monitorID, periodHours
    );
    if (!res.ok || !Array.isArray(res.data)) throw new Error(res.msg || "Failed to get monitor statistics");
    let up = 0, down = 0, pingTotal = 0, pingCount = 0;
    for (const bucket of res.data) {
      up += bucket.up;
      down += bucket.down;
      if (bucket.up > 0 && typeof bucket.avgPing === "number" && Number.isFinite(bucket.avgPing)) {
        pingTotal += bucket.avgPing * bucket.up;
        pingCount += bucket.up;
      }
    }
    return { uptime: up + down > 0 ? up / (up + down) : null, avgPing: pingCount > 0 ? pingTotal / pingCount : null };
  });
}

export async function listNotifications(): Promise<unknown[]> {
  return withSocket(async (_socket, lists) => {
    const data = lists.get("notificationList");
    if (!Array.isArray(data)) throw new Error("Kuma did not send notificationList during login");
    // Notification configs contain webhook URLs, passwords and access tokens.
    return data.map((n) => ({ id: n.id, name: n.name, type: n.config?.type ?? n.type ?? "unknown", active: n.active }));
  });
}

export async function listStatusPages(): Promise<unknown[]> {
  return withSocket(async (_socket, lists) => {
    const data = lists.get("statusPageList");
    if (!data || typeof data !== "object") throw new Error("Kuma did not send statusPageList during login");
    return Object.values(data);
  });
}

// REST: /metrics (Prometheus)
export async function getMetrics(): Promise<string> {
  const url = `${getUptimeKumaUrl()}/metrics`;
  const apiKey = process.env.UPTIME_KUMA_API_KEY;
  const username = process.env.UPTIME_KUMA_USERNAME;
  const password = process.env.UPTIME_KUMA_PASSWORD;
  const headers: Record<string, string> = {};
  let auth: { username: string; password: string } | undefined;
  if (apiKey) {
    // API key via Basic Auth with empty username
    auth = { username: "", password: apiKey };
  } else if (username && password) {
    auth = { username, password };
  }
  const res = await axios.get(url, {
    auth,
    timeout: DEFAULT_TIMEOUT_MS,
    headers,
    validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`Metrics failed: ${res.status} ${res.data}`);
  return res.data as string;
}

export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) return `Error: API ${error.response.status} — ${JSON.stringify(error.response.data).slice(0, 500)}`;
    if (error.code === "ECONNABORTED") return "Error: Request timed out. Check UPTIME_KUMA_URL reachable.";
  }
  if (error instanceof Error) {
    if (error.message.includes("UPTIME_KUMA_URL")) return `Error: ${error.message} — Set UPTIME_KUMA_URL (e.g. http://localhost:3001)`;
    if (error.message.includes("Authentication")) return `Error: ${error.message} — Set UPTIME_KUMA_USERNAME/PASSWORD or UPTIME_KUMA_TOKEN`;
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}
