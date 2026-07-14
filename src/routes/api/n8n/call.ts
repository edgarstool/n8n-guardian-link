import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearerSid, jsonError, jsonOk } from "@/lib/n8n/api-auth.server";
import { runInitializeAndCallTool } from "@/lib/n8n/mcp.server";
import { CategorizedError, logCategory, toCategory } from "@/lib/n8n/errors.server";

const CallSchema = z.object({
  name: z.string().min(1).max(200),
  arguments: z.record(z.unknown()).default({}),
});

export const Route = createFileRoute("/api/n8n/call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let sid: string;
        try {
          sid = await requireBearerSid(request);
        } catch (e) {
          const cat = toCategory(e, "unauthorized");
          return jsonError(cat, 401);
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonError("invalid_request", 400);
        }
        const parsed = CallSchema.safeParse(body);
        if (!parsed.success) return jsonError("invalid_request", 400);
        try {
          const r = await runInitializeAndCallTool(
            sid,
            parsed.data.name,
            parsed.data.arguments as Record<string, unknown>,
          );
          return jsonOk({ protocolVersion: r.negotiatedProtocolVersion, result: r.result });
        } catch (e) {
          const cat = toCategory(e, "mcp_tools_call_failed");
          const status = e instanceof CategorizedError ? e.httpStatus ?? 502 : 502;
          logCategory("api/n8n/call", cat, status);
          return jsonError(cat, status === 401 ? 401 : 502);
        }
      },
    },
  },
});
