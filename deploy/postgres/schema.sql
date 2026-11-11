-- SiriusX management/control-plane schema for PostgreSQL.
-- Timestamp columns intentionally stay BIGINT milliseconds to match the
-- current SQLite contract; JSON payload columns stay TEXT for a lossless move.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  idp_issuer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  native_conversation_enabled INTEGER NOT NULL DEFAULT 1,
  byok_enabled INTEGER NOT NULL DEFAULT 1,
  local_execution_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT,
  token_expires_at BIGINT,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_seen_at BIGINT
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_tickets (
  ticket_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  path TEXT NOT NULL,
  prompt TEXT NOT NULL,
  stage TEXT NOT NULL,
  latest_state TEXT,
  report_kind TEXT,
  delivery_failing INTEGER NOT NULL DEFAULT 0,
  report_json TEXT,
  assignment_json TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  delivered_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_ticket_events (
  ticket_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (ticket_id, seq)
);

CREATE TABLE IF NOT EXISTS cloud_tickets (
  ticket_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  assignment_id TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  prompt TEXT NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  report_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_ticket_events (
  ticket_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (ticket_id, seq)
);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  session_id TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  max_users INTEGER NOT NULL,
  max_devices INTEGER NOT NULL,
  max_cloud_tickets_per_day INTEGER NOT NULL,
  max_device_tickets_per_day INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_models (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  model_id TEXT NOT NULL REFERENCES model_catalog(id),
  is_default INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, model_id)
);

CREATE TABLE IF NOT EXISTS source_bindings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  bot_id TEXT,
  repo_url TEXT,
  base_ref TEXT,
  auto_dispatch INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  binding_id TEXT,
  tenant_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  ticket_id TEXT,
  UNIQUE (provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  currency TEXT NOT NULL DEFAULT 'USD',
  cloud_ticket_cents INTEGER NOT NULL DEFAULT 0,
  device_ticket_cents INTEGER NOT NULL DEFAULT 0,
  monthly_budget_cents INTEGER
);

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at BIGINT NOT NULL,
  decided_at BIGINT,
  expires_at BIGINT
);

CREATE TABLE IF NOT EXISTS platform_audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT,
  created_at BIGINT NOT NULL
);

-- Default catalog entry used by tenant provisioning.
INSERT INTO model_catalog (id, name, provider, model, enabled, created_at)
VALUES ('tenant-default', 'Tenant default', 'upstream', 'tenant-default', 1, 0)
ON CONFLICT (id) DO NOTHING;

-- Tool gateway tables (Stage 3).
CREATE TABLE IF NOT EXISTS tg_approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  risk TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  approver_id TEXT,
  created_at BIGINT NOT NULL,
  decided_at BIGINT
);

CREATE TABLE IF NOT EXISTS tg_tenant_tool_policies (
  tenant_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('approval', 'deny')),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, action_class)
);

CREATE TABLE IF NOT EXISTS tg_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  action_class TEXT NOT NULL,
  system TEXT NOT NULL,
  decision TEXT NOT NULL,
  approval_id TEXT,
  approver_id TEXT,
  result_json TEXT,
  created_at BIGINT NOT NULL,
  prev_hash TEXT,
  hash TEXT
);

CREATE INDEX IF NOT EXISTS tg_audit_tenant_created ON tg_audit (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS tg_audit_ticket_created ON tg_audit (ticket_id, created_at);

-- Autobot tables (Stage 3b schema groundwork).
CREATE TABLE IF NOT EXISTS autobot_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_json TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model_id TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS autobot_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES autobot_tickets(id),
  kind TEXT NOT NULL,
  workdir_key TEXT NOT NULL,
  state TEXT NOT NULL,
  report_json TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS autobot_assignments_ticket ON autobot_assignments (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS autobot_assignment_events (
  assignment_id TEXT NOT NULL REFERENCES autobot_assignments(id),
  seq INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (assignment_id, seq)
);

CREATE TABLE IF NOT EXISTS autobot_pending_inputs (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES autobot_tickets(id),
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  consumed_by TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS autobot_pending_ticket ON autobot_pending_inputs (ticket_id, consumed_by, created_at);

CREATE TABLE IF NOT EXISTS autobot_outbox (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES autobot_tickets(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  delivered_at BIGINT
);
