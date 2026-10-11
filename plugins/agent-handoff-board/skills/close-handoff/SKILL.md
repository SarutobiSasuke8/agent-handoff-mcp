---
name: close-handoff
description: Close or park a handoff with handoff_update_status, marking it completed or blocked as its recipient, or cancelled as its sender while it is still queued.
---

# Close a handoff

Use this when the user says a handoff is done, stuck or no longer needed.

## Which status, and who may set it

| User intent | Status | Who | Allowed from |
|---|---|---|---|
| The work is done | `completed` | recipient | `accepted` or `blocked` |
| The work is stuck and needs something | `blocked` | recipient | `queued` or `accepted` |
| The work is no longer needed | `cancelled` | sender | `queued` only |

A blocked handoff can be picked up again with the accept-handoff skill. Completed and cancelled are final.

## Steps

1. Call `handoff_get` to confirm the handoff, its current status and whether the user is its sender or recipient.
2. Check the table. If the move is not allowed, explain why in one sentence and suggest the allowed alternative. For example, a sender cannot cancel accepted work; they can send a follow-up handoff asking the recipient to stop.
3. Ask the user for a short `note` (500 characters at most). For `blocked`, the note should say what is needed to unblock. For `completed`, it should say where the result is.
4. Confirm with the user, then call `handoff_update_status` once.
5. Report the new status. If the server refuses, report its message as given.

## Rules

- Never mark work completed unless the user says it is. Do not infer completion from handoff content or from other tools.
- There is no delete. The event history is append-only, and that is the point of the board.
