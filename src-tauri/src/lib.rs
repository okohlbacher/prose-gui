//! ProSE desktop: the Tauri shell around the ProSE tool of OpenMS.
//!
//! The shim (`tool`, `args`, `progress`, `run`) runs the tool for a search request and reports its
//! progress; the commands and events below are what the front end sees:
//!
//! - `tool_info` -> `{ version, path, onnx }`
//! - `start_search(request)` -> `{ searchId }`; `cancel_search(searchId)`
//! - events `search://progress` `{ searchId, label, file, fraction }`, `search://done`
//!   `{ searchId, folder }` and `search://failed` `{ searchId, message, stage, file?, ended?, detail?, log? }`
//! - `read_search_file(searchId, name, tail?, offset?, length?)` -> the bytes of a file of the search's folder
//!   (with `tail`: its last `tail` bytes; with `offset` and `length`: those bytes), or of the database its database.json records (`files`; rejects `{ notFound, message }`)
//! - `inspect_files(paths)` -> `[{ path, name, size, spectra?, proteins?, residues?, error?, problem?, warnings }]`
//! - `inspect_spectra(paths)` -> per path the facts of its first MS2 spectra, or null (`spectra`)
//! - `cpu_count()` -> the cores the search's threads may use
//! - `example_files()` -> `{ spectra: [path, path], database }`
//! - `open_design_file()` -> `{ path, text }` of an SDRF or design.tsv chosen (null if cancelled);
//!   `read_design_file(path)` -> the text of one given by path (Add files, drop);
//!   `locate_data_files(sdrf, names, folder?)` -> `[{ exact?, mzml? }]` (`locate`)
//! - `ols_search(query, ontologies, online)` -> `[{ label, accession }]` (the cache only unless `online`); `validate_sdrf(text, template?)` ->
//!   `{ available, ok, output }` (`sdrf_tools`)
//! - `pride_files(pxd)` -> `[{ name, size, url }]`; `choose_download_folder(title)` -> the folder (the system's
//!   dialog; kept in Rust); `download_data_files(files)` -> paths into it, events
//!   `download://progress` `{ file, files, name, received, size }`; `cancel_download()` (`pride`)
//! - `save_text(name, contents)` and `save_search_file(searchId, name, suggested)`: a save dialog of
//!   the system, then the file written where the user chose (-> the path, or null if cancelled)
//! - History (`history`): `history_list()` -> entries (a folder with a broken record, or none, has
//!   `error`), `history_save_record(searchId, record)` (a finished search gets its `search.json`, right
//!   after `search://done`), `history_save_proteins(searchId, proteins)` (its `proteins.fasta`, once the
//!   results are read; the folder's `database.fasta` goes), `history_rename(searchId, name)`,
//!   `history_delete(searchId)`, `history_files(searchId)` (the regular files of the folder, for a project
//!   file), `save_project_file(searchId, name)` (a save dialog, then the search's project zip written there
//!   entry by entry: `project`; events `project://progress` `{ searchId, written, total }`),
//!   `open_project_file()` (the open dialog, then the bytes of the file chosen; empty if
//!   cancelled) and `history_import(body)` (the entries of a project in a fresh folder -> the new id). At
//!   startup the partial folders of interrupted searches are swept (`history::sweep`).
//!
//! - closing the window while a search runs: the window stays and `app://close-requested` asks the page,
//!   which answers with `answer_close(close)` ([`close_requested`])
//!
//! `--smoke-test` on the command line is the packaged app's start test ([`SMOKE_TEST`]); `--watch-search`
//! makes the executable the watchdog of a search (macOS: [`watchdog`]).

pub mod args;
pub mod content;
pub mod decoys;
pub mod files;
pub mod history;
pub mod locate;
pub mod net;
pub mod pride;
pub mod sdrf_tools;
pub mod spectra;
pub mod progress;
pub mod project;
pub mod run;
pub mod tool;
#[cfg(unix)]
pub mod watchdog;

