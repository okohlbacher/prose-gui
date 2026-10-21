//! What the front end may read of the disk, and nothing more:
//!
//! - [`read_search_file`]: a file of one search's folder (`<searches>/<id>/`), by its name relative to
//!   the folder, or the database that the search's `summary.yaml` records. Names are checked as text
//!   (no `..`, `.`, empty parts, other absolute paths) and the file's canonical path must lie inside
//!   the canonical folder, so no symlink leads out of it: the shim's input links (`<n>__<name>`, to the
//!   user's files) are not readable through this. A file that does not exist rejects with
//!   `{ notFound: true, message }`, which the results reader takes for a missing output.
//! - [`inspect`]: what the New search page shows of an input it was given by path (size, the spectrum
//!   count of an mzML's header, the proteins and residues of a FASTA): numbers, never contents, and
//!   only of absolute paths with the suffixes the shim searches (`.mzML`, `.mzML.gz`, `.fasta`, `.fa`,
//!   `.faa`); any other path is refused before the disk is asked.
//! - [`example_files`]: the bundled example, as the two named runs the web app searches.

use crate::args::{is_fasta_file, is_spectrum_file};
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Why a search file is not served: it does not exist (`not_found`), or it is not one of the search's.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadError {
    pub not_found: bool,
    pub message: String,
}

impl ReadError {
    fn refused(message: String) -> ReadError {
        ReadError {
            not_found: false,
            message,
        }
    }

    fn missing(name: &str) -> ReadError {
        ReadError {
            not_found: true,
            message: format!("{name} does not exist."),
        }
    }

    fn io(name: &str, e: io::Error) -> ReadError {
        if e.kind() == io::ErrorKind::NotFound {
            ReadError::missing(name)
        } else {
            ReadError::refused(format!("{name} cannot be read ({e})."))
        }
    }
}

/// A search id as the shim makes them (`<millis>-<n>`): letters, digits, `-` and `_` only, so that it
/// names one folder of the searches folder and nothing else.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A name relative to the folder: parts separated by `/`, none of them empty, `.` or `..`, no `\`
/// (a separator on Windows) and no absolute path.
pub fn valid_relative(name: &str) -> bool {
    !name.is_empty()
        && !Path::new(name).is_absolute()
        && !name.contains('\\')
        && !name.contains(':')
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// The search's folder, canonical.
fn search_folder(searches_dir: &Path, search_id: &str) -> Result<PathBuf, ReadError> {
    if !valid_id(search_id) {
        return Err(ReadError::refused(format!(
            "{search_id:?} is not a search."
        )));
    }
    let folder = searches_dir.join(search_id);
    let canonical = fs::canonicalize(&folder).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            ReadError {
                not_found: true,
                message: format!("The search {search_id} does not exist."),
            }
        } else {
            ReadError::refused(format!("The search {search_id} cannot be read ({e})."))
        }
    })?;
    if !canonical.is_dir() {
        return Err(ReadError::refused(format!(
            "The search {search_id} is not a folder."
        )));
    }
    Ok(canonical)
}

/// The path of `name` for [`read_search_file`], checked.
pub fn resolve_search_file(
    searches_dir: &Path,
    search_id: &str,
    name: &str,
) -> Result<PathBuf, ReadError> {
    let folder = search_folder(searches_dir, search_id)?;
    if Path::new(name).is_absolute() {
        // only the database this search was run with
        let recorded = fs::read_to_string(folder.join("summary.yaml"))
            .ok()
            .and_then(|yaml| parse_database_file(&yaml));
        if recorded.as_deref() != Some(name) || !is_fasta_file(name) {
            return Err(ReadError::refused(format!(
                "{name} is not a file of the search {search_id}."
            )));
        }
        let meta = fs::metadata(name).map_err(|e| ReadError::io(name, e))?;
        if !meta.is_file() {
            return Err(ReadError::refused(format!("{name} is not a file.")));
        }
        return Ok(PathBuf::from(name));
    }
    if !valid_relative(name) {
        return Err(ReadError::refused(format!(
            "{name:?} is not a file of the search {search_id}."
        )));
    }
    let canonical = fs::canonicalize(folder.join(name)).map_err(|e| ReadError::io(name, e))?;
    if !canonical.starts_with(&folder) {
        return Err(ReadError::refused(format!(
            "{name} lies outside the search {search_id}."
        )));
    }
    if !canonical.is_file() {
        return Err(ReadError::refused(format!("{name} is not a file.")));
    }
    Ok(canonical)
}

