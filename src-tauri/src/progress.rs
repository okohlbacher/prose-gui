//! ProSE's log lines as progress.
//!
//! ProSE reports no numeric progress on the command line: its progress logger is silent there, and the
//! tool prints log lines to stdout (line by line, as it goes). The tracker reads those lines and turns
//! the ones that mark a step into `{label, file, fraction}`, the shape of the web app's progress
//! (`progressMapper`, `app/src/lib/engine/core.ts`), with the web app's labels where it has one.
//!
//! The mapping (the lines are from the pinned ProSE; `tests/fixtures/` holds real runs):
//!
//! | ProSE line (stdout)                                     | label                                           | position in the file's share |
//! | ------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
//! | `[ProSE] [i/n] Searching <path>`                        | `Searching <name> (i of n)...`                  | 0 (starts the file)          |
//! | `Generating peptides...` (first file only)              | `Building the fragment index...`                | 0.05                         |
//! | `Fragment index built!`                                 | `Searching <name> (i of n)...`                  | 0.15                         |
//! | `[ProSE] Calibration: scoring ...`                      | `Running calibration pass...`                   | 0.2                          |
//! | `[PeptDeepRescoring] ...` (first of the file)           | `Adding PeptDeep rescoring features...`         | 0.4                          |
//! | `[ProSE] Protein mapping ...`                           | `Mapping peptides to proteins...`               | 0.6                          |
//! | `[ProSE] Rescoring the PSMs with Percolator...`         | `Rescoring with Percolator...`                  | 0.7                          |
//! | `[ProSE] Running detailed modification analysis ...`    | `Analysing modifications...`                    | 0.9                          |
//! | `[ProSE] Closed search mode - per-file modification analysis skipped` | (the file is done)                | 1                            |
//! | `[ProSE] Running aggregate modification analysis ...` (open search, several files) | (the last file is done) | 1                    |
//! | `[ProSE] ===== Search Report =====`                     | `Writing the results...`                        | (see below)                  |
//!
//! `<name>` is the user's file name (the shim searches links named `<n>__<name>`; the tracker is given
//! the original names). `file` is the 0-based input of the step, -1 outside the files.
//!
//! The files together take [0, 0.95] of the bar, file i of n the part [i/n, (i+1)/n] of it, and the
//! position above moves the fraction inside that part. The positions are estimates of where in a file's
//! work a step sits, not measurements. When the last file is done, the pooled protein inference and FDR
//! of several files report nothing: the label becomes `Pooling the files...` (file -1, 0.95), as in the
//! web app; with one file it is `Writing the results...`. The search report then gives
//! `Writing the results...` at 0.97. The fraction never goes back.

/// Share of the bar for the files; the rest is for pooling and writing.
const FILES_SHARE: f64 = 0.95;
const REPORT_FRACTION: f64 = 0.97;

pub const POOLING: &str = "Pooling the files...";
pub const WRITING: &str = "Writing the results...";
pub const STARTING: &str = "Starting ProSE...";

/// One step to report.
#[derive(Debug, Clone, PartialEq)]
pub struct ProgressUpdate {
    pub label: String,
    /// The 0-based input of the step; -1 outside the files.
    pub file: i32,
    pub fraction: f64,
}

#[derive(Debug)]
pub struct ProgressTracker {
    names: Vec<String>,
    count: usize,
    /// The input being searched (0-based), if any step of a file was seen.
    current: Option<usize>,
    /// Whether the PeptDeep step of the current file was reported.
    peptdeep_seen: bool,
    fraction: f64,
    label: String,
    file: i32,
    last: Option<(String, i32, f64)>,
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// `[i/n] Searching <path>` after the `[ProSE] ` tag: (i, n, path).
fn parse_searching(rest: &str) -> Option<(usize, usize, &str)> {
    let rest = rest.strip_prefix('[')?;
    let (position, path) = rest.split_once("] Searching ")?;
    let (i, n) = position.split_once('/')?;
    Some((i.trim().parse().ok()?, n.trim().parse().ok()?, path.trim()))
}

impl ProgressTracker {
    /// `names`: the user's file names, in input order (for the labels).
    pub fn new(names: Vec<String>) -> ProgressTracker {
        ProgressTracker {
            count: names.len().max(1),
            names,
            current: None,
            peptdeep_seen: false,
            fraction: 0.0,
            label: STARTING.to_string(),
            file: -1,
            last: None,
        }
    }

