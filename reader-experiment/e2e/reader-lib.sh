# Helpers for driving the Daylight Reader on an emulator from adb (sourced by the e2e scripts).
READER_PKG="${READER_PKG:-com.daylightcomputer.reader}"

# The Reader's adb-only test hook (shell/ShellReceiver.kt): "library=N archived=N deleted=N total=N ids=..."
reader_count_line() {
  adb shell am broadcast -f 32 -n "$READER_PKG/com.daylightcomputer.reader.shell.ShellReceiver" \
    -a com.daylightcomputer.reader.SHELL --es cmd count 2>/dev/null | tr -d '\r' | sed -n 's/.*data="\(.*\)".*/\1/p'
}

reader_library_count() {
  reader_count_line | sed -n 's/.*library=\([0-9]*\).*/\1/p'
}

# Waits until the library holds at least $1 documents (timeout $2 seconds). Prints the last count line.
wait_library_at_least() {
  local want="$1" timeout="${2:-90}" waited=0 n
  while [ "$waited" -lt "$timeout" ]; do
    n="$(reader_library_count)"
    if [ -n "$n" ] && [ "$n" -ge "$want" ]; then echo "library=$n after ${waited}s"; return 0; fi
    sleep 3; waited=$((waited + 3))
  done
  echo "timed out after ${timeout}s waiting for library>=$want; last: $(reader_count_line)" >&2
  return 1
}

shot() { adb exec-out screencap -p > "$1" 2>/dev/null || true; }
