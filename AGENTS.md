# Repository execution notes

The brand marker is `/workspace/.grok/og-pending` and expires after 10 minutes.

6. **Brand-asset pass** — never wait_tasks for this task and never get_task_output for this task.
   Run `node scripts/brand-check.mjs --placeholder-ok` when appropriate.
7. Final verification.
