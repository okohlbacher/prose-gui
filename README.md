# ProSE desktop

A desktop app for the ProSE search engine of OpenMS: [Tauri 2](https://tauri.app) around the OS webview, the
native `ProSE` command-line tool as the only native code, and the screens of the ProSE web app (same theme,
shadcn-svelte components and colours). Design and plan: `docs/superpowers/`.

The packages come from CI (`.github/workflows/desktop.yml`); they bundle ProSE with its libraries and the PeptDeep
models (`native/README.md`). Everything runs on the computer: the app makes no network connection (ProSE's
update check is off, `native/README.md`).

## Install

**macOS** 15 or later, Apple silicon (arm64; Intel Macs are not supported): the `.dmg`. Drag ProSE to
Applications, then, once, in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/ProSE.app
```

The app is signed ad hoc only (no Developer ID, not notarized), so macOS refuses to open it until then. The other
way: open it once (it is refused), then System Settings > Privacy & Security > "Open Anyway".

**Windows** 10 (1903 or later) or 11, x64: the installer `ProSE_<version>_x64-setup.exe`, for the current user,
without administrator rights. It is not signed: SmartScreen asks once ("More info" > "Run anyway"). The app uses
Microsoft Edge WebView2, which Windows 11 and an updated Windows 10 have (the installer fetches it otherwise).

**Linux** x64, Ubuntu 22.04 or later (and other distributions of that age): the AppImage runs as it is
(`chmod +x ProSE_<version>_amd64.AppImage`), or the `.deb` installs with `sudo apt install ./ProSE_<version>_amd64.deb`
(package `prose`). The AppImage needs one library of the system: OpenGL ES, `libGLESv2.so.2`, which desktop
installations have (the `.deb` pulls it in with WebKitGTK). Without it the app exits at once with exit code 127
("Couldn't open libGLESv2.so.2"). Install it with `sudo apt install libgles2` (Ubuntu, Debian) or `sudo dnf install
libglvnd-gles` (Fedora).

## System requirements

- A 64-bit processor and system as above; the packages take about 200 MB (ProSE and its libraries 173 MB, the
  PeptDeep models among them).
- Memory as the search needs it: ProSE has no limit of its own. The example takes well under 1 GB; a semi-tryptic
  TMT search of a 78 MB mzML against the human reference proteome (no database chunks) peaked at 7.1 GB. Larger
  searches can split the database (Settings › Advanced, `database:chunk_size`). The results are read into the
  app's page: see "Known limitations".
- Disk: each search keeps ProSE's outputs, under 1 MB per thousand PSMs (with the spectra of the PSMs).

## Where the data is

- The searches (History): a folder per search in the app's data folder, `searches/<id>/`: ProSE's outputs, the
  record `search.json`, `proteins.fasta` (the proteins of the result, so that the search opens without its
  database) and links to the inputs. The app's data folder is
  - Linux: `~/.local/share/org.openms.prose.desktop/` (`$XDG_DATA_HOME`)
  - macOS: `~/Library/Application Support/org.openms.prose.desktop/`
  - Windows: `%APPDATA%\org.openms.prose.desktop\`
- The log of the last search that failed: `logs/last-failure.log` there (the error names it).
- Presets: the app's webview keeps them, on this computer.
- The mzML and FASTA files are read where they are: never copied, and nothing is written beside them. Deleting a
  search in History removes its folder; uninstalling leaves the data folder, which can be deleted by hand.

## Project files

Export › Project (`.prose`) writes a search as one zip, which Open project (History) opens on another computer.
It holds the search's folder as the app keeps it: ProSE's outputs (Parquet, `summary.yaml`, the idXML, the
open-search tables), `search.json`, `proteins.fasta`, and `inputs.json` with the files' names only. Left out are
ProSE's log and the database copy with the contaminants. **ProSE's outputs name folders of the computer that
searched** (e.g. the database's path in `summary.yaml`, the input and database paths in the idXML and the Parquet
files' metadata), and the project carries them as they are: share it where that is fine. A project file holds at
most 3 GB (larger searches are refused with a message; they stay in History).

## Known limitations

- **Large results.** The page reads a search's outputs into memory (the Parquet files through the app's IPC, then
  decoded into the tables, the spectra and predictions of every PSM included), so the computer's memory bounds
  the largest result that opens. Measured with synthetic saved searches of one file (`e2e/large.spec.ts`, the
  rows of the example repeated; WebKitGTK 2.52 on Linux, a 128-core machine):

  | PSMs | files | opens in | memory of the web process |
  | --- | --- | --- | --- |
  | 500,000 | 106 MB | 8 s | 1.9 GB |
  | 1,000,000 | 211 MB | 15 s | 3.5 GB |
  | 2,000,000 | 421 MB | 33 s | 6.1 GB |
  | 4,000,000 | 845 MB | 72 s | 11.5 GB |
  | 8,000,000 | 1.7 GB | 197 s | 22.7 GB |

  About 2.8 GB per million PSMs: a computer with 16 GB opens about 4 million, with 32 GB about 8 million (no
  larger result was tried). The synthetic files compress better than real ones (their rows repeat); the memory
  is what decoding them takes. On Windows the webview (WebView2) runs Chromium's JavaScript engine, whose arrays
  are smaller: the same reader in Node.js (the same engine) reads 4 million PSMs but not 8 million ("Invalid
  array length": the predicted ions of all PSMs are one array), so there the limit lies between the two; macOS'
  webview is WebKit, as on Linux. Project files are made and read in memory too, and hold at most 3 GB (fflate
  writes no zip64; a larger search is refused with a message). Later, not now: streaming the project zip (with
  zip64), and reading the peaks and predictions of a PSM on demand instead of all of them at once.
- macOS: Apple silicon only; not signed with a Developer ID (see Install).
- Windows: two inputs of one name are searched together only when they are on the drive of the app's data.

## Develop (ibminode06, no root)

Everything runs inside the user-space toolchain of `native/scripts/in-env.sh` (Rust, the WebKitGTK 4.1 sysroot,
Node 24.19.0, `tauri-driver`); see `native/README.md` for how it is built. `/scratch` is node-local and purged.

```bash
npm install
native/scripts/in-env.sh npm run tauri:build:debug      # debug binary, no bundle: src-tauri/target/debug/prose-desktop
native/scripts/in-env.sh npm run check                  # svelte-check and tsc
native/scripts/in-env.sh e2e/run.sh [e2e/smoke.spec.ts] # WebdriverIO via tauri-driver + WebKitWebDriver, under xvfb-run
native/scripts/in-env.sh e2e/run.sh e2e/screens.shot.ts # screenshots into docs/screens
```

Packages and their smoke test (needs the OpenMS build of `native/scripts/build-openms.sh`):

```bash
native/scripts/bundle-prose.sh /scratch/sachsenb/openms-desktop/build src-tauri/resources/prose
native/scripts/package-linux.sh                                    # .deb and AppImage
native/scripts/smoke-appimage.sh src-tauri/target/release/bundle/appimage/ProSE_0.1.0_amd64.AppImage \
  --hide-openms /scratch/sachsenb/openms-desktop/build
```

`e2e/run.sh` builds the debug binary first (`E2E_SKIP_BUILD=1` skips that) and enters `in-env.sh` itself if it
is not in it.

The specs that run searches need the tool: `PROSE_BIN=/path/to/ProSE` (without it they skip); the bundled one,
`src-tauri/resources/prose/bin/ProSE`, is the one with PeptDeep (its build manifest says so, see `native/README.md`). Each spec file
gets an app of its own with its own data folder (`XDG_DATA_HOME`, made per run, removed at its end), and
`tauri-driver` runs for the whole run in a process group of its own; port 4444 must be free (a leftover
`tauri-driver` stops the run with a message). Debug builds read `PROSE_TEST_DIALOG_PATH` in place of the
system's save and open dialogs (`e2e/app.sh` sets it), since WebDriver cannot reach a dialog. The large search
(`e2e/big.spec.ts`) runs only with `PROSE_BIG=1`; it logs its time and ProSE's peak memory. The measurement of
large results (`e2e/large.spec.ts`, "Known limitations") runs only with `PROSE_LARGE_DIR`, the folder of the
synthetic searches that `src/lib/results/read.test.ts` writes on demand (both headers say how).

Host tools of the e2e specs: `xvfb-run`, and for `closing the window ends ProSE` (a window-manager close request
sent to the app's window) `xwininfo`, `xprop` and `python3` with libX11 (`e2e/close-window.py`); without them that
test skips with a message. Run one test of a spec with
`native/scripts/in-env.sh e2e/run.sh e2e/paths.spec.ts --mochaOpts.grep 'mzML.gz'`.
