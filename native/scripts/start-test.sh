#!/bin/bash
# The start test of a macOS or Windows package (CI), on the package as a user gets it:
#
#   start-test.sh <ProSE_*.dmg | ProSE_*-setup.exe> <example-dir>
#
# 1. The package is opened: the .dmg is mounted and ProSE.app copied out of it; the installer is run
#    silently (/S) into a folder of its own. The bundled ProSE inside is checked (bundle_closure.py
#    macho-verify / pe-verify).
# 2. The bundled ProSE prints its version, from an empty environment (Windows: only Windows' folders on
#    PATH).
# 3. It searches the example (<example-dir>: DatabaseSuitability_in_spec.mzML and
#    DatabaseSuitability_database.fasta, copied into a folder with a space in its name) from the command
#    line, with Percolator and PeptDeep: it has to end with 0, write the outputs the app reads, rescore
#    with PeptDeep, and find more than 500 target PSMs (895 with these settings).
# 4. The app starts with --smoke-test (src-tauri/src/lib.rs): once its page has loaded it reports the page
#    and tool_info, and exits. tool_info has to be the bundled ProSE inside the package, with ONNX, and the
#    version of step 2.
# A folder with a non-ASCII name is tried as well (step 3 again, shorter), and only reported.
# The build machine's OpenMS must be gone (CI removes it after bundling), so that ProSE can only use the
# package's share/OpenMS. Writes a summary to $GITHUB_STEP_SUMMARY when it is set.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <package> <example-dir>" >&2
  exit 2
fi
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE=$1
EXAMPLE=$(cd "$2" && pwd)
PY=python3
"$PY" -c '' 2>/dev/null || PY=python
die() { echo "error: $*" >&2; exit 1; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi; }
# (canonical: on macOS mktemp's /var/folders/... goes through the link /var, and Tauri refuses an app
# path with a link in it, StartingBinary, so its resource folder would not be found)
work=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$work"' EXIT

case "$(uname -s)" in
  Darwin)
    platform=macos
    mkdir "$work/mnt"
    hdiutil attach -nobrowse -readonly -mountpoint "$work/mnt" "$PACKAGE" >/dev/null
    source_app=$(find "$work/mnt" -maxdepth 1 -name '*.app' | head -n 1)
    [ -n "$source_app" ] || die "no .app in $PACKAGE"
    ditto "$source_app" "$work/$(basename "$source_app")"
    hdiutil detach "$work/mnt" >/dev/null
    app=$work/$(basename "$source_app")
    executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
    APP_BIN=$app/Contents/MacOS/$executable
    BUNDLE=$app/Contents/Resources/resources/prose
    TOOL=$BUNDLE/bin/ProSE
    "$PY" -I "$HERE/bundle_closure.py" macho-verify "$BUNDLE"
    native() { printf '%s\n' "$1"; }
    clean() { env -i HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PATH=/usr/bin:/bin "$@"; }
    ;;
  MINGW* | MSYS* | CYGWIN*)
    platform=windows
    install=$work/install
    # (no MSYS path conversion: /S and /D= are the installer's switches; /D= comes last, unquoted)
    MSYS_NO_PATHCONV=1 "$PACKAGE" /S "/D=$(cygpath -w "$install")"
    for _ in $(seq 60); do [ -d "$install/resources/prose/bin" ] && break; sleep 1; done
    APP_BIN=$(find "$install" -maxdepth 1 -iname '*.exe' ! -iname 'uninstall*' | head -n 1)
    [ -n "$APP_BIN" ] || die "the installer put no app into $install: $(ls "$install" 2>&1)"
    BUNDLE=$install/resources/prose
    TOOL=$BUNDLE/bin/ProSE.exe
    "$PY" -I "$HERE/bundle_closure.py" pe-verify "$(cygpath -m "$BUNDLE")"
    native() { cygpath -w "$1"; }
    clean() {
      env -i SYSTEMROOT="$SYSTEMROOT" WINDIR="$WINDIR" PATH="/c/Windows/System32:/c/Windows" \
        TEMP="$TEMP" TMP="$TMP" USERPROFILE="$USERPROFILE" LOCALAPPDATA="$LOCALAPPDATA" APPDATA="$APPDATA" \
        "$@"
    }
    ;;
  *) die "start-test.sh is for the macOS and Windows packages (Linux: smoke-appimage.sh)" ;;
esac
[ -x "$TOOL" ] || [ -f "$TOOL" ] || die "the package has no bundled ProSE at $TOOL"
echo "package: $PACKAGE"
echo "app: $APP_BIN"
echo "bundled ProSE: $TOOL"
cat "$BUNDLE/build.json"

# --- 2. the version --------------------------------------------------------------------------------
version=$(clean "$TOOL" --help 2>&1 | sed -n 's/^ *Version: *\([^ ]*\).*/\1/p' | head -n 1)
[ -n "$version" ] || die "the bundled ProSE does not run: $(clean "$TOOL" --help 2>&1 | tail -n 5)"
echo "ProSE version: $version"

