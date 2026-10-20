//! Finding the ProSE tool, asking it for its version, and building the command that runs it.

use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// What the front end learns of the tool (`tool_info`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub version: String,
    pub path: String,
    /// Whether the tool was built with ONNX Runtime (PeptDeep needs it).
    pub onnx: bool,
}

const EXE: &str = if cfg!(windows) { "ProSE.exe" } else { "ProSE" };

/// Where the bundled tool is, below the app's resource directory.
pub fn bundled_tool(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/prose/bin").join(EXE)
}

/// Where the bundled cRAP FASTA is. In development (no bundle yet) the file in the source tree.
pub fn bundled_crap(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let in_bundle = resource_dir.map(|d| d.join("resources/fasta/crap.fasta"));
    let in_source =
        option_env!("CARGO_MANIFEST_DIR").map(|d| Path::new(d).join("resources/fasta/crap.fasta"));
    in_bundle.into_iter().chain(in_source).find(|p| p.is_file())
}

fn is_file(path: &Path) -> bool {
    path.is_file()
}

/// The tool, by the first of: `prose_bin` (the `PROSE_BIN` variable; if set it has to exist),
/// the bundled tool in `resource_dir`, a `ProSE` on `path_var`.
pub fn resolve_with(
    prose_bin: Option<&OsStr>,
    resource_dir: Option<&Path>,
    path_var: Option<&OsStr>,
) -> Result<PathBuf, String> {
    if let Some(bin) = prose_bin.filter(|b| !b.is_empty()) {
        let path = PathBuf::from(bin);
        return if is_file(&path) {
            Ok(path)
        } else {
            Err(format!(
                "PROSE_BIN is set to {}, which is not a file.",
                path.display()
            ))
        };
    }
    if let Some(bundled) = resource_dir.map(bundled_tool).filter(|p| is_file(p)) {
        return Ok(bundled);
    }
    if let Some(found) = path_var
        .into_iter()
        .flat_map(std::env::split_paths)
        .map(|d| d.join(EXE))
        .find(|p| is_file(p))
    {
        return Ok(found);
    }
    Err("The ProSE tool was not found: it is not bundled with this app, PROSE_BIN is not set and there is no ProSE on the PATH.".to_string())
}

pub fn resolve(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    resolve_with(
        std::env::var_os("PROSE_BIN").as_deref(),
        resource_dir,
        std::env::var_os("PATH").as_deref(),
    )
}

/// The command that runs the tool: `OPENBLAS_NUM_THREADS=1` unless the user has set it (Percolator's
/// linear algebra would otherwise start a thread per core inside ProSE's own threads), as the
/// FASTag shim does. `openblas` is the variable's current value.
pub fn command_with(path: &Path, openblas: Option<OsString>) -> Command {
    let mut command = Command::new(path);
    if openblas.is_none() {
        command.env("OPENBLAS_NUM_THREADS", "1");
    }
    command
}

pub fn command(path: &Path) -> Command {
    command_with(path, std::env::var_os("OPENBLAS_NUM_THREADS"))
}

/// The version in the tool's `--help` ("Version: 3.7.0-pre-exported-20261020 Oct 20 2026, 22:16:02").
pub fn parse_version(help: &str) -> Option<String> {
    help.lines()
        .find_map(|l| l.trim().strip_prefix("Version:"))
        .and_then(|v| v.split_whitespace().next())
        .map(str::to_string)
}

/// Whether the tool uses ONNX Runtime. ProSE reports it nowhere, so this looks at what the binary
/// loads: on Linux the dynamic loader lists the libraries (`LD_TRACE_LOADED_OBJECTS`, what `ldd`
/// does; the program is not run), and on every system a library named `*onnxruntime*` next to the
/// binary or in the `lib` folder beside its folder counts.
fn has_onnx(path: &Path) -> bool {
    let traced = cfg!(target_os = "linux")
        && Command::new(path)
            .env("LD_TRACE_LOADED_OBJECTS", "1")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .to_lowercase()
                    .contains("onnxruntime")
            })
            .unwrap_or(false);
    traced || {
        let dir = path.parent();
        let candidates = [
            dir.map(Path::to_path_buf),
            dir.and_then(Path::parent).map(|p| p.join("lib")),
        ];
        candidates.into_iter().flatten().any(|d| {
            std::fs::read_dir(d)
                .map(|entries| {
                    entries.flatten().any(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .to_lowercase()
                            .contains("onnxruntime")
                    })
                })
                .unwrap_or(false)
        })
    }
}

/// Runs `path --help` and reads the version; fails if the tool does not run or does not say.
pub fn probe(path: &Path) -> Result<ToolInfo, String> {
    let output = command(path)
        .arg("--help")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("The ProSE tool {} cannot be run ({e}).", path.display()))?;
    // OpenMS tools print their help to stderr
    let help = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let version = parse_version(&help).ok_or_else(|| {
        format!(
            "{} did not report a version; is it the ProSE tool?",
            path.display()
        )
    })?;
    Ok(ToolInfo {
        version,
        path: path.to_string_lossy().into_owned(),
        onnx: has_onnx(path),
    })
}
