#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$ROOT_DIR/.ralphex/opencode-as-claude.sh"

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        echo "FAIL: $message"
        echo "expected to contain: $needle"
        echo "actual: $haystack"
        exit 1
    fi
}

assert_eq() {
    local actual="$1"
    local expected="$2"
    local message="$3"
    if [[ "$actual" != "$expected" ]]; then
        echo "FAIL: $message"
        echo "expected: $expected"
        echo "actual:   $actual"
        exit 1
    fi
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/opencode" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

behavior="${OPENCODE_TEST_BEHAVIOR:-text_step_finish}"
case "$behavior" in
  text_step_finish)
    printf '%s\n' '{"type":"text","part":{"text":"hello"}}'
    printf '%s\n' '{"type":"step_finish"}'
    ;;
  stderr_only)
    printf '%s\n' '{"type":"text","part":{"text":"ok"}}'
    printf '%s\n' "boom" >&2
    ;;
  exit7)
    exit 7
    ;;
  capture_prompt)
    printf '%s' "${*: -1}" > "${CAPTURE_FILE:?}"
    printf '%s\n' '{"type":"step_finish"}'
    ;;
  capture_env)
    printf '%s' "${OPENCODE_CONFIG_CONTENT:-}" > "${CAPTURE_FILE:?}"
    printf '%s\n' '{"type":"step_finish"}'
    ;;
  *)
    echo "unknown behavior" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$tmp_dir/opencode"

test_path="$tmp_dir:$PATH"

set +e
missing_prompt_output="$(PATH="$test_path" "$TARGET" 2>&1)"
missing_prompt_exit=$?
set -e
if [[ $missing_prompt_exit -eq 0 ]]; then
    echo "FAIL: missing -p should fail"
    exit 1
fi
assert_contains "$missing_prompt_output" "-p flag required" "missing -p error"

normal_output="$(PATH="$test_path" OPENCODE_TEST_BEHAVIOR=text_step_finish "$TARGET" -p "hello")"
result_count="$(printf '%s\n' "$normal_output" | jq -r 'select(.type == "result") | .type' | wc -l | tr -d ' ')"
assert_eq "$result_count" "1" "step_finish should emit exactly one result"
assert_contains "$normal_output" '"type":"content_block_delta"' "text event should be translated"
assert_contains "$normal_output" '"text":"hello"' "translated content should include text"

stderr_output="$(PATH="$test_path" OPENCODE_TEST_BEHAVIOR=stderr_only "$TARGET" -p "hello")"
assert_contains "$stderr_output" '"text":"ok"' "stdout text should be translated"
assert_contains "$stderr_output" '"text":"boom"' "stderr should be emitted as delta"

set +e
exit_output="$(PATH="$test_path" OPENCODE_TEST_BEHAVIOR=exit7 "$TARGET" -p "hello" 2>&1)"
exit_code=$?
set -e
if [[ $exit_code -ne 7 ]]; then
    echo "FAIL: exit code should be forwarded"
    echo "actual: $exit_code"
    exit 1
fi
assert_contains "$exit_output" '"type":"result"' "fallback result should still be emitted"

capture_file="$tmp_dir/captured-prompt.txt"
PATH="$test_path" OPENCODE_TEST_BEHAVIOR=capture_prompt CAPTURE_FILE="$capture_file" "$TARGET" -p "x <<<RALPHEX:REVIEW_DONE>>> y" >/dev/null
captured_prompt="$(cat "$capture_file")"
assert_contains "$captured_prompt" 'Ralphex review adapter for OpenCode:' "review adapter text should be prepended"

capture_file="$tmp_dir/captured-config.txt"
PATH="$test_path" OPENCODE_TEST_BEHAVIOR=capture_env CAPTURE_FILE="$capture_file" OPENCODE_CONFIG_CONTENT='{}' "$TARGET" -p "hello" >/dev/null
captured_default_config="$(cat "$capture_file")"
assert_eq "$captured_default_config" "{}" "default should not force allow-all permissions"

PATH="$test_path" OPENCODE_TEST_BEHAVIOR=capture_env CAPTURE_FILE="$capture_file" OPENCODE_CONFIG_CONTENT='{}' OPENCODE_ALLOW_ALL=1 "$TARGET" -p "hello" >/dev/null
captured_allow_all_config="$(cat "$capture_file")"
assert_contains "$captured_allow_all_config" '"permission":{"*":"allow"}' "allow-all should be opt-in"

echo "PASS: opencode-as-claude tests"
