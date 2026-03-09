# pacman-multiplayer-server

This repository includes a tiny smoke-test utility script named `hello-ralphex`.

## hello-ralphex usage

Run with default output:

```bash
./hello-ralphex
```

Expected output:

```text
Hello from ralphex test script
```

Run with a custom name:

```bash
./hello-ralphex --name "CLI"
```

Expected output:

```text
Hello, CLI from ralphex test script
```

## Run tests

```bash
bash tests/hello-ralphex_test.sh
```

To run all shell tests in this repository:

```bash
for test_file in tests/*_test.sh; do bash "$test_file"; done
```

## Ralphex + OpenCode setup

This repository can run ralphex tasks and reviews through OpenCode wrappers in `.ralphex/`.

Required tools:
- `opencode`
- `jq`
- `ralphex`

Configuration:
- `.ralphex/config` points `claude_command` to `.ralphex/opencode-as-claude.sh`.
- `.ralphex/config` uses `.ralphex/opencode-review.sh` for external review.

Useful environment variables:
- `OPENCODE_MODEL` (task/review adapter model override)
- `OPENCODE_VERBOSE` (`0`/`1` output verbosity for adapter stream)
- `OPENCODE_ALLOW_ALL` (`0` by default, set `1` to opt in to wildcard permissions)
- `OPENCODE_REVIEW_MODEL` (external review model override)
- `OPENCODE_REVIEW_REASONING` (external review reasoning effort)
- `OPENCODE_REVIEW_ALLOW_ALL` (`0` by default, set `1` to opt in to wildcard permissions)
- `OPENCODE_CONFIG_CONTENT` (merged config JSON passed to OpenCode)

## Devcontainer

- `.devcontainer/devcontainer.json` currently builds from `.devcontainer/Dockerfile.opencode`.
- The container installs OpenCode, Go, and ralphex tooling for local workflow testing.
- Host-mounted OpenCode/Claude credential directories are commented out; authenticate/configure inside the container when needed.
- `IS_SANDBOX=1` is set in container environment.
