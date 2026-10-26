export interface UptimeKumaMonitor {
  id: number;
  name: string;
  type: string;
  url?: string;
  hostname?: string;
  port?: number;
  keyword?: string;
  interval: number;
  retryInterval?: number;
  maxretries?: number;
  active: boolean;
  status?: number;
  tags?: Array<{ id: number; name: string; color: string }>;
  notificationIDList?: Record<string, boolean>;
  accepted_statuscodes?: string[];
  dns_resolve_server?: string;
  dns_resolve_type?: string;
  description?: string;
}

export interface Heartbeat {
  id: number;
  monitorID: number;
  status: number; // 0=down, 1=up, 2=pending, 3=maintenance
  time: string;
  msg: string;
  ping: number | null;
  duration?: number;
}

export interface Notification {
  id: number;
  name: string;
  type: string;
  active: boolean;
  isDefault?: boolean;
}

export interface StatusPage {
  id: number;
  slug: string;
  title: string;
  description?: string;
  published: boolean;
}

// Socket callback shape
export interface SocketResponse<T = unknown> {
  ok: boolean;
  tokenRequired?: boolean;
  token?: string;
  msg?: string;
  msgi18n?: boolean;
  monitorID?: number;
  monitor?: UptimeKumaMonitor;
  data?: T;
}
