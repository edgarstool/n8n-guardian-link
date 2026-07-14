import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteShell } from "@/components/site/SiteShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EDGAR'S Tools｜n8n MCP OAuth 連接器" },
      {
        name: "description",
        content:
          "以標準 OAuth 2.1 + PKCE 將 n8n Instance-level MCP 伺服器安全連接到您的工作流。",
      },
      { property: "og:title", content: "EDGAR'S Tools｜n8n MCP OAuth 連接器" },
      {
        property: "og:description",
        content:
          "Discovery-driven OAuth 2.1 + PKCE client for n8n Instance-level MCP servers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <SiteShell>
      <main className="mx-auto max-w-4xl px-6 py-24">
        <p className="text-xs uppercase tracking-[0.28em] text-[oklch(0.75_0.15_60)]">
          Instance MCP · OAuth 2.1 · PKCE
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          安全連接您的 n8n Instance MCP
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/70 sm:text-lg">
          Discovery-driven OAuth 2.1 + PKCE client. Tokens live server-side in Cloudflare KV. No
          codes, tokens, or client secrets ever leave the worker.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/connect/n8n"
            className="rounded-md bg-[oklch(0.75_0.15_60)] px-6 py-3 text-sm font-semibold text-black transition hover:brightness-110"
          >
            開始連接 / Start connection
          </Link>
          <a
            href="/oauth/client-metadata.json"
            className="rounded-md border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
          >
            Client metadata (CIMD)
          </a>
        </div>

        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "Discovery",
              b: "RFC 9728 protected-resource + RFC 8414 AS metadata. Nothing hardcoded.",
            },
            {
              t: "PKCE S256",
              b: "Enforced. Refuses AS that do not advertise S256.",
            },
            {
              t: "KV-backed",
              b: "Tokens, refresh, DCR clients persisted in Cloudflare KV.",
            },
          ].map((f) => (
            <div
              key={f.t}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
            >
              <h3 className="text-sm font-semibold text-white">{f.t}</h3>
              <p className="mt-2 text-sm text-white/60">{f.b}</p>
            </div>
          ))}
        </section>
      </main>
    </SiteShell>
  );
}
