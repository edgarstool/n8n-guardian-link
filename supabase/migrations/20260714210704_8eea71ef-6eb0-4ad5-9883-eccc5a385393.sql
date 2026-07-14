CREATE TABLE IF NOT EXISTS public.n8n_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sid          text NOT NULL,
  label        text,
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS n8n_api_keys_sid_idx ON public.n8n_api_keys(sid);

GRANT ALL ON public.n8n_api_keys TO service_role;

ALTER TABLE public.n8n_api_keys ENABLE ROW LEVEL SECURITY;