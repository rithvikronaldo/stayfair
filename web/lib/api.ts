import { useApiKey } from "@/lib/api-key";

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
  // Send the user's API key as Bearer when they've signed in. Absent header
  // → backend middleware resolves to the demo tenant (existing public
  // dashboard behaviour).
  const apiKey = useApiKey.getState().apiKey;
  const authHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
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

// POST /transactions returns a different shape than GET: it keys the id as
// `transaction_id` and omits `description`/`id`. (GET /transactions and the
// capture endpoint return the canonical PostedTransaction above.) Keep this
// accurate so callers don't silently read undefined fields.
export type PostTransactionResponse = {
  transaction_id: string;
  status: string;
  occurred_at: string;
  created_at: string;
  entries: PostedEntry[];
};

export type TransactionListPage = {
  transactions: PostedTransaction[];
  next_cursor?: string;
};

export type Tenant = {
  id: string;
  email: string;
  name: string;
  created_at: string;
};

export type SignupResponse = {
  tenant: Tenant;
  api_key: string;
  // false when the email already existed and the backend rotated the key
  // on the existing tenant; true on a fresh signup.
  created: boolean;
  api_key_warning: string;
};

export type StressResult = {
  n_posted: number;
  elapsed_ms: number;
  tps_peak: number;
  p99_commit_ms: number;
  p50_commit_ms: number;
  invariant_violations: number;
  serialization_retries: number;
  currency: string;
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
  listAuthorizations: (opts?: { status?: Authorization["status"]; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    const q = qs.toString();
    return request<{ authorizations: Authorization[] }>(
      `/authorizations${q ? `?${q}` : ""}`,
    ).then((r) => r.authorizations);
  },
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
    request<PostTransactionResponse>("/transactions", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(input),
    }),
  listTransactions: (opts?: {
    from?: string;
    to?: string;
    account?: string;
    limit?: number;
    cursor?: string;
  }) => {
    const qs = new URLSearchParams();
    if (opts?.from) qs.set("from", opts.from);
    if (opts?.to) qs.set("to", opts.to);
    if (opts?.account) qs.set("account", opts.account);
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.cursor) qs.set("cursor", opts.cursor);
    const q = qs.toString();
    return request<TransactionListPage>(`/transactions${q ? `?${q}` : ""}`);
  },
  signupTenant: (input: { email: string; name: string }) =>
    request<SignupResponse>("/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getMe: () => request<Tenant>("/tenants/me"),
  stress: (n: number, concurrency?: number) =>
    request<StressResult>("/stress", {
      method: "POST",
      body: JSON.stringify(
        concurrency && concurrency > 1 ? { n, concurrency } : { n },
      ),
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
