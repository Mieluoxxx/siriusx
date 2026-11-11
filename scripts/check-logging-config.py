#!/usr/bin/env python3
"""Validate the Fluent Bit logging example configuration."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
config = (root / "deploy/observability/logging/fluent-bit.conf").read_text()
parsers = (root / "deploy/observability/logging/parsers.conf").read_text()
for required in ("[SERVICE]", "[INPUT]", "[FILTER]", "[OUTPUT]", "Name              tail", "Name                kubernetes"):
    if required not in config:
        raise SystemExit(f"fluent-bit.conf missing: {required}")
for required in ("[PARSER]", "Format      regex", "Name        cri"):
    if required not in parsers:
        raise SystemExit(f"parsers.conf missing: {required}")
print("logging config OK")
