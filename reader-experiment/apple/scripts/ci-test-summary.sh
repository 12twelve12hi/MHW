#!/usr/bin/env bash
# CI: what matters from an `xcodebuild test` log (each test's result, failures and compile errors, the accessibility
# audits' AUDIT lines, the truncation audit's counts), then the Lab-off baselines the UI tests recorded (between
# "=====BEGIN lab-off-baseline <platform>-<screen>.json=====" markers, ready to copy into lab-off-baseline/), and exits
# with the test run's status. Each test class named after the status must have run and passed: at least one of its
# tests passed and none failed or was skipped (an audit that skips on an older simulator, or a failure a re-run would
# hide, fails the job).
#
#   bash ci-test-summary.sh <xcodebuild test log> <baselines dir> <xcodebuild exit status> [<required test class>…]
log=$1
dir=$2
status=${3:-0}
shift 3 2>/dev/null || shift $#

echo "----- tests ($log) -----"
grep -E "^Test Case .*(passed|failed|skipped)|error: |\*\* TEST |Executed [0-9]+ test|AUDIT |TruncationAudit |Test Suite .*(passed|failed)" "$log" \
  | head -600 || true

for f in "$dir"/*.json; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  echo "=====BEGIN lab-off-baseline $name====="
  cat "$f"
  echo "=====END lab-off-baseline $name====="
done
# The trees the tests only printed (the Mac's test runner may not write outside its sandbox): the last of each.
python3 - "$log" "$dir" <<'PY'
import os, re, sys
log, folder = sys.argv[1], sys.argv[2]
written = set(os.listdir(folder)) if os.path.isdir(folder) else set()
blocks, name, lines = {}, None, []
for line in open(log, encoding='utf-8', errors='replace'):
    m = re.match(r'=====BEGIN lab-off-baseline (\S+)=====$', line.strip())
    if m:
        name, lines = m.group(1), [line]
    elif name:
        lines.append(line)
        if line.strip().startswith('=====END lab-off-baseline'):
            blocks[name], name = ''.join(lines), None
for key in sorted(blocks):
    if key not in written:
        sys.stdout.write(blocks[key])
PY

if [ "$status" != "0" ]; then
  echo "----- the last 80 lines of $log -----"
  tail -80 "$log"
  echo "::error::xcodebuild test failed (exit $status); see the lines above"
fi

required=0
for class in "$@"; do
  case_line="^Test Case '-\[[A-Za-z0-9_]+\.$class [A-Za-z0-9_]+\]'"
  passed=$(grep -cE "$case_line passed" "$log")
  bad=$(grep -E "$case_line (failed|skipped)" "$log")
  if [ "$passed" = "0" ]; then
    echo "::error::$class did not run (no test of it passed)"; required=1
  elif [ -n "$bad" ]; then
    echo "::error::$class did not pass every time:"; echo "$bad"; required=1
  else
    echo "required: $class passed ($passed tests)"
  fi
done

if [ "$status" = "0" ] && [ "$required" != "0" ]; then status=1; fi
exit "$status"
