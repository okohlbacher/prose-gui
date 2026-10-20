//! The shim against the real ProSE tool, on the web app's example.
//!
//! Gated: set `PROSE_BIN` to the tool (the pin built by `native/scripts/build-openms.sh`, for example
//! `/scratch/sachsenb/openms-desktop/build/bin/ProSE`) to run these tests; without it each test prints
//! a skip message (shown with `--nocapture`) and passes. `PROSE_EXAMPLE_DIR` names the folder with
//! `DatabaseSuitability_in_spec.mzML` and `DatabaseSuitability_database.fasta` (default: the web app's
//! `app/public/example` on the development machine); a missing folder skips as well.

mod common;

use common::*;
use prose_desktop_lib::args::SearchRequest;
use prose_desktop_lib::run::{SearchEvent, Searches};
use prose_desktop_lib::tool;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

struct Real {
    bin: PathBuf,
    example: PathBuf,
}

fn real() -> Option<Real> {
    let Some(bin) = std::env::var_os("PROSE_BIN").map(PathBuf::from) else {
        eprintln!("skipped: set PROSE_BIN to the ProSE tool to run the test against the real tool");
        return None;
    };
    let example = std::env::var_os("PROSE_EXAMPLE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/scratch/sachsenb/prose-pages/app/public/example"));
    if !example.join("DatabaseSuitability_in_spec.mzML").is_file()
        || !example.join("DatabaseSuitability_database.fasta").is_file()
    {
        eprintln!("skipped: {} has no DatabaseSuitability_in_spec.mzML and DatabaseSuitability_database.fasta (set PROSE_EXAMPLE_DIR)", example.display());
        return None;
    }
    Some(Real { bin, example })
}

/// The web app's example: the same mzML twice (here from two folders, under one name), the orbitrap
/// preset, 5 % protein FDR, contaminants, Percolator and PeptDeep.
fn example_request(real: &Real, work: &TempDir, peptdeep: bool) -> SearchRequest {
    let mzml = real.example.join("DatabaseSuitability_in_spec.mzML");
    let mut files = Vec::new();
    for folder in ["replicate-a", "replicate-b"] {
        let path = work
            .path()
            .join("data")
            .join(folder)
            .join("DatabaseSuitability_in_spec.mzML");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::copy(&mzml, &path).unwrap();
        files.push(json!({ "id": folder, "path": path }));
    }
    serde_json::from_value(json!({
        "files": files,
        "database": real.example.join("DatabaseSuitability_database.fasta"),
        "contaminants": true,
        "settings": {
            "parameters": {
                "enzyme": "Trypsin/P",
                "peptide:enzyme_specificity": "full",
                "peptide:missed_cleavages": 2,
                "modifications:fixed": ["Carbamidomethyl (C)"],
                "modifications:variable": ["Oxidation (M)", "Acetyl (Protein N-term)"],
                "FDR:PSM": 0.01,
                "FDR:protein": 0.05,
                "precursor:mass_tolerance_lower": 10,
                "precursor:mass_tolerance_upper": 10,
                "precursor:mass_tolerance_unit": "ppm",
                "fragment:mass_tolerance": 20,
                "fragment:mass_tolerance_unit": "ppm",
                "peptdeep:instrument": "QE",
            },
            "rescore": true,
            "peptdeep": peptdeep,
            "threads": 4,
        },
    }))
    .unwrap()
}

fn parquet(path: &Path) -> bool {
    let bytes = fs::read(path).unwrap_or_default();
    bytes.len() > 8 && bytes.starts_with(b"PAR1") && bytes.ends_with(b"PAR1")
}

#[test]
fn the_real_tool_reports_its_version() {
    let Some(real) = real() else { return };
    let info = tool::probe(&real.bin).unwrap();
    assert!(!info.version.is_empty());
    assert_eq!(info.path, real.bin.to_string_lossy());
    assert!(info.onnx, "the pin is built with ONNX Runtime");
}