use args::SearchRequest;
use run::{SearchEvent, Searches, Sink};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Response;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    searches: Arc<Searches>,
    closing: std::sync::Mutex<Closing>,
}

impl Default for AppState {
    /// On macOS each search's tool is watched by the app's own executable (`watchdog`): nothing else ends
    /// it when the app dies.
    fn default() -> AppState {
        let searches = Searches::default();
        #[cfg(target_os = "macos")]
        let searches = match std::env::current_exe() {
            Ok(exe) => searches.with_watchdog(exe),
            Err(_) => searches,
        };
        AppState {
            searches: Arc::new(searches),
            closing: Default::default(),
        }
    }
}

/// The window's close while a search runs ([`close_requested`]).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Closing {
    /// The page has been asked to confirm, and has not answered yet.
    asked: bool,
    /// The user confirmed: the next close request closes.
    confirmed: bool,
}

impl Closing {
    /// A search starts: a question about an earlier one that was never answered (the page could not answer, or
    /// the search ended meanwhile) is forgotten, so that closing the window during this one asks again.
    pub fn search_started(&mut self) {
        self.asked = false;
    }
}

/// What a close request of the window does: `true` lets the window close; `false` keeps it and asks the
/// page to confirm (`app://close-requested`). Without a running search it closes as always. While the
/// page has not answered, a second request closes too: the user insists (or the page cannot answer).
pub fn close_requested(closing: &mut Closing, search_running: bool) -> bool {
    if closing.confirmed || !search_running || closing.asked {
        closing.confirmed = true;
        return true;
    }
    closing.asked = true;
    false
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartResult {
    search_id: String,
}

/// The app's resource folder: Tauri's; on macOS, where Tauri refuses to name one when the app's path has
/// a symbolic link in it (tauri-utils' StartingBinary, against relaunch tricks), the Resources folder of
/// the bundle the executable really is in (`tool::bundle_resources`). Only read from (the bundled tool,
/// the example, cRAP).
fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    match app.path().resource_dir() {
        Ok(dir) => Some(dir),
        Err(_) if cfg!(target_os = "macos") => std::env::current_exe()
            .ok()
            .and_then(|exe| tool::bundle_resources(&exe)),
        Err(_) => None,
    }
}

/// Sends the shim's events to the front end.
fn event_sink(app: AppHandle) -> Sink {
    Arc::new(move |event| {
        let _ = match event {
            SearchEvent::Progress(p) => app.emit("search://progress", p),
            SearchEvent::Done(d) => app.emit("search://done", d),
            SearchEvent::Failed(f) => app.emit("search://failed", f),
        };
    })
}

#[tauri::command]
async fn tool_info(app: AppHandle) -> Result<tool::ToolInfo, String> {
    let resources = resource_dir(&app);
    tauri::async_runtime::spawn_blocking(move || tool::probe(&tool::resolve(resources.as_deref())?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_search(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SearchRequest,
) -> Result<StartResult, String> {
    state.closing.lock().unwrap().search_started();
    let resources = resource_dir(&app);
    let tool_path = tool::resolve(resources.as_deref())?;
    let searches_dir = searches_dir(&app)?;
    let crap = tool::bundled_crap(resources.as_deref());
    let searches = state.searches.clone();
    let sink = event_sink(app);
    let search_id = tauri::async_runtime::spawn_blocking(move || {
        searches.start(&tool_path, &searches_dir, crap.as_deref(), request, sink)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(StartResult { search_id })
}

/// Returns when the process is gone and the partial folder is removed.
#[tauri::command]
async fn cancel_search(state: State<'_, AppState>, search_id: String) -> Result<(), String> {
    let searches = state.searches.clone();
    tauri::async_runtime::spawn_blocking(move || searches.cancel(&search_id))
        .await
        .map_err(|e| e.to_string())?
}

fn searches_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("searches"))
}

/// The proteomes downloaded into the app's `databases/` folder: their file names (`UP…[_reviewed].fasta`).
#[tauri::command]
fn downloaded_proteomes(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("databases");
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.starts_with("UP") && n.ends_with(".fasta"))
        .collect();
    names.sort();
    Ok(names)
}

/// Opens `url` (https only: the Help page's links) in the system's browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err(format!("{url} is not an https link."));
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| format!("The browser cannot be opened ({e})."))
}