# --- 3. the example from the command line, with PeptDeep -------------------------------------------
search() { # <folder>: copies the example there and searches it; leaves out.txt and summary.yaml
  local dir=$1
  mkdir -p "$dir"
  cp "$EXAMPLE/DatabaseSuitability_in_spec.mzML" "$EXAMPLE/DatabaseSuitability_database.fasta" "$dir/"
  clean "$TOOL" -in "$(native "$dir/DatabaseSuitability_in_spec.mzML")" \
    -database "$(native "$dir/DatabaseSuitability_database.fasta")" \
    -out_qpx "$(native "$dir/qpx")" -out_psm_spectra "$(native "$dir/spectra")" \
    -out_parquet "$(native "$dir/oms")" -summary_out "$(native "$dir/summary.yaml")" \
    -threads 3 -Search:rescore true -Search:peptdeep:enable -Search:peptdeep:instrument QE \
    -Search:FDR:PSM 0.01 -Search:modifications:fixed "Carbamidomethyl (C)" \
    -Search:modifications:variable "Oxidation (M)" >"$dir/out.txt" 2>&1
}
started=$(date +%s)
data="$work/example data"
if ! search "$data"; then
  tail -n 30 "$data/out.txt"
  die "the command-line search failed"
fi
seconds=$(( $(date +%s) - started ))
grep -E '^\[PeptDeepRescoring\] Predicted features added' "$data/out.txt" \
  || die "the search did not rescore with PeptDeep: $(grep -i peptdeep "$data/out.txt" | tail -n 5)"
for f in qpx/DatabaseSuitability_in_spec.psm.parquet spectra/DatabaseSuitability_in_spec.psm_spectra.parquet \
  oms/DatabaseSuitability_in_spec.psm.parquet summary.yaml; do
  [ -s "$data/$f" ] || die "the search wrote no $f"
done
psms=$(sed -n 's/^ *target_psms: *\([0-9]*\).*/\1/p' "$data/summary.yaml" | head -n 1)
[ -n "$psms" ] && [ "$psms" -gt 500 ] || die "the search found ${psms:-no} target PSMs, expected more than 500"
echo "command-line search: $psms target PSMs at 1 % FDR, with PeptDeep, in ${seconds} s"

# (only reported: a folder name outside ASCII)
if search "$work/Größe ü"; then
  wide=$(sed -n 's/^ *target_psms: *\([0-9]*\).*/\1/p' "$work/Größe ü/summary.yaml" | head -n 1)
  wide_result="searched (${wide:-?} target PSMs)"
else
  wide_result="FAILED: $(grep -E 'Error|error' "$work/Größe ü/out.txt" | tail -n 2 | tr '\n' ' ')"
  echo "--- ProSE's output in 'Größe ü' (only reported) ---"
  grep -vE '^(Warning: |Schema error)' "$work/Größe ü/out.txt" | head -n 80
  ls -la "$work/Größe ü" "$work/Größe ü"/* 2>&1 | head -n 30
  echo "---"
fi
echo "a folder named 'Größe ü': $wide_result"

# --- 4. the app starts, finds its ProSE, and exits ---------------------------------------------------
"$APP_BIN" --smoke-test >"$work/app.json" 2>"$work/app.err" &
pid=$!
for _ in $(seq 180); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid" 2>/dev/null || true
  die "the app did not exit within 180 s: $(tail -n 20 "$work/app.err")"
fi
status=0
wait "$pid" || status=$?
report=$(grep -m1 '^{' "$work/app.json" || true)
echo "app --smoke-test (exit $status): $report"
[ "$status" -eq 0 ] && [ -n "$report" ] || die "the app's start failed: $(tail -n 20 "$work/app.err")"
"$PY" -I - "$report" "$(native "$TOOL")" "$version" <<'PY'
import json, os, sys
report, tool, version = sys.argv[1:]
data = json.loads(report)
info = data.get("tool") or sys.exit(f"no tool_info: {data}")
def norm(p):
    # (Windows: a \\?\ path, 8.3 names; macOS: /var is /private/var)
    if p.startswith("\\\\?\\"):
        p = p[4:]
    return os.path.normcase(os.path.realpath(p))
if norm(info["path"]) != norm(tool):
    sys.exit(f"the app runs {info['path']}, not its bundled {tool}")
if not info.get("onnx"):
    sys.exit("the app's ProSE has no ONNX (PeptDeep)")
if info.get("version") != version:
    sys.exit(f"the app reports version {info.get('version')}, the tool {version}")
if not data.get("page"):
    sys.exit("no page loaded")
print(f"app: page {data['page']}, ProSE {info['version']} with ONNX, inside the package")
PY

summary "### Start test ($platform)"
summary ""
summary "- package: \`$(basename "$PACKAGE")\`"
summary "- bundled ProSE: \`$version\`"
summary "- command-line search of the example with PeptDeep: $psms target PSMs at 1 % FDR, ${seconds} s"
summary "- a folder named \`Größe ü\`: $wide_result"
summary "- app \`--smoke-test\`: \`$report\`"
echo "start test passed"
