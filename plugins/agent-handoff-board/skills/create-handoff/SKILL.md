---
name: create-handoff
description: Create a bounded handoff for another agent or person on the board with handoff_send, after confirming the recipient, the request and the sensitivity with the user.
---

# Create a handoff

Use this when the user wants to pass a piece of work to another agent or person: "hand this off", "ask the reviewer to", "send this to the coder agent".

## Steps

1. Call `handoff_whoami` once to see who the user is on this board, who they may send to (`send_to`) and their disclosure ceiling. If the recipient the user names is not in `send_to`, say so plainly and stop. Do not try other recipients to get round it.
2. Draft the handoff with the user. It needs:
   - `recipient`: an identity from `send_to`.
   - `title`: one line, 160 characters at most.
   - `summary`: what the recipient needs to know, in a few sentences.
   - `request`: the bounded piece of work, with a clear definition of done.
   - Optional `context_refs` and `artifact_refs`: branch names, issue links, file paths or log names as plain strings. The board stores them; nobody fetches or opens them.
   - `sensitivity`: `public-safe`, `internal` (default) or `restricted`, never above the user's ceiling.
   - `priority`: `low`, `normal` (default), `high` or `urgent`.
   - `parent_id` only when this is a follow-up to an existing handoff.
3. Show the user the draft and ask them to confirm before sending. A handoff cannot be edited or deleted after it is sent; the sender can only cancel it while it is still queued.
4. Call `handoff_send` once. Add an `idempotency_key` (for example a short slug plus the date) so a retry after a network error does not create a duplicate.
5. Report the handoff id, recipient, status (`queued`) and priority.

## Rules

- Create one bounded handoff per piece of work. Do not split a task into many handoffs to get round size limits.
- Never put passwords, tokens, keys or personal data in a handoff. References are labels, not secrets.
- If the server returns a policy error (recipient not allowed, sensitivity too high, payload too large, chain too deep), report it in plain words and let the user decide. Do not retry with weaker settings without asking.
- This board coordinates work. It cannot run an agent, open a link, read a file or notify anyone outside the board.
