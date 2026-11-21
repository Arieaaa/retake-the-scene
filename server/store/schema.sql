-- Review-only app schema DDL. The platform manages function_backend private RLS.
-- All application run reads/writes must still include the authenticated owner_hash.
CREATE TABLE IF NOT EXISTS app.retake_visitors (
  token_hash text PRIMARY KEY CHECK (length(token_hash) > 0),
  expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE IF NOT EXISTS app.retake_runs (
  id text PRIMARY KEY CHECK (length(id) > 0),
  owner_hash text NOT NULL REFERENCES app.retake_visitors(token_hash) ON DELETE CASCADE,
  create_key text NOT NULL CHECK (length(create_key) > 0),
  episode_id text NOT NULL CHECK (episode_id IN ('wedding', 'office', 'romance', 'hiss', 'reply')),
  expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991),
  version bigint NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
  state_version integer NOT NULL CHECK (state_version = 1),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  UNIQUE (owner_hash, create_key)
);

CREATE INDEX IF NOT EXISTS retake_visitors_expires_at_idx ON app.retake_visitors(expires_at);
CREATE INDEX IF NOT EXISTS retake_runs_expires_at_idx ON app.retake_runs(expires_at);
