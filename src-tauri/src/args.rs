//! The search request and its translation into ProSE's command line.
//!
//! The front end sends a [`SearchRequest`] (camelCase JSON). [`build_args`] checks it and turns it into
//! arguments for the tool. Nothing here runs a process or touches the search folder; the folder is made
//! by [`mod@crate::run`], which also creates the links and the database that these arguments name.
//!
//! Parameters are ProSE's `Search:` parameters by their name without the prefix, as in the web app
//! (`peptide:missed_cleavages`, `FDR:PSM`). Only the names in [`PARAMETERS`] pass, each with the type
//! it has in ProSE, so that nothing from the front end can become another option of the tool
//! (`-in`, `-ini`, an output of its own choosing).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// One input file: the front end's id for it and its path.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFile {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettings {
    /// ProSE parameters by name, without the `Search:` prefix (see [`PARAMETERS`]).
    pub parameters: Map<String, Value>,
    /// Percolator rescoring (`Search:rescore`).
    pub rescore: bool,
    /// PeptDeep features (`Search:peptdeep:enable`); ProSE finds its models itself.
    pub peptdeep: bool,
    /// `-threads` (0: all cores).
    pub threads: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub files: Vec<SearchFile>,
    pub database: String,
    /// Append the bundled cRAP to the database, with `CON__` accessions.
    pub contaminants: bool,
    pub settings: SearchSettings,
}

/// The type of a ProSE parameter, which decides how a JSON value becomes arguments.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An integer (`<number>` in ProSE's help).
    Int,
    /// A real number (`<value>`).
    Float,
    /// One of ProSE's choices, a string; the `true`/`false` ones also take a JSON boolean.
    Choice,
    /// Free text; empty means unset.
    Text,
    /// A list of strings, one argument each (an empty list clears the default).
    List,
    /// A switch without a value: `-Search:name` when true, nothing when false.
    Flag,
}

use Kind::*;

/// Every `Search:` parameter a search may set, with its type. The four that the request's own fields
/// set (`rescore`, `peptdeep:enable` and the two PeptDeep model paths) are not in the list.
/// The list is ProSE's `--helphelp` of the pinned build (`native/OPENMS_COMMIT`).
pub const PARAMETERS: &[(&str, Kind)] = &[
    ("enzyme", Choice),
    ("decoys", Choice),
    ("decoy_prefix", Text),
    ("low_memory", Flag),
    ("precursor:mass_tolerance_lower", Float),
    ("precursor:mass_tolerance_upper", Float),
    ("precursor:mass_tolerance_unit", Choice),
    ("precursor:min_charge", Int),
    ("precursor:max_charge", Int),
    ("precursor:isotope_error_min", Int),
    ("precursor:isotope_error_max", Int),
    ("fragment:mass_tolerance", Float),
    ("fragment:mass_tolerance_unit", Choice),
    ("fragment:deisotope", Choice),
    ("fragment:deisotope_min_peaks", Int),
    ("fragment:deisotope_charge_cap", Choice),
    ("fragment:deisotope_sum_intensity", Choice),
    ("fragment:min_mz", Int),
    ("fragment:max_mz", Int),
    ("fragment:min_ion_index", Int),
    ("fragment:query_spectrum", Choice),
    ("fragment:min_matched_ions", Int),
    ("fragment:max_charge", Int),
    ("peaks:keep_n", Int),
    ("peaks:window_top", Int),
    ("peaks:window_type", Choice),
    ("modifications:fixed", List),
    ("modifications:variable", List),
    ("modifications:variable_max_per_peptide", Int),
    ("annotate:PSM", List),
    ("annotate:self_trained_ion_priors", Choice),
    ("annotate:ion_prior_model", Choice),
    ("annotate:ion_prior_peaks", Choice),
    ("annotate:ion_prior_max_fragment_charge", Int),
    ("annotate:ion_prior_train_fdr", Float),
    ("annotate:ion_prior_min_psms", Int),
    ("annotate:ion_prior_features", List),
    ("annotate:local_fragment_evidence", Choice),
    ("peptdeep:instrument", Choice),
    ("peptdeep:nce", Float),
    ("peptdeep:rt_model_type", Choice),
    ("peptdeep:batch_size", Int),
    ("peptide:min_size", Int),
    ("peptide:max_size", Int),
    ("peptide:missed_cleavages", Int),
    ("peptide:clip_nterm_methionine", Choice),
    ("peptide:deduplicate", Choice),
    ("peptide:protein_mapping", Choice),
    ("peptide:enzyme_specificity", Choice),
    ("peptide:motif", Text),
    ("peptide:min_mass", Int),
    ("peptide:max_mass", Int),
    ("report:top_hits", Int),
    ("report:isotope_error_convention", Choice),
    ("FDR:PSM", Float),
    ("FDR:PSM_groups", Choice),
    ("FDR:protein", Float),
    ("scoring:max_candidates_per_spectrum", Int),
    ("scoring:fragment_charges", Choice),
    ("scoring:method", Choice),
    ("scoring:mass_error_sd", Float),
    ("ions:add_y_ions", Choice),
    ("ions:add_b_ions", Choice),
    ("ions:add_a_ions", Flag),
    ("ions:add_c_ions", Flag),
    ("ions:add_x_ions", Flag),
    ("ions:add_z_ions", Flag),
    ("ions:add_zp1_ions", Flag),
    ("ions:by_activation", Choice),
    ("calibration:enabled", Flag),
    ("calibration:subset_ratio", Float),
    ("calibration:min_psms", Int),
    ("database:chunk_size", Int),
];

