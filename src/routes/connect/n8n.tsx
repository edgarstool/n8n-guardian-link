import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteShell } from "@/components/site/SiteShell";
import { ERROR_CATEGORIES, type ErrorCategory } from "@/lib/n8n/errors";
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

const REASON_ZH: Record<ErrorCategory, string> = {
  access_denied: "已於 n8n 拒絕或取消授權。",
  missing_code_or_state: "回呼參數不完整，請重試。",
  state_expired: "授權工作階段已逾時，請重新開始。",
  state_mismatch: "偵測到狀態不一致，已中止流程。",
  missing_registration: "找不到 OAuth 用戶端註冊資料。",
  discovery_failed: "無法探索 n8n OAuth 中繼資料。請確認 Instance MCP URL。",
  token_exchange_failed: "與 n8n 交換權杖失敗。",
  mcp_initialize_failed: "MCP initialize 呼叫失敗。",
  mcp_initialized_notification_failed: "MCP initialized 通知未被接受。",
  mcp_tools_list_failed: "MCP tools/list 呼叫失敗。",
  needs_reauth: "工作階段已失效，請重新授權。",
  missing_configuration: "伺服器組態不完整，請聯絡管理員。",
};

function categoryLabel(code: ErrorCategory): string {
  return `${REASON_ZH[code]} (${code})`;
}

function isCategory(v: string | undefined): v is ErrorCategory {
  return !!v && (ERROR_CATEGORIES as readonly string[]).includes(v);
}

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
    enabled:
      statusQuery.data?.connected === true &&
      !(statusQuery.data as { needsReauth?: boolean }).needsReauth,
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
  const storage = statusQuery.data?.storage;
  const configured =
    statusQuery.data && "configured" in statusQuery.data ? statusQuery.data.configured : true;

  return (
    <SiteShell>
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          連接 n8n Instance MCP
        </h1>
        <p className="mt-2 text-sm text-white/60">
          Connect your n8n Instance-level MCP server via OAuth 2.1 + PKCE.
        </p>

        <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-medium text-white">
            取得 Instance MCP URL / Get the Instance MCP URL
          </h2>
          <p className="mt-2 text-sm text-white/70">
            請至 n8n → Settings → Instance-level MCP → Connection details → OAuth，
            將「完整的 Instance Server URL」原封不動複製過來。不要修改路徑或結尾斜線。
          </p>
          <p className="mt-2 text-sm text-white/55">
            In n8n, go to Settings → Instance-level MCP → Connection details → OAuth, and copy the
            complete Instance Server URL exactly. Do not modify its path or trailing slash.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-medium text-white">連線狀態 / Connection status</h2>
          <div className="mt-3 text-sm text-white/70">
            {statusQuery.isLoading && <p>載入中… / Loading…</p>}
            {statusQuery.data && !statusQuery.data.connected && configured && (
              <p>尚未連接 / Not connected</p>
            )}
            {statusQuery.data && !configured && (
              <p className="text-red-400">
                伺服器組態不完整 / Server-side configuration is incomplete (missing_configuration)
              </p>
            )}
            {statusQuery.data && statusQuery.data.connected === true && (
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
            {storage && (
              <p className="mt-3 text-xs text-white/50">
                儲存後端 / Storage:{" "}
                <span className="font-mono">
                  {storage === "kv"
                    ? "Cloudflare KV (OAUTH_STORE)"
                    : "in-memory (development only)"}
                </span>
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !configured}
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
            <p className="mt-4 text-sm text-red-400">
              錯誤 / Error: {categoryLabel(startMutation.data.error)}
            </p>
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
                  {t.description && <div className="text-white/60">{t.description}</div>}
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
            工具列表錯誤 / tools/list error:{" "}
            {isCategory(toolsQuery.data.error)
              ? categoryLabel(toolsQuery.data.error)
              : "mcp_tools_list_failed"}
          </p>
        )}
      </main>
    </SiteShell>
  );
}