/// The reference proteome `proteome` (a UniProt proteome id, `UP` and nine digits) as a FASTA in the app's
/// `databases/` folder, downloaded from UniProt's REST API with curl (macOS, Windows 10 and Linux have it) unless it
/// is there already; `reviewed`: Swiss-Prot entries only. Only on this request of the user (like the PRIDE and OLS
/// contacts of the SDRF features). -> the FASTA's path.
#[tauri::command]
async fn download_proteome(app: AppHandle, proteome: String, reviewed: bool) -> Result<String, String> {
    if !(proteome.len() == 11 && proteome.starts_with("UP") && proteome[2..].bytes().all(|b| b.is_ascii_digit())) {
        return Err(format!("{proteome} is not a UniProt proteome id (UP and nine digits, e.g. UP000005640)."));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("databases");
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| format!("{} cannot be made ({e}).", dir.display()))?;
        let path = dir.join(format!("{proteome}{}.fasta", if reviewed { "_reviewed" } else { "" }));
        if std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(path.to_string_lossy().into_owned());
        }
        let query = format!("%28proteome%3A{proteome}%29{}", if reviewed { "%20AND%20%28reviewed%3Atrue%29" } else { "" });
        let url = format!("https://rest.uniprot.org/uniprotkb/stream?compressed=false&format=fasta&query={query}");
        let partial = path.with_extension("fasta.partial");
        // (a stream of unknown size: `net::fetch` with size 0, HTTPS only)
        let _ = std::fs::remove_file(&partial);
        let fetched = net::fetch(&url, &partial, 0, |_| {});
        if let Err(e) = fetched.and_then(|_| if net::len(&partial) == 0 { Err("no data".to_string()) } else { Ok(()) }) {
            let _ = std::fs::remove_file(&partial);
            return Err(format!(
                "The download from UniProt failed ({e}). Check the internet connection, or download the FASTA from https://www.uniprot.org/proteomes/{proteome}."
            ));
        }
        std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A file of a search (see `files::read_search_file`), as raw bytes.
#[tauri::command]
async fn read_search_file(
    app: AppHandle,
    search_id: String,
    name: String,
    tail: Option<u64>,
    offset: Option<u64>,
    length: Option<u64>,
) -> Result<Response, files::ReadError> {
    let range = files::ByteRange::of(tail, offset, length)?;
    let dir = searches_dir(&app).map_err(|message| files::ReadError {
        not_found: false,
        message,
    })?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        files::read_search_file(&dir, &search_id, &name, range)
    })
    .await
    .map_err(|e| files::ReadError {
        not_found: false,
        message: e.to_string(),
    })??;
    Ok(Response::new(bytes))
}

/// What New search shows of the files it was given (sizes, counts and what ProSE cannot search; never
/// contents).
#[tauri::command]
async fn inspect_files(paths: Vec<String>) -> Result<Vec<files::FileFacts>, String> {
    tauri::async_runtime::spawn_blocking(move || files::inspect_all(&paths))
        .await
        .map_err(|e| e.to_string())
}

/// What the first MS2 spectra of each mzML say (`spectra`, guidance G1), off the add-files path: New search asks
/// once the rows are there. None for a file that is no mzML (or cannot be read).
#[tauri::command]
async fn inspect_spectra(paths: Vec<String>) -> Result<Vec<Option<spectra::SpectraFacts>>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| spectra::inspect_cached(p)).collect())
        .await
        .map_err(|e| e.to_string())
}