/// The name of the database in the search folder when contaminants are appended.
pub const DATABASE_FILE: &str = "database.fasta";

/// The record of the user's database in the search folder when ProSE searches it as it is (no contaminants):
/// `{"path": "<absolute path>"}`, the one absolute path the reader may read (`files::resolve_search_file`).
pub const DATABASE_RECORD: &str = "database.json";

/// The QPX output of ProSE in the search folder: `-out_qpx`, with `-qpx_extended` (the columns and the footer
/// the results reader needs, docs/parity.md).
pub const QPX_DIR: &str = "qpx";

/// The peak filter of the stored spectra (`-qpx_peak_window`, `-qpx_peak_top`; ProSE's QPX mz view): the 100
/// most intense peaks per 100 m/z and every peak ProSE annotated (the user's choice). On an Orbitrap HCD run
/// (~1,100 peaks per MS2 spectrum) it keeps 631 peaks per spectrum and removes 6.2 % of the peaks the PSM view's
/// annotation matches (b/y/a/c/x/z, charge 1-2), nearly all of intensity 0; of b/y matches 1.2 % (docs/parity.md).
pub const PEAK_WINDOW: f64 = 100.0;
pub const PEAK_TOP: u32 = 100;

/// The idXML of a search of several inputs (`-out_merged`), and of one input (`-out_idxml`), in the search
/// folder (the Export menu's idXML: `src/lib/results/exports.ts`).
pub const MERGED_IDXML: &str = "merged.idXML";
pub const SINGLE_IDXML: &str = "search.idXML";

/// The FDR the shim uses when the request has no `FDR:PSM`: ProSE's default (0) filters nothing and
/// leaves a search without q-values, which the results need.
pub const DEFAULT_PSM_FDR: f64 = 0.01;

/// Where `suffix` (ASCII, with the dot) begins at the end of `name`, compared ignoring ASCII case as
/// OpenMS compares extensions (`FileNameUtils`); None if `name` does not end with it. The original's own
/// bytes are compared: a lower-cased copy can be longer or shorter (`İ`, `Ⱥ`, `ẞ`, the Kelvin sign), and
/// its byte offsets do not fit the original.
pub fn suffix_start(name: &str, suffix: &str) -> Option<usize> {
    let start = name.len().checked_sub(suffix.len())?;
    (name.is_char_boundary(start) && name[start..].eq_ignore_ascii_case(suffix)).then_some(start)
}

