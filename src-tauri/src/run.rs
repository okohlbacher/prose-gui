//! Running a search: the search folder, the process, its progress, and cancel.
//!
//! A search lives in `<searches>/<id>.partial/` while it runs. Beside the tool's outputs it holds
//!
//! - the inputs as links `<n>__<name>` to the user's files (never copies) and `inputs.json`, the
//!   mapping from link to the user's path (see [`crate::args::InputRecord`]). On Windows, where a
//!   symbolic link needs a privilege, ProSE gets the user's paths themselves when the inputs' names
//!   differ, and hard links only for inputs that share a name, removed again when the search ends
//!   ([`crate::args::InputLinks`]);
//! - `database.fasta`, the user's FASTA with the contaminants, if they were asked for;
//! - `prose.log`, the tool's output.
//!
//! The folder holds `.lock`, locked exclusively (`history::lock_partial`) for as long as the search
//! lives, so that the startup sweep of any app instance can tell a live folder from a stale one.
//!
//! On success the folder is renamed to `<searches>/<id>/` and `done` is sent; on failure or cancel it is
//! removed (a failure sends `failed`, a cancel nothing: `cancel` returns when the process is gone).
//!
//! The tool runs in a process group of its own, started from a thread of its own that waits for it.
//! Cancel signals the group (SIGTERM, then SIGKILL after a grace period), and the group is swept with
//! SIGKILL after the tool has ended, so nothing it started outlives it. If the app dies:
//! - Linux: the tool gets SIGKILL (`PR_SET_PDEATHSIG`; the thread that starts it lives as long as it runs);
//! - Windows: the group is a job object, closed with the app, which ends whatever is still in it (cancel
//!   terminates the job: Windows has no SIGTERM for a console tool);
//! - macOS has no death signal: the tool ends at its next write to stdout or stderr, whose reading ends
//!   died with the app (SIGPIPE: the app ignores it, as every Rust program, but `Command` resets it to
//!   the default in the child, and OpenMS sets no handler). ProSE writes a line per step, so it runs on
//!   until its current step ends, at most that step's time; a later start of the app sweeps the folder.

