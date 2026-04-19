#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for the Agent Tick Claude Code hook" >&2
  exit 2
fi

agent_tick_bin="${AGENT_TICK_BIN:-agent-tick}"
if ! command -v "$agent_tick_bin" >/dev/null 2>&1; then
  echo "agent-tick is required for the Agent Tick Claude Code hook" >&2
  exit 2
fi

payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT
cat >"$payload_file"

tool_name="$(jq -r '.tool_name // ""' "$payload_file")"
if [[ "$tool_name" != "AskUserQuestion" ]]; then
  exit 0
fi

questions_json="$(jq '.tool_input.questions // []' "$payload_file")"
if [[ "$(printf '%s' "$questions_json" | jq 'length')" -eq 0 ]]; then
  echo "Claude Code did not provide any AskUserQuestion prompts" >&2
  exit 2
fi

title="${AGENT_TICK_CLAUDE_TITLE:-Claude Code Questions}"
body="${AGENT_TICK_CLAUDE_BODY:-Answer these Claude Code questions to continue the session.}"
timeout="${AGENT_TICK_TIMEOUT:-30m}"

request_json="$(
  jq -n \
    --arg title "$title" \
    --arg body "$body" \
    --arg session_id "$(jq -r '.session_id // ""' "$payload_file")" \
    --arg tool_use_id "$(jq -r '.tool_use_id // ""' "$payload_file")" \
    --arg transcript_path "$(jq -r '.transcript_path // ""' "$payload_file")" \
    --argjson questions "$questions_json" \
    '{
      title: $title,
      body: $body,
      requestType: "questionnaire",
      questions: $questions,
      metadata: {
        source: "claude-code",
        sessionId: $session_id,
        toolUseId: $tool_use_id,
        transcriptPath: $transcript_path
      }
    }'
)"

if ! response_json="$("$agent_tick_bin" adapter --timeout "$timeout" <<<"$request_json")"; then
  echo "Agent Tick could not collect Claude Code answers" >&2
  exit 2
fi

answers_json="$(printf '%s' "$response_json" | jq '.response.answers // {}')"
if [[ "$(printf '%s' "$answers_json" | jq 'length')" -eq 0 ]]; then
  echo "Agent Tick did not return any questionnaire answers" >&2
  exit 2
fi

claude_answers_json="$(
  printf '%s' "$answers_json" | jq '
    with_entries(
      .value |= if length <= 1 then (.[0] // "") else join(", ") end
    )
  '
)"

jq -n \
  --argjson questions "$questions_json" \
  --argjson answers "$claude_answers_json" \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Answers collected through Agent Tick",
      updatedInput: {
        questions: $questions,
        answers: $answers
      }
    }
  }'
