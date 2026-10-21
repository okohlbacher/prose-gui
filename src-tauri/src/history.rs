//! History: the searches of the app's data folder (`<searches>/<id>/`), and the project files.
//!
//! A search is in History when its folder has `search.json` (the record: see `src/lib/history/history.ts`
//! for its schema, version 1). The app writes the record right after `search://done` ([`save`], with
//! `proteins.fasta`); from then on Rust owns the folder: [`list`], [`rename`], [`delete`], and
//! [`import`], which makes a folder of a project file's entries. A folder without a record is not
//! listed; [`sweep`] (at startup) removes the partial folders of interrupted searches and the finished
//! folders that never got a record. A folder with an unreadable or unknown record is listed with its
//! `error`, and never fails the list.
//!
//! A `<id>.partial` folder (a running search or import) holds `.lock`, locked exclusively by its owner
//! ([`lock_partial`]) until the folder is renamed or removed; the sweep removes a partial folder only
//! when it can take that lock itself (an owner that died has released it), so no app instance sweeps a
//! live folder of another.
//!
//! A project file (`.prose`) is a zip of the search folder's regular files. Zip is handled by the
//! front end; Rust reads the chosen file ([`read_project_file`]) and writes the entries the front end
//! sends ([`import`], in the framing of [`frame`]), after checking every path again.

use crate::files::{resolve_search_file, valid_id, valid_relative};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The version of `search.json` this app reads and writes.
pub const SCHEMA: u64 = 1;
/// A finished folder without a record is removed by the sweep after this long.
pub const SWEEP_GRACE: Duration = Duration::from_secs(600);
/// The largest `search.json` (it holds the design; a few kB to a few MB).
const MAX_RECORD: u64 = 64 << 20;
/// The longest name of a search.
const MAX_NAME: usize = 200;
/// The most entries and the longest name in a project's body.
const MAX_ENTRIES: usize = 100_000;
const MAX_ENTRY_NAME: usize = 1024;
/// How deep a search folder's files are looked for.
const MAX_DEPTH: usize = 8;

const RECORD: &str = "search.json";
/// The lock file of a partial folder.
pub const LOCK_FILE: &str = ".lock";
/// A lock file younger than this is not taken for a stale one (its owner may not have locked it yet).
const LOCK_SETTLE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub name: Option<String>,
    pub created_at: Option<String>,
    pub app_version: Option<String>,
    pub tool_version: Option<String>,
    /// The names of the searched files.
    pub files: Vec<String>,
    pub database: Option<String>,
    /// Target PSMs within the PSM FDR.
    pub psms: Option<u64>,
    /// What the folder takes on disk (its files, not the links to the inputs).
    pub bytes: u64,
    /// Why the folder cannot be opened (an unreadable or unknown record).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FolderFile {
    /// Relative to the folder, `/` separated.
    pub name: String,
    pub size: u64,
}

fn newer_message(schema: u64) -> String {
    format!(
        "This search was saved by a newer version of ProSE (schema {schema}) and cannot be opened by this one \
         (it reads schema {SCHEMA}). Open it with the latest version of ProSE."
    )
}

/// The record in `text`, if it is a JSON object of this schema; else why not.
fn parse_record(text: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("{RECORD} is not valid JSON ({e})."))?;
    let serde_json::Value::Object(map) = value else {
        return Err(format!("{RECORD} is not a search record."));
    };
    match map.get("schema").and_then(|s| s.as_u64()) {
        Some(SCHEMA) => Ok(map),
        Some(newer) if newer > SCHEMA => Err(newer_message(newer)),
        Some(other) => Err(format!("{RECORD} has the unknown schema {other}.")),
        None => Err(format!(
            "{RECORD} has no schema: it is not a ProSE search record."
        )),
    }
}

/// The size of the regular files of `dir`, links not followed.
fn folder_size(dir: &Path, depth: usize) -> u64 {
    let Ok(read) = fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0;
    for entry in read.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if meta.is_file() {
            total += meta.len();
        } else if meta.is_dir() && depth < MAX_DEPTH {
            total += folder_size(&entry.path(), depth + 1);
        }
    }
    total
}

