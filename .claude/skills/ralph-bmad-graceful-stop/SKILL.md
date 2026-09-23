---
name: ralph-bmad-graceful-stop
description: Gracefully stop a running bmad-loop run after its current in-flight story finishes (through commit), instead of hard-killing mid-story. Use when user says "stop bmad-loop", "pause bmad-loop", "stop after current story", or wants to end a bmad-loop TUI/run safely without losing in-progress work.
---

# ralph-bmad-graceful-stop

Stop a live bmad-loop run at a safe boundary: current story finishes through commit, then run stops cleanly and stays resumable. Never hard-kills mid-story (risks uncommitted/half-implemented state).

Do NOT edit `.bmad-loop/policy.toml` for this — a running run snapshots policy into its `state.json` at start; editing the file live does not affect an already-running run.

## Steps

1. Find the live run id:
   ```bash
   bmad-loop list
   ```
   Or find the running PID/process:
   ```bash
   ps aux | grep -i bmad | grep -v grep
   ```

2. Confirm current in-flight story (optional sanity check):
   ```bash
   bmad-loop status <run_id>
   ```

3. Request graceful stop:
   ```bash
   bmad-loop stop <run_id> --graceful --project <project_root>
   ```
   This finishes the in-flight item through commit, then stops cleanly and stays resumable. Suppresses pending auto-sweeps.

4. Confirm to user: which story it'll stop after, and the resume command:
   ```bash
   bmad-loop resume <run_id>
   ```

## Canceling a pending graceful stop

If user changes mind before it takes effect:
```bash
bmad-loop stop <run_id> --cancel-graceful --project <project_root>
```
