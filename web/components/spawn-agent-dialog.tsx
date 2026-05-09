"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { z } from "zod";

import { api, ApiError, SUPPORTED_CURRENCIES, type Agent } from "@/lib/api";
import { DUR, EASE } from "@/lib/motion";

const schema = z.object({
  name: z
    .string()
    .min(2, "name must be at least 2 chars")
    .max(40, "name must be ≤ 40 chars")
    .regex(/^[a-z0-9_-]+$/i, "letters, digits, _ or - only"),
  currency: z.enum(SUPPORTED_CURRENCIES),
});

type FormData = z.infer<typeof schema>;

export function SpawnAgentDialog({
  onSpawned,
}: {
  onSpawned?: (agent: Agent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { currency: "USD" },
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const agent = await api.spawnAgent(data);
      onSpawned?.(agent);
      reset();
      setOpen(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "spawn failed";
      setServerError(msg);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="flex h-8 w-full items-center justify-center border border-accent/40 bg-accent/10 text-[11px] uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent/20">
          + spawn agent
        </button>
      </Dialog.Trigger>

      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.ui, ease: EASE.outQuart }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 border border-border bg-surface-1 p-6"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
              >
                <Dialog.Title className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  spawn agent
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-[12px] text-muted">
                  Creates the agent and its primary asset account.
                </Dialog.Description>

                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className="mt-5 flex flex-col gap-4"
                >
                  <Field
                    label="name"
                    error={errors.name?.message}
                    htmlFor="agent-name"
                  >
                    <input
                      id="agent-name"
                      autoFocus
                      autoComplete="off"
                      placeholder="researcher"
                      className="h-9 border border-border bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent"
                      {...register("name")}
                    />
                  </Field>

                  <Field
                    label="currency"
                    error={errors.currency?.message}
                    htmlFor="agent-currency"
                  >
                    <select
                      id="agent-currency"
                      className="num h-9 border border-border bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent"
                      {...register("currency")}
                    >
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {serverError && (
                    <div className="border border-red/40 bg-red/10 px-3 py-2 text-[12px] text-red">
                      {serverError}
                    </div>
                  )}

                  <div className="mt-2 flex gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="h-9 flex-1 border border-border text-[12px] uppercase tracking-[0.14em] text-muted hover:text-fg"
                      >
                        cancel
                      </button>
                    </Dialog.Close>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-9 flex-1 border border-accent bg-accent text-[12px] uppercase tracking-[0.14em] text-bg disabled:opacity-50"
                    >
                      {isSubmitting ? "spawning…" : "spawn"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[10px] uppercase tracking-[0.14em] text-muted"
      >
        {label}
      </label>
      {children}
      {error && <span className="text-[11px] text-red">{error}</span>}
    </div>
  );
}
