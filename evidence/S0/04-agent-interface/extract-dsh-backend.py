#!/usr/bin/env python3
"""Copy the transitive local closure of dsh-TUI's DSH backend into an empty package.

This is an extraction-cost probe, not a production vendoring script. It copies
only local (relative) imports; external packages are resolved from the installed
`dsh-tui` package's node_modules by the reproduction shell script.
"""
from __future__ import annotations
import os, re, shutil, sys
from pathlib import Path

src = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
roots = [
    'src/dsh-adapter/backend/session.ts',
    'src/dsh-adapter/backend/translate.ts',
]
# The public domain contract is evaluated both alone and together with the backend.
roots += [str(p.relative_to(src)) for p in sorted((src / 'src/agent').glob('*.ts'))]

import_re = re.compile(r"""(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]""")
dynamic_import_re = re.compile(r"""import\(\s*['\"]([^'\"]+)['\"]\s*\)""")

def resolve_local(importer: Path, spec: str) -> Path | None:
    base = (importer.parent / spec)
    if spec.endswith('.js'):
        base = Path(str(base)[:-3])
    candidates = [Path(str(base) + ext) for ext in ('.ts', '.tsx', '.js', '.jsx')] + [base / 'index.ts', base / 'index.tsx', base]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None

seen: set[Path] = set()
stack = [(src / r).resolve() for r in roots]
missing: list[tuple[Path, str]] = []
while stack:
    path = stack.pop()
    if path in seen:
        continue
    if not path.is_file():
        missing.append((path, 'root'))
        continue
    seen.add(path)
    text = path.read_text(encoding='utf-8')
    for spec in import_re.findall(text) + dynamic_import_re.findall(text):
        if not spec.startswith('.'):
            continue
        target = resolve_local(path, spec)
        if target is None:
            missing.append((path, spec))
        else:
            stack.append(target)

if out.exists():
    shutil.rmtree(out)
for path in sorted(seen):
    rel = path.relative_to(src)
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)

# Type-only internal package aliases used by the backend.
for rel in ('tui-profile/protocols/profile-definitions.js', 'tui-profile/protocols/profile-definitions.d.ts',
            'tui-profile/protocols/tui-contributions.js', 'tui-profile/protocols/tui-contributions.d.ts'):
    source = src / rel
    if source.exists():
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)

print(f'copied_files={len(seen)}')
for path in sorted(seen):
    print(path.relative_to(src))
print(f'missing_local_imports={len(missing)}')
for path, spec in missing:
    print(f'MISSING {path.relative_to(src)} -> {spec}')
