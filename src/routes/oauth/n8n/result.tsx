import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";
import { StatusPanel } from "@/components/site/StatusPanel";
import { isErrorCategory } from "@/lib/n8n/errors";

type Status = "success" | "error" | "cancelled";

export const Route = createFileRoute("/oauth/n8n/result")({
  validateSearch: (s: Record<string, unknown>) => {
    const status: Status =
      s.status === "success" || s.status === "cancelled" ? s.status : "error";
    const reason =
      typeof s.reason === "string" && isErrorCategory(s.reason) ? s.reason : undefined;
    return {
      status,
      tools: typeof s.tools === "string" ? s.tools : undefined,
      protocol: typeof s.protocol === "string" ? s.protocol : undefined,
      reason,
    };
  },
  head: () => ({
    meta: [
      { title: "n8n 授權結果｜EDGAR'S Tools" },
      { name: "description", content: "n8n MCP OAuth 授權完成頁面" },
    ],
  }),
  component: ResultPage,
});

function ResultPage() {
  const { status, tools, protocol, reason } = Route.useSearch();
  return (
    <SiteShell>
      <main className="mx-auto flex max-w-3xl flex-col items-stretch px-6 py-16">
        <StatusPanel status={status} tools={tools} protocol={protocol} reason={reason} />
        <div className="mt-8 flex flex-wrap gap-3">
          {status !== "success" && (
            <Link
              to="/connect/n8n"
              className="rounded-md bg-[oklch(0.7_0.15_60)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.8_0.15_60)]"
            >
              重新嘗試 / Retry
            </Link>
          )}
          <Link
            to="/"
            className="rounded-md border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/90 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
          >
            返回首頁 / Return home
          </Link>
        </div>
      </main>
    </SiteShell>
  );
}