/// The contents of `name` of the search `search_id` (see the module docs for what is served).
pub fn read_search_file(
    searches_dir: &Path,
    search_id: &str,
    name: &str,
) -> Result<Vec<u8>, ReadError> {
    let path = resolve_search_file(searches_dir, search_id, name)?;
    fs::read(&path).map_err(|e| ReadError::io(name, e))
}

/// A double-quoted YAML scalar as ProSE writes it (`ProSEAlgorithm.cpp`, its `q()`: `\\`, `\"`, `\n`,
/// `\t`, `\r`, `\xNN`), without the quotes; None if it is not one.
fn unquote(text: &str) -> Option<String> {
    let inner = text.strip_prefix('"')?;
    let mut out: Vec<u8> = Vec::with_capacity(inner.len());
    let bytes = inner.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return String::from_utf8(out).ok(),
            b'\\' => {
                let c = *bytes.get(i + 1)?;
                match c {
                    b'\\' | b'"' | b'/' => out.push(c),
                    b'n' => out.push(b'\n'),
                    b't' => out.push(b'\t'),
                    b'r' => out.push(b'\r'),
                    b'0' => out.push(0),
                    b'x' => {
                        let hex = std::str::from_utf8(bytes.get(i + 2..i + 4)?).ok()?;
                        out.push(u8::from_str_radix(hex, 16).ok()?);
                        i += 2;
                    }
                    _ => return None,
                }
                i += 2;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    None
}

/// `shared.database_file` of ProSE's summary YAML (`-summary_out`): the FASTA the search read.
pub fn parse_database_file(yaml: &str) -> Option<String> {
    let mut in_shared = false;
    for line in yaml.lines() {
        if !line.starts_with(' ') && !line.is_empty() {
            in_shared = line.trim_end() == "shared:";
            continue;
        }
        if !in_shared {
            continue;
        }
        if let Some(value) = line.strip_prefix("  database_file:") {
            let value = value.trim();
            return if value.starts_with('"') {
                unquote(value)
            } else if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            };
        }
    }
    None
}

/// What the New search page shows of a file it was given by path.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileFacts {
    /// As given.
    pub path: String,
    pub name: String,
    /// Bytes (0 with an error).
    pub size: u64,
    /// The `count` of an mzML's `<spectrumList>` (all spectra); None for `.mzML.gz` and other files,
    /// or if the header does not say.
    pub spectra: Option<u64>,
    /// The entries of a FASTA file and the residues (letters) of their sequences.
    pub proteins: Option<u64>,
    pub residues: Option<u64>,
    /// Why the file cannot be used (not absolute, missing, a folder, unreadable).
    pub error: Option<String>,
}

/// The part of an mzML read for its spectrum list; the header before it is usually a few kB.
const MZML_HEAD: u64 = 1 << 20;

fn spectrum_count(path: &Path) -> io::Result<Option<u64>> {
    let mut head = Vec::new();
    fs::File::open(path)?
        .take(MZML_HEAD)
        .read_to_end(&mut head)?;
    let text = String::from_utf8_lossy(&head);
    let Some(at) = text.find("<spectrumList") else {
        return Ok(None);
    };
    let tag = &text[at..];
    let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
    let Some(count) = tag.find("count=\"") else {
        return Ok(None);
    };
    let digits: String = tag[count + 7..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    Ok(digits.parse().ok())
}

/// The entries (lines starting with `>`) and residues (letters of the other lines) of a FASTA, read
/// in pieces, as the web app's `countFasta`.
fn fasta_counts(path: &Path) -> io::Result<(u64, u64)> {
    let mut file = fs::File::open(path)?;
    let mut buffer = vec![0u8; 1 << 20];
    let (mut proteins, mut residues) = (0u64, 0u64);
    let (mut line_start, mut header) = (true, false);
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        for &b in &buffer[..read] {
            if line_start && b == b'>' {
                proteins += 1;
                header = true;
            } else if !header && b.is_ascii_alphabetic() {
                residues += 1;
            }
            line_start = b == b'\n' || b == b'\r';
            if line_start {
                header = false;
            }
        }
    }
    Ok((proteins, residues))
}

