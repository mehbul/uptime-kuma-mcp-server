import { io, Socket } from "socket.io-client";
import axios from "axios";
import { getUptimeKumaUrl, SOCKET_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "../constants.js";
import type { SocketResponse, UptimeKumaMonitor, Heartbeat } from "../types.js";

/**
 * Uptime Kuma uses Socket.IO as primary API (like the Vue frontend).
 * We replicate the frontend flow:
 *  1. connect socket
 *  2. login via `login` event (username/password) or `loginByToken` (JWT)
 *  3. emit command events and await callback
 *  4. disconnect
 */

function getAuth() {
  const username = process.env.UPTIME_KUMA_USERNAME;
  const password = process.env.UPTIME_KUMA_PASSWORD;
  const token = process.env.UPTIME_KUMA_TOKEN; // JWT from previous login
  if (token) return { type: "token" as const, token };
  if (username && password) return { type: "password" as const, username, password };
  throw new Error(
    "Authentication required: set UPTIME_KUMA_TOKEN (JWT) OR UPTIME_KUMA_USERNAME + UPTIME_KUMA_PASSWORD"
  );
}

async function createAuthenticatedSocket(): Promise<Socket> {
  const url = getUptimeKumaUrl();
  const socket: Socket = io(url, {
    transports: ["websocket", "polling"],
    timeout: SOCKET_TIMEOUT_MS,
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connection timeout")), SOCKET_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Socket connect_error: ${err.message}`));
    });
  });

  const auth = getAuth();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Login timeout")), SOCKET_TIMEOUT_MS);
    const cb = (res: SocketResponse) => {
      clearTimeout(timer);
      if (res?.ok) resolve();
      else reject(new Error(res?.msg || "Login failed — check credentials"));
    };
    if (auth.type === "token") {
      socket.emit("loginByToken", auth.token, cb);
    } else {
      const totp = process.env.UPTIME_KUMA_TOTP;
      socket.emit("login", { username: auth.username, password: auth.password, token: totp || "" }, cb);
    }
  });

  return socket;
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

async function withSocket<T>(fn: (socket: Socket) => Promise<T>): Promise<T> {
  const socket = await createAuthenticatedSocket();
  try {
    return await fn(socket);
  } finally {
    try {
      socket.disconnect();
    } catch {}
  }
}

// ---------- High-level API wrappers ----------

export async function listMonitors(): Promise<Record<string, UptimeKumaMonitor>> {
  return withSocket(async (socket) => {
    // Uptime Kuma pushes monitorList via event, but also supports getMonitorList callback in newer versions
    // Try explicit callback first
    try {
      const res = await emitWithCallback<Record<string, UptimeKumaMonitor>>(socket, "getMonitorList");
      if (res.ok && res.data) return res.data as unknown as Record<string, UptimeKumaMonitor>;
      // fallback shape: res is the list itself when using callback-less emit
    } catch {}

    // Fallback: listen for monitorList event (pushed after login)
    return await new Promise<Record<string, UptimeKumaMonitor>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for monitorList event")), SOCKET_TIMEOUT_MS);
      const handler = (data: Record<string, UptimeKumaMonitor>) => {
        clearTimeout(timer);
        socket.off("monitorList", handler);
        resolve(data);
      };
      socket.on("monitorList", handler);
      // Trigger a refresh by emitting getMonitorList without callback — server will push event
      (socket.emit as unknown as (...a: unknown[]) => void)("getMonitorList");
    });
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

export async function getMonitorStatus(monitorID: number, periodHours = 24): Promise<{ uptime: number; avgPing: number | null }> {
  // Uptime Kuma exposes uptime via getMonitorBeats + uptime event; we compute from beats or call getMonitorUptime
  return withSocket(async (socket) => {
    // Try dedicated event
    try {
      const res = await emitWithCallback<{ uptime: number; avgPing: number }>(socket, "getMonitorUptime", monitorID, periodHours);
      if (res.ok && (res.data as unknown as { uptime: number })) {
        const d = res.data as unknown as { uptime: number; avgPing: number };
        return d;
      }
    } catch {}
    // Fallback compute from beats
    const beats = await emitWithCallback<Heartbeat[]>(socket, "getMonitorBeats", monitorID, periodHours).then(
      (r) => (r.data as unknown as Heartbeat[]) || []
    );
    if (!beats.length) return { uptime: 0, avgPing: null };
    const ups = beats.filter((b) => b.status === 1).length;
    const pings = beats.filter((b) => b.ping !== null).map((b) => b.ping as number);
    return {
      uptime: ups / beats.length,
      avgPing: pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : null,
    };
  });
}

export async function listNotifications(): Promise<unknown[]> {
  return withSocket(async (socket) => {
    return await new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for notificationList")), SOCKET_TIMEOUT_MS);
      const handler = (data: unknown[]) => {
        clearTimeout(timer);
        socket.off("notificationList", handler);
        resolve(data);
      };
      socket.on("notificationList", handler);
      (socket.emit as unknown as (...a: unknown[]) => void)("getNotificationList");
    });
  });
}

export async function listStatusPages(): Promise<unknown[]> {
  return withSocket(async (socket) => {
    return await new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for statusPageList")), SOCKET_TIMEOUT_MS);
      const handler = (data: unknown[]) => {
        clearTimeout(timer);
        socket.off("statusPageList", handler);
        resolve(data);
      };
      socket.on("statusPageList", handler);
      (socket.emit as unknown as (...a: unknown[]) => void)("getStatusPageList");
    });
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
