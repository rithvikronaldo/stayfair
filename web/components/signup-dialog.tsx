"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { z } from "zod";

import { api, ApiError } from "@/lib/api";
import { useApiKey } from "@/lib/api-key";
import { DUR, EASE } from "@/lib/motion";

const schema = z.object({
  email: z.string().email("must be a valid email"),
  name: z.string().max(60, "name must be ≤ 60 chars").optional(),
});

type FormData = z.infer<typeof schema>;

export function SignupDialog({
  open,
  onOpenChange,
  onSignedIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn?: () => void;
}) {
  const [apiKey, setApiKeyLocal] = useState<string | null>(null);
  const [keyEmail, setKeyEmail] = useState<string>("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const setApiKey = useApiKey((s) => s.set);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const resp = await api.signupTenant({
        email: data.email,
        name: data.name ?? "",
      });
      setApiKeyLocal(resp.api_key);
      setKeyEmail(resp.tenant.email);
    } catch (e) {
      if (e instanceof ApiError && e.code === "email_taken") {
        setServerError("An account with that email already exists.");
      } else if (e instanceof ApiError && e.code === "invalid_json") {
        setServerError("Please enter a valid email.");
      } else {
        setServerError("Could not create account. Try again in a moment.");
      }
    }
  };

  const handleDone = () => {
    if (apiKey) {
      setApiKey(apiKey, keyEmail);
      // The first-signup whisper — quiet, once, as the dashboard appears.
      // Sets the tone: nothing here is mocked.
      setTimeout(() => {
        toast("This is a real Postgres instance", {
          description:
            "Every action posts a real, balanced double-entry transaction — no mocks.",
          duration: 6000,
        });
      }, 700);
    }
    onOpenChange(false);
    onSignedIn?.();
    // Reset internal state so the next open starts fresh.
    setTimeout(() => {
      setApiKeyLocal(null);
      setKeyEmail("");
      setServerError(null);
      setCopied(false);
      reset();
    }, 200);
  };

  const handleCopy = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard might be unavailable; user can select+copy manually
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DUR.ui, ease: EASE.outQuart }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 border border-border bg-surface-1 p-6"
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: DUR.entrance, ease: EASE.outExpo }}
              >
                <Dialog.Title className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  {apiKey ? "your api key" : "sign up for an api key"}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-[12px] text-muted">
                  {apiKey
                    ? "Copy this now — it cannot be retrieved later."
                    : "Get a key, post your first transaction with curl."}
                </Dialog.Description>

                {!apiKey ? (
                  <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="mt-5 flex flex-col gap-4"
                  >
                    <Field
                      label="email"
                      error={errors.email?.message}
                      htmlFor="signup-email"
                    >
                      <input
                        id="signup-email"
                        type="email"
                        autoFocus
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="h-9 border border-border bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent"
                        {...register("email")}
                      />
                    </Field>

                    <Field
                      label="name (optional)"
                      error={errors.name?.message}
                      htmlFor="signup-name"
                    >
                      <input
                        id="signup-name"
                        autoComplete="off"
                        placeholder="Your name or company"
                        className="h-9 border border-border bg-bg px-3 text-[13px] text-fg outline-none focus:border-accent"
                        {...register("name")}
                      />
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
                        {isSubmitting ? "creating…" : "sign up"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-5 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                        api key
                      </span>
                      <div className="num flex items-center gap-2 border border-accent/40 bg-bg p-3 text-[12px] text-fg">
                        <code className="flex-1 break-all">{apiKey}</code>
                        <button
                          type="button"
                          onClick={handleCopy}
                          className="shrink-0 border border-accent bg-accent px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-bg"
                        >
                          {copied ? "copied" : "copy"}
                        </button>
                      </div>
                      <span className="text-[11px] text-dim">
                        Store this now — it cannot be retrieved later.
                      </span>
                    </div>

                    <div className="border border-border bg-bg p-3 text-[11px] text-muted">
                      <div className="num text-[10px] uppercase tracking-[0.12em] text-dim">
                        signed in as
                      </div>
                      <div className="num mt-1 text-[12px] text-fg">{keyEmail}</div>
                    </div>

                    <button
                      type="button"
                      onClick={handleDone}
                      className="h-9 w-full border border-accent bg-accent text-[12px] uppercase tracking-[0.14em] text-bg"
                    >
                      done
                    </button>
                  </div>
                )}
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
