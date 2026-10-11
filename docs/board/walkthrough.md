# Walkthrough

A five-minute tour of Agent Handoff Board on the seeded demo workspace.

1. **Who am I?** Connect as `demo-operator` and ask "who am I on the handoff board?". The assistant calls `handoff_whoami` and shows the identity, who it may send to and receive from, and its disclosure ceiling. These come from the operator's registry, not from the chat.
2. **Create.** "Hand off adding a /version endpoint to the coder agent, high priority." The assistant drafts title, summary, request and references, asks you to confirm, then sends. The handoff is `queued`.
3. **Review.** Switch to `demo-coder` and ask "what is waiting for me?". The inbox shows the new handoff and the seeded urgent credential rotation that is `blocked` on a maintenance window.
4. **Accept.** "Accept the /version handoff." The assistant shows it in full first, then accepts. Status `accepted`.
5. **Close.** "Mark it completed: merged, test added." Status `completed`.
6. **Audit.** Switch back to `demo-operator`: "show me the history of the /version handoff". Three events, each with actor, status change, note and time. There is no edit or delete; that is the point.
7. **Governance in action.** As `demo-planner`, try to send work straight to the reviewer. The board refuses: the planner's policy only allows the operator and the coder. As `demo-reviewer`, try to read the /version handoff: not found or not accessible.

What it does not do: run agents, open the references, read files, notify anyone, or sell anything. For help putting governed agent workflows like this into a real team, see [Astraeus Business Solutions](https://astraeus.ie).
