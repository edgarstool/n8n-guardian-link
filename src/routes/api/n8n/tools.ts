import { createFileRoute } from "@tanstack/react-router";
import { requireBearerSid, jsonError, jsonOk } from "@/lib/n8n/api-auth.server";
import { runInitializeAndListTools } from "@/lib/n8n/mcp.server";
import { CategorizedError, logCategory, toCategory } from "@/lib/n8n/errors.server";

export const Route = createFileRoute("/api/n8n/tools")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const sid = await requireBearerSid(request);
          const r = await runInitializeAndListTools(sid);
          return jsonOk({ protocolVersion: r.negotiatedProtocolVersion, tools: r.tools });
        } catch (e) {
          const cat = toCategory(e, "mcp_tools_list_failed");
          const status = e instanceof CategorizedError ? e.httpStatus ?? 500 : 500;
          logCategory("api/n8n/tools", cat, status);
          return jsonError(cat, status === 401 ? 401 : 502);
        }
      },
    },
  },
});
