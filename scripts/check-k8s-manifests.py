#!/usr/bin/env python3
"""Parse and sanity-check the Kubernetes Kustomize base."""
from pathlib import Path
import json
import sys
import yaml

root = Path(__file__).resolve().parent.parent
directory = root / "deploy" / "k8s"
names = sorted(path.name for path in directory.glob("*.yaml"))
optional = sorted(path.name for path in (directory / "optional").glob("*.yaml"))
manifests = []
for name in names + [f"optional/{item}" for item in optional]:
    documents = list(yaml.safe_load_all((directory / name).read_text()))
    for value in documents:
        if value is None:
            continue
        if not isinstance(value, dict) or not isinstance(value.get("apiVersion"), str) or not isinstance(value.get("kind"), str):
            raise SystemExit(f"{name}: missing apiVersion/kind")
        if value["kind"] != "Kustomization" and not isinstance(value.get("metadata", {}).get("name"), str):
            raise SystemExit(f"{name}: missing metadata.name")
        manifests.append({"file": name, **value})

kustomization = next((item for item in manifests if item["kind"] == "Kustomization"), None)
if kustomization is None:
    raise SystemExit("kustomization.yaml is missing")
resources = kustomization.get("resources", [])
for resource in resources:
    if resource not in names:
        raise SystemExit(f"kustomization resource not found: {resource}")
for item in manifests:
    rendered = json.dumps(item)
    if ":latest" in rendered:
        raise SystemExit(f"{item['file']}: mutable :latest image is not allowed")

print(json.dumps({
    "files": len(names) + len(optional),
    "documents": len(manifests),
    "kinds": sorted({item["kind"] for item in manifests}),
    "resources": len(resources),
}, indent=2))
