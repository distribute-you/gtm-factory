"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon, EnvelopeSimpleIcon, LinkedinLogoIcon, PlugIcon, TelegramLogoIcon, WhatsappLogoIcon, AddressBookIcon } from "@phosphor-icons/react";
import type { ApiConnectAttempt, ApiConnectChannel, ApiConnectField } from "@gtm-factory/core";
import { Drawer } from "./ui";
import { apiGet, apiSend } from "@/lib/api/client";

const ICON: Record<string, React.ReactNode> = {
  gmail: <EnvelopeSimpleIcon size={18} weight="duotone" />,
  imap: <EnvelopeSimpleIcon size={18} weight="duotone" />,
  whatsapp: <WhatsappLogoIcon size={18} weight="duotone" />,
  telegram: <TelegramLogoIcon size={18} weight="duotone" />,
  linkedin: <LinkedinLogoIcon size={18} weight="duotone" />,
};

const METHOD_LABEL: Record<string, string> = { qr: "Scan a code", phone: "Pairing code by phone number", password: "Email and password", cookies: "Browser cookies" };

/**
 * Connect an account: pick what to connect, give it a role, then follow its own steps (a Google
 * sign-in, a code to scan on the phone, a login form). The new account is read once connected.
 */
export function ConnectDrawer({ brandId, roles, channels, onClose }: { brandId: string; roles: string[]; channels: ApiConnectChannel[]; onClose: () => void }) {
  const [picked, setPicked] = useState<ApiConnectChannel | null>(null);
  const [role, setRole] = useState(roles[roles.length - 1] ?? "");
  const [method, setMethod] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<ApiConnectAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a code is on screen, the account is asked again until it connects, fails or asks something.
  useEffect(() => {
    if (!attempt || attempt.status !== "connecting" || attempt.step?.type === "input" || attempt.step?.type === "redirect") return;
    const t = window.setInterval(async () => {
      try {
        setAttempt(await apiGet<ApiConnectAttempt>(`/accounts/${encodeURIComponent(attempt.accountId)}/connect`));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [attempt]);

  useEffect(() => {
    if (attempt?.step?.type === "redirect") window.location.href = attempt.step.url;
  }, [attempt]);

  const start = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      setAttempt(await apiSend<ApiConnectAttempt>("POST", "/accounts/connect", { brandId, channel: picked.id, role, ...(method ? { method } : {}), values }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (v: Record<string, string>) => {
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      setAttempt(await apiSend<ApiConnectAttempt>("POST", `/accounts/${encodeURIComponent(attempt.accountId)}/connect/input`, { values: v }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title="Connect an account" onClose={onClose} width={480}>
      {attempt ? (
        <AttemptView attempt={attempt} label={picked?.label ?? ""} busy={busy} onAnswer={answer} onDone={onClose} onRetry={() => setAttempt(null)} />
      ) : !picked ? (
        <ul className="space-y-1.5" data-testid="connect-channels">
          {channels.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.available}
                onClick={() => {
                  setPicked(c);
                  setMethod(c.methods?.[0] ?? "");
                  setValues({});
                }}
                className="k-inset flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left enabled:hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed"
              >
                <span className="k-fg2 mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-raised)]">{ICON[c.id] ?? (c.accountChannel === "CRM" ? <AddressBookIcon size={18} weight="duotone" /> : <PlugIcon size={18} />)}</span>
                <span className="min-w-0">
                  <span className={`block text-[14px] font-medium ${c.available ? "" : "k-fg3"}`}>{c.label}</span>
                  <span className="k-fg3 block text-[12px] leading-[17px]">{c.available ? c.blurb : c.unavailableReason}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="k-fg2 inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--bg-inset)]">{ICON[picked.id] ?? <PlugIcon size={18} />}</span>
            <span className="text-[15px] font-medium">{picked.label}</span>
            <button type="button" className="k-btn-ghost ml-auto" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
          <p className="k-fg2 text-[13px]">{picked.blurb}</p>
          <Field label="Role" help="Messages go out from the role a campaign asks for.">
            <select className="k-input w-full px-2" style={{ font: "inherit" }} value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {picked.kind === "bridge" && (picked.methods?.length ?? 0) > 1 && (
            <Field label="How to link it">
              <select className="k-input w-full px-2" style={{ font: "inherit" }} value={method} onChange={(e) => setMethod(e.target.value)}>
                {picked.methods!.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {picked.kind === "bridge" && method === "phone" && <Fields fields={[{ id: "phone", label: "Phone number", placeholder: "+33 6 12 34 56 78", help: "With its country code." }]} values={values} onChange={setValues} />}
          {picked.kind === "fields" && <Fields fields={picked.fields ?? []} values={values} onChange={setValues} />}
          <button type="button" className="k-btn-strong w-full justify-center" disabled={busy || !role} onClick={start}>
            {picked.kind === "oauth" ? `Sign in with ${picked.label === "Gmail" ? "Google" : picked.label}` : picked.kind === "bridge" ? `Link ${picked.label}` : `Connect ${picked.label}`}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-[var(--data-rose)]">{error}</p>}
    </Drawer>
  );
}

function AttemptView({ attempt, label, busy, onAnswer, onDone, onRetry }: { attempt: ApiConnectAttempt; label: string; busy: boolean; onAnswer: (v: Record<string, string>) => void; onDone: () => void; onRetry: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (attempt.status === "connected")
    return (
      <div className="space-y-3 text-center" data-testid="connect-done">
        <CheckCircleIcon size={36} weight="duotone" className="mx-auto text-[var(--run)]" />
        <p className="text-[15px] font-medium">{label} is connected</p>
        <p className="k-fg2 text-[13px]">GTM Factory reads it from now on. Nothing is sent from it until sending is switched on.</p>
        <button type="button" className="k-btn-strong" onClick={onDone}>
          Done
        </button>
      </div>
    );
  if (attempt.status === "failed" || attempt.status === "to_reconnect")
    return (
      <div className="space-y-3">
        <p className="text-[14px] font-medium">{label} is not connected</p>
        <p className="k-fg2 text-[13px]">{attempt.error ?? "The connection stopped."}</p>
        <button type="button" className="k-btn" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  const s = attempt.step;
  if (!s) return <p className="k-fg2 text-[13px]">Connecting {label}...</p>;
  if (s.type === "redirect") return <p className="k-fg2 text-[13px]">Opening the sign-in page...</p>;
  if (s.type === "qr")
    return (
      <div className="space-y-3 text-center" data-testid="connect-qr">
        <p className="text-[14px] font-medium">Scan this code with {label} on your phone</p>
        <img src={s.data} alt={`${label} code to scan`} width={240} height={240} className="mx-auto rounded-[8px] bg-white p-2" />
        <p className="k-fg3 text-[12px]">{s.instructions ?? "The code refreshes on its own until you scan it."}</p>
      </div>
    );
  if (s.type === "code")
    return (
      <div className="space-y-3 text-center">
        <p className="text-[14px] font-medium">Type this code in {label} on your phone</p>
        <p className="font-mono text-[28px] tracking-[0.2em]">{s.data}</p>
        <p className="k-fg3 text-[12px]">{s.instructions ?? `In ${label}: Linked devices, then link with a phone number.`}</p>
      </div>
    );
  return (
    <div className="space-y-4">
      {s.instructions && <p className="k-fg2 text-[13px]">{s.instructions}</p>}
      <Fields fields={s.fields} values={values} onChange={setValues} />
      <button type="button" className="k-btn-strong w-full justify-center" disabled={busy} onClick={() => onAnswer(values)}>
        Continue
      </button>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium">{label}</span>
      {children}
      {help && <span className="k-fg3 mt-1 block text-[12px]">{help}</span>}
    </label>
  );
}

function Fields({ fields, values, onChange }: { fields: ApiConnectField[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <Field key={f.id} label={f.optional ? `${f.label} (optional)` : f.label} help={f.help}>
          {f.options ? (
            <select className="k-input w-full px-2" style={{ font: "inherit" }} value={values[f.id] ?? ""} onChange={(e) => onChange({ ...values, [f.id]: e.target.value })}>
              <option value="">Pick one</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="k-input w-full px-2"
              style={{ font: "inherit" }}
              type={f.secret ? "password" : "text"}
              autoComplete={f.secret ? "new-password" : "off"}
              placeholder={f.placeholder}
              value={values[f.id] ?? ""}
              onChange={(e) => onChange({ ...values, [f.id]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}