/// Extension check: `name` ends with one of `suffixes` (with the dot), ignoring ASCII case.
fn has_suffix(name: &str, suffixes: &[&str]) -> bool {
    suffixes.iter().any(|s| suffix_start(name, s).is_some())
}

pub fn is_spectrum_file(name: &str) -> bool {
    has_suffix(name, &[".mzml", ".mzml.gz"])
}

pub fn is_fasta_file(name: &str) -> bool {
    has_suffix(name, &[".fasta", ".fa", ".faa"])
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The name of input `index` (0-based) in the search folder: `<n>__<name>` with `n` from 1. ProSE names
/// its per-input outputs after the input and refuses two inputs of one name, so an input goes in as
/// a link with a name of its own (see [`InputLinks`]); the suffix (`.mzML.gz`) stays as it is.
pub fn link_name(index: usize, path: &str) -> String {
    format!("{}__{}", index + 1, file_name(path))
}

/// Whether `name`, a name in the top level of a search folder, is one of the links to the inputs
/// (`<n>__<name>.mzML[.gz]`): never one of the search's own files.
pub fn is_input_link(name: &str) -> bool {
    name.split_once("__").is_some_and(|(n, rest)| {
        !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) && is_spectrum_file(rest)
    })
}

/// How the inputs reach ProSE, which names its outputs after each input's stem and refuses two inputs
/// of one stem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputLinks {
    /// Every input as a symbolic link `<n>__<name>` in the search folder (Linux, macOS).
    Symlinks,
    /// Windows, where a symbolic link needs a privilege (developer mode): the inputs by their own paths
    /// when their stems differ (ignoring case, as NTFS does); those that share a stem as hard links
    /// `<n>__<name>` in the search folder, which works on the same volume only; never a copy.
    PathsOrHardLinks,
}

impl InputLinks {
    /// This platform's way.
    pub const PLATFORM: InputLinks = if cfg!(windows) {
        InputLinks::PathsOrHardLinks
    } else {
        InputLinks::Symlinks
    };
}

/// How one input reaches ProSE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// A symbolic link `<n>__<name>` in the search folder.
    Symlink,
    /// A hard link `<n>__<name>` in the search folder, removed again when the search ends.
    HardLink,
    /// The user's path itself.
    OwnPath,
}

/// The stem ProSE gives an input of this name, compared as NTFS compares names.
fn stem_key(name: &str) -> String {
    input_stem(name).to_lowercase()
}

fn all_unique(names: impl IntoIterator<Item = String>) -> bool {
    let mut seen = std::collections::HashSet::new();
    names.into_iter().all(|n| seen.insert(stem_key(&n)))
}

/// How each input of `req` reaches ProSE (in order).
pub fn input_placements(req: &SearchRequest, links: InputLinks) -> Vec<Placement> {
    match links {
        InputLinks::Symlinks => vec![Placement::Symlink; req.files.len()],
        InputLinks::PathsOrHardLinks => {
            let keys: Vec<String> = req
                .files
                .iter()
                .map(|f| stem_key(&file_name(&f.path)))
                .collect();
            let placements: Vec<Placement> = keys
                .iter()
                .map(|k| {
                    if keys.iter().filter(|other| *other == k).count() > 1 {
                        Placement::HardLink
                    } else {
                        Placement::OwnPath
                    }
                })
                .collect();
            // a file whose own name looks like a link (`1__a.mzML` beside two `a.mzML`): all as links
            let names = req
                .files
                .iter()
                .enumerate()
                .zip(&placements)
                .map(|((i, f), p)| seen_name(i, &f.path, *p));
            if all_unique(names) {
                placements
            } else {
                vec![Placement::HardLink; req.files.len()]
            }
        }
    }
}

/// The name ProSE sees for input `index`: the link's, or the file's own.
fn seen_name(index: usize, path: &str, placement: Placement) -> String {
    match placement {
        Placement::OwnPath => file_name(path),
        Placement::Symlink | Placement::HardLink => link_name(index, path),
    }
}

