"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/useAdminAuth";

type Usage = {
  ready: boolean;
  totals: { calls: number; failures: number; chars: number; audioSeconds: number; hits: number };
  calls: { id: string; at: string; api: string; purpose: string; ref: string; chars: number | null; seconds: number | null; ok: boolean; httpStatus: number; ms: number; detail: string }[];
};
const API_NAME: Record<string, string> = { translate: "Text → text (English → Swahili)", speak: "Text → speech (Swahili)", voices: "Voices (Swahili)", transcribe: "Speech → text (Swahili)", translate_speech: "Speech translation" };

// Kiswahili with NKENNEAi: every call we made, how big it was, and how often a reader was served from what was kept
// (which costs no tokens). NKENNEAi's own dashboard shows the token balance; this is our side of it.
export default function AdminNkennePage() {
  const { user, loading } = useAdminAuth();
  const [u, setU] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/admin/nkenne", { headers: { Authorization: `Bearer ${await user!.getIdToken()}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Something went wrong");
      setU(j);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
  }, [user]);
  useEffect(() => { if (user) void load(); }, [user, load]);
  if (loading || !user) return <div className="px-6 py-24 text-center text-slate">Loading…</div>;

  const t = u?.totals;
  const kpi = (n: string | number, label: string) => <div className="card p-4"><p className="font-display text-3xl text-ink">{typeof n === "number" ? n.toLocaleString("en-NG") : n}</p><p className="text-xs text-slate">{label}</p></div>;
  return (
    <section className="mx-auto max-w-5xl px-4 py-14">
      <p className="eyebrow text-crimson">Admin · NKENNEAi</p>
      <h1 className="mt-1 font-display text-4xl">Kiswahili usage</h1>
      <p className="mt-2 text-sm text-slate">
        Journals their authors offer in Kiswahili are translated, and their audio made, the first time a reader asks, then kept; voice notes are
        translated when someone taps and kept on the message. {u && (u.ready ? "NKENNE_API_KEY is set." : "NKENNE_API_KEY isn't set, so the Kiswahili buttons don't show.")} The token balance is on NKENNEAi&apos;s own dashboard.
      </p>
      {error && <p className="mt-4 text-sm text-crimson">{error}</p>}
      {t && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {kpi(t.calls, "calls to NKENNEAi")}
          {kpi(t.hits, "served from what we kept (no tokens)")}
          {kpi(t.chars, "characters translated or read")}
          {kpi(`${Math.floor(t.audioSeconds / 60)}:${String(t.audioSeconds % 60).padStart(2, "0")}`, "of voice notes sent")}
          {kpi(t.failures, "failed calls")}
        </div>
      )}
      <h2 className="mt-10 font-display text-2xl">Latest calls</h2>
      {u && (u.calls.length === 0 ? <p className="mt-3 text-sm text-slate">No calls yet.</p> : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-rule bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead><tr className="border-b border-rule font-mono text-[11px] uppercase tracking-eyebrow text-slate"><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">API</th><th className="px-4 py-2.5">For</th><th className="px-4 py-2.5">Size</th><th className="px-4 py-2.5">Result</th></tr></thead>
            <tbody>
              {u.calls.map((c) => (
                <tr key={c.id} className="border-b border-rule last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate">{new Date(c.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</td>
                  <td className="px-4 py-2.5">{API_NAME[c.api] ?? c.api}</td>
                  <td className="px-4 py-2.5">{c.purpose}<span className="block font-mono text-[11px] text-slate">{c.ref}</span></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate">{c.chars ? `${c.chars.toLocaleString("en-NG")} characters` : c.seconds ? `${c.seconds}s of audio` : "—"}</td>
                  <td className="px-4 py-2.5">{c.ok ? <span className="font-semibold text-emerald-800">{c.httpStatus} · kept · {c.ms} ms</span> : <span className="font-semibold text-crimson">{c.httpStatus || "no answer"}{c.detail ? ` · ${c.detail.slice(0, 120)}` : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
