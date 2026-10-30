//! The application menus: on macOS the menu bar with the app menu (About, Hide, Quit), on Windows and Linux the
//! same menus as the window's menu bar (About under Help, Exit under File). Most items are the page's: a click
//! emits `menu://action` with the item's id (below), which the page handles as its own buttons (`src/lib/menu.ts`);
//! the page tells which items apply (`menu_state`: Save only with a project, Export only with an open result, the
//! theme's check marks). Edit's items are the system's own (predefined), so that the text fields have Undo, Cut,
//! Copy and Paste with the usual keys. Close window and Exit close the window as its close button does (a running
//! search asks first: `close_requested`); full screen is the system's (macOS) or the window's (F11).
//!
//! The page's ids: `new-search`, `open-project`, `save-project`, `save-project-as`, `open-qpx`, `import-results`,
//! `export-csv`, `export-xlsx`, `export-idxml`, `export-archive`, `view-search`, `view-results`, `view-history`,
//! `view-help`, `theme-system`, `theme-light`, `theme-dark`, `help`, `help-troubleshooting`, `help-shortcuts`,
//! `help-webapp`, `help-issue`, and `recent:<n>` (the n-th recent project, `setup_file::recent`).

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event of a page's item.
pub const MENU_EVENT: &str = "menu://action";
/// The prefix of the recent projects' ids.
pub const RECENT_PREFIX: &str = "recent:";
const CLEAR_RECENT: &str = "recent-clear";
const CLOSE_WINDOW: &str = "close-window";
const FULLSCREEN: &str = "fullscreen";

/// What the page says applies (`menu_state`).
#[derive(Debug, Default, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    /// A result is open in Results (Export).
    pub result: bool,
    /// The tab shows a table (CSV and Excel).
    pub table: bool,
    /// The theme chosen: "system", "light" or "dark".
    pub theme: String,
}

/// The items whose state changes, kept to change it.
pub struct MenuHandles<R: Runtime> {
    export: Submenu<R>,
    table_items: Vec<MenuItem<R>>,
    themes: Vec<(String, CheckMenuItem<R>)>,
    recent: Submenu<R>,
    /// The paths behind `recent:<n>`, as the submenu lists them.
    pub recent_paths: Mutex<Vec<PathBuf>>,
}

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, text: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accelerator)
}