/// What ProSE calls an input in its outputs (`<stem>.psm.parquet`): the link's name without `.gz`
/// and `.mzML`, ignoring ASCII case (OpenMS's `File::stemName`).
pub fn input_stem(link: &str) -> String {
    let mut stem = link;
    if let Some(end) = suffix_start(stem, ".gz") {
        stem = &stem[..end];
    }
    if let Some(end) = suffix_start(stem, ".mzml") {
        stem = &stem[..end];
    }
    stem.to_string()
}

fn check_file(
    kind: &str,
    path: &str,
    accepted: fn(&str) -> bool,
    expected: &str,
) -> Result<(), String> {
    if path.is_empty() {
        return Err(format!("No {kind} was given."));
    }
    // an absolute path cannot be taken for an option (a relative "-in" would be), and does not depend
    // on the folder the app was started in
    if !Path::new(path).is_absolute() {
        return Err(format!("The {kind} {path} is not an absolute path."));
    }
    let meta =
        fs::metadata(path).map_err(|e| format!("The {kind} {path} cannot be read ({e})."))?;
    if !meta.is_file() {
        return Err(format!("The {kind} {path} is not a file."));
    }
    if !accepted(&file_name(path)) {
        return Err(format!("The {kind} {path} is not {expected}."));
    }
    Ok(())
}

/// A string for the command line: not empty (unless `allow_empty`), no control characters, and not
/// starting with `-`, which ProSE would take for an option.
fn text_value(name: &str, value: &str, allow_empty: bool) -> Result<String, String> {
    if value.is_empty() && !allow_empty {
        return Err(format!("The value of {name} is empty."));
    }
    if value.starts_with('-') {
        return Err(format!(
            "The value of {name} may not start with \"-\": {value}"
        ));
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(format!("The value of {name} has control characters."));
    }
    Ok(value.to_string())
}

fn number(name: &str, value: &Value) -> Result<f64, String> {
    value
        .as_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| format!("The value of {name} must be a number, not {value}."))
}

/// The arguments one parameter becomes.
fn parameter_args(name: &str, kind: Kind, value: &Value) -> Result<Vec<OsString>, String> {
    let flag = OsString::from(format!("-Search:{name}"));
    let one = |v: String| vec![flag.clone(), OsString::from(v)];
    Ok(match kind {
        Int => {
            let f = number(name, value)?;
            if f.fract() != 0.0 || f.abs() > 9.0e15 {
                return Err(format!(
                    "The value of {name} must be a whole number, not {value}."
                ));
            }
            one(format!("{}", f as i64))
        }
        Float => one(format!("{}", number(name, value)?)),
        Choice => match value {
            Value::String(s) => one(text_value(name, s, false)?),
            Value::Bool(b) => one(b.to_string()),
            _ => return Err(format!("The value of {name} must be text, not {value}.")),
        },
        Text => match value {
            Value::String(s) if s.is_empty() => vec![],
            Value::String(s) => one(text_value(name, s, false)?),
            _ => return Err(format!("The value of {name} must be text, not {value}.")),
        },
        List => {
            let Value::Array(items) = value else {
                return Err(format!("The value of {name} must be a list, not {value}."));
            };
            let mut args = vec![flag];
            for item in items {
                let Value::String(s) = item else {
                    return Err(format!("The items of {name} must be text, not {item}."));
                };
                args.push(OsString::from(text_value(name, s, false)?));
            }
            args
        }
        Flag => match value {
            Value::Bool(true) => vec![flag],
            Value::Bool(false) => vec![],
            _ => {
                return Err(format!(
                    "The value of {name} must be true or false, not {value}."
                ))
            }
        },
    })
}

/// A parameter of the request as a number (for the open-search rule), or the default.
fn number_or(params: &Map<String, Value>, name: &str, default: f64) -> f64 {
    params.get(name).and_then(Value::as_f64).unwrap_or(default)
}

/// ProSE's rule (`FragmentIndex::isOpenSearchMode`): a precursor window of more than 1000 ppm or 1 Da on
/// either side is an open search, which gets the modification analysis.
pub fn is_open_search(params: &Map<String, Value>) -> bool {
    let ppm = params
        .get("precursor:mass_tolerance_unit")
        .and_then(Value::as_str)
        .unwrap_or("ppm")
        == "ppm";
    let lower = number_or(params, "precursor:mass_tolerance_lower", 10.0);
    let upper = number_or(params, "precursor:mass_tolerance_upper", 10.0);
    lower.max(upper) > if ppm { 1000.0 } else { 1.0 }
}

