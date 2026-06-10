# Pail task list (taskSource: "markdown")

Anything before the first `## ` task heading is ignored — use it for notes.
Tasks run **in file order** (not number order): put the highest-priority task first.
Pail flips the Status line (`open` → `done` / `needs-human`) and appends its summary
to the section. Only `open` tasks are picked up.

## 101: Example task title
**Status:** open

Everything until the next `## ` heading is the task body the agent receives.
Paste the full spec here — acceptance criteria, file hints, decisions already made.
Reference screenshots as local files next to this one (e.g. `.pail/shot-101.png`);
the agent opens them with its Read tool.

## 102: A finished task looks like this
**Status:** done

Original body stays.

## In plain English
What Pail's agent did, appended automatically.