/// The menus of the app, and the handles of what changes in them.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, MenuHandles<R>)> {
    let mac = cfg!(target_os = "macos");
    let about = PredefinedMenuItem::about(
        app,
        Some("About ProSE"),
        Some(AboutMetadata {
            name: Some("ProSE".into()),
            version: Some(app.package_info().version.to_string()),
            comments: Some("The OpenMS search engine for bottom-up proteomics".into()),
            website: Some("https://github.com/timosachsenberg/prose-gui".into()),
            license: Some("BSD-3-Clause".into()),
            ..Default::default()
        }),
    )?;

    // File
    let recent = SubmenuBuilder::with_id(app, "recent", "Open Recent").build()?;
    let csv = item(app, "export-csv", "CSV (current view)…", None)?;
    let xlsx = item(app, "export-xlsx", "Excel .xlsx (current view)…", None)?;
    let export = SubmenuBuilder::with_id(app, "export", "Export")
        .item(&csv)
        .item(&xlsx)
        .item(&item(app, "export-idxml", "idXML…", None)?)
        .separator()
        .item(&item(app, "export-archive", "Results archive (.prose)…", None)?)
        .enabled(false)
        .build()?;
    let mut file = SubmenuBuilder::new(app, "File")
        .item(&item(app, "new-search", "New Search", Some("CmdOrCtrl+N"))?)
        .separator()
        .item(&item(app, "open-project", "Open Project…", Some("CmdOrCtrl+O"))?)
        .item(&recent)
        .item(&item(app, "save-project", "Save Project", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "save-project-as", "Save Project As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item(app, "open-qpx", "Open QPX Folder…", None)?)
        .item(&item(app, "import-results", "Import Results Archive (.prose)…", None)?)
        .item(&export)
        .separator()
        .item(&item(app, CLOSE_WINDOW, "Close Window", Some("CmdOrCtrl+W"))?);
    if !mac {
        file = file.separator().item(&item(app, "exit", "Exit", None)?);
    }
    let file = file.build()?;

    // Edit: the system's own items
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // View
    let themes: Vec<(String, CheckMenuItem<R>)> = [("system", "System"), ("light", "Light"), ("dark", "Dark")]
        .into_iter()
        .map(|(id, text)| {
            CheckMenuItem::with_id(app, format!("theme-{id}"), text, true, id == "system", None::<&str>)
                .map(|c| (id.to_string(), c))
        })
        .collect::<tauri::Result<_>>()?;
    let mut theme = SubmenuBuilder::new(app, "Theme");
    for (_, c) in &themes {
        theme = theme.item(c);
    }
    let mut view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "view-search", "New Search", Some("CmdOrCtrl+Shift+1"))?)
        .item(&item(app, "view-results", "Results", Some("CmdOrCtrl+Shift+2"))?)
        .item(&item(app, "view-history", "History", Some("CmdOrCtrl+Shift+3"))?)
        .item(&item(app, "view-help", "Help", Some("CmdOrCtrl+Shift+4"))?)
        .separator()
        .item(&theme.build()?)
        .separator();
    view = if mac { view.fullscreen() } else { view.item(&item(app, FULLSCREEN, "Toggle Full Screen", Some("F11"))?) };
    let view = view.build()?;

    // Window
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize();
    let window = if mac { window.separator().bring_all_to_front() } else { window }.build()?;

    // Help
    let mut help = SubmenuBuilder::new(app, "Help")
        .item(&item(app, "help", "ProSE Help", None)?)
        .item(&item(app, "help-troubleshooting", "Troubleshooting", None)?)
        .item(&item(app, "help-shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/"))?)
        .separator()
        .item(&item(app, "help-webapp", "ProSE Web App", None)?)
        .item(&item(app, "help-issue", "Report an Issue…", None)?);
    if !mac {
        help = help.separator().item(&about);
    }
    let help = help.build()?;

    let menu = Menu::new(app)?;
    if mac {
        let app_menu = SubmenuBuilder::new(app, "ProSE")
            .item(&about)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu.append(&app_menu)?;
    }
    for sub in [&file, &edit, &view, &window, &help] {
        menu.append(sub)?;
    }
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }
    let handles = MenuHandles {
        export,
        table_items: vec![csv, xlsx],
        themes,
        recent,
        recent_paths: Mutex::new(Vec::new()),
    };
    Ok((menu, handles))
}

impl<R: Runtime> MenuHandles<R> {
    /// Applies what the page says (`menu_state`).
    pub fn apply(&self, state: &MenuState) -> tauri::Result<()> {
        self.export.set_enabled(state.result)?;
        for i in &self.table_items {
            i.set_enabled(state.table)?;
        }
        for (id, c) in &self.themes {
            c.set_checked(*id == state.theme)?;
        }
        Ok(())
    }

    /// Lists `paths` under Open Recent (the file's name, its folder after it), with Clear Menu.
    pub fn set_recent(&self, app: &AppHandle<R>, paths: Vec<PathBuf>) -> tauri::Result<()> {
        for old in self.recent.items()? {
            self.recent.remove(&old)?;
        }
        for (n, path) in paths.iter().enumerate() {
            let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let folder = path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            self.recent
                .append(&item(app, &format!("{RECENT_PREFIX}{n}"), &format!("{name} — {folder}"), None)?)?;
        }
        if paths.is_empty() {
            self.recent.append(&MenuItem::with_id(app, "recent-none", "No Recent Projects", false, None::<&str>)?)?;
        } else {
            self.recent.append(&PredefinedMenuItem::separator(app)?)?;
            self.recent.append(&item(app, CLEAR_RECENT, "Clear Menu", None)?)?;
        }
        *self.recent_paths.lock().unwrap() = paths;
        Ok(())
    }
}

/// A click on an item: the window's own ones here, the page's sent to it.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent, data_dir: Option<PathBuf>) {
    let id = event.id().as_ref();
    let window = app.get_webview_window("main").or_else(|| app.webview_windows().into_values().next());
    match id {
        CLOSE_WINDOW | "exit" => {
            if let Some(w) = window {
                let _ = w.close();
            }
        }
        FULLSCREEN => {
            if let Some(w) = window {
                let on = w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(!on);
            }
        }
        CLEAR_RECENT => {
            if let Some(dir) = data_dir {
                crate::setup_file::forget_all(&dir);
            }
            if let Some(handles) = app.try_state::<MenuHandles<R>>() {
                let _ = handles.set_recent(app, Vec::new());
            }
        }
        _ => {
            let _ = app.emit(MENU_EVENT, id.to_string());
        }
    }
}
