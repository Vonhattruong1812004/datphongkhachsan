CREATE TABLE IF NOT EXISTS node_sessions (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

ALTER TABLE node_sessions
  ADD CONSTRAINT node_sessions_pkey PRIMARY KEY (sid);

CREATE INDEX IF NOT EXISTS node_sessions_expire_idx ON node_sessions (expire);
