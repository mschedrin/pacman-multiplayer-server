# Project knowledge notes

## hello-ralphex script pattern

- Keep repository utility scripts in Bash with strict mode: `#!/usr/bin/env bash` and `set -euo pipefail`.
- Keep command behavior deterministic so tests can assert exact output text.
- Parse flags explicitly and print usage + non-zero exit for invalid arguments.

## Shell test pattern

- Place lightweight executable shell tests under `tests/`.
- Validate both success and failure paths by checking output and exit codes.

## OpenCode adapter pattern

- `.ralphex/opencode-as-claude.sh` maps OpenCode JSON events to Claude stream-json events (`text` to `content_block_delta`, `step_finish` to `result`).
- When a review prompt includes `<<<RALPHEX:REVIEW_DONE>>>`, prepend the adapter instruction block and preserve all original `<<<RALPHEX:...>>>` signals.
- Forward `SIGTERM` to the child OpenCode process and preserve the child exit code.
- Emit a fallback final result event only when no `step_finish` result was emitted.
- Default to existing permission policy; wildcard permissions require explicit `OPENCODE_ALLOW_ALL=1`.

## Review script pattern

- `.ralphex/opencode-review.sh` expects a prompt-file argument and exits non-zero for missing files.
- Merge external review settings into `OPENCODE_CONFIG_CONTENT` with model/reasoning overrides.
- Keep wildcard permissions opt-in via `OPENCODE_REVIEW_ALLOW_ALL=1`.
