import { createFileRoute } from "@tanstack/react-router";
import { getAppBaseUrl } from "@/lib/n8n/env.server";

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: async () => {
        const base = getAppBaseUrl();
        const doc = {
          openapi: "3.1.0",
          info: {
            title: "EDGAR'S Tools — n8n MCP HTTP Adapter",
            version: "1.0.0",
            description:
              "Temporary HTTP/OpenAPI adapter over the authenticated n8n MCP OAuth connector. " +
              "Authenticate with a personal integration key created on /connect/n8n.",
          },
          servers: [{ url: base }],
          components: {
            securitySchemes: {
              bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" },
            },
            schemas: {
              Tool: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                },
                required: ["name"],
              },
              Error: {
                type: "object",
                properties: {
                  ok: { type: "boolean", enum: [false] },
                  error: { type: "string" },
                },
                required: ["ok", "error"],
              },
            },
          },
          security: [{ bearerAuth: [] }],
          paths: {
            "/api/n8n/tools": {
              get: {
                operationId: "listTools",
                summary: "List MCP tools available to the connected n8n instance.",
                responses: {
                  "200": {
                    description: "Tool list",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            ok: { type: "boolean", enum: [true] },
                            protocolVersion: { type: "string" },
                            tools: { type: "array", items: { $ref: "#/components/schemas/Tool" } },
                          },
                          required: ["ok", "protocolVersion", "tools"],
                        },
                      },
                    },
                  },
                  "401": {
                    description: "Unauthorized",
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                  },
                  "502": {
                    description: "Upstream MCP error",
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                  },
                },
              },
            },
            "/api/n8n/call": {
              post: {
                operationId: "callTool",
                summary: "Invoke an MCP tool by name with a JSON arguments object.",
                requestBody: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          arguments: { type: "object", additionalProperties: true },
                        },
                        required: ["name"],
                      },
                    },
                  },
                },
                responses: {
                  "200": {
                    description: "Tool result",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            ok: { type: "boolean", enum: [true] },
                            protocolVersion: { type: "string" },
                            result: {},
                          },
                          required: ["ok", "protocolVersion", "result"],
                        },
                      },
                    },
                  },
                  "400": {
                    description: "Invalid request",
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                  },
                  "401": {
                    description: "Unauthorized",
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                  },
                  "502": {
                    description: "Upstream MCP error",
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                  },
                },
              },
            },
          },
        };
        return new Response(JSON.stringify(doc, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=60",
          },
        });
      },
    },
  },
});
