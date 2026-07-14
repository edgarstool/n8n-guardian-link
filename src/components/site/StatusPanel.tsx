type Props = {
  status: "success" | "error" | "cancelled";
  tools?: string;
  protocol?: string;
  reason?: string;
};

const COPY = {
  success: {
    zh: "授權成功",
    en: "Authorization complete",
    body: (tools?: string, protocol?: string) =>
      `n8n MCP 已成功連接${tools ? `，共取得 ${tools} 個工具` : ""}${
        protocol ? `。協定版本 ${protocol}` : ""
      }。`,
    tone: "success" as const,
  },
  error: {
    zh: "授權失敗",
    en: "Authorization could not be completed",
    body: (_t?: string, _p?: string, reason?: string) =>
      `無法完成 n8n MCP 授權${reason ? `：${reason}` : "。請稍後再試"}。`,
    tone: "error" as const,
  },
  cancelled: {
    zh: "已取消授權",
    en: "Authorization cancelled",
    body: () => "您在 n8n 授權頁面選擇了取消。您可以隨時重新開始。",
    tone: "warn" as const,
  },
};

export function StatusPanel({ status, tools, protocol, reason }: Props) {
  const c = COPY[status];
  const toneRing =
    c.tone === "success"
      ? "border-[oklch(0.7_0.15_150)]/40 bg-[oklch(0.7_0.15_150)]/[0.06]"
      : c.tone === "warn"
        ? "border-amber-500/40 bg-amber-500/[0.06]"
        : "border-red-500/40 bg-red-500/[0.06]";
  const toneDot =
    c.tone === "success"
      ? "bg-[oklch(0.75_0.15_150)]"
      : c.tone === "warn"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <section className={`rounded-2xl border p-8 ${toneRing}`}>
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${toneDot}`} aria-hidden />
        <p className="text-xs uppercase tracking-widest text-white/50">n8n · Instance MCP</p>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{c.zh}</h1>
      <p className="mt-1 text-sm text-white/60">{c.en}</p>
      <p className="mt-6 text-base leading-relaxed text-white/80">
        {c.body(tools, protocol, reason)}
      </p>
    </section>
  );
}
