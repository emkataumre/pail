# Pail 
<img width="350" height="350" alt="image" src="https://github.com/user-attachments/assets/adec89bd-f349-4acb-a7d1-f3e946442244" />

A minimal, legible autonomous coding loop: runs a `claude` agent through your GitHub `afk` issues
one at a time, each isolated in a git worktree, gated by your repo's own check command, merging
green work onto a local integration branch and reporting back in plain English.

See `docs/specs/2026-06-09-pail-v1-design.md` for the full design and `docs/plans/` for the build.

## Use it in a repo
1. Copy `templates/config.example.json` to `<repo>/.pail/config.json` and edit it
   (set `trunkBranch`, `integrationBranch`, `checkCommand`).
2. Copy `templates/prompt.md` to `<repo>/.pail/prompt.md` (tune to taste).
3. Make sure the repo has a single green/red check command.
4. From inside the repo: `npx tsx I:\Personal\pail\run.ts`

## Requirements
`git`, the `gh` CLI (authenticated), and the `claude` CLI on PATH.

## Develop
`npm run check`  (typecheck + tests)

## Use cases
So far I've used Pail in two real codebases: 
Inact's Inact Now web platform
AI Rådgivning's WIP AI learning platform

Pail, despite being simple, has been able to autonomously turn open issues into solved problems in a safe, human-verifiable way