    /// The last label reported (the stage a failure happened in).
    pub fn label(&self) -> &str {
        &self.label
    }

    /// The input of the last report: `None` outside the files.
    pub fn file(&self) -> Option<i32> {
        (self.file >= 0).then_some(self.file)
    }

    fn searching_label(&self, file: usize) -> String {
        let name = self.names.get(file).map(String::as_str).unwrap_or("");
        format!("Searching {name} ({} of {})...", file + 1, self.count)
    }

    fn report(&mut self, label: String, file: i32, position: f64) -> Option<ProgressUpdate> {
        let at = if file >= 0 {
            (file as f64 + position) / self.count as f64 * FILES_SHARE
        } else {
            position
        };
        self.fraction = self.fraction.max(at.min(1.0));
        self.label = label.clone();
        self.file = file;
        let key = (label.clone(), file, self.fraction);
        if self
            .last
            .as_ref()
            .is_some_and(|l| l.0 == key.0 && l.1 == key.1 && l.2 >= key.2)
        {
            return None;
        }
        self.last = Some(key);
        Some(ProgressUpdate {
            label,
            file,
            fraction: self.fraction,
        })
    }

    /// A step of the current file at `position`.
    fn step(&mut self, label: &str, position: f64) -> Option<ProgressUpdate> {
        let file = self.current?;
        self.report(label.to_string(), file as i32, position)
    }

    /// The current file is done; after the last one there is only pooling and writing.
    fn finish_file(&mut self) -> Option<ProgressUpdate> {
        let file = self.current?;
        if file + 1 < self.count {
            // the next file's step follows at once: nothing to say in between
            self.fraction = self
                .fraction
                .max((file as f64 + 1.0) / self.count as f64 * FILES_SHARE);
            return None;
        }
        let label = if self.count > 1 { POOLING } else { WRITING };
        self.current = None;
        self.report(label.to_string(), -1, FILES_SHARE)
    }

    /// Reads one line of ProSE's stdout; returns the progress it marks, if any.
    pub fn feed(&mut self, line: &str) -> Option<ProgressUpdate> {
        let line = line.trim_end();
        if line.starts_with("Generating peptides...") {
            return self.step("Building the fragment index...", 0.05);
        }
        if line.starts_with("Fragment index built!") {
            let label = self.searching_label(self.current?);
            return self.step(&label, 0.15);
        }
        if line.starts_with("[PeptDeepRescoring]") {
            if self.peptdeep_seen {
                return None;
            }
            self.peptdeep_seen = true;
            return self.step("Adding PeptDeep rescoring features...", 0.4);
        }
        let rest = line.strip_prefix("[ProSE] ")?;
        if let Some((i, n, path)) = parse_searching(rest) {
            let index = i.saturating_sub(1);
            if n > self.count {
                self.count = n;
            }
            self.current = Some(index);
            self.peptdeep_seen = false;
            let label = if self.names.get(index).is_some() {
                self.searching_label(index)
            } else {
                format!("Searching {} ({i} of {n})...", basename(path))
            };
            return self.report(label, index as i32, 0.0);
        }
        if rest.starts_with("Calibration: scoring") {
            return self.step("Running calibration pass...", 0.2);
        }
        if rest.starts_with("Protein mapping") {
            return self.step("Mapping peptides to proteins...", 0.6);
        }
        if rest.starts_with("Rescoring the PSMs with Percolator") {
            return self.step("Rescoring with Percolator...", 0.7);
        }
        if rest.starts_with("Running detailed modification analysis") {
            return self.step("Analysing modifications...", 0.9);
        }
        if rest.starts_with("Closed search mode - per-file modification analysis skipped")
            || rest.starts_with("Running aggregate modification analysis")
        {
            return self.finish_file();
        }
        if rest.contains("Search Report") && rest.starts_with('=') {
            // open searches have no end marker of the file: the report is the first thing after the last one
            if self.current.is_some() {
                self.finish_file();
            }
            return self.report(WRITING.to_string(), -1, REPORT_FRACTION);
        }
        None
    }
}
