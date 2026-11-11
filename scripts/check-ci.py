#!/usr/bin/env python3
"""Validate the GitHub Actions workflow shape."""
from pathlib import Path
import yaml

workflow = Path(__file__).resolve().parent.parent / ".github/workflows/ci.yml"
value = yaml.safe_load(workflow.read_text())
if not isinstance(value, dict) or "jobs" not in value:
    raise SystemExit("ci workflow: jobs missing")
job = value["jobs"].get("verify")
if not isinstance(job, dict) or not isinstance(job.get("steps"), list):
    raise SystemExit("ci workflow: verify.steps missing")
runs = [step.get("run", "") for step in job["steps"] if isinstance(step, dict)]
uses = [step.get("uses", "") for step in job["steps"] if isinstance(step, dict)]
if not any("pnpm install" in run for run in runs) or not any("pnpm test" in run for run in runs):
    raise SystemExit("ci workflow: install/test steps missing")
if not any("actions/upload-artifact" in use for use in uses):
    raise SystemExit("ci workflow: artifact upload missing")
print(f"ci workflow OK: {len(job['steps'])} steps")