/// The record's text, read through the scoped reader (no link leads out of the folder).
fn read_record(dir: &Path, id: &str) -> Result<String, String> {
    let path = resolve_search_file(dir, id, RECORD).map_err(|e| e.message)?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_RECORD {
        return Err(format!("{RECORD} is too large ({size} bytes)."));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{RECORD} cannot be read ({e})."))?;
    String::from_utf8(bytes).map_err(|_| format!("{RECORD} is not text."))
}

fn entry_of(dir: &Path, id: &str) -> HistoryEntry {
    let mut entry = HistoryEntry {
        id: id.to_string(),
        name: None,
        created_at: None,
        app_version: None,
        tool_version: None,
        files: Vec::new(),
        database: None,
        psms: None,
        bytes: folder_size(&dir.join(id), 0),
        error: None,
    };
    let record = read_record(dir, id).and_then(|text| parse_record(&text));
    match record {
        Err(message) => entry.error = Some(message),
        Ok(map) => {
            let text = |key: &str| map.get(key).and_then(|v| v.as_str()).map(str::to_string);
            entry.name = text("name");
            entry.created_at = text("createdAt");
            entry.app_version = text("appVersion");
            entry.tool_version = text("toolVersion");
            entry.database = text("database");
            entry.psms = map.get("psms").and_then(|v| v.as_u64());
            if let Some(files) = map.get("files").and_then(|v| v.as_array()) {
                entry.files = files
                    .iter()
                    .filter_map(|f| f.as_str().map(str::to_string))
                    .collect();
            }
        }
    }
    entry
}

/// The searches of History, the newest first (those with an `error` last). Never fails: what is wrong
/// with a folder is in its entry's `error`, and a folder without a record is not listed.
pub fn list(dir: &Path) -> Vec<HistoryEntry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for item in read.flatten() {
        let Some(id) = item.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_id(&id) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(item.path()) else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        // (a record that is a link or a folder is listed with its error; none: not in History)
        if fs::symlink_metadata(item.path().join(RECORD)).is_err() {
            continue;
        }
        entries.push(entry_of(dir, &id));
    }
    entries.sort_by(|a, b| {
        let key = |e: &HistoryEntry| {
            (
                e.error.is_none(),
                e.created_at.clone().unwrap_or_default(),
                e.id.clone(),
            )
        };
        key(b).cmp(&key(a))
    });
    entries
}

/// Writes `data` to `path` through a temporary file in the same folder, so that the file is whole or
/// absent.
fn write_atomically(path: &Path, data: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// The folder of search `id`, which has to exist (and not be a link).
fn existing_folder(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("{id:?} is not a search."));
    }
    let folder = dir.join(id);
    match fs::symlink_metadata(&folder) {
        Ok(meta) if meta.is_dir() => Ok(folder),
        Ok(_) => Err(format!("The search {id} is not a folder.")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            Err(format!("The search {id} does not exist."))
        }
        Err(e) => Err(format!("The search {id} cannot be read ({e}).")),
    }
}

/// Puts the finished search `id` into History: writes `proteins.fasta`, then `search.json` (so that a
/// record means a complete folder). The record has to be of this schema and name this folder as its
/// `id`; a search that has a record is not saved again.
pub fn save(dir: &Path, id: &str, record_json: &str, proteins_fasta: &str) -> Result<(), String> {
    let folder = existing_folder(dir, id)?;
    let map = parse_record(record_json)?;
    if map.get("id").and_then(|v| v.as_str()) != Some(id) {
        return Err(format!("The record does not belong to the search {id}."));
    }
    if fs::symlink_metadata(folder.join(RECORD)).is_ok() {
        return Err(format!("The search {id} is already saved."));
    }
    // (a name that is not a name is refused; the text is kept as the app wrote it unless the name is trimmed)
    let mut map = map;
    let rewritten = match map.get("name").and_then(|n| n.as_str()) {
        Some(name) => {
            let cleaned = clean_name(name)?;
            let changed = cleaned != name;
            map.insert("name".to_string(), serde_json::Value::String(cleaned));
            changed
        }
        None => false,
    };
    let record_text = if rewritten {
        serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?
    } else {
        record_json.to_string()
    };
    write_atomically(&folder.join("proteins.fasta"), proteins_fasta.as_bytes())
        .map_err(|e| format!("proteins.fasta cannot be written ({e})."))?;
    write_atomically(&folder.join(RECORD), record_text.as_bytes())
        .map_err(|e| format!("{RECORD} cannot be written ({e})."))
}