use crate::args::{
    build_args_with, humanize, input_placements, input_records_with, with_contaminants, InputLinks,
    InputRecord, Placement, SearchRequest, DATABASE_FILE,
};
use crate::history::{finish_partial, lock_partial, remove_partial, with_backoff};
use crate::progress::{ProgressTracker, STARTING};
use crate::tool;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How long a tool gets to end after SIGTERM before it is killed.
const GRACE: Duration = Duration::from_secs(3);
/// How long cancel waits for the kill to take effect.
const KILL_WAIT: Duration = Duration::from_secs(10);
/// How many of the tool's last stderr lines are kept for a failure message.
const STDERR_TAIL: usize = 60;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub search_id: String,
    pub label: String,
    /// The input of the step (0-based); -1 outside the files.
    pub file: i32,
    pub fraction: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DoneEvent {
    pub search_id: String,
    /// The search folder, `<searches>/<id>`.
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FailedEvent {
    pub search_id: String,
    pub message: String,
    /// The last progress label.
    pub stage: String,
    /// The input of the last progress report; absent outside the files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SearchEvent {
    Progress(ProgressEvent),
    Done(DoneEvent),
    Failed(FailedEvent),
}

/// Where a search's events go (the app emits them as `search://…` events).
pub type Sink = Arc<dyn Fn(SearchEvent) + Send + Sync>;

/// A running search, as `cancel` sees it.
struct Handle {
    /// The tool's process group (see `sys::Group`); set before `start` returns, taken when the search
    /// is over.
    group: Mutex<Option<Arc<sys::Group>>>,
    cancelled: AtomicBool,
    /// Set when the search is over and its folder dealt with.
    finished: Mutex<bool>,
    changed: Condvar,
}

impl Handle {
    fn group(&self) -> Option<Arc<sys::Group>> {
        self.group.lock().unwrap().clone()
    }

    fn finish(&self) {
        *self.finished.lock().unwrap() = true;
        self.changed.notify_all();
    }

    fn wait_finished(&self, timeout: Duration) -> bool {
        let guard = self.finished.lock().unwrap();
        let (guard, _) = self
            .changed
            .wait_timeout_while(guard, timeout, |done| !*done)
            .unwrap();
        *guard
    }
}

/// The searches running in this app.
pub struct Searches {
    running: Mutex<HashMap<String, Arc<Handle>>>,
    counter: AtomicU64,
    /// How the inputs reach the tool: this platform's way, unless a test chooses.
    links: InputLinks,
}

impl Default for Searches {
    fn default() -> Searches {
        Searches::with_links(InputLinks::PLATFORM)
    }
}

#[cfg(unix)]
mod sys {
    use std::os::raw::c_int;

    extern "C" {
        fn kill(pid: c_int, sig: c_int) -> c_int;
        #[cfg(target_os = "linux")]
        fn prctl(option: c_int, ...) -> c_int;
    }

    const SIGKILL: c_int = 9;
    const SIGTERM: c_int = 15;

    /// The tool's process group: the tool is started as the leader of one (`prepare`).
    pub struct Group {
        pid: u32,
    }

    impl Group {
        pub fn new(child: &std::process::Child) -> Group {
            Group { pid: child.id() }
        }

        pub fn pid(&self) -> u32 {
            self.pid
        }

        /// Signals every process of the group.
        fn signal(&self, signal: c_int) {
            if self.pid > 0 && self.pid <= i32::MAX as u32 {
                // SAFETY: kill(2) with a negative pid signals a process group; it has no memory effects.
                unsafe { kill(-(self.pid as c_int), signal) };
            }
        }

        /// Asks the group to end (SIGTERM).
        pub fn terminate(&self) {
            self.signal(SIGTERM);
        }

        /// Ends the group (SIGKILL).
        pub fn kill(&self) {
            self.signal(SIGKILL);
        }
    }

    pub fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
        std::os::unix::process::ExitStatusExt::signal(status)
    }

    /// Own process group; on Linux killed with the app.
    pub fn prepare(command: &mut std::process::Command) {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        #[cfg(target_os = "linux")]
        // SAFETY: only prctl(2) runs between fork and exec, which is async-signal-safe.
        unsafe {
            command.pre_exec(|| {
                const PR_SET_PDEATHSIG: c_int = 1;
                prctl(PR_SET_PDEATHSIG, SIGKILL as std::os::raw::c_ulong);
                Ok(())
            });
        }
    }

    pub fn link_input(original: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(original, link)
    }
}

#[cfg(windows)]
mod sys {
    //! The tool's processes as a job object: every process the tool starts joins the job, which
    //! `TerminateJobObject` ends at once, and which ends with the app (`KILL_ON_JOB_CLOSE`: the app's
    //! handle is the only one, and Windows closes it when the app ends, however it ends).
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::{Command, Stdio};

    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    /// JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimitInformation {
        basic: BasicLimitInformation,
        io_info: [u64; 6],
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *mut c_void, length: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, exit_code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    /// The exit code of a tool ended by cancel.
    const KILLED: u32 = 1;

    /// A job with the tool in it; without one (it could not be made) the tool's tree is ended with
    /// `taskkill /T /F`.
    pub struct Group {
        pid: u32,
        job: Option<Handle>,
    }

    // SAFETY: a job handle is a kernel handle, usable from any thread; it is closed only in Drop.
    unsafe impl Send for Group {}
    unsafe impl Sync for Group {}

