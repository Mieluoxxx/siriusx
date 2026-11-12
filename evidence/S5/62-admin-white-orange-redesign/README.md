# Admin Web usability redesign

- Responsive application shell with sidebar navigation
- Overview metrics and recent tenants
- Dedicated views for tenants, models, sources, support, audit
- Native `<dialog>` tenant detail: focus management, Esc dismissal, scroll containment
- Sticky, labeled responsive tables with container queries and stacked mobile rows
- Visible form labels, focus-visible rings, semantic status pills
- No horizontal overflow at 390px viewport
- Playwright verified Overview, Tenants, dialog open/close, Escape, mobile layout, console errors

Evidence: `overview.png`, `mobile.png`, `verify.txt`, `typecheck.txt`, `build.txt`.
