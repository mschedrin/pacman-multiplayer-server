#!/usr/bin/env bash
# opencode-review.sh - custom review script for ralphex external review phase.
#
# uses OpenCode CLI to perform code review with a configurable model,
# allowing a different model than the one used for task/review phases.
#
# config example (~/.config/ralphex/config or .ralphex/config):
#   external_review_tool = custom
#   custom_review_script = /path/to/opencode-review.sh
#
# environment variables:
OPENCODE_REVIEW_MODEL="${OPENCODE_REVIEW_MODEL:-githubcopilot/gpt-5.3-codex}"
OPENCODE_REVIEW_REASONING="${OPENCODE_REVIEW_REASONING:-high}"
# OPENCODE_REVIEW_ALLOW_ALL=1 enables wildcard permissions for review runs.
OPENCODE_REVIEW_ALLOW_ALL="${OPENCODE_REVIEW_ALLOW_ALL:-0}"

set -euo pipefail

# verify opencode is available
command -v opencode >/dev/null 2>&1 || { echo "error: opencode is required but not found" >&2; exit 1; }

# verify jq is available (required for JSON config merging)
command -v jq >/dev/null 2>&1 || { echo "error: jq is required but not found" >&2; exit 1; }

if [[ "$OPENCODE_REVIEW_ALLOW_ALL" != "0" && "$OPENCODE_REVIEW_ALLOW_ALL" != "1" ]]; then
    echo "warning: OPENCODE_REVIEW_ALLOW_ALL must be 0 or 1, got '$OPENCODE_REVIEW_ALLOW_ALL', defaulting to 0" >&2
    OPENCODE_REVIEW_ALLOW_ALL=0
fi

# prompt file path is passed as the single argument
prompt_file="${1:-}"
if [[ -z "$prompt_file" || ! -f "$prompt_file" ]]; then
    echo "error: prompt file not provided or not found" >&2
    exit 1
fi

prompt=$(cat "$prompt_file")

# build config with model override and reasoning effort.
# reasoning effort is a passthrough option — opencode forwards it directly to the provider.
base_config=$(jq -nc \
    --arg model "$OPENCODE_REVIEW_MODEL" \
    --arg reasoning "$OPENCODE_REVIEW_REASONING" \
    --arg allow_all "$OPENCODE_REVIEW_ALLOW_ALL" \
    '{
        agent: {
            coder: {
                model: $model,
                reasoningEffort: $reasoning
            }
        }
    } | if $allow_all == "1" then . + {permission: {"*": "allow"}} else . end')

# merge with existing OPENCODE_CONFIG_CONTENT if set
if [[ -n "${OPENCODE_CONFIG_CONTENT:-}" ]]; then
    OPENCODE_CONFIG_CONTENT=$(echo "$OPENCODE_CONFIG_CONTENT" | jq -c --argjson base "$base_config" '. * $base')
else
    OPENCODE_CONFIG_CONTENT="$base_config"
fi
export OPENCODE_CONFIG_CONTENT

opencode run --model "$OPENCODE_REVIEW_MODEL" "$prompt"
