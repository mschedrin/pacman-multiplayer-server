# Project knowledge notes

## hello-ralphex script pattern

- Keep repository utility scripts in Bash with strict mode: `#!/usr/bin/env bash` and `set -euo pipefail`.
- Keep command behavior deterministic so tests can assert exact output text.
- Parse flags explicitly and print usage + non-zero exit for invalid arguments.

## Shell test pattern

- Place lightweight executable shell tests under `tests/`.
- Validate both success and failure paths by checking output and exit codes.
