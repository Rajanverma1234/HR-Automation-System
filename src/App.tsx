import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; message: string };

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `HTTP ${res.status}`;
          throw new Error(message);
        }
        setHealth({ status: "ok" });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">HR Screening Agent</h1>
      </header>
      <main className="px-6 py-4">
        <p className="text-sm">
          {health.status === "loading" && <span className="text-slate-500">Checking API…</span>}
          {health.status === "ok" && <span className="text-green-700">API OK</span>}
          {health.status === "error" && <span className="text-red-700">API error: {health.message}</span>}
        </p>
      </main>
    </div>
  );
}
