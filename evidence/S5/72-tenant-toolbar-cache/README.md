# Tenant toolbar and cache polish

- Tenant header now uses a dedicated `.tenant-actions` flex toolbar, independent of generic `.page-head > div` rules.
- Back / Edit profile / Suspend stay on one row at wide desktop sizes.
- Detail panels align to the start instead of stretching to the tallest panel.
- Admin assets are served with `cache-control: no-store` during active UI work, preventing stale CSS after rebuilds.
- Verified route reload/back and mobile reflow.