/// The command line of a search whose folder is `out_dir`, with this platform's [`InputLinks`].
pub fn build_args(req: &SearchRequest, out_dir: &Path) -> Result<Vec<OsString>, String> {
    build_args_with(req, out_dir, InputLinks::PLATFORM)
}

/// The command line of a search whose folder is `out_dir`: the inputs as the links `<n>__<name>` in it
/// or by their own paths ([`input_placements`]), the database (the folder's `database.fasta` with
/// contaminants, else the user's file), and the outputs the app reads (`docs/parity.md`, "How the app
/// runs ProSE"). Checks the request first.
pub fn build_args_with(
    req: &SearchRequest,
    out_dir: &Path,
    links: InputLinks,
) -> Result<Vec<OsString>, String> {
    if req.files.is_empty() {
        return Err("There is no input file.".to_string());
    }
    for file in &req.files {
        check_file(
            "input file",
            &file.path,
            is_spectrum_file,
            "an mzML file (.mzML or .mzML.gz)",
        )?;
    }
    check_file(
        "database",
        &req.database,
        is_fasta_file,
        "a FASTA file (.fasta, .fa or .faa)",
    )?;

    let mut params = req.settings.parameters.clone();
    let mut threads = req.settings.threads;
    let mut parameter_args_list: Vec<OsString> = Vec::new();
    // validate every parameter before using any of them, in the order the front end gave
    for (name, value) in &params {
        if name == "threads" {
            let n = number(name, value)?;
            if n < 0.0 || n.fract() != 0.0 || n > f64::from(u32::MAX) {
                return Err(format!(
                    "The value of threads must be a whole number of at least 0, not {value}."
                ));
            }
            threads = n as u32;
            continue;
        }
        let Some((_, kind)) = PARAMETERS.iter().find(|(n, _)| n == name) else {
            return Err(format!(
                "The parameter {name} is not one of ProSE's search parameters the app sets."
            ));
        };
        parameter_args_list.extend(parameter_args(name, *kind, value)?);
    }
    match params.get("FDR:PSM") {
        Some(v) => {
            if number("FDR:PSM", v)? <= 0.0 {
                return Err(
                    "FDR:PSM must be above 0: without it the search has no q-values, which the results need.".to_string()
                );
            }
        }
        None => {
            params.insert("FDR:PSM".to_string(), Value::from(DEFAULT_PSM_FDR));
            parameter_args_list.extend(parameter_args(
                "FDR:PSM",
                Float,
                &Value::from(DEFAULT_PSM_FDR),
            )?);
        }
    }

    let mut args: Vec<OsString> = vec!["-in".into()];
    args.extend(
        req.files
            .iter()
            .zip(input_placements(req, links))
            .enumerate()
            .map(|(i, (f, placement))| match placement {
                Placement::OwnPath => OsString::from(&f.path),
                Placement::Symlink | Placement::HardLink => {
                    out_dir.join(link_name(i, &f.path)).into_os_string()
                }
            }),
    );
    args.push("-database".into());
    args.push(if req.contaminants {
        out_dir.join(DATABASE_FILE).into_os_string()
    } else {
        OsString::from(&req.database)
    });
    args.push("-out_qpx".into());
    args.push(out_dir.join(QPX_DIR).into_os_string());
    args.push("-qpx_extended".into());
    args.push("-qpx_peak_window".into());
    args.push(PEAK_WINDOW.to_string().into());
    args.push("-qpx_peak_top".into());
    args.push(PEAK_TOP.to_string().into());
    args.push("-keep_decoys".into());
    // the idXML of the Export menu: the merged one of several inputs, the one input's own
    if req.files.len() > 1 {
        args.push("-out_merged".into());
        args.push(out_dir.join(MERGED_IDXML).into_os_string());
    } else {
        args.push("-out_idxml".into());
        args.push(out_dir.join(SINGLE_IDXML).into_os_string());
    }
    if is_open_search(&params) {
        args.push("-out_mod_analysis_dir".into());
        args.push(out_dir.join("mods").into_os_string());
    }
    args.push("-threads".into());
    args.push(threads.to_string().into());
    args.push("-Search:rescore".into());
    args.push(req.settings.rescore.to_string().into());
    if req.settings.peptdeep {
        args.push("-Search:peptdeep:enable".into());
    }
    args.extend(parameter_args_list);
    Ok(args)
}

