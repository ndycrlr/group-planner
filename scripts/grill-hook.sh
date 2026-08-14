#!/usr/bin/env bash
#
# PostToolUse on Bash/PowerShell for the hook in .claude/settings.json: after a
# shell command that actually landed a commit, asks Claude to open a grilling
# session on it (the `grilling` skill in .agents/skills/).
#
# Two conditions, both needed. The command has to look like a commit, so
# checkouts and rebases that also move HEAD stay quiet; and HEAD has to have
# actually moved, so a commit the commit-msg hook rejected — or a --dry-run —
# does not start an interview about a commit that does not exist.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 0

MARKER='.grill-last-commit'

# Node rather than jq: this is a Node project, so node is always here and jq is
# not (notably on Windows).
read_command() {
  node -e "
    let raw = '';
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try {
        const payload = JSON.parse(raw);
        process.stdout.write(payload.tool_input?.command ?? '');
      } catch {
        process.stdout.write('');
      }
    });
  " 2>/dev/null
}

command_run="$(read_command)"
case "$command_run" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

head="$(git rev-parse HEAD 2>/dev/null)"
[ -n "$head" ] || exit 0

previous="$(cat "$MARKER" 2>/dev/null)"
printf '%s' "$head" > "$MARKER"
[ "$head" != "$previous" ] || exit 0

subject="$(git log -1 --format=%s 2>/dev/null)"

# additionalContext rather than exit 2: this is an instruction for the next
# turn, not a failure to feed back.
node -e "
  const context = [
    'A commit just landed: ' + process.argv[1] + ' (' + process.argv[2] + ').',
    '',
    'Every commit in this repository is followed by a grilling session. Invoke the',
    '\`grilling\` skill now and run it against this commit: read the diff with',
    '\`git show ' + process.argv[2] + '\`, build the design tree from the decisions the',
    'change actually makes, and put the first round of questions to the user.',
  ].join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: context,
    },
  }));
" "$subject" "$head"

exit 0
