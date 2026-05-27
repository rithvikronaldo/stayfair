"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { useActionDialog, type ActionMode } from "@/lib/action-dialog";
import { api, API_URL, SUPPORTED_CURRENCIES } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { useCodeMode } from "@/lib/code-mode";
import { DUR, EASE } from "@/lib/motion";
import { useStore } from "@/lib/store";

// ActionDialog is the no-curl path for spawning an account and posting a
// transaction (guided-flow Stage 4: "all via in-app forms, no curl required").
// When code mode is ON it also renders the live curl for the current form
// values — the teaching layer, shown at the exact point of action.

const TABS: { mode: ActionMode; label: string }[] = [
  { mode: "post", label: "Post transaction" },
  { mode: "spawn", label: "Spawn account" },
];

export function ActionDialog() {
  const open = useActionDialog((s) => s.open);
  const mode = useActionDialog((s) => s.mode);
  const setMode = useActionDialog((s) => s.openDialog);
  const close = useActionDialog((s) => s.close);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="action-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.ui, ease: EASE.outQuart }}
          onClick={close}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[10vh] backdrop-blur-sm"
        >
          <motion.div
            key="action-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
            onClick={(e) => e.stopPropagation()}
            className="w-[560px] max-w-full overflow-hidden rounded-md border border-border bg-surface-1 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-2">
              <div className="flex">
                {TABS.map((t) => (
                  <button
                    key={t.mode}
                    type="button"
                    onClick={() => setMode(t.mode)}
                    className={`num px-3 py-2.5 text-[11px] uppercase tracking-[0.14em] transition-colors ${
                      mode === t.mode
                        ? "text-accent"
                        : "text-dim hover:text-muted"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="flex h-6 w-6 items-center justify-center border border-border text-[14px] leading-none text-muted hover:text-fg"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {mode === "post" ? (
                <PostForm onDone={close} />
              ) : (
                <SpawnForm onDone={close} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CurlPreview({ body }: { body: string }) {
  const on = useCodeMode((s) => s.on);
  if (!on) return null;
  return (
    <div className="mt-4 rounded-sm border border-border-2 bg-surface-2/40 p-3">
      <div className="num mb-1.5 text-[10px] uppercase tracking-[0.14em] text-dim">
        same call over the wire
      </div>
      <pre className="num overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-fg">
        {body}
      </pre>
    </div>
  );
}

const fieldCls =
  "w-full rounded-sm border border-border-2 bg-surface-2/40 px-2.5 py-2 text-sm text-fg outline-none focus:border-border";
const labelCls = "mb-1 block text-xs text-muted";

function SpawnForm({ onDone }: { onDone: () => void }) {
  const apiKey = useApiKey((s) => s.apiKey);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [busy, setBusy] = useState(false);

  const curl = `curl -X POST ${API_URL}/agents \\
  -H "Authorization: Bearer ${apiKey ?? "<your_api_key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "${name || "my-account"}", "currency": "${currency}"}'`;

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const agent = await api.spawnAgent({ name: name.trim(), currency });
      useStore.getState().applyAgentSpawned(agent);
      toast.success("Account spawned", { description: `${agent.name} · ${currency}` });
      onDone();
    } catch (err) {
      toast.error("spawn failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className={labelCls} htmlFor="spawn-name">
        Account name
      </label>
      <input
        id="spawn-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="payouts-eu"
        className={fieldCls}
      />

      <label className={`${labelCls} mt-3`} htmlFor="spawn-ccy">
        Currency
      </label>
      <select
        id="spawn-ccy"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className={fieldCls}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <CurlPreview body={curl} />

      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="num mt-4 w-full border border-accent bg-accent py-2 text-[11px] uppercase tracking-[0.14em] text-bg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "spawning…" : "Spawn account"}
      </button>
    </form>
  );
}

function PostForm({ onDone }: { onDone: () => void }) {
  const apiKey = useApiKey((s) => s.apiKey);
  const agents = useStore((s) => s.agents);
  const options = useMemo(
    () => agents.filter((a) => a.status !== "killed"),
    [agents],
  );

  const prefillDest = useActionDialog((s) => s.prefillDest);
  const clearPrefill = useActionDialog((s) => s.clearPrefill);

  const [source, setSource] = useState("");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // Default the selects to the first two distinct accounts when they load.
  useEffect(() => {
    if (!source && options[0]) setSource(options[0].accountCode);
    if (!dest && options[1]) setDest(options[1].accountCode);
  }, [options, source, dest]);

  // "Fund this account" shortcut: pre-select the empty account as the
  // destination and auto-pick a funded, same-currency source so the transfer
  // is one amount-and-go away. Runs after the default-fill effect (defined
  // above) so it wins, then clears the prefill so it doesn't re-fire.
  useEffect(() => {
    if (!prefillDest) return;
    const target = options.find((a) => a.accountCode === prefillDest);
    if (!target) return;
    setDest(prefillDest);
    const funded =
      options.find(
        (a) =>
          a.accountCode !== prefillDest &&
          a.currency === target.currency &&
          a.balance > 0,
      ) ??
      options.find(
        (a) => a.accountCode !== prefillDest && a.currency === target.currency,
      );
    if (funded) setSource(funded.accountCode);
    clearPrefill();
  }, [prefillDest, options, clearPrefill]);

  const sourceAgent = options.find((a) => a.accountCode === source);
  const destAgent = options.find((a) => a.accountCode === dest);
  const currency = sourceAgent?.currency ?? "USD";
  const amountNum = Number(amount);
  const minor = Number.isFinite(amountNum) ? Math.round(amountNum * 100) : 0;

  const ccyMismatch =
    !!sourceAgent && !!destAgent && sourceAgent.currency !== destAgent.currency;
  const sameAccount = !!source && source === dest;
  const valid =
    !!source && !!dest && !sameAccount && !ccyMismatch && minor > 0;

  const curl = `curl -X POST ${API_URL}/transactions \\
  -H "Authorization: Bearer ${apiKey ?? "<your_api_key>"}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    description: description || "in-app transfer",
    entries: [
      { account: source || "<source>", amount: minor, currency, direction: "out" },
      { account: dest || "<dest>", amount: minor, currency, direction: "in" },
    ],
  })}'`;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const desc = description || "in-app transfer";
      const occurredAt = new Date().toISOString();
      const entries = [
        { account: source, amount: minor, currency, direction: "out" as const },
        { account: dest, amount: minor, currency, direction: "in" as const },
      ];
      const res = await api.postTransaction({
        description: desc,
        occurred_at: occurredAt,
        entries,
      });
      // POST /transactions returns { transaction_id, ... } and omits the
      // description, so we rebuild the canonical PostedTransaction the store
      // expects from what we already know plus the server-assigned id.
      useStore.getState().applyPostedTransaction({
        id: res.transaction_id,
        description: desc,
        occurred_at: res.occurred_at ?? occurredAt,
        created_at: res.created_at ?? occurredAt,
        entries: res.entries,
      });
      toast.success("Transaction posted", {
        description: `${(minor / 100).toFixed(2)} ${currency} · ${sourceAgent?.name} → ${destAgent?.name}`,
      });
      onDone();
    } catch (err) {
      toast.error("post failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  if (options.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        You need at least two accounts to post a transfer. Spawn one first.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="post-source">
            From
          </label>
          <select
            id="post-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={fieldCls}
          >
            {options.map((a) => (
              <option key={a.accountCode} value={a.accountCode}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="post-dest">
            To
          </label>
          <select
            id="post-dest"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className={fieldCls}
          >
            {options.map((a) => (
              <option key={a.accountCode} value={a.accountCode}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className={`${labelCls} mt-3`} htmlFor="post-amount">
        Amount ({currency})
      </label>
      <input
        id="post-amount"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="100.00"
        className={fieldCls}
      />

      <label className={`${labelCls} mt-3`} htmlFor="post-desc">
        Description (optional)
      </label>
      <input
        id="post-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="vendor payout"
        className={fieldCls}
      />

      {sameAccount && (
        <p className="mt-2 text-xs text-amber-400">Source and destination must differ.</p>
      )}
      {ccyMismatch && (
        <p className="mt-2 text-xs text-amber-400">
          Both accounts must share a currency (no FX in a single transaction).
        </p>
      )}

      <CurlPreview body={curl} />

      <button
        type="submit"
        disabled={!valid || busy}
        className="num mt-4 w-full border border-accent bg-accent py-2 text-[11px] uppercase tracking-[0.14em] text-bg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "posting…" : "Post transaction"}
      </button>
    </form>
  );
}