/// A name for a search: not empty, one line, not longer than [`MAX_NAME`] characters.
fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A name cannot be empty.".to_string());
    }
    if name.chars().count() > MAX_NAME {
        return Err(format!("A name has at most {MAX_NAME} characters."));
    }
    if name.chars().any(char::is_control) {
        return Err("A name is one line.".to_string());
    }
    Ok(name.to_string())
}

pub fn rename(dir: &Path, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name)?;
    let folder = existing_folder(dir, id)?;
    let mut map = parse_record(&read_record(dir, id)?)?;
    map.insert("name".to_string(), serde_json::Value::String(name));
    let text = serde_json::to_vec_pretty(&map).map_err(|e| e.to_string())?;
    write_atomically(&folder.join(RECORD), &text)
        .map_err(|e| format!("{RECORD} cannot be written ({e})."))
}

/// Removes the search's folder (any folder of the searches folder by its id: also one without a
/// record). A search that is not there is fine. Links inside are removed, never followed.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("{id:?} is not a search."));
    }
    let folder = dir.join(id);
    match fs::symlink_metadata(&folder) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("The search {id} cannot be read ({e}).")),
        Ok(meta) if !meta.is_dir() => return Err(format!("The search {id} is not a folder.")),
        Ok(_) => {}
    }
    fs::remove_dir_all(&folder).map_err(|e| format!("The search {id} cannot be deleted ({e})."))
}

fn collect_files(root: &Path, dir: &Path, depth: usize, out: &mut Vec<FolderFile>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_file() {
            if depth == 0 && entry.file_name() == LOCK_FILE {
                continue;
            }
            if let Ok(relative) = path.strip_prefix(root) {
                let name = relative
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(FolderFile {
                    name,
                    size: meta.len(),
                });
            }
        } else if meta.is_dir() && depth < MAX_DEPTH {
            collect_files(root, &path, depth + 1, out);
        }
    }
}

/// The regular files of a search folder (a project file's content), without the links to the inputs.
pub fn folder_files(dir: &Path, id: &str) -> Result<Vec<FolderFile>, String> {
    let folder = existing_folder(dir, id)?;
    let mut files = Vec::new();
    collect_files(&folder, &folder, 0, &mut files);
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// The bytes of the `.prose` file that the user chose in the open dialog (`open_project_file`; the page
/// never names a path). Refused unless it is an absolute path with the extension `.prose` that is a
/// regular file itself: a link is not followed.
pub fn read_chosen_project(path: &Path) -> Result<Vec<u8>, String> {
    let shown = path.display();
    let is_prose = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("prose"));
    if !path.is_absolute() || !is_prose {
        return Err(format!("{shown} is not a project file (.prose)."));
    }
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{shown} cannot be read ({e})."))?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a regular file."));
    }
    let bytes = fs::read(path).map_err(|e| format!("{shown} cannot be read ({e})."))?;
    if bytes.is_empty() {
        return Err(format!("{shown} is empty."));
    }
    Ok(bytes)
}

//------------------------------------------------------------------------------------------------
// Locks of partial folders

/// Locks a partial folder for its owner: makes `<folder>/.lock` and takes an exclusive lock on it, which
/// the owner keeps (the returned file) until the folder is renamed ([`finish_partial`]) or removed. The
/// operating system releases it when the process ends, however it ends.
pub fn lock_partial(folder: &Path) -> io::Result<fs::File> {
    let file = fs::File::create(folder.join(LOCK_FILE))?;
    file.lock()?;
    Ok(file)
}

/// Makes the finished folder of a partial one: the lock file is removed (it never belongs to a search
/// or a project), the folder renamed to `target`, and only then the lock released.
pub fn finish_partial(lock: Option<fs::File>, partial: &Path, target: &Path) -> io::Result<()> {
    let _ = fs::remove_file(partial.join(LOCK_FILE));
    let renamed = fs::rename(partial, target);
    drop(lock);
    renamed
}

//------------------------------------------------------------------------------------------------
// Import

/// The body of `history_import`: the entries of a project, each `[u32 BE name length][name]
/// [u64 BE data length][data]`, one after the other.
pub fn frame(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, data) in entries {
        out.extend_from_slice(&(name.len() as u32).to_be_bytes());
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&(data.len() as u64).to_be_bytes());
        out.extend_from_slice(data);
    }
    out
}

fn take<'a>(body: &'a [u8], at: &mut usize, n: usize) -> Result<&'a [u8], String> {
    let end = at
        .checked_add(n)
        .filter(|end| *end <= body.len())
        .ok_or("The project's entries are cut short.")?;
    let slice = &body[*at..end];
    *at = end;
    Ok(slice)
}

