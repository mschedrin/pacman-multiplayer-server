#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$ROOT_DIR/hello-ralphex"

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

default_output="$($TARGET)"
assert_eq "$default_output" "Hello from ralphex test script" "default output"

named_output="$($TARGET --name CLI)"
assert_eq "$named_output" "Hello, CLI from ralphex test script" "--name output"

set +e
missing_name_output="$($TARGET --name 2>&1)"
missing_name_exit=$?
set -e
if [[ $missing_name_exit -eq 0 ]]; then
    echo "FAIL: missing --name value should fail"
    exit 1
fi
assert_contains "$missing_name_output" "--name requires a value" "missing --name error message"
assert_contains "$missing_name_output" "Usage:" "missing --name usage output"

set +e
name_flag_value_is_flag_output="$($TARGET --name --oops 2>&1)"
name_flag_value_is_flag_exit=$?
set -e
if [[ $name_flag_value_is_flag_exit -eq 0 ]]; then
    echo "FAIL: --name with flag-like value should fail"
    exit 1
fi
assert_contains "$name_flag_value_is_flag_output" "--name requires a value" "--name flag-like value error message"

set +e
unknown_arg_output="$($TARGET --nope 2>&1)"
unknown_arg_exit=$?
set -e
if [[ $unknown_arg_exit -eq 0 ]]; then
    echo "FAIL: unknown flag should fail"
    exit 1
fi
assert_contains "$unknown_arg_output" "unknown argument" "unknown flag error message"
assert_contains "$unknown_arg_output" "Usage:" "unknown flag usage output"

echo "PASS: hello-ralphex tests"