    /// A job that ends its processes when its last handle is closed.
    fn new_job() -> Option<Handle> {
        // SAFETY: plain Win32 calls with valid pointers; the handle is closed on failure.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info = ExtendedLimitInformation::default();
            info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&mut info as *mut ExtendedLimitInformation).cast(),
                std::mem::size_of::<ExtendedLimitInformation>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return None;
            }
            Some(job)
        }
    }

    impl Group {
        /// Puts the child into a job of its own. (The child runs from its start; a process it starts
        /// before it is assigned, within microseconds, would not be in the job. ProSE starts none.)
        pub fn new(child: &std::process::Child) -> Group {
            let job = new_job().filter(|job| {
                // SAFETY: the child's process handle is valid while `child` lives.
                let assigned =
                    unsafe { AssignProcessToJobObject(*job, child.as_raw_handle() as Handle) };
                if assigned == 0 {
                    // SAFETY: the job was made above and is not used elsewhere.
                    unsafe { CloseHandle(*job) };
                }
                assigned != 0
            });
            Group {
                pid: child.id(),
                job,
            }
        }

        pub fn pid(&self) -> u32 {
            self.pid
        }

        /// Windows has no request to end for a console tool without a console: ends the job.
        pub fn terminate(&self) {
            self.kill();
        }

        /// Ends every process of the job.
        pub fn kill(&self) {
            match self.job {
                // SAFETY: the job handle is open until Drop.
                Some(job) => unsafe {
                    TerminateJobObject(job, KILLED);
                },
                None => {
                    let _ = Command::new("taskkill")
                        .args(["/PID", &self.pid.to_string(), "/T", "/F"])
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();
                }
            }
        }
    }

    impl Drop for Group {
        fn drop(&mut self) {
            if let Some(job) = self.job.take() {
                // SAFETY: the handle was opened by `new_job` and is closed once.
                unsafe { CloseHandle(job) };
            }
        }
    }

    pub fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
        None
    }

    /// (The console window is suppressed for every run of the tool: `tool::command`.)
    pub fn prepare(_command: &mut std::process::Command) {}

    /// Only `Placement::HardLink` reaches the folder on Windows; a symbolic link needs a privilege.
    pub fn link_input(original: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(original, link)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// The job is made and its limit set (else cancel falls back to taskkill unnoticed): the
        /// structure has the size Windows expects (JOBOBJECT_EXTENDED_LIMIT_INFORMATION, x64: 144 bytes).
        #[test]
        fn a_job_object_that_ends_its_processes_is_made_and_holds_the_tool() {
            assert_eq!(std::mem::size_of::<ExtendedLimitInformation>(), 144);
            let job = new_job().expect("a job object with KILL_ON_JOB_CLOSE");
            // SAFETY: the handle was just made.
            unsafe { CloseHandle(job) };
            let mut child = Command::new("cmd")
                .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
                .stdout(Stdio::null())
                .spawn()
                .unwrap();
            let group = Group::new(&child);
            assert!(group.job.is_some(), "the child is in a job");
            group.kill();
            let status = child.wait().unwrap();
            assert_eq!(status.code(), Some(KILLED as i32), "ended by the job");
        }
    }
}

/// Lines of a stream, lossily decoded, without the line end.
fn read_lines(stream: impl Read, mut each: impl FnMut(&str)) {
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer);
                each(line.trim_end_matches(['\n', '\r']));
            }
        }
    }
}

fn is_noise(line: &str) -> bool {
    line.trim().is_empty() || line.starts_with("Schema error") || line.starts_with("Warning:")
}

/// The message of a failure: the last "Error…" line of the tool's stderr, else its last line, else
/// how the process ended.
fn failure_message(tail: &VecDeque<String>, status: &ExitStatus) -> String {
    let line = tail
        .iter()
        .rev()
        .find(|l| l.starts_with("Error"))
        .or_else(|| tail.back());
    match (line, status.code(), sys::exit_signal(status)) {
        (Some(line), _, _) => line.trim().to_string(),
        (None, _, Some(signal)) => format!("ProSE was stopped by signal {signal}."),
        (None, Some(code), _) => format!("ProSE ended with exit code {code}."),
        (None, None, None) => "ProSE ended unexpectedly.".to_string(),
    }
}

/// Everything the supervising thread needs.
struct Job {
    id: String,
    tool: PathBuf,
    args: Vec<std::ffi::OsString>,
    partial: PathBuf,
    done_dir: PathBuf,
    records: Vec<InputRecord>,
    placements: Vec<Placement>,
    sink: Sink,
    handle: Arc<Handle>,
    /// The lock of the partial folder (see `history::lock_partial`), held until the folder is renamed
    /// or removed.
    lock: Option<fs::File>,
}

