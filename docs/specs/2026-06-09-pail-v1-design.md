# Pail — v1 Design Spec

- **Date:** 2026-06-09
- **Status:** Approved design — pre-implementation
- **Owner:** Emil
- **Name:** Pail 🪣 (the bucket you build sandcastles with — a hand-built, minimal equivalent of AI Hero's Sandcastle)

---

## 1. Purpose

Pail is a small, legible orchestrator that runs a coding agent **autonomously** against a backlog of GitHub issues — **one isolated task at a time**, gated by the project's own verification command, merging back only on green.

Two goals, equally weighted:

1. **Learn how an autonomous agent loop actually works** by building one where every line is legible (no framework owns the process).
2. **Have a reusable tool** that drops into any repo: add a `.pail/config.json`, run Pail from that repo.

Pail is the minimal-core rung of a ladder: **v1 serial + worktree isolation → v2 + Docker → v3 + parallel.** Each later layer touches exactly one file, by design.

---

## 2. Scope

### In scope (v1 — "minimal core")
- Serial loop — one task at a time.
- Git **worktree isolation** per task.
- Agent invocation via the **`claude` CLI**.
- **Independent verification** via the repo's `check` command (re-run by Pail, not trusted from the agent).
- **Merge-back** to a local **integration branch** on green; the human promotes it to trunk (§5, §10).
- **GitHub issues** as the work source (`gh` CLI).
- **Human-readable, at-a-glance summaries** on every write (the learn-wings convention — see §7).

### Out of scope (explicit non-goals, with growth path)
- **Docker / sandbox isolation** → v2. Changes only `agent.ts`.
- **Parallelism** → v3. Changes only `run.ts`.
- **PR-per-task hand-off** → considered and deferred; v1 uses the local integration branch (§3). PR-per-task is the natural v1.5.
- **The runtime verification system** (`~/.claude/verification.md`) → a separate, opt-in-per-repo practice. Pail does not implement it; it *composes* via `check` (§8).
- **Regenerating the `orient` digest / editing `CONTEXT.md`** → owned by the `orient` skill. Pail only writes *source-side* summaries that `orient` lifts (§7).
- **Blocking-relationship graphs / DAG scheduling** → v1 uses a simple label filter; richer dependency handling is later.

---

## 3. Constraints & decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Language | Node + TypeScript, run via `npx tsx` | Mirrors real Sandcastle, types around orchestration, matches the user's stack; dependency-light |
| Architecture | Modular — one file per concept | Legible now; clean seams for v2/v3 |
| Agent | `claude` CLI shell-out — **permanent**, not the Agent SDK | Transparent: you see the exact command invoked |
| Permission mode | `--permission-mode auto` (classifier-guarded) on host | Safer than `--dangerously-skip-permissions`; right for an un-jailed host (§10) |
| Work source | GitHub issues via `gh` | Plugs into the grill→prd→to-issues workflow |
| Hand-off / merge | **Local integration branch (batch)** — Pail merges green tasks onto `integrationBranch`; **you** promote it to trunk via a PR | Most minimal/local for v1; the staging branch *is* the trunk HITL gate |
| Failed worktrees | Remove the worktree **directory**, keep the **branch** | Clean disk, recoverable/inspectable work for HITL review |
| Home / invocation | Lives at `I:\Personal\pail`; run from inside a target repo; reads that repo's `.pail/config.json` | Reusable across any repo |

---

## 4. Architecture — module map

One small, deep module per concept. Each readable in ~30 seconds and testable alone.

| File | One job | Interface (the whole surface) | Future change |
|---|---|---|---|
| `config.ts` | Load + validate `.pail/config.json` | `loadConfig() → Config` | — |
| `issues.ts` | GitHub adapter (`gh`) | `getNextTask() → Task \| null`, `closeTask(n, summary)`, `flagForHuman(n, label, summary)` | — |
| `worktree.ts` | git worktree isolation + branch setup | `ensureBranch(name, createFrom)`, `create(from, branch) → path`, `remove(path, { keepBranch })` | — |
| `agent.ts` | Run the agent | `run(path, task, cfg) → { ok, output }` | **v2: Docker — only this file** |
| `check.ts` | Independent verify (with timeout) | `run(path, cfg) → { green: boolean, timedOut: boolean }` | — |
| `merge.ts` | Integrate | `commitAll(path, message)`, `mergeInto(taskBranch, target) → { merged, conflict }` | — |
| `prompt.ts` | Build the standing prompt | `build(task, cfg) → string` (reads `.pail/prompt.md`) | — |
| `humanSummary.ts` | Format the at-a-glance header | `format({ plainEnglish, whyItMatters, detail }) → string` | — |
| `run.ts` | The loop that orders the above | *(entrypoint)* | **v3: parallel — only this file** |

**Deep-module test:** you can rewrite any file's internals without touching its callers, because the interface is the contract.

---

## 5. The loop (`run.ts`, serial)

```
cfg = loadConfig()
worktree.ensureBranch(cfg.integrationBranch, cfg.trunkBranch)   // bootstrap: create staging branch from trunk if missing
consecutiveFailures = 0

loop (until no AFK issues, or maxIterations, or circuit-breaker):
    task = issues.getNextTask()                 // lowest-numbered open issue with afkLabel, not 'blocked'
    if task is null: break                       // backlog drained → clean exit

    branch = `${cfg.branchPrefix}/issue-${task.number}`
    path   = worktree.create(cfg.integrationBranch, branch)   // fork the task branch FROM the integration branch

    { ok, output } = agent.run(path, task, cfg)  // claude CLI, cwd=path, told to TDD + self-check
    merge.commitAll(path, <human-summary commit msg>)   // safety: capture whatever the agent did (no-op if clean)

    if not ok:
        FAIL(task, branch, path, "agent did not complete", output); continue

    { green, timedOut } = check.run(path, cfg)   // INDEPENDENT re-run, fresh — never trust the agent's "done"
    if not green:
        FAIL(task, branch, path, timedOut ? "check timed out (hang)" : "check failed", output); continue

    { merged, conflict } = merge.mergeInto(branch, cfg.integrationBranch)   // local merge onto the staging branch
    if conflict:
        FAIL(task, branch, path, "merge conflict", output); continue

    issues.closeTask(task.number, <human-summary: what merged + why>)
    worktree.remove(path, { keepBranch: false })  // success → merged into integration, safe to drop the branch
    consecutiveFailures = 0

FAIL(task, branch, path, reason, output):
    issues.flagForHuman(task.number, cfg.humanLabel, <plain-English: what happened + decision needed>)
    worktree.remove(path, { keepBranch: true })   // keep branch for inspection; clean the dir
    consecutiveFailures++
    if consecutiveFailures >= cfg.maxConsecutiveFailures: stop("circuit breaker")

end: print plain-English run report (picked up / merged / needs-human)
```

**Two-layer verification on purpose:** the agent is *told* to make `check` pass (its self-check), then Pail runs `check` **again, independently**, before merging. We never merge on the agent's word. That is the anti-slop thesis in five lines.

**The trunk gate is yours:** Pail only ever merges onto `integrationBranch`, locally. Nothing reaches `trunkBranch` until *you* open `integrationBranch → trunkBranch` and review the batch. Pail never touches trunk (and the `guard-trunk` hook enforces that).

---

## 6. Configuration

### `.pail/config.json` (per-repo — the reuse surface)

```jsonc
{
  "trunkBranch": "main",                  // your real mainline — Pail NEVER commits here; YOU promote to it
  "integrationBranch": "integration/pail",// Pail's local staging branch; created from trunkBranch if missing
  "afkLabel": "afk",                      // only issues with this label are eligible
  "humanLabel": "pail-needs-human",       // applied when a task can't complete autonomously
  "checkCommand": "npm run check",        // the single green/red gate
  "checkTimeoutMs": 180000,               // kill a hanging check → counts as red (e.g. the functions open-handle hang)
  "maxIterations": 10,                    // runaway / cost backstop
  "maxConsecutiveFailures": 3,            // circuit breaker — don't burn the whole backlog into failure
  "branchPrefix": "pail",                 // task branches: pail/issue-<n>
  "claudeArgs": ["--permission-mode", "auto"]   // v1 host-safe; v2 Docker → ["--permission-mode","bypassPermissions"]
}
```

### `.pail/prompt.md` (the standing AFK prompt — your main customization knob; DRAFT, refine together)

Standing instructions handed to every fresh agent, with the issue interpolated:

> You are working a single GitHub issue in an **isolated git worktree**. Implement it and nothing else.
> - Work **test-first** (red → green → refactor). One vertical slice.
> - Run `npm run check` and ensure it is **green** before you finish.
> - **Commit** your work with a message that leads with the human-summary header:
>   `## In plain English` (one jargon-free sentence) · `## Why it matters / who it affects` · `---` · `## What changed` · `## Testing`.
> - Do **not** push, open a PR, or merge. Do not touch files outside this worktree.
> - If you **cannot** complete it, stop and explain **in plain English** what's blocking you and what decision a human needs to make.
>
> --- Issue #{number}: {title} ---
> {body}

`.pail/prompt.md` is the "push" surface you tune per project; `config.json` is the per-project settings. Both live in the *target* repo, so each repo customizes Pail without forking it.

---

## 7. Human-summary + HITL integration (the learn-wings convention)

Pail adopts the existing `.github` template convention everywhere it writes, so its output flows into the `orient` comprehension digest.

**The header format** (`humanSummary.ts`), matching `task.yml` / `pull_request_template.md`:

```
## In plain English
<one sentence a non-author / future-you understands — no file paths, no jargon>

## Why it matters / who it affects
<real-user bug / launch-blocker / security / cleanup / nicety — and who>

---
<technical detail: What changed · Testing · Notes>
```

Applied at every Pail write:
- **Close comment** (success): plain-English "what merged + why" + the `check` result.
- **`pail-needs-human` comment** (HITL stop): plain-English "what happened + the decision you need" — never a silent skip.
- **Commit / merge message:** the same header (per `pull_request_template.md`).
- **End-of-run report:** plain-English summary — picked up / merged / needs-human.

**Why this is worth it:** your `orient` skill already *"lifts the human-summary header when present."* So everything Pail writes is automatically legible in `/orient` when you return from being away — **the AFK loop becomes part of your comprehension layer, not a black box.**

**Clean separation (respecting your architecture):** Pail only writes **source-side** summaries. It does **not** regenerate `digest.html` or edit `CONTEXT.md` — those stay owned by `orient` / handoff. `humanSummary.ts` is the only place the format lives; `issues.ts` and `merge.ts` consume it.

---

## 8. Relationship to the verification system

Four distinct layers; Pail is the orchestrator that runs *gated by* the others:

| Layer | Answers | Owner | In Pail? |
|---|---|---|---|
| Tests / typecheck (`check`) | "Is the logic correct in isolation?" | the repo | runs it (`check.ts`) |
| **Verification** (`verification.md`) | "Does the *running thing* work?" | the repo, **opt-in** | **no** — composes via `check` |
| **Comprehension** (`orient`) | "What's going on, in plain English?" | the repo (`orient` skill) | writes *into* it (§7) |
| **Pail** | "Run an agent on a task, gated by the above" | the orchestrator | — |

If a repo opts into `verification.md`, its verifiers run inside the test runner → become part of `npm run check` → **Pail's "green" automatically gets stronger.** That is "feedback loops set the ceiling," literally. learn-wings has **not** opted in (no `CLAUDE.local.md`), and its `orient` skill flags verification as "a separate, later initiative" — so Pail stays out of it and benefits later if it's turned on.

---

## 9. Error handling

| Situation | Behavior |
|---|---|
| No eligible AFK issues | Clean exit 0. |
| Agent errors / non-zero | No merge. `pail-needs-human` + plain-English comment. Clean worktree dir, keep branch. |
| `check` red | Same as above; comment names it as a check failure with the output tail. |
| `check` hangs | `checkTimeoutMs` kills it → treated as red (the learn-wings functions open-handle case). |
| Merge conflict | Don't close; `pail-needs-human` + comment (reason: merge conflict); keep branch; continue. (Rare in serial — integration branch only moves forward.) |
| N consecutive failures | Circuit-breaker stop, so the loop can't grind the whole backlog into failure. |
| Ctrl-C / abort | Finish/abandon the current iteration, leave state inspectable, exit. |

---

## 10. Safety model (v1 = host, no Docker — deliberate)

Pail runs the agent on the **host** with `--permission-mode auto`. The `auto` classifier **auto-approves safe actions and denies risky ones**; in non-interactive (`-p`) mode a denied action simply doesn't run (the agent adapts or flags). Layered mitigations:

- **Worktree isolation** — your main working copy is untouched until a merge.
- **Merge only on independent green.**
- **Dedicated integration branch** (`integration/pail`), never trunk — Pail merges green work here *locally*; **you** promote it to `main` via a PR when satisfied (the trunk HITL gate). Respects the repo's `guard-trunk` hook.
- **`maxIterations`** + **circuit breaker** caps runaway cost/looping.
- **Watch the first runs.** The mild nervousness of running un-jailed is the lesson that motivates v2.

**v2 (Docker)** removes the nervousness: switch `claudeArgs` to `bypassPermissions` *inside the container*, where full autonomy is safe because it's contained. One-line config change + the `agent.ts` swap.

Pail's worktrees live in `.pail/worktrees/`, **separate** from the `.claude/worktrees/` your slice-workflow uses — no collision.

---

## 11. Testing strategy (build Pail *with* TDD — dogfooding)

- `humanSummary.ts` — pure function; assert exact formatting.
- `config.ts` — assert parse/validation, defaults, bad-config errors.
- `issues.ts` — mock the `gh` exec; assert query construction, parsing, filtering (label, not-blocked), comment/label calls.
- `worktree.ts` / `merge.ts` — integration tests against a throwaway temp git repo (ensureBranch → create → commit → mergeInto → conflict → remove).
- `check.ts` — point at fake scripts that exit 0 / exit 1 / hang past the timeout.
- `agent.ts` — mock the `claude` exec; assert the command line (cwd, `--permission-mode auto`, prompt wiring) and ok/output mapping.
- `run.ts` — inject fakes for every module; assert the orchestration for each branch (success, agent-fail, red, timeout, conflict, circuit-breaker). The modular seams make this clean.
- Runner: **Vitest**, matching the user's stack.

---

## 12. Reusability

Pail is a standalone tool. To use it in any repo:

1. Add `.pail/config.json` and `.pail/prompt.md` to that repo.
2. Ensure the repo has a single `check` command (green/red).
3. From inside the repo: `npx tsx I:\Personal\pail\run.ts` (a thin wrapper / npm bin can come later).

Pail operates on the current working directory's repo and its `.pail/` config — nothing is hard-coded to learn-wings.

---

## 13. Growth path

- **v2 — Docker isolation.** Swap `agent.ts` to run the agent in a container with the worktree bind-mounted; `claudeArgs` → `bypassPermissions`. Nothing else changes.
- **v3 — Parallelism.** Change `run.ts` to dispatch N unblocked tasks concurrently (each its own worktree + container) with a small concurrency cap and a merge queue. Other modules unchanged.
- **Later** — PR-per-task hand-off, dependency DAG from issue `Depends on` / `Blocked by`, a `gh`-vs-local task-source abstraction.

---

## 14. Resolved decisions (were the open questions)

- **Branch model.** Two named branches in the *target* repo: `trunkBranch` (e.g. `main`) — Pail never commits to it; and `integrationBranch` (e.g. `integration/pail`) — Pail's local staging branch, **created from `trunkBranch` if missing** on first run. Task branches (`pail/issue-<n>`) fork from and merge into `integrationBranch`. **You** promote `integrationBranch → trunkBranch` via a PR — that's the trunk HITL gate. (Chosen over PR-per-task for v1 minimalism; PR-per-task is the v1.5 option.)
- **Commit authorship/attribution.** Follow the target repo's existing convention; finalize at implementation.
- **`gh` "unblocked" definition** (v1). Eligible = **open** + has `afkLabel` + does **not** have a `blocked` label + has no "Blocked by" external note in its body. Pail picks the **lowest-numbered** eligible issue each iteration. Dependency ordering beyond this is the later DAG.

---

*Built via the brainstorming workflow. Next step after your review: an implementation plan (writing-plans), then TDD build.*
