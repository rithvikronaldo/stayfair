export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type AgentStatus = "active" | "paused" | "killed";

export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  currency: string;
  account_code: string;
  created_at: string;
};

export type AgentSummary = Agent & { balance: number };

export type Balance = {
  account: string;
  currency: string;
  balance: number;
  available: number;
  on_hold: number;
  as_of?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      res.status,
      body.message ?? body.error ?? res.statusText,
      body.error,
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  spawnAgent: (input: { name: string; currency: string }) =>
    request<Agent>("/agents", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listAgents: () =>
    request<{ agents: AgentSummary[] }>("/agents").then((r) => r.agents),
  getBalance: (code: string, opts?: { as_of?: string; in?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.as_of) qs.set("as_of", opts.as_of);
    if (opts?.in) qs.set("in", opts.in);
    const q = qs.toString();
    return request<Balance>(
      `/accounts/${encodeURIComponent(code)}/balance${q ? `?${q}` : ""}`,
    );
  },
};

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "INR", "GBP"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function formatMinor(amount: number, currency: string): string {
  const major = amount / 100;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major) + ` ${currency}`;
}
