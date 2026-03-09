# Add simple hello script

## Overview
- Add a tiny root-level Bash script `hello-ralphex` to validate local ralphex-driven workflow in this repository.
- Solve the immediate need for a minimal, deterministic script used only for smoke testing and onboarding confidence.
- Scope expanded during implementation to also wire OpenCode adapters for ralphex task/review flows and devcontainer support.

## Context (from discovery)
- Files/components involved: `hello-ralphex`, `tests/hello-ralphex_test.sh`, `.ralphex/config`, `.ralphex/opencode-as-claude.sh`, `.ralphex/opencode-review.sh`, `.devcontainer/Dockerfile.opencode`, `.devcontainer/devcontainer.json`, `README.md`, `docs/knowledge.md`, skill docs under `.agents/skills/`.
- Related patterns found: existing scripts (`dev`, `.ralphex/opencode-as-claude.sh`, `.ralphex/opencode-review.sh`) use Bash shebang and strict mode (`set -euo pipefail`).
- Dependencies identified: Bash plus tooling for adapter/devcontainer flow (`opencode`, `jq`, Go toolchain, ralphex).

## Development Approach
- **Testing approach**: Regular (code first, then tests) per user preference.
- Complete each task fully before moving to the next.
- Make small, focused changes.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task.
  - tests are not optional - they are a required part of the checklist
  - write unit tests for new functions/methods
  - write unit tests for modified functions/methods
  - add new test cases for new code paths
  - update existing test cases if behavior changes
  - tests cover both success and error scenarios
- **CRITICAL: all tests must pass before starting next task** - no exceptions.
- **CRITICAL: update this plan file when scope changes during implementation**.
- Run tests after each change.
- Maintain backward compatibility.

## Testing Strategy
- **Unit tests**: required for every task (see Development Approach above).
- For this repo, implement lightweight shell-based tests as executable test scripts under `tests/`.
- **E2E tests**: not applicable unless UI/e2e tooling is introduced later.

## Progress Tracking
- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.
- Update plan if implementation deviates from original scope.
- Keep plan in sync with actual work done.

## What Goes Where
- **Implementation Steps** (`[ ]` checkboxes): tasks achievable within this codebase - code changes, tests, documentation updates.
- **Post-Completion** (no checkboxes): items requiring external action - manual testing, changes in consuming projects, deployment configs, third-party verifications.

## Implementation Steps

### Task 1: Add root hello script
- [x] create executable `hello-ralphex` with `#!/usr/bin/env bash` and `set -euo pipefail`
- [x] implement output `Hello from ralphex test script` by default
- [x] add optional `--name <value>` argument to print `Hello, <value> from ralphex test script`
- [x] write tests for success cases (`default output`, `--name` output)
- [x] write tests for error/edge cases (missing `--name` value, unknown flag)
- [x] run tests - must pass before next task

### Task 2: Verify acceptance criteria
- [x] verify all requirements from Overview are implemented
- [x] verify edge cases are handled
- [x] run full test suite (unit tests)
- [x] run e2e tests if project has them (N/A: no e2e test suite present)
- [x] run linter - all issues must be fixed (shellcheck unavailable in environment; used `bash -n` syntax checks)
- [x] verify test coverage meets project standard (80%+) (validated via branch coverage of script logic)

### Task 3: [Final] Update documentation
- [x] update README.md if needed with script usage examples
- [x] update project knowledge docs if new patterns discovered

### ➕ Task 4: Wire OpenCode adapters and container tooling
- [x] add `.ralphex/config` entries to route ralphex task and external review through OpenCode wrapper scripts
- [x] add/adjust adapter scripts in `.ralphex/` and preserve review signal behavior
- [x] switch devcontainer to `.devcontainer/Dockerfile.opencode` and install required tooling
- [x] update docs for OpenCode/ralphex setup and container behavior
- [x] add shell tests for `.ralphex/opencode-as-claude.sh` and `.ralphex/opencode-review.sh`

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`*

## Technical Details
- Data structures and changes: simple argument parsing with positional/flag handling in Bash plus JSON event translation in the OpenCode adapter.
- Parameters and formats: `hello-ralphex [--name <value>]`; adapter env toggles (`OPENCODE_VERBOSE`, `OPENCODE_ALLOW_ALL`, `OPENCODE_REVIEW_ALLOW_ALL`).
- Processing flow: parse args -> validate -> render deterministic message for script; for adapter, run OpenCode -> map events -> emit exactly one terminal result -> preserve child exit status.

## Post-Completion
*Items requiring manual intervention or external systems - no checkboxes, informational only*

**Manual verification** (if applicable):
- Run `./hello-ralphex` and `./hello-ralphex --name "CLI"` in a clean shell.
- Confirm executable permissions are preserved after commit/clone.

**External system updates** (if applicable):
- None expected for this local test utility.
