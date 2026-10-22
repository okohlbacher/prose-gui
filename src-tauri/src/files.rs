//! What the front end may read of the disk, and nothing more:
//!
//! - [`read_search_file`]: a file of one search's folder (`<searches>/<id>/`), by its name relative to
//!   the folder (all of it, its last bytes, or a byte range), or the database that the search's `database.json` records (the shim
//!   writes it when ProSE reads the user's FASTA as it is). Names are checked as text
//!   (no `..`, `.`, empty parts, other absolute paths) and the file's canonical path must lie inside
//!   the canonical folder, so no symlink leads out of it: the shim's input links (`<n>__<name>`, to the
//!   user's files) are not readable through this. A file that does not exist rejects with
//!   `{ notFound: true, message }`, which the results reader takes for a missing output.
//! - [`inspect`]: what the New search page shows of an input it was given by path (size, the spectrum
//!   count of an mzML's header, the proteins and residues of a FASTA): numbers, never contents, and
//!   only of absolute paths with the suffixes the shim searches (`.mzML`, `.mzML.gz`, `.fasta`, `.fa`,
//!   `.faa`); any other path is refused before the disk is asked.
//! - [`example_files`]: the bundled example, as the two named runs the web app searches.

use crate::args::{is_fasta_file, is_input_link, is_spectrum_file, suffix_start, DATABASE_RECORD};
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
    pub(crate) fn refused(message: String) -> ReadError {
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

/// The search's folder, canonical. The folder itself has to be a folder, not a link to one (as History
/// has it: `history::existing_folder`): a link in the searches folder could lead anywhere.
fn search_folder(searches_dir: &Path, search_id: &str) -> Result<PathBuf, ReadError> {
    if !valid_id(search_id) {
        return Err(ReadError::refused(format!(
            "{search_id:?} is not a search."
        )));
    }
    let folder = searches_dir.join(search_id);
    if fs::symlink_metadata(&folder).is_ok_and(|m| !m.is_dir()) {
        return Err(ReadError::refused(format!(
            "The search {search_id} is not a folder."
        )));
    }
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

/// Whether the search counts as imported from a project file: its `search.json` says so, or is there
/// and cannot be read as a record (then it is not trusted). A folder without a `search.json` (one just
/// finished, not saved yet) is not imported.
fn is_imported(folder: &Path) -> bool {
    const MAX: u64 = 64 << 20;
    let canonical = match fs::canonicalize(folder.join("search.json")) {
        Ok(canonical) => canonical,
        Err(e) => return e.kind() != io::ErrorKind::NotFound,
    };
    if !canonical.starts_with(folder)
        || fs::metadata(&canonical).map_or(true, |m| !m.is_file() || m.len() > MAX)
    {
        return true;
    }
    match fs::read(&canonical)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
    {
        Some(record) => record.get("imported").and_then(|i| i.as_bool()) == Some(true),
        None => true,
    }
}

/// The path of `name` for [`read_search_file`], checked.
pub fn resolve_search_file(
    searches_dir: &Path,
    search_id: &str,
    name: &str,
) -> Result<PathBuf, ReadError> {
    let folder = search_folder(searches_dir, search_id)?;
    if Path::new(name).is_absolute() {
        // an imported search (a project from elsewhere) never reads outside its folder: a path it records
        // is that of another computer, or an attempt to name one of this
        if is_imported(&folder) {
            return Err(ReadError::refused(format!(
                "{name} is not a file of the search {search_id}: an imported search reads only its own folder."
            )));
        }
        // only the database this search was run with
        let recorded = recorded_database(&folder);
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
    // a link to an input (on Windows a hard link, which resolves inside the folder) is the user's file
    if is_input_link(name) {
        return Err(ReadError::refused(format!(
            "{name} is an input of the search {search_id}, not one of its files."
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

/// Which bytes of a file [`read_search_file`] reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteRange {
    /// All of it.
    All,
    /// The last bytes (all of a smaller file): the footer of a Parquet file, which History and the
    /// results reader read.
    Tail(u64),
    /// `length` bytes from `offset` (fewer at the end of the file, none past it): a part of a Parquet file,
    /// e.g. the peaks of one PSM, which the PSM view reads.
    Range { offset: u64, length: u64 },
}

impl ByteRange {
    /// The range of the command's arguments: `tail`, or `offset` with `length`, or all (an `offset` without
    /// `length` or the other way round, or `tail` with them, is refused).
    pub fn of(
        tail: Option<u64>,
        offset: Option<u64>,
        length: Option<u64>,
    ) -> Result<Self, ReadError> {
        match (tail, offset, length) {
            (None, None, None) => Ok(ByteRange::All),
            (Some(tail), None, None) => Ok(ByteRange::Tail(tail)),
            (None, Some(offset), Some(length)) => Ok(ByteRange::Range { offset, length }),
            _ => Err(ReadError::refused(
                "Give either tail, or offset and length, or none of them.".to_string(),
            )),
        }
    }
}

/// The largest byte range [`read_search_file`] reads at once (the peaks of one row group are a few MB).
pub const MAX_RANGE: u64 = 1 << 30;

/// The contents of `name` of the search `search_id` (see the module docs for what is served): the bytes of
/// `range`.
pub fn read_search_file(
    searches_dir: &Path,
    search_id: &str,
    name: &str,
    range: ByteRange,
) -> Result<Vec<u8>, ReadError> {
    let path = resolve_search_file(searches_dir, search_id, name)?;
    if range == ByteRange::All {
        return fs::read(&path).map_err(|e| ReadError::io(name, e));
    }
    use io::Seek;
    let mut file = fs::File::open(&path).map_err(|e| ReadError::io(name, e))?;
    let size = file.metadata().map_err(|e| ReadError::io(name, e))?.len();
    let (start, length) = match range {
        ByteRange::Tail(tail) => (size.saturating_sub(tail), tail.min(size)),
        ByteRange::Range { offset, length } => {
            if length > MAX_RANGE {
                return Err(ReadError::refused(format!(
                    "{name}: {length} bytes at once are more than the {MAX_RANGE} the app reads."
                )));
            }
            let start = offset.min(size);
            (start, length.min(size - start))
        }
        ByteRange::All => unreachable!(),
    };
    file.seek(io::SeekFrom::Start(start))
        .map_err(|e| ReadError::io(name, e))?;
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(length)
        .read_to_end(&mut bytes)
        .map_err(|e| ReadError::io(name, e))?;
    Ok(bytes)
}

/// The database the search `folder` read as it is (no contaminants): the path its [`DATABASE_RECORD`]
/// records (written by the shim, `run.rs`), if it is one.
pub fn recorded_database(folder: &Path) -> Option<String> {
    const MAX: u64 = 1 << 20;
    let path = folder.join(DATABASE_RECORD);
    if fs::symlink_metadata(&path).map_or(true, |m| !m.is_file() || m.len() > MAX) {
        return None;
    }
    let record: serde_json::Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
    record.get("path")?.as_str().map(str::to_string)
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
    let counted = if is_fasta_file(&name) {
        fasta_counts(Path::new(path)).map(|(p, r)| {
            facts.proteins = Some(p);
            facts.residues = Some(r);
        })
    } else if suffix_start(&name, ".gz").is_none() {
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

/// Whether `link` already is the example run under its name: a symbolic link to `run` (Unix), or a file
/// of the run's size (Windows: a hard link or copy of it, see `link_example`).
fn is_example_link(link: &Path, run: &Path) -> bool {
    if cfg!(unix) {
        fs::read_link(link).ok().as_deref() == Some(run) && link.is_file()
    } else {
        let size = |p: &Path| {
            fs::symlink_metadata(p)
                .ok()
                .filter(|m| m.is_file())
                .map(|m| m.len())
        };
        size(link).is_some() && size(link) == size(run)
    }
}

/// The bundled example run under another name. Windows has no symbolic links without a privilege: a
/// hard link, or, where the app's data is on another drive than the app, a copy of the bundled file (the
/// app's own example, 6.5 MB; the user's files are never copied).
fn link_example(run: &Path, link: &Path) -> io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(run, link);
    #[cfg(not(unix))]
    return fs::hard_link(run, link).or_else(|_| fs::copy(run, link).map(|_| ()));
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
        if !is_example_link(&link, &run) {
            if fs::symlink_metadata(&link).is_ok() {
                fs::remove_file(&link).map_err(|e| format!("{} ({e})", link.display()))?;
            }
            link_example(&run, &link).map_err(|e| {
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