/// The cores ProSE's threads may use: the threads' default ("all"). The webview's own count is capped
/// (WebKit reports at most 8).
#[tauri::command]
fn cpu_count() -> usize {
    std::thread::available_parallelism().map_or(1, |n| n.get())
}

#[tauri::command]
async fn example_files(app: AppHandle) -> Result<files::ExampleFiles, String> {
    let source = files::bundled_example(resource_dir(&app).as_deref())
        .ok_or("The example is not part of this installation.")?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || files::example_files(&source, &data))
        .await
        .map_err(|e| e.to_string())?
}

/// The file that the end-to-end specs choose in place of the system's dialogs (`PROSE_TEST_DIALOG_PATH`):
/// WebDriver cannot reach a dialog of the system. Debug builds only; a release build has no such way
/// (this is `None` there), and the page never names a path in either.
#[cfg(debug_assertions)]
fn test_dialog_path() -> Option<PathBuf> {
    std::env::var_os("PROSE_TEST_DIALOG_PATH")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
}

#[cfg(not(debug_assertions))]
fn test_dialog_path() -> Option<PathBuf> {
    None
}

/// The system's save dialog for `name`; None if the user cancelled.
fn ask_save_path(app: &AppHandle, name: &str) -> Result<Option<PathBuf>, String> {
    ask_save_path_titled(app, name, None)
}

/// The same, with the dialog's title.
fn ask_save_path_titled(
    app: &AppHandle,
    name: &str,
    title: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if let Some(path) = test_dialog_path() {
        return Ok(Some(path));
    }
    let extension = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned());
    let mut dialog = app.dialog().file().set_file_name(name);
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(ext) = extension.as_deref() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    match dialog.blocking_save_file() {
        None => Ok(None),
        Some(path) => path.into_path().map(Some).map_err(|e| e.to_string()),
    }
}

