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
images = yaml.safe_load((Path(__file__).resolve().parent.parent / ".github/workflows/images.yml").read_text())
image_job = images.get("jobs", {}).get("build-and-push") if isinstance(images, dict) else None
if not isinstance(image_job, dict) or not isinstance(image_job.get("steps"), list):
    raise SystemExit("images workflow: build-and-push steps missing")
image_runs = [step.get("run", "") for step in image_job["steps"] if isinstance(step, dict)]
if not any("docker push" in run for run in image_runs):
    raise SystemExit("images workflow: docker push missing")
print(f"ci workflow OK: {len(job['steps'])} verify steps, {len(image_job['steps'])} image steps")
