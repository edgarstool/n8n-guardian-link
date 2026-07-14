// Minimal MCP client for the n8n Instance-level MCP endpoint.

import { requireSessionMcpUrl } from "./env.server";
import { CategorizedError, ErrorCategory, logCategory } from "./errors.server";
import { getTokens, putTokens } from "./kv.server";
import { forceRefreshTokens, getValidAccessToken } from "./tokens.server";

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
  if (ct.includes("application/json")) return (await r.json()) as JsonRpcResponse;
  const text = await r.text();
  if (ct.includes("text/event-stream")) return parseSseText(text);
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

async function mcpFetch(url: string, body: unknown, opts: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${opts.accessToken}`,
  };
  if (opts.protocolVersion) headers["mcp-protocol-version"] = opts.protocolVersion;
  if (opts.sessionIdHeader) headers["mcp-session-id"] = opts.sessionIdHeader;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function mcpFetchWithOneRetry(
  sid: string,
  url: string,
  body: unknown,
  base: CallOptions,
): Promise<{ response: Response; usedToken: string }> {
  return _fetchWithRetry({
    url,
    body,
    base,
    refresh: async () => (await forceRefreshTokens(sid)).access_token,
  });
}

// Test-only: dependency-injected variant that does not touch the DB.
export async function _fetchWithRetry(args: {
  url: string;
  body: unknown;
  base: CallOptions;
  refresh: () => Promise<string>;
}): Promise<{ response: Response; usedToken: string }> {
  let token = args.base.accessToken;
  let r = await mcpFetch(args.url, args.body, { ...args.base, accessToken: token });
  if (r.status !== 401) return { response: r, usedToken: token };
  await r.text().catch(() => "");
  token = await args.refresh();
  r = await mcpFetch(args.url, args.body, { ...args.base, accessToken: token });
  return { response: r, usedToken: token };
}

// Test-only: build the JSON-RPC body used by tools/call.
export function _buildToolsCallBody(name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: 3,
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  };
}


export type McpToolsListResult = {
  negotiatedProtocolVersion: string;
  tools: Array<{ name: string; description?: string }>;
};

function fail(category: ErrorCategory, status?: number): never {
  logCategory("mcp", category, status);
  throw new CategorizedError(category, status);
}

export async function runInitializeAndListTools(sid: string): Promise<McpToolsListResult> {
  const url = await requireSessionMcpUrl(sid);
  const t = await getValidAccessToken(sid);

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
  const initResult = await mcpFetchWithOneRetry(sid, url, initBody, {
    accessToken: t.access_token,
  });
  const initResp = initResult.response;
  if (!initResp.ok) {
    await initResp.text().catch(() => "");
    fail("mcp_initialize_failed", initResp.status);
  }
  const mcpSessionId = initResp.headers.get("mcp-session-id") ?? undefined;
  const parsed = await readMcpResponse(initResp);
  if (!parsed || parsed.error) fail("mcp_initialize_failed", initResp.status);
  const result = (parsed as JsonRpcResponse).result as { protocolVersion?: string } | undefined;
  const serverVersion = result?.protocolVersion ?? LATEST_MCP_VERSION;
  if (!(SUPPORTED_MCP_VERSIONS as readonly string[]).includes(serverVersion)) {
    fail("mcp_initialize_failed", initResp.status);
  }
  const negotiated = serverVersion;

  const stored = await getTokens(sid);
  if (stored) {
    await putTokens(sid, { ...stored, negotiated_mcp_protocol_version: negotiated });
  }

  const notifResult = await mcpFetchWithOneRetry(
    sid,
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      accessToken: initResult.usedToken,
      protocolVersion: negotiated,
      sessionIdHeader: mcpSessionId,
    },
  );
  if (!notifResult.response.ok) {
    await notifResult.response.text().catch(() => "");
    fail("mcp_initialized_notification_failed", notifResult.response.status);
  }
  await notifResult.response.text().catch(() => "");

  const listResult = await mcpFetchWithOneRetry(
    sid,
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    {
      accessToken: notifResult.usedToken,
      protocolVersion: negotiated,
      sessionIdHeader: mcpSessionId,
    },
  );
  const listResp = listResult.response;
  if (!listResp.ok) {
    await listResp.text().catch(() => "");
    fail("mcp_tools_list_failed", listResp.status);
  }
  const listParsed = await readMcpResponse(listResp);
  if (!listParsed || listParsed.error) fail("mcp_tools_list_failed", listResp.status);
  const rawTools = (listParsed as JsonRpcResponse).result as
    | { tools?: Array<{ name?: unknown; description?: unknown }> }
    | undefined;
  const toolsIn = rawTools?.tools;
  if (!Array.isArray(toolsIn)) fail("mcp_tools_list_failed", listResp.status);
  const tools = (toolsIn as Array<{ name?: unknown; description?: unknown }>)
    .filter((x): x is { name: string; description?: string } => typeof x?.name === "string")
    .map((x) => ({
      name: x.name,
      description: typeof x.description === "string" ? x.description : undefined,
    }));

  return { negotiatedProtocolVersion: negotiated, tools };
}

/** Perform initialize + initialized + tools/call in a single session. */
export async function runInitializeAndCallTool(
  sid: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<{ negotiatedProtocolVersion: string; result: unknown }> {
  const url = await requireSessionMcpUrl(sid);
  const t = await getValidAccessToken(sid);

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
  const initRes = await mcpFetchWithOneRetry(sid, url, initBody, {
    accessToken: t.access_token,
  });
  if (!initRes.response.ok) {
    await initRes.response.text().catch(() => "");
    fail("mcp_initialize_failed", initRes.response.status);
  }
  const mcpSessionId = initRes.response.headers.get("mcp-session-id") ?? undefined;
  const parsedInit = await readMcpResponse(initRes.response);
  if (!parsedInit || parsedInit.error) fail("mcp_initialize_failed", initRes.response.status);
  const initResult = (parsedInit as JsonRpcResponse).result as
    | { protocolVersion?: string }
    | undefined;
  const negotiated = initResult?.protocolVersion ?? LATEST_MCP_VERSION;
  if (!(SUPPORTED_MCP_VERSIONS as readonly string[]).includes(negotiated)) {
    fail("mcp_initialize_failed", initRes.response.status);
  }

  const stored = await getTokens(sid);
  if (stored) await putTokens(sid, { ...stored, negotiated_mcp_protocol_version: negotiated });

  const notifRes = await mcpFetchWithOneRetry(
    sid,
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { accessToken: initRes.usedToken, protocolVersion: negotiated, sessionIdHeader: mcpSessionId },
  );
  if (!notifRes.response.ok) {
    await notifRes.response.text().catch(() => "");
    fail("mcp_initialized_notification_failed", notifRes.response.status);
  }
  await notifRes.response.text().catch(() => "");

  const callRes = await mcpFetchWithOneRetry(
    sid,
    url,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs ?? {} },
    },
    {
      accessToken: notifRes.usedToken,
      protocolVersion: negotiated,
      sessionIdHeader: mcpSessionId,
    },
  );
  if (!callRes.response.ok) {
    await callRes.response.text().catch(() => "");
    fail("mcp_tools_call_failed", callRes.response.status);
  }
  const parsedCall = await readMcpResponse(callRes.response);
  if (!parsedCall || parsedCall.error) fail("mcp_tools_call_failed", callRes.response.status);
  return {
    negotiatedProtocolVersion: negotiated,
    result: (parsedCall as JsonRpcResponse).result,
  };
}

