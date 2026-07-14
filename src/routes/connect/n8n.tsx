import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteShell } from "@/components/site/SiteShell";
import {
  disconnectN8n,
  getN8nConnectionStatus,
  listN8nMcpTools,
  startN8nOAuth,
} from "@/lib/n8n/n8n-oauth.functions";

export const Route = createFileRoute("/connect/n8n")({
  head: () => ({
    meta: [
      { title: "連接 n8n Instance MCP｜EDGAR'S Tools" },
      {
        name: "description",
        content:
          "以 OAuth 2.1 + PKCE 將您的 n8n Instance-level MCP 伺服器安全連接到 EDGAR'S Tools。",
      },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const router = useRouter();
  const start = useServerFn(startN8nOAuth);
  const disconnect = useServerFn(disconnectN8n);
  const listTools = useServerFn(listN8nMcpTools);
  const getStatus = useServerFn(getN8nConnectionStatus);

  const statusQuery = useQuery({
    queryKey: ["n8n-connection"],
    queryFn: () => getStatus(),
  });

  const toolsQuery = useQuery({
    queryKey: ["n8n-tools"],
    queryFn: () => listTools(),
    enabled: statusQuery.data?.connected === true && !statusQuery.data?.needsReauth,
  });

  const startMutation = useMutation({
    mutationFn: () => start(),
    onSuccess: (data) => {
      if (data.ok) window.location.href = data.authorizeUrl;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => router.invalidate(),
  });

  const connected = statusQuery.data?.connected;

  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          連接 n8n Instance MCP
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Connect your n8n Instance-level MCP server via OAuth 2.1 + PKCE.
        </p>

        <section className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-medium text-white">連線狀態 / Connection status</h2>
          <div className="mt-3 text-sm text-white/70">
            {statusQuery.isLoading && <p>載入中… / Loading…</p>}
            {connected === false && <p>尚未連接 / Not connected</p>}
            {connected === true && (
              <div className="space-y-1">
                <p>
                  已連接至 / Connected to:{" "}
                  <span className="font-mono text-white">{statusQuery.data.issuer}</span>
                </p>
                {statusQuery.data.negotiatedProtocolVersion && (
                  <p>
                    協定版本 / Protocol:{" "}
                    <span className="font-mono">{statusQuery.data.negotiatedProtocolVersion}</span>
                  </p>
                )}
                {statusQuery.data.needsReauth && (
                  <p className="text-amber-400">需要重新授權 / Reauthorization required</p>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="rounded-md bg-[oklch(0.7_0.15_60)] px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {startMutation.isPending
                ? "重新導向中… / Redirecting…"
                : connected
                  ? "重新授權 / Reauthorize"
                  : "開始授權 / Start authorization"}
            </button>
            {connected && (
              <button
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
                className="rounded-md border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/90 hover:bg-white/10"
              >
                中斷連線 / Disconnect
              </button>
            )}
          </div>

          {startMutation.data && !startMutation.data.ok && (
            <p className="mt-4 text-sm text-red-400">錯誤 / Error: {startMutation.data.error}</p>
          )}
        </section>

        {connected && toolsQuery.data?.ok && (
          <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-medium text-white">
              可用工具 / Available tools ({toolsQuery.data.tools.length})
            </h2>
            <p className="mt-1 text-xs text-white/50">
              MCP protocol {toolsQuery.data.protocolVersion}
            </p>
            <ul className="mt-4 space-y-2">
              {toolsQuery.data.tools.map((t) => (
                <li
                  key={t.name}
                  className="rounded-md border border-white/5 bg-black/30 px-3 py-2 text-sm"
                >
                  <div className="font-mono text-white">{t.name}</div>
                  {t.description && (
                    <div className="text-white/60">{t.description}</div>
                  )}
                </li>
              ))}
              {toolsQuery.data.tools.length === 0 && (
                <li className="text-sm text-white/60">
                  尚無工作流程開放給 MCP。請至 n8n 每個 workflow → Settings → 開啟「Available in
                  MCP」。
                </li>
              )}
            </ul>
          </section>
        )}
        {toolsQuery.data && !toolsQuery.data.ok && (
          <p className="mt-4 text-sm text-red-400">
            工具列表錯誤 / tools/list error: {toolsQuery.data.error}
          </p>
        )}
      </main>
    </SiteShell>
  );
}