impl Searches {
    /// Searches whose inputs reach the tool as `links` says (the default: this platform's way).
    pub fn with_links(links: InputLinks) -> Searches {
        Searches {
            running: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
            links,
        }
    }

    fn new_id(&self, dir: &Path) -> String {
        loop {
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let n = self.counter.fetch_add(1, Ordering::Relaxed);
            let id = format!("{millis}-{n}");
            if !dir.join(&id).exists() && !dir.join(format!("{id}.partial")).exists() {
                return id;
            }
        }
    }

    /// Checks the request, makes the search folder and starts the tool; returns the search id. The
    /// events go to `sink`. `crap` is the contaminant FASTA, needed if the request asks for them.
    pub fn start(
        self: &Arc<Self>,
        tool_path: &Path,
        searches_dir: &Path,
        crap: Option<&Path>,
        request: SearchRequest,
        sink: Sink,
    ) -> Result<String, String> {
        if request.contaminants && crap.is_none() {
            return Err(
                "The contaminant database (cRAP) is not available in this installation."
                    .to_string(),
            );
        }
        fs::create_dir_all(searches_dir).map_err(|e| {
            format!(
                "The searches folder {} cannot be made ({e}).",
                searches_dir.display()
            )
        })?;
        let id = self.new_id(searches_dir);
        let partial = searches_dir.join(format!("{id}.partial"));
        let done_dir = searches_dir.join(&id);
        // everything that can be wrong with the request is found before a folder exists
        let args = build_args_with(&request, &partial, self.links)?;

        fs::create_dir(&partial).map_err(|e| {
            format!(
                "The search folder {} cannot be made ({e}).",
                partial.display()
            )
        })?;
        let lock = match lock_partial(&partial) {
            Ok(lock) => lock,
            Err(e) => {
                let _ = remove_partial(None, &partial);
                return Err(format!("The search folder cannot be locked ({e})."));
            }
        };
        let records = input_records_with(&request, self.links);
        let placements = input_placements(&request, self.links);
        if let Err(e) = prepare_folder(&partial, &request, &records, &placements, crap) {
            let _ = remove_partial(Some(lock), &partial);
            return Err(e);
        }

        let handle = Arc::new(Handle {
            group: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            finished: Mutex::new(false),
            changed: Condvar::new(),
        });
        self.running
            .lock()
            .unwrap()
            .insert(id.clone(), handle.clone());
        let job = Job {
            id: id.clone(),
            tool: tool_path.to_path_buf(),
            args,
            partial: partial.clone(),
            done_dir,
            records,
            placements,
            sink,
            handle,
            lock: Some(lock),
        };
        let (started_tx, started_rx) = mpsc::channel();
        let searches = self.clone();
        let spawned = thread::Builder::new()
            .name(format!("prose-{id}"))
            .spawn(move || supervise(searches, job, started_tx));
        let result = match spawned {
            Ok(_) => started_rx.recv().unwrap_or_else(|_| {
                Err("The search thread ended before the tool started.".to_string())
            }),
            Err(e) => Err(format!("The search thread cannot be started ({e}).")),
        };
        if let Err(e) = result {
            self.running.lock().unwrap().remove(&id);
            // (the thread has ended and released the lock)
            let _ = remove_partial(None, &partial);
            return Err(e);
        }
        Ok(id)
    }

