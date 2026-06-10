# Markdown task source (design)

**Date:** 2026-06-10
**Status:** approved

## Why

Some target repos can't host Pail's GitHub conventions — e.g. a team repo where creating
an `afk` label (or having a bot close/comment issues) isn't appropriate. First concrete
case: the Inact `platform` monorepo. Pail needs a task source that lives entirely in the
local working copy and never touches the repo's GitHub project.

## What

A new, **optional** task source selected by config. The GitHub source stays the default
and is bit-for-bit unchanged; existing configs (no `taskSource` field) behave identically.

### Config

- `taskSource: "github" | "markdown"`, default `"github"`.
- Any other value → load-time error.

### File format — `.pail/tasks.md`

```markdown
# Anything before the first task heading is ignored (use it for notes).

## 6620: Tooltip cuts off on limit column
**Status:** open

Full task text. Everything until the next `## ` heading is the body.
Reference local screenshots as files next to this one (.pail/shot-6620.png).

## 6630: BaseDialog should close on Esc
**Status:** done
...
```

- A task = a `## <number>: <title>` heading.
- `**Status:**` line directly states the task state: `open`, `done`, `needs-human`.
  A section without a status line counts as `open` (Pail inserts the line when it
  first writes to the section). Anything that isn't `open` is skipped.
- **Tasks run in file order**, not number order — the author controls priority by
  ordering sections. (GitHub source keeps lowest-number-first; unchanged.)

### Operations (same trio the GitHub source provides)

| Deps slot | markdown behaviour |
|---|---|
| `getNextTask` | first section in file order with status `open`, else `null` |
| `closeTask` | flip status to `done`, append the plain-English summary to the section |
| `flagForHuman` | flip status to `needs-human`, append the reason (label arg unused) |

Writes edit only the targeted section; the rest of the file is preserved.

## How

- New module `src/tasksMd.ts` (+ tests), real `fs` against temp dirs like `config.test.ts`.
- `Deps` in `run.ts` is **unchanged**; `main()` wires the markdown functions in
  (closing over `repoRoot`) when `cfg.taskSource === "markdown"`. `runLoop` untouched.
- `types.ts`: add `taskSource` to `Config`.
- `templates/tasks.example.md` documents the format.

## Out of scope

- Atomic task-claiming for parallel instances (v3 concern; file-based source makes the
  eventual lease cheap — flip status to `claimed` — but not now).
- Reading GitHub issues read-only to *populate* tasks.md (the human curates the file).
