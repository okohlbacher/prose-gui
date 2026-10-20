# ProSE desktop

A desktop app for the ProSE search engine of OpenMS: [Tauri 2](https://tauri.app) around the OS webview, the
native `ProSE` command-line tool as the only native code, and the screens of the ProSE web app (same theme,
shadcn-svelte components and colours). Design and plan: `docs/superpowers/`.

Status: the shell (top bar with the web app's theme) only.

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

`e2e/run.sh` builds the debug binary first (`E2E_SKIP_BUILD=1` skips that) and enters `in-env.sh` itself if it
is not in it.