    /// Stops a search: its process group gets SIGTERM, and SIGKILL if it is still there after a few
    /// seconds (Windows: its job is terminated at once). Returns when the process is gone and the
    /// partial folder is removed. A search that is not running (finished, or never existed) is not an
    /// error.
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let Some(handle) = self.running.lock().unwrap().get(id).cloned() else {
            return Ok(());
        };
        handle.cancelled.store(true, Ordering::SeqCst);
        let group = handle.group();
        if let Some(group) = &group {
            group.terminate();
        }
        if handle.wait_finished(GRACE) {
            return Ok(());
        }
        if let Some(group) = &group {
            group.kill();
        }
        if handle.wait_finished(KILL_WAIT) {
            Ok(())
        } else {
            let pid = group.map(|g| g.pid()).unwrap_or(0);
            Err(format!("ProSE (process {pid}) did not stop."))
        }
    }

    /// Cancels every running search (the app is closing).
    pub fn cancel_all(&self) {
        let handles: Vec<Arc<Handle>> = self.running.lock().unwrap().values().cloned().collect();
        let running: Vec<(Arc<Handle>, Option<Arc<sys::Group>>)> = handles
            .into_iter()
            .map(|h| {
                h.cancelled.store(true, Ordering::SeqCst);
                let group = h.group();
                if let Some(group) = &group {
                    group.terminate();
                }
                (h, group)
            })
            .collect();
        for (handle, group) in running {
            if !handle.wait_finished(GRACE) {
                if let Some(group) = &group {
                    group.kill();
                }
                handle.wait_finished(KILL_WAIT);
            }
        }
    }
}

/// The links, `inputs.json` and, with contaminants, `database.fasta`.
fn prepare_folder(
    dir: &Path,
    request: &SearchRequest,
    records: &[InputRecord],
    placements: &[Placement],
    crap: Option<&Path>,
) -> Result<(), String> {
    for ((file, record), placement) in request.files.iter().zip(records).zip(placements) {
        let original = fs::canonicalize(&file.path).unwrap_or_else(|_| PathBuf::from(&file.path));
        let link = dir.join(&record.link);
        match placement {
            Placement::OwnPath => {}
            Placement::Symlink => sys::link_input(&original, &link).map_err(|e| {
                format!(
                    "The input {} cannot be linked into the search folder ({e}).",
                    file.path
                )
            })?,
            // (Windows) a hard link works on the folder's own volume only; nothing is ever copied
            Placement::HardLink => fs::hard_link(&original, &link).map_err(|e| {
                format!(
                    "Two inputs are named {}. ProSE names its results after the files, so files of one \
                     name are searched together only through links in the search folder, which Windows \
                     can make only on the drive of the app's data ({}) and on NTFS; {} cannot be linked \
                     there ({e}). Rename one of the files and start the search again.",
                    record.name,
                    dir.parent().unwrap_or(dir).display(),
                    file.path
                )
            })?,
        }
    }
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    fs::write(dir.join("inputs.json"), json)
        .map_err(|e| format!("inputs.json cannot be written ({e})."))?;
    if request.contaminants {
        let crap =
            crap.ok_or("The contaminant database (cRAP) is not available in this installation.")?;
        with_contaminants(Path::new(&request.database), crap, &dir.join(DATABASE_FILE))
            .map_err(|e| format!("The database with contaminants cannot be written ({e})."))?;
    }
    Ok(())
}

