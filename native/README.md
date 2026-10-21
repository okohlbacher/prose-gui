# Native engine and Tauri toolchain

The ProSE desktop app (Tauri 2) runs on a native C++ engine built against OpenMS. This
directory holds the tooling for the two things that engine needs: a user-space toolchain for the
Tauri and Rust side, and a native OpenMS build that the C++ engine compiles against.

## Tauri toolchain without root

The host (ibminode06, Ubuntu 24.04) has no Rust and no WebKitGTK development files, and there is
no root. `/scratch` is node-local (ibminode06 only) and purged, so on another node, or after a
purge, the toolchain below has to be rebuilt first (rustup and `cargo install` with network access,
then `make-sysroot.sh`; the `.deb` cache is lost too). A container was tried first and does not work here: `apptainer build --fakeroot`, and
`apptainer exec --writable --fakeroot` on a sandbox, both fail with `Could not write info to
setgroups: Permission denied` (the user has no `/etc/subuid` entry, and
`kernel.apparmor_restrict_unprivileged_userns = 1` blocks the root-mapped namespace). Plain
`apptainer exec` works, but an image cannot be built. So the toolchain is installed in user space
and `native/scripts/in-env.sh` puts it on the paths:

| Piece | Where | How |
| --- | --- | --- |
| Rust stable (rustup, clippy, rustfmt) | `/scratch/sachsenb/tools/rust/{rustup,cargo}` | `curl https://sh.rustup.rs \| sh -s -- -y --no-modify-path -c clippy -c rustfmt`, with `RUSTUP_HOME` and `CARGO_HOME` set to those directories |
| `tauri-driver` | `/scratch/sachsenb/tools/rust/cargo/bin` | `cargo install tauri-driver --locked` |
| Node 24.19.0 | `/scratch/sachsenb/emsdk/node/24.19.0_64bit/bin` | already there (emsdk) |
| WebKitGTK 4.1, GTK/AppIndicator/rsvg development files, `WebKitWebDriver`, `patchelf` | `/scratch/sachsenb/tools/tauri-sysroot` | `native/scripts/make-sysroot.sh` |
| `Xvfb`, `xvfb-run`, `xauth`, `file`, GTK 3 runtime | the host | installed system packages |

### The sysroot

`make-sysroot.sh [sysroot] [deb-cache]` (defaults `/scratch/sachsenb/tools/tauri-sysroot` and
`/scratch/sachsenb/tools/tauri-sysroot-debs`) works as follows. It is safe to re-run; delete the
sysroot first for a clean slate.

1. Resolves the packages by simulating `apt-get install --no-install-recommends` of the
   top-level packages the host lacks (`libwebkit2gtk-4.1-dev libgtk-3-dev
   libayatana-appindicator3-dev librsvg2-dev webkit2gtk-driver patchelf`; `xvfb xauth file` are
   already installed) on top of the host's dpkg state. That yields exactly the 159 packages to
   add, and it already skips what the host has. (`apt-cache depends --recurse` was tried: it
   expands every alternative of every OR dependency, 530 packages including all aspell
   dictionaries and i386 packages.) Six Mesa packages are upgraded in the sysroot because their
   versioned dependencies demand it.
2. Fetches them with `apt-get download` (no root) into the deb cache and unpacks each with
   `dpkg -x`.
3. Fixes symlinks: a target present in the sysroot becomes a relative link inside it, a target
   present only on the host (for example `libglib-2.0.so -> libglib-2.0.so.0.8000.0`, whose real
   file is a host package) becomes an absolute link to the host path.
4. Patches the compiled-in WebKit helper path (below).
5. Rewrites `prefix=`, `libdir=` and `-I/-L` entries of `/usr` in the sysroot's `.pc` files to
   the sysroot. `PKG_CONFIG_SYSROOT_DIR` is not used: it would also prefix the host's own `.pc`
   files, whose files are not in the sysroot.
