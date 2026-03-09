#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$ROOT_DIR/.ralphex/opencode-review.sh"

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
printf '%s' "${OPENCODE_CONFIG_CONTENT:-}" > "${CAPTURE_CONFIG_FILE:?}"
printf '%s' "$*" > "${CAPTURE_ARGS_FILE:?}"
EOF
chmod +x "$tmp_dir/opencode"

test_path="$tmp_dir:$PATH"

set +e
missing_prompt_output="$(PATH="$test_path" "$TARGET" 2>&1)"
missing_prompt_exit=$?
set -e
if [[ $missing_prompt_exit -eq 0 ]]; then
    echo "FAIL: missing prompt file should fail"
    exit 1
fi
assert_contains "$missing_prompt_output" "prompt file not provided or not found" "missing prompt file error"

prompt_file="$tmp_dir/prompt.txt"
printf '%s' 'review me' > "$prompt_file"
config_file="$tmp_dir/config.json"
args_file="$tmp_dir/args.txt"

PATH="$test_path" CAPTURE_CONFIG_FILE="$config_file" CAPTURE_ARGS_FILE="$args_file" OPENCODE_CONFIG_CONTENT='{}' "$TARGET" "$prompt_file"
captured_config="$(cat "$config_file")"
captured_args="$(cat "$args_file")"

assert_contains "$captured_config" '"agent":{"coder"' "config should include coder model override"
assert_contains "$captured_config" '"reasoningEffort":"high"' "config should include reasoning effort"
if [[ "$captured_config" == *'"permission":{"*":"allow"}'* ]]; then
    echo "FAIL: default config should not force allow-all permissions"
    exit 1
fi
assert_contains "$captured_args" '--model' "opencode args should include model flag"
assert_contains "$captured_args" 'review me' "opencode args should include prompt text"

PATH="$test_path" CAPTURE_CONFIG_FILE="$config_file" CAPTURE_ARGS_FILE="$args_file" OPENCODE_CONFIG_CONTENT='{}' OPENCODE_REVIEW_ALLOW_ALL=1 "$TARGET" "$prompt_file"
captured_allow_all_config="$(cat "$config_file")"
assert_contains "$captured_allow_all_config" '"permission":{"*":"allow"}' "allow-all review mode should be opt-in"

echo "PASS: opencode-review tests"