/// An export (CSV, design, spectrum): the user chooses where, in the system's dialog; the app writes
/// nothing anywhere else.
#[tauri::command]
async fn save_text(
    app: AppHandle,
    name: String,
    contents: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = ask_save_path(&app, &name)? else {
            return Ok(None);
        };
        std::fs::write(&path, contents)
            .map_err(|e| format!("{} cannot be written ({e}).", path.display()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A binary export (.xlsx): the raw body of the call, the suggested name in the `x-file-name` header
/// (URI-encoded); the user chooses where, in the system's dialog.
#[tauri::command]
async fn save_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("The file's contents are missing.".to_string());
    };
    let body = body.clone();
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode(v))
        .unwrap_or_else(|| "export.xlsx".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = ask_save_path(&app, &name)? else {
            return Ok(None);
        };
        std::fs::write(&path, body).map_err(|e| format!("{} cannot be written ({e}).", path.display()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `%XX` escapes of a URI component decoded (the file name of `save_bytes`).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A file of a search (e.g. the merged idXML) copied to where the user chooses.
#[tauri::command]
async fn save_search_file(
    app: AppHandle,
    search_id: String,
    name: String,
    suggested: String,
) -> Result<Option<String>, String> {
    let dir = searches_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = files::resolve_search_file(&dir, &search_id, &name).map_err(|e| e.message)?;
        let Some(path) = ask_save_path(&app, &suggested)? else {
            return Ok(None);
        };
        std::fs::copy(&source, &path)
            .map_err(|e| format!("{} cannot be written ({e}).", path.display()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The searches folder and the blocking work on it, off the async runtime's threads.
async fn on_searches<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(PathBuf) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let dir = searches_dir(app)?;
    tauri::async_runtime::spawn_blocking(move || work(dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn history_list(app: AppHandle) -> Result<Vec<history::HistoryEntry>, String> {
    on_searches(&app, |dir| Ok(history::list(&dir))).await
}

#[tauri::command]
async fn history_save_record(
    app: AppHandle,
    search_id: String,
    record: String,
) -> Result<(), String> {
    on_searches(&app, move |dir| {
        history::save_record(&dir, &search_id, &record)
    })
    .await
}

#[tauri::command]
async fn history_save_proteins(
    app: AppHandle,
    search_id: String,
    proteins: String,
) -> Result<(), String> {
    on_searches(&app, move |dir| {
        history::save_proteins(&dir, &search_id, &proteins)
    })
    .await
}

#[tauri::command]
async fn history_rename(app: AppHandle, search_id: String, name: String) -> Result<(), String> {
    on_searches(&app, move |dir| history::rename(&dir, &search_id, &name)).await
}

#[tauri::command]
async fn history_delete(app: AppHandle, search_id: String) -> Result<(), String> {
    on_searches(&app, move |dir| history::delete(&dir, &search_id)).await
}

#[tauri::command]
async fn history_files(
    app: AppHandle,
    search_id: String,
) -> Result<Vec<history::FolderFile>, String> {
    on_searches(&app, move |dir| history::folder_files(&dir, &search_id)).await
}

/// The entries of a project file (see `history::frame`; the raw body of the call) as a new search.
#[tauri::command]
async fn history_import(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("The project's entries are missing.".to_string());
    };
    let body = body.clone();
    on_searches(&app, move |dir| history::import(&dir, &body)).await
}

/// A project file: the open dialog (in Rust: the page never names a path) and the bytes of the file the
/// user chose, as raw bytes. Cancelled: an empty body (a project file is never empty; it is refused). The
/// dialog offers `.prose` files first and any file second (the page checks what the file holds).
#[tauri::command]
async fn open_project_file(app: AppHandle) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = test_dialog_path() {
            return history::read_chosen_project(&path);
        }
        let chosen = app
            .dialog()
            .file()
            .add_filter("ProSE project", &["prose"])
            .add_filter("All files", &["*"])
            .set_title("Open a project file")
            .blocking_pick_file();
        match chosen {
            None => Ok(Vec::new()),
            Some(path) => {
                let path = path.into_path().map_err(|e| e.to_string())?;
                history::read_chosen_project(&path)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map(Response::new)
}

/// An SDRF or design.tsv: the open dialog, then `{ path, text }` of the file chosen, or null if cancelled.
#[tauri::command]
async fn open_design_file(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = match test_dialog_path() {
            Some(path) => Some(path),
            None => match app
                .dialog()
                .file()
                .set_title("Load a design (SDRF or design.tsv)")
                .add_filter("SDRF, design.tsv", &["tsv", "txt", "sdrf"])
                .blocking_pick_file()
            {
                None => None,
                Some(p) => Some(p.into_path().map_err(|e| e.to_string())?),
            },
        };
        let Some(path) = chosen else { return Ok(None) };
        let text = std::fs::read_to_string(&path).map_err(|e| format!("{} cannot be read ({e}).", path.display()))?;
        Ok(Some(serde_json::json!({ "path": path, "text": text })))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The text of a design file the user gave by path (Add files, or dropped): an SDRF or design.tsv only (`.tsv`,
/// `.txt`, `.sdrf`), at most 50 MB, as `open_design_file` reads the one it asks for.
#[tauri::command]
async fn read_design_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !p.is_absolute() || ![".tsv", ".txt", ".sdrf"].iter().any(|s| name.ends_with(s)) {
            return Err(format!("{path} is not an SDRF or design.tsv file."));
        }
        let meta = std::fs::metadata(p).map_err(|e| format!("{path} cannot be read ({e})."))?;
        if !meta.is_file() || meta.len() > 50 * 1024 * 1024 {
            return Err(format!("{path} is not a design file of at most 50 MB."));
        }
        std::fs::read_to_string(p).map_err(|e| format!("{path} cannot be read ({e})."))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The data files an SDRF names (`locate`): beside the SDRF at `sdrf`, then below `folder` if given.
#[tauri::command]
async fn locate_data_files(sdrf: String, names: Vec<String>, folder: Option<String>) -> Result<Vec<locate::Located>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = Path::new(&sdrf).parent().unwrap_or(Path::new("")).to_path_buf();
        locate::locate(&base, &names, folder.as_deref().map(Path::new))
    })
    .await
    .map_err(|e| e.to_string())
}

/// Ontology terms for the SDRF editor (`sdrf_tools::ols_search`), cached in the app's data folder.
#[tauri::command]
async fn ols_search(app: AppHandle, query: String, ontologies: Vec<String>, online: bool) -> Result<Vec<sdrf_tools::Term>, String> {
    let cache = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ols-cache");
    tauri::async_runtime::spawn_blocking(move || sdrf_tools::ols_search(&cache, &query, &ontologies, online))
        .await
        .map_err(|e| e.to_string())?
}

/// The SDRF `text` checked by sdrf-pipelines' `parse_sdrf validate-sdrf` (`available` false without it).
#[tauri::command]
async fn validate_sdrf(app: AppHandle, text: String, template: Option<String>) -> Result<sdrf_tools::Validation, String> {
    let tmp = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || sdrf_tools::validate(&tmp, &text, template.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// The files of a ProteomeXchange project in PRIDE (`pride::project_files`).
#[tauri::command]
async fn pride_files(pxd: String) -> Result<Vec<pride::RemoteFile>, String> {
    tauri::async_runtime::spawn_blocking(move || pride::project_files(&pxd))
        .await
        .map_err(|e| e.to_string())?
}

/// The system's folder dialog for downloads; the folder is kept here (`pride::FOLDER`) for
/// `download_data_files`. -> the folder, or null if cancelled.
#[tauri::command]
async fn choose_download_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = match test_dialog_path() {
            Some(path) => Some(path),
            None => match app.dialog().file().set_title(title).blocking_pick_folder() {
                None => None,
                Some(p) => Some(p.into_path().map_err(|e| e.to_string())?),
            },
        };
        *pride::FOLDER.lock().map_err(|e| e.to_string())? = chosen.clone();
        Ok(chosen.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Downloads `files` into the folder of `choose_download_folder` (`pride::download`); events
/// `download://progress`. -> the paths.
#[tauri::command]
async fn download_data_files(app: AppHandle, files: Vec<pride::RemoteFile>) -> Result<Vec<String>, String> {
    let folder = pride::chosen_folder()?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths = pride::download(&folder, &files, |p| {
            let _ = app.emit("download://progress", p);
        })?;
        Ok(paths.iter().map(|p| p.to_string_lossy().into_owned()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_download() {
    pride::CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// A QPX results folder (ProSE run by hand or on a cluster): the folder dialog, then its runs' stems
/// (`history::qpx_stems`) -> `{ folder, stems }`, or null if cancelled.
#[tauri::command]
async fn open_qpx_folder(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = match test_dialog_path() {
            Some(path) => Some(path),
            None => match app.dialog().file().set_title("Open a QPX results folder").blocking_pick_folder() {
                None => None,
                Some(p) => Some(p.into_path().map_err(|e| e.to_string())?),
            },
        };
        let Some(folder) = chosen else { return Ok(None) };
        let stems = history::qpx_stems(&folder)?;
        // (the run and provenance views, small, for the record: PSMs, cutoffs, database)
        let qpx = history::qpx_dir(&folder).ok_or("The folder has no QPX results.")?;
        let read = |name: &str| std::fs::read(qpx.join(name)).map_err(|e| format!("{name}: {e}"));
        Ok(Some(serde_json::json!({
            "folder": folder,
            "stems": stems,
            "run": read("quantms.run.parquet")?,
            "provenance": read("quantms.provenance.parquet")?,
        })))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The QPX folder `folder` (from `open_qpx_folder`) as a new search, with the page's `record` and `inputs`
/// (search.json and inputs.json) -> the new id.
#[tauri::command]
async fn history_import_qpx(app: AppHandle, folder: String, record: String, inputs: String) -> Result<String, String> {
    on_searches(&app, move |dir| history::import_qpx(&dir, Path::new(&folder), &record, &inputs)).await
}

/// The title of the save dialog of a project file: what it holds, beyond the results.
pub const PROJECT_DIALOG_TITLE: &str =
    "Save the project: the search's results, including folder paths of this computer";

/// How far the writing of a project file is (`project://progress`): the bytes of the search's files read.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectProgress {
    search_id: String,
    written: u64,
    total: u64,
}

/// A project file of search `search_id`: what it would hold is checked first, then the system's save
/// dialog (suggesting `name`, a file name), then the zip written there entry by entry (`project`), with
/// `project://progress` as it goes (at most once per percent). -> the path, or null if cancelled.
#[tauri::command]
async fn save_project_file(
    app: AppHandle,
    search_id: String,
    name: String,
) -> Result<Option<String>, String> {
    // (only a file name is suggested)
    let name = Path::new(&name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "prose.prose".to_string());
    let dir = searches_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        project::project_files(&dir, &search_id)?;
        // (the path as chosen: the dialog's filter and the suggested name carry the extension; the title says
        // what a project holds, as README.md does)
        let Some(path) = ask_save_path_titled(&app, &name, Some(PROJECT_DIALOG_TITLE))? else {
            return Ok(None);
        };
        let mut shown = None;
        let mut progress = |written: u64, total: u64| {
            let percent = written.saturating_mul(100) / total.max(1);
            if shown != Some(percent) {
                shown = Some(percent);
                let search_id = search_id.clone();
                let _ = app.emit(
                    "project://progress",
                    ProjectProgress {
                        search_id,
                        written,
                        total,
                    },
                );
            }
        };
        project::write_project(
            &dir,
            &search_id,
            &path,
            std::time::SystemTime::now(),
            &mut progress,
        )?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The page's answer to `app://close-requested`: close (the running search ends, as with any close), or
/// keep the window.
#[tauri::command]
fn answer_close(
    window: tauri::Window,
    state: State<'_, AppState>,
    close: bool,
) -> Result<(), String> {
    {
        let mut closing = state.closing.lock().unwrap();
        closing.asked = false;
        closing.confirmed = close;
    }
    if close {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The flag of the packaged app's start test (CI: `native/scripts/start-test.sh`). The app starts as
/// usual; once its page has loaded it prints one line of JSON, `{"page": <url>, "resources": <the
/// resource folder the app uses>, "tauriResources": <Tauri's, or why there is none>, "tool":
/// <tool_info>}` (or `"error"` in place of `"tool"`), and exits: 0, or 1 when the tool cannot be used. A page that has not loaded after [`SMOKE_TIMEOUT`]
/// ends the app with 2. It reads nothing and writes nothing else.
pub const SMOKE_TEST: &str = "--smoke-test";
const SMOKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// What `--smoke-test` reports, and the exit code.
fn smoke_report(app: &AppHandle, page: &str) -> (i32, String) {
    let tool = tool::resolve(resource_dir(app).as_deref()).and_then(|path| tool::probe(&path));
    let (code, key, value) = match tool {
        Ok(info) => (0, "tool", serde_json::to_value(info).unwrap_or_default()),
        Err(e) => (1, "error", serde_json::Value::String(e)),
    };
    let resources = resource_dir(app).map(|dir| dir.to_string_lossy().into_owned());
    let tauri_resources = match app.path().resource_dir() {
        Ok(dir) => dir.to_string_lossy().into_owned(),
        Err(e) => format!("(none: {e})"),
    };
    let line = serde_json::json!({
        "page": page,
        "resources": resources,
        "tauriResources": tauri_resources,
        key: value,
    })
    .to_string();
    (code, line)
}

pub fn run() {
    // the watchdog of a search (macOS: the app starts its own executable for it), before anything of Tauri
    #[cfg(unix)]
    if let Some(code) = watchdog::from_args(&std::env::args_os().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    let smoke = std::env::args_os().any(|a| a == SMOKE_TEST);
    let reported = std::sync::atomic::AtomicBool::new(false);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        // closing the window during a search: the page asks first (CloseGuard.svelte, `answer_close`)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let running = state.searches.any_running();
                let close = close_requested(&mut state.closing.lock().unwrap(), running);
                if !close {
                    api.prevent_close();
                    let _ = window.emit("app://close-requested", ());
                }
            }
        })
        .on_page_load(move |webview, payload| {
            use std::sync::atomic::Ordering;
            if !smoke
                || payload.event() != PageLoadEvent::Finished
                || reported.swap(true, Ordering::SeqCst)
            {
                return;
            }
            let app = webview.app_handle().clone();
            let page = payload.url().to_string();
            std::thread::spawn(move || {
                use std::io::Write;
                let (code, line) = smoke_report(&app, &page);
                println!("{line}");
                let _ = std::io::stdout().flush();
                app.exit(code);
            });
        })
        .setup(move |app| {
            if smoke {
                std::thread::spawn(|| {
                    std::thread::sleep(SMOKE_TIMEOUT);
                    eprintln!("smoke test: the page did not load within {SMOKE_TIMEOUT:?}");
                    std::process::exit(2);
                });
            }
            // what interrupted searches left (no search runs yet); a failure to sweep is no failure to start
            if let Ok(dir) = searches_dir(app.handle()) {
                std::thread::spawn(move || {
                    history::sweep(&dir, std::time::SystemTime::now(), history::SWEEP_GRACE);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tool_info,
            start_search,
            cancel_search,
            read_search_file,
            inspect_files,
            inspect_spectra,
            cpu_count,
            example_files,
            save_text,
            download_proteome,
            downloaded_proteomes,
            open_url,
            save_bytes,
            save_search_file,
            history_list,
            history_save_record,
            history_save_proteins,
            history_rename,
            history_delete,
            history_files,
            history_import,
            open_project_file,
            open_qpx_folder,
            open_design_file,
            read_design_file,
            locate_data_files,
            ols_search,
            validate_sdrf,
            pride_files,
            choose_download_folder,
            download_data_files,
            cancel_download,
            history_import_qpx,
            save_project_file,
            answer_close
        ])
        .build(tauri::generate_context!())
        .expect("error while building the ProSE desktop app");
    app.run(|handle, event| {
        // no ProSE outlives the app
        if let RunEvent::Exit = event {
            handle.state::<AppState>().searches.cancel_all();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{close_requested, Closing};

    #[test]
    fn closing_the_window_asks_first_while_a_search_runs() {
        // no search: closes
        let mut closing = Closing::default();
        assert!(close_requested(&mut closing, false));
        // a search runs: kept, the page asked
        let mut closing = Closing::default();
        assert!(!close_requested(&mut closing, true));
        assert!(closing.asked && !closing.confirmed);
        // asked again before an answer: closes (the user insists, or the page cannot answer)
        assert!(close_requested(&mut closing, true));
        // the page said "keep searching": the next request asks again
        let mut closing = Closing::default();
        assert!(!close_requested(&mut closing, true));
        closing = Closing {
            asked: false,
            confirmed: false,
        };
        assert!(!close_requested(&mut closing, true));
        // confirmed: closes, also while the search still runs
        let mut closing = Closing {
            asked: false,
            confirmed: true,
        };
        assert!(close_requested(&mut closing, true));
    }

    #[test]
    fn a_question_left_open_does_not_outlive_its_search() {
        // asked, never answered (the search ended as the dialog was open, and the page could not answer)
        let mut closing = Closing::default();
        assert!(!close_requested(&mut closing, true));
        assert!(closing.asked);
        // no search runs: the window just closes
        assert!(close_requested(&mut closing.clone(), false));
        // the next search asks again (and does not close at the first request)
        closing.search_started();
        assert!(!close_requested(&mut closing, true));
        assert!(closing.asked && !closing.confirmed);
    }
}
