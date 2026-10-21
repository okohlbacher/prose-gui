//! ProSE desktop: the Tauri shell around the ProSE tool of OpenMS.
//!
//! The shim (`tool`, `args`, `progress`, `run`) runs the tool for a search request and reports its
//! progress; the commands and events below are what the front end sees:
//!
//! - `tool_info` -> `{ version, path, onnx }`
//! - `start_search(request)` -> `{ searchId }`; `cancel_search(searchId)`
//! - events `search://progress` `{ searchId, label, file, fraction }`, `search://done`
//!   `{ searchId, folder }` and `search://failed` `{ searchId, message, stage, file?, ended?, detail?, log? }`
//! - `read_search_file(searchId, name)` -> the bytes of a file of the search's folder, or of the
//!   database its summary records (`files`; rejects `{ notFound, message }`)
//! - `inspect_files(paths)` -> `[{ path, name, size, spectra?, proteins?, residues?, error? }]`
//! - `example_files()` -> `{ spectra: [path, path], database }`
//! - `save_text(name, contents)` and `save_search_file(searchId, name, suggested)`: a save dialog of
//!   the system, then the file written where the user chose (-> the path, or null if cancelled)
//! - History (`history`): `history_list()` -> entries (a folder with a broken record, or none, has
//!   `error`), `history_save_record(searchId, record)` (a finished search gets its `search.json`, right
//!   after `search://done`), `history_save_proteins(searchId, proteins)` (its `proteins.fasta`, once the
//!   results are read; the folder's `database.fasta` goes), `history_rename(searchId, name)`,
//!   `history_delete(searchId)`, `history_files(searchId)` (the regular files of the folder, for a project
//!   file), `save_project_file(body, header name)` (a save dialog, then the zip written where the user
//!   chose), `open_project_file()` (the open dialog, then the bytes of the file chosen; empty if
//!   cancelled) and `history_import(body)` (the entries of a project in a fresh folder -> the new id). At
//!   startup the partial folders of interrupted searches are swept (`history::sweep`).
//!
//! `--smoke-test` on the command line is the packaged app's start test ([`SMOKE_TEST`]).

pub mod args;
pub mod files;
pub mod history;
pub mod progress;
pub mod run;
pub mod tool;

use args::SearchRequest;
use run::{SearchEvent, Searches, Sink};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Response;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct AppState {
    searches: Arc<Searches>,
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

/// A file of a search (see `files::read_search_file`), as raw bytes.
#[tauri::command]
async fn read_search_file(
    app: AppHandle,
    search_id: String,
    name: String,
) -> Result<Response, files::ReadError> {
    let dir = searches_dir(&app).map_err(|message| files::ReadError {
        not_found: false,
        message,
    })?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        files::read_search_file(&dir, &search_id, &name)
    })
    .await
    .map_err(|e| files::ReadError {
        not_found: false,
        message: e.to_string(),
    })??;
    Ok(Response::new(bytes))
}

/// What New search shows of the files it was given (sizes and counts; never contents).
#[tauri::command]
async fn inspect_files(paths: Vec<String>) -> Result<Vec<files::FileFacts>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| files::inspect(p)).collect())
        .await
        .map_err(|e| e.to_string())
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
    if let Some(path) = test_dialog_path() {
        return Ok(Some(path));
    }
    let extension = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().into_owned());
    let mut dialog = app.dialog().file().set_file_name(name);
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

/// `text` with `%XX` escapes decoded (a header carries the name of the project, escaped by the page).
fn unescape(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A project file: the zip (the raw body; the suggested name in the header `name`) written where
/// the user chooses in the system's save dialog, as `.prose`. -> the path, or null if cancelled.
#[tauri::command]
async fn save_project_file(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("The project's bytes are missing.".to_string());
    };
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .and_then(unescape)
        .unwrap_or_else(|| "prose.prose".to_string());
    // (only a file name is suggested)
    let name = Path::new(&name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "prose.prose".to_string());
    let body = body.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // (the path as chosen: the dialog's filter and the suggested name carry the extension)
        let Some(path) = ask_save_path(&app, &name)? else {
            return Ok(None);
        };
        std::fs::write(&path, body)
            .map_err(|e| format!("{} cannot be written ({e}).", path.display()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
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
    let smoke = std::env::args_os().any(|a| a == SMOKE_TEST);
    let reported = std::sync::atomic::AtomicBool::new(false);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
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
            example_files,
            save_text,
            save_search_file,
            history_list,
            history_save_record,
            history_save_proteins,
            history_rename,
            history_delete,
            history_files,
            history_import,
            open_project_file,
            save_project_file
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
    use super::unescape;

    #[test]
    fn unescape_decodes_the_pages_encodeuricomponent() {
        assert_eq!(unescape("a%20b.prose").as_deref(), Some("a b.prose"));
        assert_eq!(unescape("na%C3%AFve").as_deref(), Some("naïve"));
        assert_eq!(unescape("plain").as_deref(), Some("plain"));
        assert_eq!(unescape("bad%2"), None);
        assert_eq!(unescape("bad%zz"), None);
        assert_eq!(unescape("%FF"), None, "not UTF-8");
    }
}
