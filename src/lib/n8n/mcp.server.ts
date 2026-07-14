// Minimal MCP client for the n8n Instance-level MCP endpoint.
// Handles protocol negotiation, JSON + SSE responses, and 401→refresh→retry.

import { requireN8nMcpUrl } from "./env.server";
import { getTokens, putTokens } from "./kv.server";
import { getValidAccessToken } from "./tokens.server";

export const SUPPORTED_MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export type SupportedMcpVersion = (typeof SUPPORTED_MCP_VERSIONS)[number];
export const LATEST_MCP_VERSION: SupportedMcpVersion = "2025-11-25";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function parseSseText(text: string): JsonRpcResponse | null {
  // Concatenate `data: ...` lines
  const events = text.split(/\n\n/);
  for (const ev of events) {
    const dataLines = ev
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (!dataLines.length) continue;
    const payload = dataLines.join("\n");
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed && typeof parsed === "object" && "jsonrpc" in parsed) return parsed;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

async function readMcpResponse(r: Response): Promise<JsonRpcResponse | null> {
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await r.json()) as JsonRpcResponse;
  }
  const text = await r.text();
  if (ct.includes("text/event-stream")) return parseSseText(text);
  // Try JSON as fallback
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    return parseSseText(text);
  }
}

type CallOptions = {
  accessToken: string;
  protocolVersion?: string;
  sessionIdHeader?: string;
};

async function mcpFetch(body: unknown, opts: CallOptions): Promise<Response> {
  const url = requireN8nMcpUrl();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${opts.accessToken}`,
  };
  if (opts.protocolVersion) headers["mcp-protocol-version"] = opts.protocolVersion;
  if (opts.sessionIdHeader) headers["mcp-session-id"] = opts.sessionIdHeader;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function callWith401Retry(
  sid: string,
  body: unknown,
  opts: CallOptions,
): Promise<{ response: Response; usedToken: string }> {
  let token = opts.accessToken;
  let r = await mcpFetch(body, { ...opts, accessToken: token });
  if (r.status === 401) {
    // Force refresh via getValidAccessToken by marking expired
    const t = await getTokens(sid);
    if (t) {
      await putTokens(sid, { ...t, expires_at: 0 });
    }
    const fresh = await getValidAccessToken(sid);
    token = fresh.access_token;
    r = await mcpFetch(body, { ...opts, accessToken: token });
  }
  return { response: r, usedToken: token };
}

export type McpToolsListResult = {
  negotiatedProtocolVersion: string;
  tools: Array<{ name: string; description?: string }>;
};

export async function runInitializeAndListTools(sid: string): Promise<McpToolsListResult> {
  const t = await getValidAccessToken(sid);

  // 1) initialize
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_MCP_VERSION,
      capabilities: {},
      clientInfo: { name: "edgars-tools-n8n-connector", version: "1.0.0" },
    },
  };
  const { response: initResp, usedToken } = await callWith401Retry(sid, initBody, {
    accessToken: t.access_token,
  });
  if (!initResp.ok) {
    const text = await initResp.text().catch(() => "");
    throw new Error(`initialize failed: ${initResp.status} ${text.slice(0, 200)}`);
  }
  const mcpSessionId = initResp.headers.get("mcp-session-id") ?? undefined;
  const parsed = await readMcpResponse(initResp);
  if (!parsed || parsed.error) {
    throw new Error(`initialize error: ${parsed?.error?.message ?? "no response"}`);
  }
  const result = parsed.result as { protocolVersion?: string };
  const serverVersion = result?.protocolVersion ?? LATEST_MCP_VERSION;
  if (!(SUPPORTED_MCP_VERSIONS as readonly string[]).includes(serverVersion)) {
    throw new Error(
      `Server returned unsupported MCP protocolVersion "${serverVersion}". Supported: ${SUPPORTED_MCP_VERSIONS.join(", ")}.`,
    );
  }
  const negotiated = serverVersion;

  // Persist negotiated version
  const tokens = await getTokens(sid);
  if (tokens) {
    await putTokens(sid, { ...tokens, negotiated_mcp_protocol_version: negotiated });
  }

  // 2) notifications/initialized (no id)
  await mcpFetch(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { accessToken: usedToken, protocolVersion: negotiated, sessionIdHeader: mcpSessionId },
  );

  // 3) tools/list
  const listResp = await mcpFetch(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { accessToken: usedToken, protocolVersion: negotiated, sessionIdHeader: mcpSessionId },
  );
  if (!listResp.ok) {
    const text = await listResp.text().catch(() => "");
    throw new Error(`tools/list failed: ${listResp.status} ${text.slice(0, 200)}`);
  }
  const listParsed = await readMcpResponse(listResp);
  if (!listParsed || listParsed.error) {
    throw new Error(`tools/list error: ${listParsed?.error?.message ?? "no response"}`);
  }
  const tools =
    ((listParsed.result as { tools?: Array<{ name: string; description?: string }> })?.tools ??
      []) as Array<{ name: string; description?: string }>;
  return { negotiatedProtocolVersion: negotiated, tools };
}
