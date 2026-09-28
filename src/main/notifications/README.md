# Notifications — module map

49 files, but you rarely touch more than 5. The count is a **migration artifact**, not a
design: two complete systems run side by side while the rebuild finishes, and Phase 9
deletes one of them.

## The 5 files that matter

| File | Job |
|---|---|
| `registry/<feature>/index.ts` | **Who gets this event, what it says, where it links.** Add events here. |
| `queues/notification.queue.ts` | `notify(eventKey, ctx)` — the only entry point from outside. |
| `services/dispatch.service.ts` | Resolves recipients, writes rows, emits. Runs in the worker. |
| `ports/directory.port.ts` | How the module asks other features "who is this user?". No cross-module Drizzle imports. |
| `models/notifications.model.ts` | The table. |

To add a notification: write a registry entry, call `notify()` from the feature. Nothing else.

## The other 44, grouped

| Group | Files | Status |
|---|---|---|
| New path — registry, ports, queues, preferences, kill switch, retention | 22 | Current |
| WhatsApp — service, webhook, templates, outbox, reminders | 8 | Separate channel, not the engine |
| Legacy path — `universalNotification.service` + `providers/` | 6 | **Deleted in Phase 9** |
| Per-feature senders — appointment, lab, prescription, login alert, SNS | 6 | Shims; fold into the registry as each module migrates |
| Core CRUD — model, service, controller, routes, schemas | 7 | Current |

**~12 files disappear in Phase 9 by deletion.** Refactoring them first would be wasted work.

## Rules

1. Outside this module, the only import is `notify()`. Enforced by `no-restricted-imports`.
2. Inside it, no Drizzle model from another feature — go through a port.
3. Registry entries carry `aliases` for their legacy key, or saved preferences stop matching.
4. Persist before emit. A socket frame with no row is a toast that can't be marked read.
5. Access control is `user_id`, always. `tenant_id` is a filter, never a boundary.

## Commands

```
npm run notifications:docs     # regenerate docs/NOTIFICATION_EVENTS.md from the registry
npm run notifications:parity   # prove the registry still matches saved preferences
```

Full plan and history: `docs/playbook/NOTIFICATION_REBUILD.md`.
API reference and verification checklist: `docs/playbook/NOTIFICATION_TEST_PLAN.md`.