#[test]
fn the_example_is_searched_through_start_search() {
    let Some(real) = real() else { return };
    let work = TempDir::new("real");
    let onnx = tool::probe(&real.bin).unwrap().onnx;
    let request = example_request(&real, &work, onnx);
    let originals: Vec<String> = request.files.iter().map(|f| f.path.clone()).collect();
    let searches = Arc::new(Searches::default());
    let (sink, rx) = channel_sink();
    let crap = tool::bundled_crap(None).expect("resources/fasta/crap.fasta");
    let searches_dir = work.path().join("searches");
    let id = searches
        .start(&real.bin, &searches_dir, Some(&crap), request, sink)
        .unwrap();
    let events = until_terminal(&rx, Duration::from_secs(300));

    let folder = match events.last() {
        Some(SearchEvent::Done(d)) => PathBuf::from(&d.folder),
        other => panic!("not done: {other:?}"),
    };
    assert_eq!(folder, searches_dir.join(&id));
    assert!(!searches_dir.join(format!("{id}.partial")).exists());

    // the outputs the app reads (docs/parity.md), for both inputs although they have one name
    for file in [
        "qpx/quantms.psm.parquet",
        "qpx/1__DatabaseSuitability_in_spec.psm.parquet",
        "qpx/2__DatabaseSuitability_in_spec.psm.parquet",
        "spectra/1__DatabaseSuitability_in_spec.psm_spectra.parquet",
        "spectra/2__DatabaseSuitability_in_spec.psm_spectra.parquet",
        "oms/openms.psm.parquet",
        "oms/merged.proteins.parquet",
        "oms/merged.pg.parquet",
    ] {
        assert!(parquet(&folder.join(file)), "{file} is a Parquet file");
    }
    for file in [
        "summary.yaml",
        "merged.idXML",
        "inputs.json",
        "prose.log",
        "database.fasta",
    ] {
        assert!(folder.join(file).is_file(), "{file}");
    }
    assert!(fs::read_to_string(folder.join("database.fasta"))
        .unwrap()
        .contains(">CON__sp|ALBU_BOVIN|"));
    let summary = fs::read_to_string(folder.join("summary.yaml")).unwrap();
    assert!(summary.contains("per_file"), "{summary}");

    // progress: both files, the PeptDeep and Percolator steps, a fraction that only grows
    let progress: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            SearchEvent::Progress(p) => Some(p),
            _ => None,
        })
        .collect();
    let labels: Vec<&str> = progress.iter().map(|p| p.label.as_str()).collect();
    for p in &progress {
        eprintln!(
            "progress {:>6.3} file {:>2}  {}",
            p.fraction, p.file, p.label
        );
    }
    assert!(
        labels.contains(&"Searching DatabaseSuitability_in_spec.mzML (1 of 2)..."),
        "{labels:?}"
    );
    assert!(
        labels.contains(&"Searching DatabaseSuitability_in_spec.mzML (2 of 2)..."),
        "{labels:?}"
    );
    assert!(
        labels.contains(&"Rescoring with Percolator..."),
        "{labels:?}"
    );
    assert_eq!(
        labels.contains(&"Adding PeptDeep rescoring features..."),
        onnx,
        "{labels:?}"
    );
    assert!(labels.contains(&"Pooling the files..."), "{labels:?}");
    assert!(progress.windows(2).all(|w| w[1].fraction >= w[0].fraction));
    assert!(progress.iter().any(|p| p.file == 1) && progress.last().unwrap().fraction < 1.0);

    // the inputs are linked, not copied, and nothing was written next to them
    for (n, original) in originals.iter().enumerate() {
        let link = folder.join(format!("{}__DatabaseSuitability_in_spec.mzML", n + 1));
        assert_eq!(
            fs::read_link(&link).unwrap(),
            Path::new(original).canonicalize().unwrap()
        );
        let mut names: Vec<_> = fs::read_dir(Path::new(original).parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        names.sort();
        assert_eq!(names, ["DatabaseSuitability_in_spec.mzML"]);
    }
}

#[test]
fn cancelling_the_real_tool_leaves_no_process_and_no_folder() {
    let Some(real) = real() else { return };
    let work = TempDir::new("real-cancel");
    let request = example_request(&real, &work, false);
    let searches = Arc::new(Searches::default());
    let (sink, rx) = channel_sink();
    let crap = tool::bundled_crap(None).unwrap();
    let searches_dir = work.path().join("searches");
    let id = searches
        .start(&real.bin, &searches_dir, Some(&crap), request, sink)
        .unwrap();
    first_progress(&rx, Duration::from_secs(60));
    let folder = searches_dir.to_string_lossy().into_owned();
    assert!(processes_with(&folder) >= 1, "the tool runs");

    searches.cancel(&id).unwrap();
    assert_eq!(
        processes_with(&folder),
        0,
        "no process of the search is left"
    );
    assert!(
        fs::read_dir(&searches_dir).unwrap().next().is_none(),
        "the partial folder is removed"
    );
}

/// The number of live processes whose command line mentions `needle`.
fn processes_with(needle: &str) -> usize {
    fs::read_dir("/proc")
        .unwrap()
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .chars()
                .all(|c| c.is_ascii_digit())
        })
        .filter(|e| process_alive(e.file_name().to_string_lossy().parse().unwrap()))
        .filter(|e| {
            fs::read(e.path().join("cmdline"))
                .map(|b| {
                    String::from_utf8_lossy(&b).contains(needle)
                        && !String::from_utf8_lossy(&b).contains("real_prose")
                })
                .unwrap_or(false)
        })
        .count()
}