/// The facts of the file at `path` (an absolute path). Never fails: what goes wrong is in `error`.
pub fn inspect(path: &str) -> FileFacts {
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut facts = FileFacts {
        path: path.to_string(),
        name: name.clone(),
        size: 0,
        spectra: None,
        proteins: None,
        residues: None,
        error: None,
    };
    if !Path::new(path).is_absolute() {
        facts.error = Some(format!("{path} is not an absolute path."));
        return facts;
    }
    // only what a search takes, before anything is asked of the disk: other files (a key, a document)
    // are not even looked up, so the page learns nothing of them
    if !is_spectrum_file(&name) && !is_fasta_file(&name) {
        facts.error = Some(format!(
            "{path} is not an mzML file (.mzML, .mzML.gz) or a FASTA file (.fasta, .fa, .faa)."
        ));
        return facts;
    }
    let meta = match fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => {
            facts.error = Some(format!("{path} is not a file."));
            return facts;
        }
        Err(e) => {
            facts.error = Some(format!("{path} cannot be read ({e})."));
            return facts;
        }
    };
    facts.size = meta.len();
    let lower = name.to_lowercase();
    let counted = if is_fasta_file(&name) {
        fasta_counts(Path::new(path)).map(|(p, r)| {
            facts.proteins = Some(p);
            facts.residues = Some(r);
        })
    } else if !lower.ends_with(".gz") {
        spectrum_count(Path::new(path)).map(|n| facts.spectra = n)
    } else {
        Ok(())
    };
    if let Err(e) = counted {
        facts.error = Some(format!("{path} cannot be read ({e})."));
    }
    facts
}

/// The bundled example: the web app's run and its FASTA.
pub const EXAMPLE_RUN: &str = "DatabaseSuitability_in_spec.mzML";
pub const EXAMPLE_FASTA: &str = "DatabaseSuitability_database.fasta";
/// The run is searched twice, as two replicates, under these names (as in the web app).
pub const EXAMPLE_NAMES: [&str; 2] = ["DatabaseSuitability_1.mzML", "DatabaseSuitability_2.mzML"];

/// Where the bundled example is. In development (no bundle yet) the folder in the source tree.
pub fn bundled_example(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let in_bundle = resource_dir.map(|d| d.join("resources/example"));
    let in_source =
        option_env!("CARGO_MANIFEST_DIR").map(|d| Path::new(d).join("resources/example"));
    in_bundle
        .into_iter()
        .chain(in_source)
        .find(|p| p.join(EXAMPLE_RUN).is_file())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExampleFiles {
    pub spectra: Vec<String>,
    pub database: String,
}

#[cfg(unix)]
fn link_or_copy(original: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(original, link)
}

#[cfg(not(unix))]
fn link_or_copy(original: &Path, link: &Path) -> io::Result<()> {
    fs::copy(original, link).map(|_| ())
}

/// The example's inputs: the bundled run under its two names, as links in `<data_dir>/example/`
/// (the app's own folder; nothing is written beside the bundle), and the bundled FASTA.
pub fn example_files(source_dir: &Path, data_dir: &Path) -> Result<ExampleFiles, String> {
    let run = source_dir.join(EXAMPLE_RUN);
    let fasta = source_dir.join(EXAMPLE_FASTA);
    if !run.is_file() || !fasta.is_file() {
        return Err("The example is not part of this installation.".to_string());
    }
    let dir = data_dir.join("example");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("The example folder {} cannot be made ({e}).", dir.display()))?;
    let mut spectra = Vec::new();
    for name in EXAMPLE_NAMES {
        let link = dir.join(name);
        let current = fs::read_link(&link).ok();
        if current.as_deref() != Some(run.as_path()) || !link.is_file() {
            if fs::symlink_metadata(&link).is_ok() {
                fs::remove_file(&link).map_err(|e| format!("{} ({e})", link.display()))?;
            }
            link_or_copy(&run, &link).map_err(|e| {
                format!("The example cannot be prepared in {} ({e}).", dir.display())
            })?;
        }
        spectra.push(link.to_string_lossy().into_owned());
    }
    Ok(ExampleFiles {
        spectra,
        database: fasta.to_string_lossy().into_owned(),
    })
}