/// Writes `dest`: the user's FASTA, then the entries of `crap` with `CON__` before their accession
/// (unless it is there already), as the web app's `withContaminants` does. A newline is added after
/// the user's last line if it has none. Not deduplicated against the user's entries. The user's file
/// is only read.
pub fn with_contaminants(user: &Path, crap: &Path, dest: &Path) -> io::Result<()> {
    use io::Write;
    let crap_text = fs::read_to_string(crap)?;
    let mut out = io::BufWriter::new(fs::File::create(dest)?);
    let mut input = fs::File::open(user)?;
    let mut last = b'\n';
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = io::Read::read(&mut input, &mut buffer)?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read])?;
        last = buffer[read - 1];
    }
    if last != b'\n' {
        out.write_all(b"\n")?;
    }
    for line in crap_text.split_inclusive('\n') {
        if line.starts_with('>') && !line.starts_with(">CON__") {
            out.write_all(b">CON__")?;
            out.write_all(&line.as_bytes()[1..])?;
        } else {
            out.write_all(line.as_bytes())?;
        }
    }
    out.flush()
}

/// The record of one input in `inputs.json`: how the search folder's link maps to the user's file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputRecord {
    /// The front end's id of the file.
    pub id: String,
    /// Position in the request.
    pub index: usize,
    /// The name ProSE saw: the link in the search folder (`<n>__<name>`), or the file's own name when
    /// it was given its own path (Windows, [`InputLinks::PathsOrHardLinks`]).
    pub link: String,
    /// What ProSE calls the input in its outputs.
    pub stem: String,
    /// The user's file name.
    pub name: String,
    /// The user's path, as given.
    pub path: String,
}

pub fn input_records(req: &SearchRequest) -> Vec<InputRecord> {
    input_records_with(req, InputLinks::PLATFORM)
}

pub fn input_records_with(req: &SearchRequest, links: InputLinks) -> Vec<InputRecord> {
    let placements = input_placements(req, links);
    req.files
        .iter()
        .zip(placements)
        .enumerate()
        .map(|(index, (f, placement))| {
            let link = seen_name(index, &f.path, placement);
            InputRecord {
                id: f.id.clone(),
                index,
                stem: input_stem(&link),
                link,
                name: file_name(&f.path),
                path: f.path.clone(),
            }
        })
        .collect()
}

/// `text` with the search folder's names for the inputs replaced by the user's: the path of a link by
/// the user's path, the bare name of a link by the user's file name. Only whole names are replaced
/// (`1__a.mzML` inside `11__a.mzML` stays).
pub fn humanize(text: &str, dir: &Path, records: &[InputRecord]) -> String {
    let mut text = text.to_string();
    for r in records {
        let full: PathBuf = dir.join(&r.link);
        text = replace_whole(&text, &full.to_string_lossy(), &r.path);
        text = replace_whole(&text, &r.link, &r.name);
    }
    text
}

fn replace_whole(text: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return text.to_string();
    }
    let boundary = |c: Option<char>| c.is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut before: Option<char> = None;
    while let Some(at) = rest.find(from) {
        let prev = rest[..at].chars().next_back().or(before);
        let after = rest[at + from.len()..].chars().next();
        out.push_str(&rest[..at]);
        if boundary(prev) && boundary(after) {
            out.push_str(to);
        } else {
            out.push_str(from);
        }
        before = from.chars().next_back();
        rest = &rest[at + from.len()..];
    }
    out.push_str(rest);
    out
}
