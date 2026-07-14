import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/n8n/env.server";

export const Route = createFileRoute("/oauth/client-metadata[.]json")({
  server: {
    handlers: {
      GET: async () => {
        const env = getEnv();
        const doc = {
          client_id: env.CLIENT_METADATA_URL,
          client_name: "EDGAR'S Tools — n8n Connector",
          client_uri: env.APP_BASE_URL,
          redirect_uris: [env.REDIRECT_URI],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          application_type: "web",
        };
        return new Response(JSON.stringify(doc, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