fn parse_frames(body: &[u8]) -> Result<Vec<(String, &[u8])>, String> {
    let mut entries = Vec::new();
    let mut at = 0;
    while at < body.len() {
        let name_len = u32::from_be_bytes(take(body, &mut at, 4)?.try_into().unwrap()) as usize;
        if name_len > MAX_ENTRY_NAME {
            return Err("A name in the project is too long.".to_string());
        }
        let name = String::from_utf8(take(body, &mut at, name_len)?.to_vec())
            .map_err(|_| "A name in the project is not text.".to_string())?;
        let data_len = u64::from_be_bytes(take(body, &mut at, 8)?.try_into().unwrap());
        let data_len = usize::try_from(data_len).map_err(|_| "An entry is too large.")?;
        entries.push((name, take(body, &mut at, data_len)?));
        if entries.len() > MAX_ENTRIES {
            return Err("The project has too many files.".to_string());
        }
    }
    Ok(entries)
}

/// A plain relative name: what `files::valid_relative` allows, without control characters, and not
/// a folder (no trailing `/`, which `valid_relative` refuses as an empty part).
fn plain_name(name: &str) -> bool {
    valid_relative(name) && !name.chars().any(char::is_control)
}

/// A fresh id for an imported search, with its `.partial` folder made and locked (the id is the shim's
/// `<millis>-` and an `i` count: no shim id is the same).
fn reserve_import(dir: &Path) -> Result<(String, PathBuf, fs::File), String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    for n in 0..10_000 {
        let id = format!("{millis}-i{n}");
        if dir.join(&id).exists() {
            continue;
        }
        let partial = dir.join(format!("{id}.partial"));
        match fs::create_dir(&partial) {
            Ok(()) => match lock_partial(&partial) {
                Ok(lock) => return Ok((id, partial, lock)),
                Err(e) => {
                    let _ = fs::remove_dir_all(&partial);
                    return Err(format!("The search folder cannot be locked ({e})."));
                }
            },
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(format!(
                    "The search folder {} cannot be made ({e}).",
                    partial.display()
                ))
            }
        }
    }
    Err("No free id for the imported search.".to_string())
}

/// Makes a search of a project's entries (see [`frame`]) in a fresh folder, and returns its id. Every
/// name is checked here again (plain, relative, unique, no file that is also a folder), the record has
/// to be of this schema (a newer one is refused with a message), and the record's `id` becomes the
/// folder's. The folder is made as `<id>.partial` and renamed when complete.
pub fn import(dir: &Path, body: &[u8]) -> Result<String, String> {
    let entries = parse_frames(body)?;
    if entries.is_empty() {
        return Err("The project is empty.".to_string());
    }
    let mut names = HashSet::new();
    let mut folders = HashSet::new();
    for (name, _) in &entries {
        if !plain_name(name) || name == LOCK_FILE {
            return Err(format!(
                "{name:?} in the project is not a plain file name inside the folder."
            ));
        }
        if !names.insert(name.as_str()) {
            return Err(format!("{name} is in the project twice."));
        }
        let mut prefix = String::new();
        let parts: Vec<&str> = name.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            prefix.push_str(part);
            folders.insert(prefix.clone());
            prefix.push('/');
        }
    }
    if let Some(clash) = names.iter().find(|n| folders.contains(**n)) {
        return Err(format!("{clash} is a file and a folder in the project."));
    }
    let Some((_, record)) = entries.iter().find(|(name, _)| name == RECORD) else {
        return Err(format!(
            "The project has no {RECORD}: it is not a ProSE project."
        ));
    };
    let text = std::str::from_utf8(record).map_err(|_| format!("{RECORD} is not text."))?;
    let mut map = parse_record(text)?;
    // the name is a name (as `rename` and `save` have it); the search is marked as imported, whatever
    // the project says: its summary's database path is not served (`files::resolve_search_file`)
    if let Some(name) = map.get("name").and_then(|n| n.as_str()) {
        let cleaned = clean_name(name)?;
        map.insert("name".to_string(), serde_json::Value::String(cleaned));
    }
    map.insert("imported".to_string(), serde_json::Value::Bool(true));

    fs::create_dir_all(dir).map_err(|e| {
        format!(
            "The searches folder {} cannot be made ({e}).",
            dir.display()
        )
    })?;
    let (id, partial, lock) = reserve_import(dir)?;
    let written = (|| -> Result<(), String> {
        let root = fs::canonicalize(&partial).map_err(|e| e.to_string())?;
        for (name, data) in &entries {
            if name == RECORD {
                continue;
            }
            let path = root.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("{name} cannot be made ({e})."))?;
                // (the folders are the ones just made: nothing in them is a link)
                let real = fs::canonicalize(parent).map_err(|e| e.to_string())?;
                if !real.starts_with(&root) {
                    return Err(format!("{name} lies outside the search folder."));
                }
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| format!("{name} cannot be written ({e})."))?;
            file.write_all(data)
                .map_err(|e| format!("{name} cannot be written ({e})."))?;
        }
        map.insert("id".to_string(), serde_json::Value::String(id.clone()));
        let text = serde_json::to_vec_pretty(&map).map_err(|e| e.to_string())?;
        fs::write(root.join(RECORD), text)
            .map_err(|e| format!("{RECORD} cannot be written ({e})."))?;
        Ok(())
    })();
    match written {
        Ok(()) => finish_partial(Some(lock), &partial, &dir.join(&id))
            .map(|()| id)
            .map_err(|e| {
                let _ = fs::remove_dir_all(&partial);
                format!("The search folder cannot be finished ({e}).")
            }),
        Err(e) => {
            let _ = fs::remove_dir_all(&partial);
            drop(lock);
            Err(e)
        }
    }
}

