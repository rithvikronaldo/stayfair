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

export type Authorization = {
  id: string;
  source_account: string;
  dest_account: string;
  amount: number;
  currency: string;
  status: "pending" | "captured" | "voided" | "expired";
  description: string;
  created_at: string;
  expires_at: string;
};

export type PostedEntry = {
  id: string;
  account: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
};

export type PostedTransaction = {
  id: string;
  description: string;
  occurred_at: string;
  created_at: string;
  entries: PostedEntry[];
};

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
  authorize: (input: {
    source: string;
    dest: string;
    amount: number;
    currency: string;
    description?: string;
  }) =>
    request<Authorization>("/authorizations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  capture: (id: string, amount: number) =>
    request<{ authorization_id: string; transaction: PostedTransaction }>(
      `/authorizations/${encodeURIComponent(id)}/capture`,
      { method: "POST", body: JSON.stringify({ amount }) },
    ),
  voidAuth: (id: string) =>
    request<{ authorization_id: string; status: string }>(
      `/authorizations/${encodeURIComponent(id)}/void`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  postTransaction: (input: {
    description: string;
    occurred_at: string;
    entries: { account: string; amount: number; currency: string; direction: "in" | "out" }[];
  }, idempotencyKey?: string) =>
    request<PostedTransaction>("/transactions", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(input),
    }),
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
