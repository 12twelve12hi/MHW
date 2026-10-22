#!/usr/bin/env bash
# CI: what matters from an `xcodebuild test` log (each test's result, failures and compile errors, the accessibility
# audits' AUDIT lines, the truncation audit's counts), then the Lab-off baselines the UI tests recorded (between
# "=====BEGIN lab-off-baseline <platform>-<screen>.json=====" markers, ready to copy into lab-off-baseline/), and exits
# with the test run's status.
#
#   bash ci-test-summary.sh <xcodebuild test log> <baselines dir> <xcodebuild exit status>
log=$1
dir=$2
status=${3:-0}

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

if [ "$status" != "0" ]; then
  echo "----- the last 80 lines of $log -----"
  tail -80 "$log"
  echo "::error::xcodebuild test failed (exit $status); see the lines above"
fi
exit "$status"
