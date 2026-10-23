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
//! # Chunked searches (`database:chunk_size`)
//!
//! With a chunk size ProSE searches chunk-major, for one input as well as for several: it prints no
//! `Searching` line, but (real runs in `tests/fixtures/prose-chunked-*.stdout.txt`)
//!
//! | ProSE line (stdout)                                  | label                                       | file | fraction                          |
//! | ---------------------------------------------------- | ------------------------------------------- | ---- | --------------------------------- |
//! | `[ProSE] Loading <path>`                             | `Reading the spectra...`                    | -1   | 0                                 |
//! | `[ProSE] Chunk-major multi-file: P proteins, N chunks, M files.` | (sets N and M)                  |      |                                   |
//! | `[ProSE] Chunk k/N (…)`                              | `Searching database chunk k of N...`        | -1   | (k-1)/N of the first 50 %         |
//! | `[PeptDeepRescoring] …` (first before a mapping)     | `Adding PeptDeep rescoring features...`     | j    | file j's part of the rest         |
//! | `Mapping n peptides to p proteins.`                  | `Mapping peptides to proteins...`           | j    | (j = the mappings seen before)    |
//! | `[ProSE] Rescoring the PSMs with Percolator...`      | `Rescoring with Percolator...`              | j    |                                   |
//! | `[ProSE] Protein inference on …` (M > 1; before OpenMS #10707 `[ProSE] Merged protein inference + FDR …`) | `Pooling the files...` | -1 | 0.95 |
//!
//! The rescoring of the files comes after all chunks, file by file, so those steps are attributed to
//! file 0, 1, … by counting the mapping lines; they share [0.5, 0.95] of the bar. The index lines of the
//! chunks (`Generating peptides...`, `Fragment index built!`) are not reported. Whatever the mode, a line
//! that is not in the tables gives no event, and the fraction never goes back.
//!
//! # Files
//!
//! The files together take [0, 0.95] of the bar, file i of n the part [i/n, (i+1)/n] of it, and the
//! position above moves the fraction inside that part. The positions are estimates of where in a file's
//! work a step sits, not measurements. When the last file is done, the pooled protein inference and FDR
//! of several files report nothing: the label becomes `Pooling the files...` (file -1, 0.95), as in the
//! web app; with one file it is `Writing the results...`. The search report then gives
//! `Writing the results...` at 0.97. The fraction never goes back.

/// Share of the bar for the files; the rest is for pooling and writing.
const FILES_SHARE: f64 = 0.95;
/// In a chunked search (`database:chunk_size`), the share of the bar for the chunks; the files'
/// rescoring takes the rest of the files' share.
const CHUNKS_SHARE: f64 = 0.5;
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
    /// The chunks of a chunked search (`Chunk-major` line seen).
    chunks: Option<usize>,
    /// Chunked searches: the `Mapping n peptides` lines seen (one per file).
    mapped: usize,
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

/// `Chunk-major multi-file: P proteins, N chunks, M files.` after the tag: (N, M).
fn parse_chunk_major(rest: &str) -> Option<(usize, usize)> {
    let rest = rest.strip_prefix("Chunk-major multi-file:")?;
    let number_before = |word: &str| -> Option<usize> {
        let head = rest.split(word).next()?;
        head.rsplit(|c: char| !c.is_ascii_digit())
            .find(|t| !t.is_empty())?
            .parse()
            .ok()
    };
    Some((number_before(" chunks")?, number_before(" files")?))
}

/// `Chunk k/N (20 proteins)` after the tag: (k, N).
fn parse_chunk(rest: &str) -> Option<(usize, usize)> {
    let (k, tail) = rest.strip_prefix("Chunk ")?.split_once('/')?;
    let n: String = tail.chars().take_while(char::is_ascii_digit).collect();
    Some((k.trim().parse().ok()?, n.parse().ok()?))
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
            chunks: None,
            mapped: 0,
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

    /// Reports `label` at the bar position `at` (never behind the last one).
    fn report_at(&mut self, label: String, file: i32, at: f64) -> Option<ProgressUpdate> {
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

    /// Reports a step of `file` at `position` (0..1) of the file's part of the bar.
    fn report(&mut self, label: String, file: i32, position: f64) -> Option<ProgressUpdate> {
        let at = if file < 0 {
            position
        } else if self.chunks.is_some() {
            CHUNKS_SHARE
                + (file as f64 + position) / self.count as f64 * (FILES_SHARE - CHUNKS_SHARE)
        } else {
            (file as f64 + position) / self.count as f64 * FILES_SHARE
        };
        self.report_at(label, file, at)
    }

    /// A step of file `file` in a chunked search (the rescoring after the chunks).
    fn chunked_step(&mut self, label: &str, file: usize, position: f64) -> Option<ProgressUpdate> {
        self.current = Some(file.min(self.count - 1));
        self.report(label.to_string(), self.current? as i32, position)
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

    /// The lines of a chunked search. `Some(update)` when the line is handled here (the update may be
    /// `None`: a line that gives no event but must not reach the file-by-file rules), `None` otherwise.
    fn feed_chunked(&mut self, line: &str) -> Option<Option<ProgressUpdate>> {
        let chunks = self.chunks?;
        if line.starts_with("Generating peptides...") || line.starts_with("Fragment index built!") {
            return Some(None);
        }
        if line.starts_with("[PeptDeepRescoring]") {
            if self.peptdeep_seen {
                return Some(None);
            }
            self.peptdeep_seen = true;
            return Some(self.chunked_step(
                "Adding PeptDeep rescoring features...",
                self.mapped,
                0.4,
            ));
        }
        if line.starts_with("Mapping ") && line.contains(" peptides to ") {
            let file = self.mapped;
            self.mapped += 1;
            self.peptdeep_seen = false;
            return Some(self.chunked_step("Mapping peptides to proteins...", file, 0.6));
        }
        let rest = line.strip_prefix("[ProSE] ")?;
        if let Some((k, n)) = parse_chunk(rest) {
            let share = (k.saturating_sub(1)) as f64 / n.max(chunks).max(1) as f64 * CHUNKS_SHARE;
            return Some(self.report_at(
                format!("Searching database chunk {k} of {n}..."),
                -1,
                share,
            ));
        }
        if rest.starts_with("Rescoring the PSMs with Percolator") {
            return Some(self.chunked_step(
                "Rescoring with Percolator...",
                self.mapped.saturating_sub(1),
                0.7,
            ));
        }
        // the pooled protein inference with its protein FDR (with several files only the pooled set has one)
        if (rest.starts_with("Protein inference on")
            || rest.starts_with("Merged protein inference"))
            && self.count > 1
        {
            return Some(self.report_at(POOLING.to_string(), -1, FILES_SHARE));
        }
        // the other lines (the report, the modification analysis) are the file-by-file rules'
        None
    }

    /// Reads one line of ProSE's stdout; returns the progress it marks, if any.
    pub fn feed(&mut self, line: &str) -> Option<ProgressUpdate> {
        let line = line.trim_end();
        if self.chunks.is_some() {
            if let Some(update) = self.feed_chunked(line) {
                return update;
            }
        }
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
        if rest.starts_with("Loading ") {
            return self.report_at("Reading the spectra...".to_string(), -1, 0.0);
        }
        if let Some((chunks, files)) = parse_chunk_major(rest) {
            self.chunks = Some(chunks);
            self.count = self.count.max(files);
            self.current = None;
            return None;
        }
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
