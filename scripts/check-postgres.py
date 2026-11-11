#!/usr/bin/env python3
"""Validate the PostgreSQL schema and migration tool shape."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
schema = (root / "deploy/postgres/schema.sql").read_text()
expected = [
    "tenants", "users", "settings", "devices", "pairing_codes", "bots",
    "device_tickets", "device_ticket_events", "cloud_tickets", "cloud_ticket_events",
    "revoked_sessions", "tenant_quotas", "model_catalog", "tenant_models",
    "source_bindings", "source_events", "tenant_billing", "support_requests", "platform_audit",
    "tg_approvals", "tg_tenant_tool_policies", "tg_audit",
    "autobot_tickets", "autobot_assignments", "autobot_assignment_events",
    "autobot_pending_inputs", "autobot_outbox",
]
for table in expected:
    if not re.search(rf"CREATE TABLE IF NOT EXISTS\s+{re.escape(table)}\s*\(", schema):
        raise SystemExit(f"schema missing table: {table}")
if not re.search(r"id\s+BIGSERIAL\s+PRIMARY KEY", schema):
    raise SystemExit("platform_audit must use BIGSERIAL")
tool = (root / "scripts/migrate-sqlite-to-postgres.mjs").read_text()
for table in expected:
    if f"'{table}'" not in tool:
        raise SystemExit(f"migration tool missing table: {table}")
print(f"postgres schema OK: {len(expected)} tables")
