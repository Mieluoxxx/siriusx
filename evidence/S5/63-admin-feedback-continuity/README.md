# Admin feedback and continuity

- Status/Action toast uses native `popover="manual"`, `role="status"`, close target, timer pause on hover/focus
- Suspend tenant is immediate with Undo toast; Resume confirms
- Upstream deletion asks in a native `<dialog>` and fades its row before the gap closes
- Support requests appear in the header notification popover with a pending count
- Failed platform token is shown inline under the token field
- Sidebar active indicator moves between views
- Tenant table filters use View Transitions when available; rows keep stable view-transition names
- Tenant detail opens from the pressed row and closes back toward it with measured motion
- Mobile nav remains a native popover

Verified with Playwright: empty notification panel, suspend/undo, inline 401, tenant detail, delete confirmation cancel, dialog close animation, no console errors beyond intentional 401 probes.
