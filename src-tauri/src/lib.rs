//! ProSE desktop: the Tauri shell around the ProSE tool of OpenMS.
//!
//! The shim (`tool`, `args`, `progress`, `run`) runs the tool for a search request and reports its
//! progress; the commands and events below are what the front end sees:
//!
//! - `tool_info` -> `{ version, path, onnx }`
//! - `start_search(request)` -> `{ searchId }`; `cancel_search(searchId)`
//! - events `search://progress` `{ searchId, label, file, fraction }`, `search://done`
//!   `{ searchId, folder }` and `search://failed` `{ searchId, message, stage, file? }`

pub mod args;
pub mod progress;
pub mod run;
pub mod tool;

use args::SearchRequest;
use run::{SearchEvent, Searches, Sink};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

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
    let searches_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("searches");
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

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            tool_info,
            start_search,
            cancel_search
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
