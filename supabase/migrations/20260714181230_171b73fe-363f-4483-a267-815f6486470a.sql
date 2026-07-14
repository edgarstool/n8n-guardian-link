
-- Sessions: opaque sid → selected n8n MCP URL
CREATE TABLE public.n8n_sessions (
  sid TEXT PRIMARY KEY,
  mcp_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.n8n_sessions TO service_role;
ALTER TABLE public.n8n_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated cannot access; service_role bypasses RLS.

-- Pending OAuth authorization state (single-use, keyed by opaque state)
CREATE TABLE public.n8n_pending_auth (
  state TEXT PRIMARY KEY,
  sid TEXT NOT NULL,
  verifier TEXT NOT NULL,
  issuer TEXT NOT NULL,
  resource TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  mcp_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.n8n_pending_auth TO service_role;
ALTER TABLE public.n8n_pending_auth ENABLE ROW LEVEL SECURITY;

-- Authorization Server metadata cache
CREATE TABLE public.n8n_as_metadata (
  issuer TEXT PRIMARY KEY,
  metadata JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.n8n_as_metadata TO service_role;
ALTER TABLE public.n8n_as_metadata ENABLE ROW LEVEL SECURITY;

-- Client registrations (preconfigured, CIMD, DCR)
CREATE TABLE public.n8n_client_registrations (
  issuer TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  registration JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, redirect_uri)
);
GRANT ALL ON public.n8n_client_registrations TO service_role;
ALTER TABLE public.n8n_client_registrations ENABLE ROW LEVEL SECURITY;

-- Tokens per opaque session
CREATE TABLE public.n8n_tokens (
  sid TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.n8n_tokens TO service_role;
ALTER TABLE public.n8n_tokens ENABLE ROW LEVEL SECURITY;