6. Compiles the GLib schemas and GIO module cache, and the GdkPixbuf loader cache if the sysroot
   has loaders (it has none at present; the host's cache is used).

**WebKit's helper processes.** libwebkit2gtk starts `WebKitWebProcess`, `WebKitNetworkProcess`
and `WebKitGPUProcess` from the directory compiled into it, `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1`,
and the Ubuntu build honours no environment variable to redirect it (`WEBKIT_EXEC_PATH` and
`WEBKIT_INJECTED_BUNDLE_PATH` exist only in developer builds; `strings` shows only the injected
bundle one). So `make-sysroot.sh` patches the sysroot's copy of `libwebkit2gtk-4.1.so.0.*` and
of `WebKitWebDriver`: the 40-byte path is replaced, with the same length, by
`/scratch/sachsenb/tools/webkit2gtk-4.1` (a symlink to the sysroot directory, padded with extra
slashes). The link sits beside the sysroot, so `<parent of the sysroot>/webkit2gtk-4.1` must be at
most 40 bytes long, which the script checks. `WebKitWebDriver` is patched only when the sysroot has
it (a host with `webkit2gtk-driver` installed uses its own copy). `libc6`, `libgcc-s1` and
`libstdc++6` are never unpacked into the sysroot (its library directories lead `LD_LIBRARY_PATH`,
and a second libc there would break every host binary); the script warns and skips them if apt
asks for them. Use the sysroot's copy of the library only; the
patch is repeated on every run of `make-sysroot.sh`, from the pristine `.deb`.

**WebKit sandbox.** WebKit sandboxes its processes with bubblewrap, which needs unprivileged user
namespaces; the node forbids them. WebKit looks for bubblewrap at the absolute path
`/usr/bin/bwrap`, which the host lacks, so the processes start unsandboxed anyway (checked: a Tauri
window renders without any flag). `in-env.sh --disable-webkit-sandbox` additionally sets
`WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`, in case a `/usr/bin/bwrap` ever appears; use it for
tests on this host only, never for anything that loads untrusted content.

### Using it

```bash
native/scripts/in-env.sh [--disable-webkit-sandbox] <cmd...>
```

It runs the command with:

- `PATH`: the sysroot's `usr/bin`, the cargo bin and Node 24.19.0 in front of the host `PATH`
  without linuxbrew;
- `PKG_CONFIG_PATH` for the sysroot, `LIBRARY_PATH` and `LD_LIBRARY_PATH` for the sysroot's
  `usr/lib/x86_64-linux-gnu` and `lib/x86_64-linux-gnu` (the linker uses `LD_LIBRARY_PATH` to
  resolve the libraries' own dependencies, and binaries find the libraries through it at run time);
- `XDG_DATA_DIRS`, `GSETTINGS_SCHEMA_DIR`, `GIO_EXTRA_MODULES` (additive; `GIO_MODULE_DIR` would
  replace the host's modules) and, when the sysroot has a loader cache, `GDK_PIXBUF_MODULE_FILE`;
- `LIBGL_DRIVERS_PATH` (only if the sysroot has a `dri` directory) and `__EGL_VENDOR_LIBRARY_DIRS` for the sysroot's Mesa (software
  rendering; `libEGL warning: DRI3 error` messages on Xvfb are harmless);
- `RUSTUP_HOME` and `CARGO_HOME`.

Check the toolchain:

```bash
native/scripts/in-env.sh bash -c 'cargo --version && node --version \
  && pkg-config --modversion webkit2gtk-4.1 && WebKitWebDriver --help >/dev/null \
  && tauri-driver --help >/dev/null && Xvfb -help >/dev/null 2>&1 && echo ok'
```

and a webview under Xvfb, for example a minimal Tauri 2 app built with
`in-env.sh cargo build --release --features custom-protocol` and run with
`in-env.sh xvfb-run -a -s "-screen 0 1024x768x24" ./app`.

## Native OpenMS build

`scripts/build-openms.sh <openms-src> <build-dir>` configures and builds libOpenMS, the
`ProSE` tool and the ProSE class tests with the host toolchain (outside `in-env.sh`):

```bash
native/scripts/build-openms.sh /scratch/sachsenb/openms-pr10564 \
  /scratch/sachsenb/openms-pr10564/build/native-release
```

It uses Ninja, a Release build, the vcpkg toolchain of the OpenMS checkout
(`x64-linux-dynamic`, feature `onnxruntime`) and a vcpkg binary cache in
`/scratch/sachsenb/vcpkg-bincache-native`, so a rebuild in a fresh directory does not rebuild
the dependencies. `JOBS` (default 100) sets the parallelism. Notes on the configuration:

- `WITH_THERMO_RAW=OFF`: the Thermo bridge needs dotnet. `WITH_OPENTIMS=OFF`, `WITH_GUI=OFF`,
  `ENABLE_DOCS=OFF` and `PYOPENMS=OFF` leave out what the app does not use.
- `PATH` is rebuilt without linuxbrew: its binutils (`as` 2.36) cannot assemble the
  AVX-NE-CONVERT code in ONNX Runtime.
- The targets include `FileInfo`, `ParquetDiff` and `FuzzyDiff` (the `TOPP_ProSE` tests run them)
  and `PeptDeepLibraryPredictor_test`; without them those tests report "Not Run".
- The build directory is `build/native-release` inside the OpenMS checkout, next to the wasm
  build directories, which it does not touch.

Check the build with the ProSE class tests (83 tests):

```bash
ctest --test-dir /scratch/sachsenb/openms-pr10564/build/native-release \
  -R "ProSE|PeptDeep|OpenSearchModificationAnalysis|Percolator_test" -j 32 --output-on-failure
```

## The OpenMS pin

`OPENMS_COMMIT` holds the full hash of the OpenMS commit the app's ProSE is built from: the local
integration branch `claude/prose-desktop-pin` of the worktree `/scratch/sachsenb/openms-desktop`
(a worktree of the clone `/scratch/sachsenb/openms-pr10564`), which is `develop` (8d0afe11a5) with
three merges: #10641 (`claude/peptdeep-onnx-memory`, PeptDeep memory and NCE selection), #10676
(`claude/prose-qpx-spectra`: `-out_psm_spectra` sidecar of peaks and PeptDeep predictions, `-keep_decoys`, the
pooled proteins in Parquet and the summary additions; see `docs/parity.md`) and #10677
(`claude/prose-empty-result`: a search in which no PSM passes the FDR ends with empty outputs instead of "Graph
empty. Build it first."). The pin branch is not pushed. Build it with

```bash
native/scripts/build-openms.sh /scratch/sachsenb/openms-desktop /scratch/sachsenb/openms-desktop/build
```

and check it with `ctest --test-dir /scratch/sachsenb/openms-desktop/build -R "ProSE|PeptDeep|QPX|Percolator_test|ArrowIOHelpers_test"`
(164 tests). Update the file whenever the pin branch moves.
