//! ProSE desktop: the Tauri shell around the ProSE tool of OpenMS.
//!
//! The shim (`tool`, `args`, `progress`, `run`) runs the tool for a search request and reports its
//! progress; the commands and events below are what the front end sees:
//!
//! - `tool_info` -> `{ version, path, onnx }`
//! - `start_search(request)` -> `{ searchId }`; `cancel_search(searchId)`
//! - events `search://progress` `{ searchId, label, file, fraction }`, `search://done`
//!   `{ searchId, folder }` and `search://failed` `{ searchId, message, stage, file? }`
//! - `read_search_file(searchId, name)` -> the bytes of a file of the search's folder, or of the
//!   database its summary records (`files`; rejects `{ notFound, message }`)
//! - `inspect_files(paths)` -> `[{ path, name, size, spectra?, proteins?, residues?, error? }]`
//! - `example_files()` -> `{ spectra: [path, path], database }`
//! - `save_text(name, contents)` and `save_search_file(searchId, name, suggested)`: a save dialog of
//!   the system, then the file written where the user chose (-> the path, or null if cancelled)

pub mod args;
pub mod files;
pub mod progress;
pub mod run;
pub mod tool;

use args::SearchRequest;
use run::{SearchEvent, Searches, Sink};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Response;
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

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
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

/// The system's save dialog for `name`; None if the user cancelled.
fn ask_save_path(app: &AppHandle, name: &str) -> Result<Option<PathBuf>, String> {
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

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            tool_info,
            start_search,
            cancel_search,
            read_search_file,
            inspect_files,
            example_files,
            save_text,
            save_search_file
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