/// Runs the tool, passes on its progress, and settles the folder. Runs on the thread that started the
/// tool, which is what ties the tool to the app on Linux (`PR_SET_PDEATHSIG`).
fn supervise(searches: Arc<Searches>, job: Job, started: mpsc::Sender<Result<(), String>>) {
    let Job {
        id,
        tool: tool_path,
        args,
        partial,
        done_dir,
        records,
        placements,
        sink,
        handle,
        mut lock,
    } = job;
    let mut command = tool::command(&tool_path);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    sys::prepare(&mut command);
    let mut child: Child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = started.send(Err(format!(
                "The ProSE tool {} cannot be started ({e}).",
                tool_path.display()
            )));
            return;
        }
    };
    let group = Arc::new(sys::Group::new(&child));
    *handle.group.lock().unwrap() = Some(group.clone());
    let _ = started.send(Ok(()));
    let emit = |event: SearchEvent| (sink)(event);
    emit(SearchEvent::Progress(ProgressEvent {
        search_id: id.clone(),
        label: STARTING.to_string(),
        file: -1,
        fraction: 0.0,
    }));

    let log = fs::File::create(partial.join("prose.log"))
        .ok()
        .map(|f| Arc::new(Mutex::new(f)));
    if let Some(log) = &log {
        let _ = writeln!(
            log.lock().unwrap(),
            "$ {} {}",
            tool_path.display(),
            args.iter()
                .map(|a| a.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ")
        );
    }

    let names: Vec<String> = records.iter().map(|r| r.name.clone()).collect();
    let stdout = child.stdout.take();
    let out_reader = {
        let (sink, id, log) = (sink.clone(), id.clone(), log.clone());
        thread::spawn(move || {
            let mut tracker = ProgressTracker::new(names);
            if let Some(stdout) = stdout {
                read_lines(stdout, |line| {
                    if let Some(log) = &log {
                        let _ = writeln!(log.lock().unwrap(), "{line}");
                    }
                    if let Some(p) = tracker.feed(line) {
                        sink(SearchEvent::Progress(ProgressEvent {
                            search_id: id.clone(),
                            label: p.label,
                            file: p.file,
                            fraction: p.fraction,
                        }));
                    }
                });
            }
            tracker
        })
    };
    let stderr = child.stderr.take();
    let err_reader = {
        let log = log.clone();
        thread::spawn(move || {
            let mut tail: VecDeque<String> = VecDeque::new();
            if let Some(stderr) = stderr {
                read_lines(stderr, |line| {
                    if line.starts_with("Schema error") {
                        return;
                    }
                    if let Some(log) = &log {
                        let _ = writeln!(log.lock().unwrap(), "{line}");
                    }
                    if !is_noise(line) {
                        if tail.len() == STDERR_TAIL {
                            tail.pop_front();
                        }
                        tail.push_back(line.to_string());
                    }
                });
            }
            tail
        })
    };

    let status = child.wait();
    // whatever the tool left running goes with it (and holds no pipe open for the readers)
    group.kill();
    let tracker = out_reader
        .join()
        .unwrap_or_else(|_| ProgressTracker::new(Vec::new()));
    let tail = err_reader.join().unwrap_or_default();
    drop(log);

    // the hard links to the inputs (Windows) have served: they do not belong to the search, and would
    // keep a file the user deletes on the disk
    for (record, placement) in records.iter().zip(&placements) {
        if *placement == Placement::HardLink {
            let _ = with_backoff(|| fs::remove_file(partial.join(&record.link)));
        }
    }
    let outcome = if handle.cancelled.load(Ordering::SeqCst) {
        let _ = remove_partial(lock.take(), &partial);
        None
    } else {
        match status {
            Ok(status) if status.success() => {
                match finish_partial(lock.take(), &partial, &done_dir) {
                    Ok(()) => Some(SearchEvent::Done(DoneEvent {
                        search_id: id.clone(),
                        folder: done_dir.to_string_lossy().into_owned(),
                    })),
                    Err(e) => {
                        let _ = remove_partial(None, &partial);
                        Some(failed(
                            &id,
                            format!("The search folder cannot be finished ({e})."),
                            &tracker,
                        ))
                    }
                }
            }
            Ok(status) => {
                let message = humanize(&failure_message(&tail, &status), &partial, &records);
                let _ = remove_partial(lock.take(), &partial);
                Some(failed(&id, message, &tracker))
            }
            Err(e) => {
                let _ = remove_partial(lock.take(), &partial);
                Some(failed(
                    &id,
                    format!("Waiting for ProSE failed ({e})."),
                    &tracker,
                ))
            }
        }
    };
    searches.running.lock().unwrap().remove(&id);
    // (Windows: closing the job ends anything still in it; the process's own handle goes too, so that
    // it is gone from the process list when cancel returns)
    handle.group.lock().unwrap().take();
    drop(group);
    drop(child);
    if let Some(event) = outcome {
        emit(event);
    }
    handle.finish();
}

fn failed(id: &str, message: String, tracker: &ProgressTracker) -> SearchEvent {
    SearchEvent::Failed(FailedEvent {
        search_id: id.to_string(),
        message,
        stage: tracker.label().to_string(),
        file: tracker.file(),
    })
}
