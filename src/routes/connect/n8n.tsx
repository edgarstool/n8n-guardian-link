import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteShell } from "@/components/site/SiteShell";
import { ERROR_CATEGORIES, type ErrorCategory } from "@/lib/n8n/errors";
import {
  createN8nApiKey,
  disconnectN8n,
  getN8nConnectionStatus,
  listN8nApiKeys,
  listN8nMcpTools,
  revokeN8nApiKey,
  saveN8nMcpUrl,
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
  invalid_mcp_url: "n8n Instance MCP URL 無效或無法連線。",
  discovery_failed: "無法探索 n8n OAuth 中繼資料。請確認 Instance MCP URL。",
  token_exchange_failed: "與 n8n 交換權杖失敗。",
  mcp_initialize_failed: "MCP initialize 呼叫失敗。",
  mcp_initialized_notification_failed: "MCP initialized 通知未被接受。",
  mcp_tools_list_failed: "MCP tools/list 呼叫失敗。",
  needs_reauth: "工作階段已失效，請重新授權。",
  missing_configuration: "尚未儲存 Instance MCP URL，請先於下方輸入並儲存。",
  mcp_tools_call_failed: "MCP tools/call 呼叫失敗。",
  unauthorized: "缺少或無效的 API 金鑰。",
  invalid_request: "請求格式錯誤。",
};

function categoryLabel(code: ErrorCategory): string {
  return `${REASON_ZH[code]} (${code})`;
}

function isCategory(v: string | undefined): v is ErrorCategory {
  return !!v && (ERROR_CATEGORIES as readonly string[]).includes(v);
}

function ConnectPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const start = useServerFn(startN8nOAuth);
  const disconnect = useServerFn(disconnectN8n);
  const listTools = useServerFn(listN8nMcpTools);
  const getStatus = useServerFn(getN8nConnectionStatus);
  const saveUrl = useServerFn(saveN8nMcpUrl);
  const listKeys = useServerFn(listN8nApiKeys);
  const createKey = useServerFn(createN8nApiKey);
  const revokeKey = useServerFn(revokeN8nApiKey);

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

  const [mcpInput, setMcpInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (statusQuery.data?.mcpUrl && !mcpInput) setMcpInput(statusQuery.data.mcpUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data?.mcpUrl]);

  const saveMutation = useMutation({
    mutationFn: (mcpUrl: string) => saveUrl({ data: { mcpUrl } }),
    onSuccess: (data) => {
      if (!data.ok) {
        const map: Record<string, string> = {
          invalid_url: "網址格式不正確，請貼上完整的 Instance Server URL。",
          https_required: "正式環境必須使用 HTTPS。",
          invalid_mcp_url:
            "這個 n8n Instance MCP URL 無法連線或回傳 404。請回 n8n → Settings → Instance-level MCP → Connection details → OAuth 重新複製 Instance Server URL。",
          missing_configuration: "伺服器儲存服務尚未就緒，請稍後重試。",
        };
        setSaveError(map[data.error] ?? "儲存失敗");
        return;
      }
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["n8n-connection"] });
    },
    onError: () => setSaveError("儲存失敗，請稍後重試。"),
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

  const status = statusQuery.data;
  const connected = status?.connected;
  const storage = status?.storage;
  const configured = status && "configured" in status ? status.configured : true;
  const savedMcpUrl = status?.mcpUrl;
  const callbackUrl = status?.callbackUrl ?? "";
  const canStart = Boolean(savedMcpUrl) && configured !== false;

  async function copyCallback() {
    if (!callbackUrl) return;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

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
            步驟 1｜取得 Instance MCP URL
          </h2>
          <p className="mt-2 text-sm text-white/70">
            前往 n8n → Settings → Instance-level MCP → Connection details → OAuth，
            將「完整的 Instance Server URL」原封不動複製過來（路徑與結尾斜線都保留）。
          </p>
          <p className="mt-2 text-xs text-amber-300/90">
            若 Lovable Connectors 顯示 Connection failed，通常代表此 URL 本身無效或 n8n workspace
            未啟用 Instance-level MCP；請以 n8n 畫面最新產生的 OAuth URL 為準。
          </p>
          <p className="mt-2 text-xs text-white/50">
            In n8n → Settings → Instance-level MCP → Connection details → OAuth, copy the exact
            Instance Server URL — do not modify its path or trailing slash.
          </p>

          <label className="mt-4 block text-xs font-medium text-white/70">
            Instance Server URL
          </label>
          <input
            type="url"
            value={mcpInput}
            onChange={(e) => setMcpInput(e.target.value)}
            placeholder="https://your-instance.n8n.cloud/mcp-server/http"
            className="mt-1 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm font-mono text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => saveMutation.mutate(mcpInput)}
              disabled={saveMutation.isPending || !mcpInput.trim()}
              className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
            >
              {saveMutation.isPending ? "儲存中…" : "儲存 MCP URL"}
            </button>
            {savedMcpUrl && (
              <span className="text-xs text-emerald-400">已儲存 / Saved</span>
            )}
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </section>

        {savedMcpUrl && (
          <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-lg font-medium text-white">
              步驟 2｜將此 Callback URL 加入 n8n
            </h2>
            <p className="mt-2 text-sm text-white/70">
              請在 n8n Instance-level MCP 的 OAuth 設定中，將以下 Callback URL 加入
              「Allowed OAuth Redirect URLs」清單。
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
                {callbackUrl}
              </code>
              <button
                onClick={copyCallback}
                className="rounded-md border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15"
              >
                {copied ? "已複製" : "複製"}
              </button>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-medium text-white">
            步驟 3｜開始授權 / Connection status
          </h2>
          <div className="mt-3 text-sm text-white/70">
            {statusQuery.isLoading && <p>載入中… / Loading…</p>}
            {status && !status.connected && configured && !savedMcpUrl && (
              <p>請先於步驟 1 儲存 Instance MCP URL。</p>
            )}
            {status && !status.connected && configured && savedMcpUrl && (
              <p>尚未連接 / Not connected</p>
            )}
            {status && !configured && (
              <p className="text-red-400">
                伺服器儲存尚未就緒 / Server-side storage is not ready (missing_configuration)
              </p>
            )}
            {status && status.connected === true && (
              <div className="space-y-1">
                <p>
                  已連接至 / Connected to:{" "}
                  <span className="font-mono text-white">{status.issuer}</span>
                </p>
                {status.negotiatedProtocolVersion && (
                  <p>
                    協定版本 / Protocol:{" "}
                    <span className="font-mono">{status.negotiatedProtocolVersion}</span>
                  </p>
                )}
                {status.needsReauth && (
                  <p className="text-amber-400">需要重新授權 / Reauthorization required</p>
                )}
              </div>
            )}
            {storage && (
              <p className="mt-3 text-xs text-white/50">
                儲存後端 / Storage: <span className="font-mono">{storage}</span>
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !canStart}
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

        {connected && (
          <ApiKeysPanel
            listKeys={listKeys}
            createKey={createKey}
            revokeKey={revokeKey}
          />
        )}
      </main>
    </SiteShell>
  );
}

type ApiKeysPanelProps = {
  listKeys: () => Promise<Awaited<ReturnType<typeof listN8nApiKeys>>>;
  createKey: (opts: { data: { label?: string } }) => Promise<Awaited<ReturnType<typeof createN8nApiKey>>>;
  revokeKey: (opts: { data: { id: string } }) => Promise<{ ok: boolean }>;
};

function ApiKeysPanel({ listKeys, createKey, revokeKey }: ApiKeysPanelProps) {
  const qc = useQueryClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const apiBase = origin;
  const openapiUrl = `${origin}/openapi.json`;
  const toolsUrl = `${origin}/api/n8n/tools`;
  const callUrl = `${origin}/api/n8n/call`;

  const keysQuery = useQuery({
    queryKey: ["n8n-api-keys"],
    queryFn: () => listKeys(),
  });

  const [label, setLabel] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (l: string) => createKey({ data: { label: l } }),
    onSuccess: (r) => {
      if (r.ok) {
        setNewSecret(r.secret);
        setLabel("");
        qc.invalidateQueries({ queryKey: ["n8n-api-keys"] });
      }
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeKey({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["n8n-api-keys"] }),
  });

  const placeholder = "YOUR_API_KEY";
  const displaySecret = newSecret ?? placeholder;
  const curlTools = `curl -H "Authorization: Bearer ${displaySecret}" ${toolsUrl}`;
  const curlCall = `curl -X POST ${callUrl} \\\n  -H "Authorization: Bearer ${displaySecret}" \\\n  -H "content-type: application/json" \\\n  -d '{"name":"<tool-name>","arguments":{}}'`;

  const keys = keysQuery.data?.ok ? keysQuery.data.keys : [];

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
      <h2 className="text-lg font-medium text-white">
        HTTP / OpenAPI 介接 / HTTP adapter
      </h2>
      <p className="mt-1 text-xs text-white/60">
        瀏覽器代理與 ECS 可透過個人 API 金鑰以 HTTP Bearer 呼叫同一組 n8n 工具。
      </p>

      <dl className="mt-4 grid gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="w-28 text-white/50">API base</dt>
          <dd className="flex-1 truncate font-mono text-white">{apiBase}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="w-28 text-white/50">OpenAPI</dt>
          <dd className="flex-1 truncate font-mono text-white">
            <a href={openapiUrl} className="underline hover:text-emerald-300" target="_blank" rel="noreferrer">
              {openapiUrl}
            </a>
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="w-28 text-white/50">GET tools</dt>
          <dd className="flex-1 truncate font-mono text-white">{toolsUrl}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="w-28 text-white/50">POST call</dt>
          <dd className="flex-1 truncate font-mono text-white">{callUrl}</dd>
        </div>
      </dl>

      <div className="mt-6">
        <h3 className="text-sm font-medium text-white">個人 API 金鑰 / Personal keys</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="標籤（選填） / Label (optional)"
            className="min-w-[220px] flex-1 rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
          <button
            onClick={() => createMutation.mutate(label)}
            disabled={createMutation.isPending}
            className="rounded-md border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
          >
            {createMutation.isPending ? "建立中…" : "建立金鑰 / Create key"}
          </button>
        </div>

        {newSecret && (
          <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className="text-xs font-semibold text-emerald-300">
              金鑰僅顯示一次，請立即複製保存 / Copy this key now — it will not be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-black/50 px-2 py-1 text-xs text-white">
                {newSecret}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(newSecret)}
                className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/15"
              >
                複製 / Copy
              </button>
              <button
                onClick={() => setNewSecret(null)}
                className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                我已複製 / Done
              </button>
            </div>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {keys.length === 0 && (
            <li className="text-xs text-white/50">尚未建立任何 API 金鑰。</li>
          )}
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs"
            >
              <div className="flex-1">
                <div className="font-mono text-white">{k.prefix}…</div>
                <div className="text-white/50">
                  {k.label ?? "未命名"} · 建立於 {new Date(k.created_at).toLocaleString()}
                  {k.revoked_at ? " · 已撤銷" : ""}
                </div>
              </div>
              {!k.revoked_at && (
                <button
                  onClick={() => revokeMutation.mutate(k.id)}
                  disabled={revokeMutation.isPending}
                  className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/20"
                >
                  撤銷 / Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-medium text-white">範例請求 / Example requests</h3>
        <pre className="mt-2 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-white/90">
{curlTools}
        </pre>
        <pre className="mt-2 overflow-x-auto rounded-md border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-white/90">
{curlCall}
        </pre>
      </div>
    </section>
  );
}
