import { ERROR_CATEGORIES, type ErrorCategory } from "@/lib/n8n/errors";

type Props = {
  status: "success" | "error" | "cancelled";
  tools?: string;
  protocol?: string;
  reason?: string;
};

const HEADINGS = {
  success: { zh: "授權成功", en: "Authorization complete", tone: "success" as const },
  error: {
    zh: "授權失敗",
    en: "Authorization could not be completed",
    tone: "error" as const,
  },
  cancelled: { zh: "已取消授權", en: "Authorization cancelled", tone: "warn" as const },
};

// Category → sanitized bilingual explanation. Never contains raw provider text.
const REASON_COPY: Record<ErrorCategory, { zh: string; en: string }> = {
  access_denied: {
    zh: "您在 n8n 授權頁面拒絕或取消了授權請求。",
    en: "The authorization request was denied or cancelled at n8n.",
  },
  missing_code_or_state: {
    zh: "回呼網址缺少必要的授權參數。請重新開始授權流程。",
    en: "The callback URL was missing required authorization parameters.",
  },
  state_expired: {
    zh: "本次授權工作階段已逾時，請重新開始授權。",
    en: "The authorization session expired. Please restart the flow.",
  },
  state_mismatch: {
    zh: "偵測到授權狀態不一致，為安全起見已中止流程。",
    en: "Authorization state mismatch detected; the flow was aborted for safety.",
  },
  missing_registration: {
    zh: "找不到對應的 OAuth 用戶端註冊資料。",
    en: "No matching OAuth client registration was found.",
  },
  discovery_failed: {
    zh: "無法自 n8n 探索 OAuth 中繼資料。請確認 Instance MCP URL 正確且伺服器可用。",
    en: "Failed to discover OAuth metadata from n8n. Verify the Instance MCP URL.",
  },
  token_exchange_failed: {
    zh: "與 n8n 交換存取權杖時失敗。",
    en: "Token exchange with n8n failed.",
  },
  mcp_initialize_failed: {
    zh: "MCP initialize 呼叫失敗。",
    en: "MCP initialize call failed.",
  },
  mcp_initialized_notification_failed: {
    zh: "MCP initialized 通知未被伺服器接受。",
    en: "MCP initialized notification was not accepted by the server.",
  },
  mcp_tools_list_failed: {
    zh: "MCP tools/list 呼叫失敗。",
    en: "MCP tools/list call failed.",
  },
  needs_reauth: {
    zh: "工作階段已失效，請重新授權。",
    en: "The session is no longer valid. Please reauthorize.",
  },
  missing_configuration: {
    zh: "伺服器端組態尚未完成，請聯絡管理員。",
    en: "Server-side configuration is incomplete. Please contact the administrator.",
  },
  mcp_tools_call_failed: {
    zh: "MCP tools/call 呼叫失敗。",
    en: "MCP tools/call request failed.",
  },
  unauthorized: {
    zh: "缺少或無效的 API 金鑰。",
    en: "Missing or invalid API key.",
  },
  invalid_request: {
    zh: "請求格式錯誤。",
    en: "Malformed request.",
  },
};

function isKnownCategory(v: string | undefined): v is ErrorCategory {
  return !!v && (ERROR_CATEGORIES as readonly string[]).includes(v);
}

export function StatusPanel({ status, tools, protocol, reason }: Props) {
  const h = HEADINGS[status];
  const toneRing =
    h.tone === "success"
      ? "border-[oklch(0.7_0.15_150)]/40 bg-[oklch(0.7_0.15_150)]/[0.06]"
      : h.tone === "warn"
        ? "border-amber-500/40 bg-amber-500/[0.06]"
        : "border-red-500/40 bg-red-500/[0.06]";
  const toneDot =
    h.tone === "success"
      ? "bg-[oklch(0.75_0.15_150)]"
      : h.tone === "warn"
        ? "bg-amber-400"
        : "bg-red-500";

  let body: { zh: string; en: string };
  if (status === "success") {
    body = {
      zh: `n8n MCP 已成功連接${tools ? `，共取得 ${tools} 個工具` : ""}${
        protocol ? `。協定版本 ${protocol}` : ""
      }。`,
      en: `Connected to n8n MCP${tools ? ` — ${tools} tools available` : ""}${
        protocol ? ` (protocol ${protocol})` : ""
      }.`,
    };
  } else if (status === "cancelled") {
    body = REASON_COPY.access_denied;
  } else {
    const cat = isKnownCategory(reason) ? reason : "token_exchange_failed";
    body = REASON_COPY[cat];
  }

  return (
    <section className={`rounded-2xl border p-8 ${toneRing}`}>
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${toneDot}`} aria-hidden />
        <p className="text-xs uppercase tracking-widest text-white/50">n8n · Instance MCP</p>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{h.zh}</h1>
      <p className="mt-1 text-sm text-white/60">{h.en}</p>
      <p className="mt-6 text-base leading-relaxed text-white/80">{body.zh}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/55">{body.en}</p>
      {status === "error" && isKnownCategory(reason) && (
        <p className="mt-4 font-mono text-xs text-white/40">code: {reason}</p>
      )}
    </section>
  );
}
