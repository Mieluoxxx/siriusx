#!/usr/bin/env python3
"""Validate Prometheus rules and the Grafana dashboard."""
from pathlib import Path
import json
import re
import sys
import yaml

root = Path(__file__).resolve().parent.parent
rules_path = root / "deploy/observability/prometheus/rules/siriusx-alerts.yml"
dashboard_path = root / "deploy/observability/grafana/dashboard.json"
rules = yaml.safe_load(rules_path.read_text())
if not isinstance(rules, dict) or not isinstance(rules.get("groups"), list):
    raise SystemExit("invalid Prometheus rules: groups missing")
alerts = []
for group in rules["groups"]:
    for rule in group.get("rules", []):
        if "alert" not in rule or "expr" not in rule:
            raise SystemExit(f"invalid rule: {rule}")
        alerts.append(rule["alert"])
        expr = rule["expr"]
        for metric in re.findall(r"[a-zA-Z_:][a-zA-Z0-9_:]*", re.sub(r'"[^"]*"', '', expr)):
            if metric.startswith("siriusx_") or metric in {"up", "job"}:
                continue
            raise SystemExit(f"unexpected metric token in {rule['alert']}: {metric}")
dashboard = json.loads(dashboard_path.read_text())
if dashboard.get("uid") != "siriusx-infrastructure" or not dashboard.get("panels"):
    raise SystemExit("invalid Grafana dashboard")
print(json.dumps({"alerts": alerts, "panels": len(dashboard["panels"])}, indent=2))