//------------------------------------------------------------------------------------------------
// Sweep

/// The time of the last write into a folder: its own and its log's (a long search ends with the log's
/// last line).
fn last_written(folder: &Path) -> Option<SystemTime> {
    let own = fs::metadata(folder).and_then(|m| m.modified()).ok();
    let log = fs::metadata(folder.join("prose.log"))
        .and_then(|m| m.modified())
        .ok();
    own.max(log)
}

fn older_than(time: Option<SystemTime>, now: SystemTime, grace: Duration) -> bool {
    time.and_then(|t| now.duration_since(t).ok())
        .is_some_and(|age| age > grace)
}

/// Whether the sweep may remove the partial folder: its lock can be taken (its owner is gone) and the
/// lock file is not brand new; a folder without lock file (one of an older version) only when it has
/// not been written to for `grace`. The lock taken is returned, to be held while the folder is removed.
fn claim_partial(folder: &Path, now: SystemTime, grace: Duration) -> Option<Option<fs::File>> {
    let lock_path = folder.join(LOCK_FILE);
    match fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
    {
        Ok(file) => match file.try_lock() {
            Ok(()) => {
                let made = file.metadata().and_then(|m| m.modified()).ok();
                // (an owner creates the file, then locks it: a file this young may be about to be)
                older_than(made, now, LOCK_SETTLE).then_some(Some(file))
            }
            Err(_) => None,
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            older_than(last_written(folder), now, grace).then_some(None)
        }
        Err(_) => None,
    }
}

/// The startup sweep of the searches folder: removes `<id>.partial` folders whose owner is gone (see
/// [`claim_partial`]: a running search or import, of this or another app instance, holds its lock), and
/// finished `<id>` folders without a record whose last write is more than `grace` before `now` (the app
/// saves a record within moments of a search's end). The folders are listed first, so none made while
/// the sweep runs is looked at. Links, files, and anything not named like a search are left alone.
/// Returns the names removed.
pub fn sweep(dir: &Path, now: SystemTime, grace: Duration) -> Vec<String> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let found: Vec<(String, PathBuf)> = read
        .flatten()
        .filter_map(|item| {
            let name = item.file_name().to_str()?.to_string();
            let path = item.path();
            fs::symlink_metadata(&path)
                .is_ok_and(|m| m.is_dir())
                .then_some((name, path))
        })
        .collect();
    let mut removed = Vec::new();
    for (name, path) in found {
        let (remove, _guard) = match name.strip_suffix(".partial") {
            Some(id) if valid_id(id) => match claim_partial(&path, now, grace) {
                Some(guard) => (true, guard),
                None => (false, None),
            },
            Some(_) => (false, None),
            None => (
                valid_id(&name)
                    && fs::symlink_metadata(path.join(RECORD)).is_err()
                    && older_than(last_written(&path), now, grace),
                None,
            ),
        };
        if remove && fs::remove_dir_all(&path).is_ok() {
            removed.push(name);
        }
    }
    removed.sort();
    removed
}
