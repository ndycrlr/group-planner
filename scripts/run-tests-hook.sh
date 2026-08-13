#!/usr/bin/env bash
#
# Runs the Playwright suite for the Claude Code hooks in .claude/settings.json.
#
#   --after-edit   PostToolUse on Edit/Write. Notes that the tree has changed,
#                  and runs the suite straight away when the edited file is one
#                  the tests actually cover.
#   --if-pending   Stop. Runs the suite only if an edit since the last green run
#                  has not been checked yet, so a turn that only talked does not
#                  pay for a test run.
#
# A failure exits 2, which feeds the output back to Claude rather than failing
# silently. Everything else exits 0.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 0

MARKER='.test-pending'
mode="${1:---if-pending}"

# Node rather than jq: this is a Node project, so node is always here and jq is
# not (notably on Windows).
read_file_path() {
  node -e "
    let raw = '';
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try {
        const payload = JSON.parse(raw);
        process.stdout.write(payload.tool_input?.file_path ?? payload.tool_response?.filePath ?? '');
      } catch {
        process.stdout.write('');
      }
    });
  " 2>/dev/null
}

# The files the suite can actually say anything about.
covers() {
  case "$1" in
    *public/*|*/server.js|*/db.js|*tests/*|*playwright.config.js) return 0 ;;
    *) return 1 ;;
  esac
}

run_suite() {
  local output status
  # The dot reporter keeps passing tests to one character each, so the tail
  # below is the actual failure rather than a wall of ticks.
  output="$(npm test --silent -- --reporter=dot 2>&1)"
  status=$?

  if [ $status -ne 0 ]; then
    echo "The Playwright suite is failing. Fix this before moving on."
    echo
    # Enough of the tail to carry the failure and its diff, not the whole log.
    echo "$output" | tail -c 4000
    exit 2
  fi

  rm -f "$MARKER"
  exit 0
}

case "$mode" in
  --after-edit)
    file="$(read_file_path)"
    # Any edit means the tree is unverified, even one the filter below skips —
    # that is what the Stop hook picks up later.
    touch "$MARKER"
    [ -n "$file" ] || exit 0
    covers "$file" || exit 0
    run_suite
    ;;
  --if-pending)
    [ -f "$MARKER" ] || exit 0
    run_suite
    ;;
  *)
    echo "usage: run-tests-hook.sh [--after-edit|--if-pending]" >&2
    exit 0
    ;;
esac
