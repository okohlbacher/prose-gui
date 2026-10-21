//! The shim against a fake ProSE (tests/fake-prose.sh; on Windows examples/fake_prose.rs) and fixtures of
//! real ProSE output.

mod common;

use common::*;
use prose_desktop_lib::args::{
    build_args, build_args_with, input_placements, input_records_with, input_stem, is_input_link,
    link_name, with_contaminants, InputLinks, Placement, SearchRequest,
};
use prose_desktop_lib::progress::ProgressTracker;
use prose_desktop_lib::run::{SearchEvent, Searches};
use prose_desktop_lib::tool;
use serde_json::{json, Value};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(20);

/// A request as the front end sends it (camelCase JSON).
fn request(
    files: &[&Path],
    database: &Path,
    contaminants: bool,
    parameters: Value,
) -> SearchRequest {
    serde_json::from_value(json!({
        "files": files.iter().enumerate().map(|(i, p)| json!({ "id": format!("f{i}"), "path": p })).collect::<Vec<_>>(),
        "database": database,
        "contaminants": contaminants,
        "settings": { "parameters": parameters, "rescore": true, "peptdeep": false, "threads": 2 },
    }))
    .unwrap()
}

/// The arguments with every input as a link `<n>__<name>` (Linux, macOS; Windows below).
fn args_of(req: &SearchRequest, out: &Path) -> Vec<OsString> {
    build_args_with(req, out, InputLinks::Symlinks).unwrap()
}

/// The values after `flag` up to the next option.
fn values_of(args: &[OsString], flag: &str) -> Vec<OsString> {
    let at = args
        .iter()
        .position(|a| a == flag)
        .unwrap_or_else(|| panic!("{flag} is not in {args:?}"));
    args[at + 1..]
        .iter()
        .take_while(|a| {
            !a.to_string_lossy().starts_with('-') || a.to_string_lossy().parse::<f64>().is_ok()
        })
        .cloned()
        .collect()
}

fn has(args: &[OsString], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

/// A folder with an mzML (empty contents are enough: the shim reads nothing) and a FASTA.
struct Inputs {
    dir: TempDir,
    mzml: PathBuf,
    fasta: PathBuf,
}

fn inputs() -> Inputs {
    let dir = TempDir::new("inputs");
    let mzml = dir.write("data/a.mzML", "<mzML/>");
    let fasta = dir.write("data/db.fasta", ">sp|P1|ONE\nMKWVTFISLLK\n");
    Inputs { dir, mzml, fasta }
}

// ---- arguments ------------------------------------------------------------------------------

#[test]
fn arguments_keep_paths_with_spaces_and_umlauts_intact() {
    let dir = TempDir::new("umlauts");
    let mzml = dir.write("Mäß daten/ünï cøde 1.mzML", "<mzML/>");
    let gz = dir.write("two words/Probe ä.mzML.gz", "gz");
    let fasta = dir.write("Datenbank ö/prot ein.fasta", ">a\nMK\n");
    let out = dir.path().join("out dir ü/s.partial");
    let args = args_of(&request(&[&mzml, &gz], &fasta, false, json!({})), &out);

    assert_eq!(
        values_of(&args, "-in"),
        vec![
            out.join("1__ünï cøde 1.mzML").into_os_string(),
            out.join("2__Probe ä.mzML.gz").into_os_string()
        ],
        "inputs are the symlinks of the search folder, each one argument"
    );
    assert_eq!(
        values_of(&args, "-database"),
        vec![fasta.clone().into_os_string()]
    );
    assert_eq!(
        values_of(&args, "-out_qpx"),
        vec![out.join("qpx").into_os_string()]
    );
    assert_eq!(
        values_of(&args, "-summary_out"),
        vec![out.join("summary.yaml").into_os_string()]
    );
}

#[test]
fn the_app_outputs_are_always_requested() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let args = args_of(&request(&[&i.mzml], &i.fasta, false, json!({})), &out);
    for (flag, path) in [
        ("-out_qpx", "qpx"),
        ("-out_psm_spectra", "spectra"),
        ("-out_parquet", "oms"),
        ("-summary_out", "summary.yaml"),
    ] {
        assert_eq!(
            values_of(&args, flag),
            vec![out.join(path).into_os_string()],
            "{flag}"
        );
    }
    assert!(has(&args, "-keep_decoys"));
    assert_eq!(values_of(&args, "-threads"), vec![OsString::from("2")]);
    assert_eq!(
        values_of(&args, "-Search:rescore"),
        vec![OsString::from("true")]
    );
    assert!(!has(&args, "-Search:peptdeep:enable"));
    // one input: no pooled output, and a closed search: no modification analysis
    assert!(!has(&args, "-out_merged"));
    assert!(!has(&args, "-out_mod_analysis_dir"));
}

#[test]
fn several_inputs_ask_for_the_merged_output_and_open_search_for_the_modification_tables() {
    let i = inputs();
    let b = i.dir.write("other/b.mzML", "<mzML/>");
    let out = i.dir.path().join("o");
    let open = json!({
        "precursor:mass_tolerance_lower": 500, "precursor:mass_tolerance_upper": 500,
        "precursor:mass_tolerance_unit": "Da",
    });
    let args = args_of(&request(&[&i.mzml, &b], &i.fasta, false, open), &out);
    assert_eq!(
        values_of(&args, "-out_merged"),
        vec![out.join("merged.idXML").into_os_string()]
    );
    assert_eq!(
        values_of(&args, "-out_mod_analysis_dir"),
        vec![out.join("mods").into_os_string()]
    );

    // ProSE's own rule: more than 1000 ppm or 1 Da on either side
    let wide_ppm = json!({ "precursor:mass_tolerance_upper": 1500 });
    assert!(has(
        &args_of(&request(&[&i.mzml], &i.fasta, false, wide_ppm), &out),
        "-out_mod_analysis_dir"
    ));
    let narrow_da = json!({ "precursor:mass_tolerance_unit": "Da", "precursor:mass_tolerance_lower": 0.5, "precursor:mass_tolerance_upper": 1 });
    assert!(!has(
        &args_of(&request(&[&i.mzml], &i.fasta, false, narrow_da), &out),
        "-out_mod_analysis_dir"
    ));
}

#[test]
fn parameters_are_typed_and_use_the_search_prefix() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let params = json!({
        "enzyme": "Trypsin/P",
        "peptide:missed_cleavages": 2,
        "precursor:isotope_error_min": -1,
        "precursor:mass_tolerance_lower": 10,
        "fragment:mass_tolerance": 0.02,
        "FDR:PSM": 0.01,
        "modifications:fixed": ["Carbamidomethyl (C)"],
        "modifications:variable": ["Oxidation (M)", "Acetyl (Protein N-term)"],
        "annotate:self_trained_ion_priors": false,
        "calibration:enabled": true,
        "ions:add_a_ions": false,
        "database:chunk_size": 100000,
        "peptdeep:instrument": "timsTOF",
    });
    let args = args_of(&request(&[&i.mzml], &i.fasta, false, params), &out);
    let one = |flag: &str| values_of(&args, flag);
    assert_eq!(one("-Search:enzyme"), vec![OsString::from("Trypsin/P")]);
    assert_eq!(
        one("-Search:peptide:missed_cleavages"),
        vec![OsString::from("2")]
    );
    assert_eq!(
        one("-Search:precursor:isotope_error_min"),
        vec![OsString::from("-1")]
    );
    assert_eq!(
        one("-Search:precursor:mass_tolerance_lower"),
        vec![OsString::from("10")]
    );
    assert_eq!(
        one("-Search:fragment:mass_tolerance"),
        vec![OsString::from("0.02")]
    );
    assert_eq!(one("-Search:FDR:PSM"), vec![OsString::from("0.01")]);
    assert_eq!(
        one("-Search:modifications:fixed"),
        vec![OsString::from("Carbamidomethyl (C)")]
    );
    assert_eq!(
        one("-Search:modifications:variable"),
        vec![
            OsString::from("Oxidation (M)"),
            OsString::from("Acetyl (Protein N-term)")
        ],
        "a list is one argument per item"
    );
    assert_eq!(
        one("-Search:annotate:self_trained_ion_priors"),
        vec![OsString::from("false")],
        "a true/false choice takes its value"
    );
    assert_eq!(
        one("-Search:database:chunk_size"),
        vec![OsString::from("100000")]
    );
    assert_eq!(
        one("-Search:peptdeep:instrument"),
        vec![OsString::from("timsTOF")]
    );
    // a switch: present when on, absent when off (ProSE's flags take no value)
    assert!(has(&args, "-Search:calibration:enabled"));
    assert!(!has(&args, "-Search:ions:add_a_ions"));
}

#[test]
fn an_empty_list_clears_the_default_and_peptdeep_is_a_switch() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let mut req = request(
        &[&i.mzml],
        &i.fasta,
        false,
        json!({ "modifications:variable": [] }),
    );
    req.settings.peptdeep = true;
    req.settings.rescore = false;
    let args = args_of(&req, &out);
    let at = args
        .iter()
        .position(|a| a == "-Search:modifications:variable")
        .unwrap();
    assert!(
        args.get(at + 1)
            .is_none_or(|next| next.to_string_lossy().starts_with('-')),
        "no value follows: {args:?}"
    );
    assert!(has(&args, "-Search:peptdeep:enable"));
    assert_eq!(
        values_of(&args, "-Search:rescore"),
        vec![OsString::from("false")]
    );
}

#[test]
fn unknown_parameters_are_refused() {
    let i = inputs();
    let out = i.dir.path().join("o");
    for name in [
        "bogus",
        "Search:enzyme",
        "in",
        "out_idxml",
        "ini",
        "peptdeep:ms2_model",
        "rescore",
        "peptdeep:enable",
    ] {
        let err = build_args(
            &request(&[&i.mzml], &i.fasta, false, json!({ name: "x" })),
            &out,
        )
        .unwrap_err();
        assert!(
            err.contains(name),
            "the error names the parameter {name}: {err}"
        );
    }
}

#[test]
fn parameter_values_of_the_wrong_type_are_refused() {
    let i = inputs();
    let out = i.dir.path().join("o");
    for params in [
        json!({ "peptide:missed_cleavages": "two" }),
        json!({ "peptide:missed_cleavages": 1.5 }),
        json!({ "peptide:missed_cleavages": null }),
        json!({ "FDR:protein": "0.01" }),
        json!({ "enzyme": 3 }),
        json!({ "enzyme": "-in" }),
        json!({ "enzyme": "" }),
        json!({ "modifications:fixed": "Carbamidomethyl (C)" }),
        json!({ "modifications:fixed": ["-database"] }),
        json!({ "modifications:fixed": [1] }),
        json!({ "calibration:enabled": "yes" }),
        json!({ "enzyme": "Tryp\nsin" }),
    ] {
        assert!(
            build_args(&request(&[&i.mzml], &i.fasta, false, params.clone()), &out).is_err(),
            "{params} is refused"
        );
    }
}

#[test]
fn the_psm_fdr_is_above_zero() {
    let i = inputs();
    let out = i.dir.path().join("o");
    // absent: the shim sends 1 %, because ProSE's default (0) leaves a search without q-values
    let args = args_of(&request(&[&i.mzml], &i.fasta, false, json!({})), &out);
    assert_eq!(
        values_of(&args, "-Search:FDR:PSM"),
        vec![OsString::from("0.01")]
    );
    for fdr in [json!(0), json!(-0.5)] {
        let err = build_args(
            &request(&[&i.mzml], &i.fasta, false, json!({ "FDR:PSM": fdr })),
            &out,
        )
        .unwrap_err();
        assert!(err.contains("FDR:PSM"), "{err}");
    }
}

#[test]
fn input_paths_are_validated() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let missing = i.dir.path().join("data/missing.mzML");
    let folder = i.dir.path().join("data");
    let raw = i.dir.write("data/a.raw", "x");
    let text = i.dir.write("data/db.txt", ">a\nMK\n");
    assert!(
        build_args(&request(&[&missing], &i.fasta, false, json!({})), &out)
            .unwrap_err()
            .contains("missing.mzML")
    );
    assert!(
        build_args(&request(&[&folder], &i.fasta, false, json!({})), &out).is_err(),
        "a folder is not a file"
    );
    assert!(
        build_args(&request(&[&raw], &i.fasta, false, json!({})), &out)
            .unwrap_err()
            .contains("a.raw")
    );
    assert!(
        build_args(&request(&[&i.mzml], &text, false, json!({})), &out)
            .unwrap_err()
            .contains("db.txt")
    );
    assert!(build_args(
        &request(
            &[&i.mzml],
            &i.dir.path().join("none.fasta"),
            false,
            json!({})
        ),
        &out
    )
    .is_err());
    assert!(
        build_args(&request(&[], &i.fasta, false, json!({})), &out).is_err(),
        "no input file"
    );
    // the extensions the app takes
    let gz = i.dir.write("data/b.MZML.GZ", "gz");
    let fa = i.dir.write("data/db.fa", ">a\nMK\n");
    let faa = i.dir.write("data/db.faa", ">a\nMK\n");
    for db in [&fa, &faa] {
        assert!(build_args(&request(&[&i.mzml, &gz], db, false, json!({})), &out).is_ok());
    }
}

#[test]
fn relative_paths_are_refused_so_none_can_pass_for_an_option() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let json = |files: Value, database: Value| -> SearchRequest {
        serde_json::from_value(json!({
            "files": files, "database": database, "contaminants": false,
            "settings": { "parameters": {}, "rescore": true, "peptdeep": false, "threads": 1 },
        }))
        .unwrap()
    };
    let good_file = json!([{ "id": "f", "path": i.mzml }]);
    let good_db = json!(i.fasta);
    for path in [
        "-in.mzML",
        "-out_qpx",
        "data/a.mzML",
        "a.mzML",
        "./a.mzML",
        "../a.mzML",
    ] {
        let err = build_args(
            &json(json!([{ "id": "f", "path": path }]), good_db.clone()),
            &out,
        )
        .unwrap_err();
        assert!(
            err.contains("absolute") && err.contains(path),
            "{path}: {err}"
        );
    }
    for path in ["-database.fasta", "-ini", "db.fasta", "sub/db.fasta"] {
        let err = build_args(&json(good_file.clone(), json!(path)), &out).unwrap_err();
        assert!(
            err.contains("absolute") && err.contains(path),
            "{path}: {err}"
        );
    }
    assert!(build_args(&json(good_file, good_db), &out).is_ok());
}

#[test]
fn contaminants_swap_the_database_for_the_search_folders_copy() {
    let i = inputs();
    let out = i.dir.path().join("o");
    let with = args_of(&request(&[&i.mzml], &i.fasta, true, json!({})), &out);
    assert_eq!(
        values_of(&with, "-database"),
        vec![out.join("database.fasta").into_os_string()]
    );
    let without = args_of(&request(&[&i.mzml], &i.fasta, false, json!({})), &out);
    assert_eq!(
        values_of(&without, "-database"),
        vec![i.fasta.clone().into_os_string()]
    );
}

#[test]
fn contaminants_are_appended_with_con_accessions() {
    let dir = TempDir::new("crap");
    // the user's FASTA has no final newline; one cRAP entry carries the prefix already
    let user = dir.write("user.fasta", ">sp|P1|ONE desc\nMKWV\nTFIS");
    let crap = dir.write(
        "crap.fasta",
        ">sp|ALBU_BOVIN|\nMKWVT\nFISL\n>CON__kept\nAAAA\n>gi|2|keratin\nGGGG\n",
    );
    let dest = dir.path().join("database.fasta");
    with_contaminants(&user, &crap, &dest).unwrap();
    assert_eq!(
        fs::read_to_string(&dest).unwrap(),
        ">sp|P1|ONE desc\nMKWV\nTFIS\n>CON__sp|ALBU_BOVIN|\nMKWVT\nFISL\n>CON__kept\nAAAA\n>CON__gi|2|keratin\nGGGG\n"
    );
    // the user's file is untouched, and a final newline is not doubled
    assert_eq!(
        fs::read_to_string(&user).unwrap(),
        ">sp|P1|ONE desc\nMKWV\nTFIS"
    );
    let user2 = dir.write("user2.fasta", ">x\nMK\n");
    with_contaminants(&user2, &crap, &dest).unwrap();
    assert!(fs::read_to_string(&dest)
        .unwrap()
        .starts_with(">x\nMK\n>CON__sp|ALBU_BOVIN|\n"));
}

#[test]
fn the_bundled_crap_has_116_entries_and_gets_the_prefix() {
    let dir = TempDir::new("bundled-crap");
    let crap = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fasta/crap.fasta");
    let user = dir.write("user.fasta", ">a\nMK\n");
    let dest = dir.path().join("database.fasta");
    with_contaminants(&user, &crap, &dest).unwrap();
    let text = fs::read_to_string(&dest).unwrap();
    let headers: Vec<&str> = text.lines().filter(|l| l.starts_with('>')).collect();
    assert_eq!(headers.len(), 117);
    assert_eq!(headers[0], ">a");
    assert!(headers[1..].iter().all(|h| h.starts_with(">CON__")));
}

#[test]
fn on_windows_inputs_go_by_their_own_paths_unless_their_names_clash() {
    let dir = TempDir::new("placements");
    let a = dir.write("one/a.mzML", "<mzML/>");
    let b = dir.write("one/b.mzML.gz", "gz");
    let a_upper = dir.write("two/A.MZML", "<mzML/>");
    let a_gz = dir.write("three/a.mzML.gz", "gz");
    let fasta = dir.write("db.fasta", ">a\nMK\n");
    let out = dir.path().join("s.partial");
    let windows = InputLinks::PathsOrHardLinks;
    let plan = |files: &[&Path]| {
        let req = request(files, &fasta, false, json!({}));
        let args = build_args_with(&req, &out, windows).unwrap();
        let records = input_records_with(&req, windows);
        (
            input_placements(&req, windows),
            values_of(&args, "-in"),
            records
                .iter()
                .map(|r| (r.link.clone(), r.stem.clone()))
                .collect::<Vec<_>>(),
        )
    };

    // names that differ: the user's paths themselves, and ProSE names the outputs after them
    let (placements, ins, records) = plan(&[&a, &b]);
    assert_eq!(placements, [Placement::OwnPath, Placement::OwnPath]);
    assert_eq!(
        ins,
        [a.clone().into_os_string(), b.clone().into_os_string()]
    );
    assert_eq!(
        records,
        [
            ("a.mzML".to_string(), "a".to_string()),
            ("b.mzML.gz".to_string(), "b".to_string())
        ]
    );
    // one stem, ignoring case (NTFS) or the .gz: the clashing ones as hard links in the folder
    let (placements, ins, records) = plan(&[&a, &b, &a_upper, &a_gz]);
    use Placement::*;
    assert_eq!(placements, [HardLink, OwnPath, HardLink, HardLink]);
    assert_eq!(
        ins,
        [
            out.join("1__a.mzML").into_os_string(),
            b.clone().into_os_string(),
            out.join("3__A.MZML").into_os_string(),
            out.join("4__a.mzML.gz").into_os_string(),
        ]
    );
    assert_eq!(
        records
            .iter()
            .map(|(_, stem)| stem.as_str())
            .collect::<Vec<_>>(),
        ["1__a", "b", "3__A", "4__a"]
    );
    // a file whose own name looks like a link beside the clash it would meet: all of them as links
    let tricky = dir.write("four/1__a.mzML", "<mzML/>");
    let (placements, _, records) = plan(&[&a, &a_upper, &tricky]);
    assert_eq!(placements, [HardLink, HardLink, HardLink]);
    assert_eq!(
        records
            .iter()
            .map(|(link, _)| link.as_str())
            .collect::<Vec<_>>(),
        ["1__a.mzML", "2__A.MZML", "3__1__a.mzML"]
    );
    // elsewhere every input is a symbolic link
    let req = request(&[&a, &b], &fasta, false, json!({}));
    assert_eq!(
        input_placements(&req, InputLinks::Symlinks),
        [Symlink, Symlink]
    );
    assert_eq!(
        InputLinks::PLATFORM,
        if cfg!(windows) {
            windows
        } else {
            InputLinks::Symlinks
        }
    );
}

#[test]
fn input_links_are_known_by_their_names() {
    for name in ["1__a.mzML", "12__x y.mzML.gz", "3__1__a.MZML"] {
        assert!(is_input_link(name), "{name}");
    }
    for name in [
        "a.mzML",
        "__a.mzML",
        "x__a.mzML",
        "1__a.fasta",
        "1__",
        "summary.yaml",
        "1_a.mzML",
    ] {
        assert!(!is_input_link(name), "{name}");
    }
}

#[test]
fn link_names_keep_the_name_and_the_gz_suffix() {
    assert_eq!(link_name(0, "/data/x.mzML"), "1__x.mzML");
    assert_eq!(link_name(9, "/data/x.mzML.gz"), "10__x.mzML.gz");
    assert_eq!(link_name(0, "/Daten ä/ünï cøde.mzML"), "1__ünï cøde.mzML");
    assert_eq!(input_stem("1__x.mzML"), "1__x");
    assert_eq!(input_stem("10__x.mzML.gz"), "10__x");
    assert_eq!(input_stem("2__a.b.MZML.GZ"), "2__a.b");
}

// ---- progress -------------------------------------------------------------------------------

type Step = (String, i32, f64);

fn steps_of(fixture_name: &str, names: &[&str]) -> Vec<Step> {
    let mut tracker = ProgressTracker::new(names.iter().map(|n| n.to_string()).collect());
    let mut steps = Vec::new();
    for line in fixture(fixture_name).lines() {
        if let Some(p) = tracker.feed(line) {
            steps.push((p.label, p.file, p.fraction));
        }
    }
    steps
}

fn labels(steps: &[Step]) -> Vec<&str> {
    steps.iter().map(|s| s.0.as_str()).collect()
}

fn assert_monotone(steps: &[Step]) {
    for pair in steps.windows(2) {
        assert!(pair[1].2 >= pair[0].2, "the fraction goes back: {pair:?}");
    }
    assert!(
        steps.iter().all(|s| (0.0..=1.0).contains(&s.2)),
        "{steps:?}"
    );
}

#[test]
fn progress_lines_become_events_with_file_and_fraction() {
    // real output of the pinned ProSE: two files, PeptDeep and Percolator on, closed search
    let steps = steps_of(
        "prose-closed-two-files-peptdeep.stdout.txt",
        &["DatabaseSuitability_1.mzML", "DatabaseSuitability_2.mzML"],
    );
    assert_eq!(
        labels(&steps),
        [
            "Searching DatabaseSuitability_1.mzML (1 of 2)...",
            "Building the fragment index...",
            "Searching DatabaseSuitability_1.mzML (1 of 2)...",
            "Adding PeptDeep rescoring features...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Searching DatabaseSuitability_2.mzML (2 of 2)...",
            "Adding PeptDeep rescoring features...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Pooling the files...",
            "Writing the results...",
        ]
    );
    let files: Vec<i32> = steps.iter().map(|s| s.1).collect();
    assert_eq!(files, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, -1, -1]);
    assert_eq!(steps[0].2, 0.0, "the first file starts at 0");
    // the second file's step starts where the first one's share ends: half of the 95 % for the files
    assert!((steps[6].2 - 0.475).abs() < 1e-9, "{:?}", steps[6]);
    assert!(
        (steps[10].2 - 0.95).abs() < 1e-9,
        "pooling holds at 95 %: {:?}",
        steps[10]
    );
    assert_monotone(&steps);
}

#[test]
fn progress_names_the_file_by_the_original_name_not_the_symlink() {
    // the fixture names the files "1__DatabaseSuitability_1.mzML" (the shim's link); the label shows the user's name
    let steps = steps_of(
        "prose-closed-two-files-peptdeep.stdout.txt",
        &["First run.mzML", "Zweite Probe ä.mzML.gz"],
    );
    assert_eq!(steps[0].0, "Searching First run.mzML (1 of 2)...");
    assert!(labels(&steps).contains(&"Searching Zweite Probe ä.mzML.gz (2 of 2)..."));
    // without names, the line's own file name is used
    let plain = steps_of("prose-closed-two-files-peptdeep.stdout.txt", &[]);
    assert_eq!(
        plain[0].0,
        "Searching 1__DatabaseSuitability_1.mzML (1 of 2)..."
    );
}

#[test]
fn progress_of_a_single_open_search_ends_with_the_modification_analysis() {
    let steps = steps_of(
        "prose-open-one-file.stdout.txt",
        &["DatabaseSuitability_1.mzML"],
    );
    assert_eq!(
        labels(&steps),
        [
            "Searching DatabaseSuitability_1.mzML (1 of 1)...",
            "Building the fragment index...",
            "Searching DatabaseSuitability_1.mzML (1 of 1)...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Analysing modifications...",
            "Writing the results...",
        ]
    );
    assert_eq!(steps.last().unwrap().1, -1);
    assert_monotone(&steps);
}

#[test]
fn progress_of_several_open_files_pools_after_the_last_modification_analysis() {
    let steps = steps_of("prose-open-two-files.stdout.txt", &["a.mzML", "b.mzML"]);
    let l = labels(&steps);
    assert_eq!(
        &l[l.len() - 3..],
        [
            "Analysing modifications...",
            "Pooling the files...",
            "Writing the results..."
        ]
    );
    assert_eq!(
        l.iter()
            .filter(|x| **x == "Analysing modifications...")
            .count(),
        2
    );
    assert_eq!(
        steps
            .iter()
            .find(|s| s.0 == "Pooling the files...")
            .unwrap()
            .1,
        -1
    );
    assert_monotone(&steps);
}

const CHUNK_NAMES: [&str; 2] = ["a.mzML", "b.mzML"];

fn chunk_labels(n: usize) -> Vec<String> {
    (1..=n)
        .map(|k| format!("Searching database chunk {k} of {n}..."))
        .collect()
}

#[test]
fn a_chunked_search_of_two_files_reports_its_chunks_and_each_files_rescoring() {
    // real output: `database:chunk_size 20` on two inputs prints no "Searching" line (chunk-major mode)
    let steps = steps_of("prose-chunked-two-files-peptdeep.stdout.txt", &CHUNK_NAMES);
    let mut expected = vec!["Reading the spectra...".to_string()];
    expected.extend(chunk_labels(17));
    expected.extend(
        [
            "Adding PeptDeep rescoring features...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Adding PeptDeep rescoring features...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Pooling the files...",
            "Writing the results...",
        ]
        .map(String::from),
    );
    assert_eq!(
        labels(&steps),
        expected.iter().map(String::as_str).collect::<Vec<_>>()
    );
    let files: Vec<i32> = steps.iter().map(|s| s.1).collect();
    assert!(
        files[..18].iter().all(|f| *f == -1),
        "reading and chunks are outside the files"
    );
    assert_eq!(files[18..], [0, 0, 0, 1, 1, 1, -1, -1]);
    // the chunks take the first half of the bar, in 17 equal steps
    assert_eq!(steps[1].2, 0.0);
    assert!(
        (steps[17].2 - 16.0 / 17.0 * 0.5).abs() < 1e-9,
        "{:?}",
        steps[17]
    );
    // the files' rescoring follows, file 1 after file 0
    assert!(
        steps[18].2 >= 0.5 && steps[23].2 > steps[20].2 && steps[23].2 < 0.95,
        "{steps:?}"
    );
    assert!((steps[24].2 - 0.95).abs() < 1e-9 && (steps[25].2 - 0.97).abs() < 1e-9);
    assert_monotone(&steps);
}

#[test]
fn a_chunked_search_of_one_file_reports_its_chunks() {
    let steps = steps_of(
        "prose-chunked-one-file-peptdeep.stdout.txt",
        &CHUNK_NAMES[..1],
    );
    let mut expected = vec!["Reading the spectra...".to_string()];
    expected.extend(chunk_labels(17));
    expected.extend(
        [
            "Adding PeptDeep rescoring features...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Writing the results...",
        ]
        .map(String::from),
    );
    assert_eq!(
        labels(&steps),
        expected.iter().map(String::as_str).collect::<Vec<_>>()
    );
    assert_eq!(
        steps[18..21].iter().map(|s| s.1).collect::<Vec<_>>(),
        [0, 0, 0]
    );
    assert_eq!(steps.last().unwrap().1, -1);
    assert_monotone(&steps);
}

#[test]
fn a_chunked_open_search_pools_after_the_aggregate_modification_analysis() {
    // no PeptDeep: the mapping line starts each file's rescoring
    let steps = steps_of("prose-chunked-open-two-files.stdout.txt", &CHUNK_NAMES);
    let l = labels(&steps);
    assert_eq!(l[0], "Reading the spectra...");
    assert_eq!(l[1], "Searching database chunk 1 of 4...");
    assert_eq!(
        l[5..],
        [
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Mapping peptides to proteins...",
            "Rescoring with Percolator...",
            "Pooling the files...",
            "Writing the results...",
        ]
    );
    assert_eq!(
        steps[5..11].iter().map(|s| s.1).collect::<Vec<_>>(),
        [0, 0, 1, 1, -1, -1]
    );
    assert_monotone(&steps);
}

#[test]
fn progress_never_stalls_on_lines_it_does_not_know() {
    // unknown lines between the known ones change nothing, in every mode
    for (fixture, names) in [
        (
            "prose-closed-two-files-peptdeep.stdout.txt",
            &CHUNK_NAMES[..],
        ),
        (
            "prose-chunked-two-files-peptdeep.stdout.txt",
            &CHUNK_NAMES[..],
        ),
        (
            "prose-chunked-one-file-peptdeep.stdout.txt",
            &CHUNK_NAMES[..1],
        ),
        ("prose-open-one-file.stdout.txt", &CHUNK_NAMES[..1]),
    ] {
        let plain = steps_of(fixture, names);
        let mut tracker = ProgressTracker::new(names.iter().map(|n| n.to_string()).collect());
        let mut noisy = Vec::new();
        for line in fixture_lines(fixture) {
            for junk in [
                "",
                "[ProSE] something new",
                "Chunk",
                "Chunk x/y",
                "[ProSE] Chunk-major",
                "Mapping",
                "[PeptDeepRescoring",
            ] {
                assert!(tracker.feed(junk).is_none(), "{junk:?} in {fixture}");
            }
            if let Some(p) = tracker.feed(&line) {
                noisy.push((p.label, p.file, p.fraction));
            }
        }
        assert_eq!(noisy, plain, "{fixture}");
    }
}

fn fixture_lines(name: &str) -> Vec<String> {
    fixture(name).lines().map(String::from).collect()
}

#[test]
fn progress_reports_the_calibration_pass() {
    let steps = steps_of(
        "prose-calibration-one-file.stdout.txt",
        &["DatabaseSuitability_1.mzML"],
    );
    assert!(
        labels(&steps).contains(&"Running calibration pass..."),
        "{:?}",
        labels(&steps)
    );
    assert!(
        !labels(&steps).contains(&"Rescoring with Percolator..."),
        "rescoring was off in this run"
    );
    assert_monotone(&steps);
}

#[test]
fn lines_without_a_step_give_no_event() {
    let mut tracker = ProgressTracker::new(vec!["a.mzML".into()]);
    for line in [
        "",
        "Generating fragments...",
        "Collapsed 12 repeated peptidoform occurrences.",
        "random text",
        "[ProSE] open_search=false (precursor tolerance [-10, +10] ppm)",
    ] {
        assert!(tracker.feed(line).is_none(), "{line:?}");
    }
}

// ---- tool resolution ------------------------------------------------------------------------

fn executable(dir: &TempDir, relative: &str) -> PathBuf {
    let path = dir.write(relative, "#!/bin/sh\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

#[test]
fn the_tool_is_found_through_prose_bin_then_the_bundle_then_path() {
    let dir = TempDir::new("resolve");
    let env_bin = executable(&dir, "env/ProSE");
    let bundled = executable(&dir, &format!("res/resources/prose/bin/{}", tool::EXE));
    let on_path = executable(&dir, &format!("pathdir/{}", tool::EXE));
    let res = dir.path().join("res");
    let path_var = OsString::from(dir.path().join("pathdir"));

    let all = |bin: Option<&Path>| {
        tool::resolve_with(bin.map(Path::as_os_str), Some(&res), Some(&path_var))
    };
    assert_eq!(all(Some(&env_bin)).unwrap(), env_bin);
    assert_eq!(all(None).unwrap(), bundled);
    fs::remove_file(&bundled).unwrap();
    assert_eq!(all(None).unwrap(), on_path);
    fs::remove_file(&on_path).unwrap();
    let err = all(None).unwrap_err();
    assert!(err.contains("ProSE"), "{err}");

    // a PROSE_BIN that does not exist is an error, not a reason to look elsewhere
    let err = tool::resolve_with(
        Some(OsStr::new("/nonexistent/ProSE")),
        Some(&res),
        Some(&path_var),
    )
    .unwrap_err();
    assert!(
        err.contains("PROSE_BIN") && err.contains("/nonexistent/ProSE"),
        "{err}"
    );
}

/// macOS: Tauri names no resource folder when the app's path goes through a symbolic link; the app then
/// takes the Resources folder of the bundle its executable really is in.
#[cfg(unix)]
#[test]
fn the_resources_of_an_app_bundle_are_found_through_a_link() {
    let dir = TempDir::new("bundle");
    let exe = executable(&dir, "real/ProSE.app/Contents/MacOS/prose-desktop");
    dir.write(
        "real/ProSE.app/Contents/Resources/resources/prose/build.json",
        "{}",
    );
    let resources = dir
        .path()
        .join("real/ProSE.app/Contents/Resources")
        .canonicalize()
        .unwrap();
    assert_eq!(tool::bundle_resources(&exe), Some(resources.clone()));
    // the app through a linked folder, and as a linked bundle
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("linked")).unwrap();
    std::os::unix::fs::symlink(
        dir.path().join("real/ProSE.app"),
        dir.path().join("Linked.app"),
    )
    .unwrap();
    for through in [
        "linked/ProSE.app/Contents/MacOS/prose-desktop",
        "Linked.app/Contents/MacOS/prose-desktop",
    ] {
        assert_eq!(
            tool::bundle_resources(&dir.path().join(through)),
            Some(resources.clone()),
            "{through}"
        );
    }
    // not in a bundle: no Resources folder, none
    let loose = executable(&dir, "bin/prose-desktop");
    assert_eq!(tool::bundle_resources(&loose), None);
    assert_eq!(tool::bundle_resources(&dir.path().join("nothing")), None);
}

#[test]
fn the_tools_version_is_read_from_its_help() {
    let help = "ProSE -- Annotates bottom-up MS/MS spectra using ProSE.\nFull documentation: http://x\nVersion: 3.7.0-pre-exported-20261020 Oct 20 2026, 22:16:02\nTo cite OpenMS:\n";
    assert_eq!(
        tool::parse_version(help).as_deref(),
        Some("3.7.0-pre-exported-20261020")
    );
    assert_eq!(tool::parse_version("nothing"), None);
}

#[test]
fn probing_a_tool_reports_its_version_path_and_onnx_support() {
    let dir = TempDir::new("probe");
    // a script on Unix; on Windows the fake tool, which answers --help the same way
    #[cfg(unix)]
    let script = executable(&dir, "ProSE");
    #[cfg(unix)]
    fs::write(&script, "#!/bin/sh\necho 'Version: 9.9.9 Oct 20 2026'\n").unwrap();
    #[cfg(not(unix))]
    let script = fake_prose_exe();
    let info = tool::probe(&script).unwrap();
    assert_eq!(info.version, "9.9.9");
    assert_eq!(info.path, script.to_string_lossy());
    assert!(!info.onnx, "a tool without a build manifest has no ONNX");
    assert!(tool::probe(&dir.path().join("none")).is_err());
}

#[test]
fn onnx_support_comes_from_the_bundles_manifest_and_its_models() {
    let dir = TempDir::new("onnx");
    let bin = executable(&dir, "prose/bin/ProSE");
    let models = [
        "share/OpenMS/models/peptdeep_ms2_dynamic.onnx",
        "share/OpenMS/models/peptdeep_rt_dynamic.onnx",
    ];
    let manifest = |with_onnx: bool| {
        dir.write(
            "prose/build.json",
            &serde_json::json!({ "tool": "ProSE", "withOnnx": with_onnx, "models": models })
                .to_string(),
        );
    };

    // no manifest (a tool from a build tree or the PATH): no ONNX, whatever it links
    assert!(!tool::has_onnx(&bin));
    // a build with ONNX, but the models are missing
    manifest(true);
    assert!(!tool::has_onnx(&bin));
    for model in models {
        dir.write(&format!("prose/{model}"), "onnx");
    }
    assert!(tool::has_onnx(&bin));
    // one model gone
    fs::remove_file(dir.path().join("prose").join(models[1])).unwrap();
    assert!(!tool::has_onnx(&bin));
    dir.write(&format!("prose/{}", models[1]), "onnx");
    // a build without ONNX, models or not
    manifest(false);
    assert!(!tool::has_onnx(&bin));
    // a manifest that names no models, or cannot be read
    dir.write("prose/build.json", r#"{"withOnnx": true, "models": []}"#);
    assert!(!tool::has_onnx(&bin));
    dir.write("prose/build.json", "not json");
    assert!(!tool::has_onnx(&bin));
    // a model path that leaves the bundle does not count
    dir.write("outside.onnx", "onnx");
    dir.write(
        "prose/build.json",
        r#"{"withOnnx": true, "models": ["../outside.onnx"]}"#,
    );
    assert!(!tool::has_onnx(&bin));
}

#[test]
fn the_tool_runs_with_one_blas_thread_unless_set() {
    let cmd = tool::command_with(Path::new("/x/ProSE"), None);
    let env: Vec<_> = cmd.get_envs().collect();
    assert!(env.contains(&(OsStr::new("OPENBLAS_NUM_THREADS"), Some(OsStr::new("1")))));
    let cmd = tool::command_with(Path::new("/x/ProSE"), Some(OsString::from("4")));
    assert!(
        cmd.get_envs().all(|(k, _)| k != "OPENBLAS_NUM_THREADS"),
        "the user's value stays"
    );
    // macOS: the loader's search variables never reach the bundled tool
    for name in tool::LOADER_VARIABLES {
        let removed = cmd.get_envs().any(|(k, v)| k == *name && v.is_none());
        assert_eq!(removed, cfg!(target_os = "macos"), "{name}");
    }
}

#[test]
fn the_tool_never_runs_the_update_check_of_openms() {
    for openblas in [None, Some(OsString::from("4"))] {
        let cmd = tool::command_with(Path::new("/x/ProSE"), openblas);
        let set: Vec<_> = cmd
            .get_envs()
            .filter(|(k, _)| *k == "OPENMS_DISABLE_UPDATE_CHECK")
            .collect();
        // set explicitly, so a user's OPENMS_DISABLE_UPDATE_CHECK=OFF (which turns the check on) is replaced
        assert_eq!(
            set,
            vec![(
                OsStr::new("OPENMS_DISABLE_UPDATE_CHECK"),
                Some(OsStr::new("ON"))
            )]
        );
    }
    assert_eq!(tool::NO_UPDATE_CHECK, ("OPENMS_DISABLE_UPDATE_CHECK", "ON"));
}

// ---- running --------------------------------------------------------------------------------

struct Run {
    work: TempDir,
    searches: Arc<Searches>,
}

impl Run {
    fn new() -> Run {
        Run {
            work: TempDir::new("run"),
            searches: Arc::new(Searches::default()),
        }
    }

    fn dir(&self) -> PathBuf {
        self.work.path().join("searches")
    }

    fn start(
        &self,
        req: SearchRequest,
        crap: Option<&Path>,
    ) -> (
        Result<String, String>,
        std::sync::mpsc::Receiver<SearchEvent>,
    ) {
        let (sink, rx) = channel_sink();
        (
            self.searches
                .start(&fake_prose(), &self.dir(), crap, req, sink),
            rx,
        )
    }

    fn listing(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.dir())
            .map(|d| {
                d.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
}

impl Run {
    /// As `new`, with the inputs reaching the tool as `links` says (Windows' way on any platform).
    fn with_links(links: InputLinks) -> Run {
        Run {
            work: TempDir::new("run"),
            searches: Arc::new(Searches::with_links(links)),
        }
    }
}

fn done_folder(events: &[SearchEvent]) -> PathBuf {
    match events.last() {
        Some(SearchEvent::Done(d)) => PathBuf::from(&d.folder),
        other => panic!("not done: {other:?} in {events:?}"),
    }
}

#[test]
fn a_search_ends_with_done_and_the_partial_folder_becomes_the_search_folder() {
    let run = Run::new();
    let i = inputs();
    let crap = i.dir.write("crap.fasta", ">ALBU\nMKW\n");
    let (id, rx) = run.start(request(&[&i.mzml], &i.fasta, true, json!({})), Some(&crap));
    let id = id.unwrap();
    let events = until_terminal(&rx, WAIT);
    let folder = done_folder(&events);

    assert_eq!(folder, run.dir().join(&id));
    assert_eq!(
        run.listing(),
        vec![id.clone()],
        "no .partial folder is left"
    );
    assert!(folder.join("qpx/quantms.psm.parquet").is_file());
    assert!(folder.join("summary.yaml").is_file());
    assert!(
        !folder.join(".lock").exists(),
        "the lock file does not belong to the search"
    );
    assert!(fs::read_to_string(folder.join("database.fasta"))
        .unwrap()
        .contains(">CON__ALBU"));
    // every event carries the search id; progress stays below 1 (the search is not done before `done`)
    for event in &events {
        match event {
            SearchEvent::Progress(p) => {
                assert_eq!(p.search_id, id);
                assert!(p.fraction < 1.0, "{p:?}");
            }
            SearchEvent::Done(d) => assert_eq!(d.search_id, id),
            SearchEvent::Failed(f) => panic!("{f:?}"),
        }
    }
    assert!(
        matches!(&events[0], SearchEvent::Progress(p) if p.file == -1 && p.fraction == 0.0),
        "{:?}",
        events[0]
    );
    assert!(events.iter().any(|e| matches!(e, SearchEvent::Progress(p) if p.label == "Searching a.mzML (1 of 1)..." && p.file == 0)));
    // the fake ran with exactly the arguments build_args makes for the partial folder
    let argv = fs::read_to_string(folder.join("argv.txt")).unwrap();
    let input = match InputLinks::PLATFORM {
        InputLinks::Symlinks => run.dir().join(format!("{id}.partial")).join("1__a.mzML"),
        InputLinks::PathsOrHardLinks => i.mzml.clone(),
    };
    assert!(
        argv.lines().any(|l| Path::new(l) == input),
        "{input:?} in {argv}"
    );
    // nothing was written next to the input
    let mut data: Vec<_> = fs::read_dir(i.mzml.parent().unwrap())
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    data.sort();
    assert_eq!(data, ["a.mzML", "db.fasta"]);
}

#[cfg(unix)]
#[test]
fn two_inputs_with_the_same_name_from_different_folders_are_both_searched() {
    let run = Run::new();
    let i = inputs();
    let first = i.dir.write("run1/sample.mzML", "<mzML>first</mzML>");
    let second = i.dir.write("run2/sample.mzML", "<mzML>second</mzML>");
    let (id, rx) = run.start(
        request(&[&first, &second], &i.fasta, false, json!({})),
        None,
    );
    let id = id.unwrap();
    let folder = done_folder(&until_terminal(&rx, WAIT));
    assert_eq!(folder, run.dir().join(&id));

    // the tool got two differently named files, each one a link to its own original
    let resolved = fs::read_to_string(folder.join("inputs.txt")).unwrap();
    let lines: Vec<&str> = resolved.lines().collect();
    assert_eq!(lines.len(), 2, "{resolved}");
    assert!(
        lines[0].contains("/1__sample.mzML ->")
            && lines[0].ends_with(first.canonicalize().unwrap().to_str().unwrap()),
        "{resolved}"
    );
    assert!(
        lines[1].contains("/2__sample.mzML ->")
            && lines[1].ends_with(second.canonicalize().unwrap().to_str().unwrap()),
        "{resolved}"
    );
    assert!(
        folder.join("qpx/1__sample.psm.parquet").is_file()
            && folder.join("qpx/2__sample.psm.parquet").is_file()
    );

    // links, not copies; the mapping is recorded for the results
    for (n, original) in [(1, &first), (2, &second)] {
        let link = folder.join(format!("{n}__sample.mzML"));
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "{link:?} is a link"
        );
        assert_eq!(
            fs::read_link(&link).unwrap(),
            original.canonicalize().unwrap()
        );
    }
    let mapping: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("inputs.json")).unwrap()).unwrap();
    assert_eq!(
        mapping,
        json!([
            { "id": "f0", "index": 0, "link": "1__sample.mzML", "stem": "1__sample", "name": "sample.mzML", "path": first },
            { "id": "f1", "index": 1, "link": "2__sample.mzML", "stem": "2__sample", "name": "sample.mzML", "path": second },
        ])
    );
}

#[cfg(unix)]
#[test]
fn gz_inputs_keep_their_suffix_in_the_link() {
    let run = Run::new();
    let i = inputs();
    let gz = i.dir.write("zipped/x.mzML.gz", "gz");
    let (id, rx) = run.start(request(&[&gz], &i.fasta, false, json!({})), None);
    id.unwrap();
    let folder = done_folder(&until_terminal(&rx, WAIT));
    assert!(fs::symlink_metadata(folder.join("1__x.mzML.gz"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(folder.join("qpx/1__x.psm.parquet").is_file());
    let mapping: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("inputs.json")).unwrap()).unwrap();
    assert_eq!(mapping[0]["link"], "1__x.mzML.gz");
    assert_eq!(mapping[0]["name"], "x.mzML.gz");
}

/// Windows' way (`InputLinks::PathsOrHardLinks`), run on every platform: inputs of different names go to
/// the tool by their own paths, and nothing of them is in the search folder.
#[test]
fn inputs_of_different_names_go_to_the_tool_by_their_own_paths() {
    let run = Run::with_links(InputLinks::PathsOrHardLinks);
    let i = inputs();
    let b = i.dir.write("other/b.mzML.gz", "gz");
    let (id, rx) = run.start(request(&[&i.mzml, &b], &i.fasta, false, json!({})), None);
    let id = id.unwrap();
    let folder = done_folder(&until_terminal(&rx, WAIT));
    assert_eq!(folder, run.dir().join(&id));
    let argv = fs::read_to_string(folder.join("argv.txt")).unwrap();
    let ins: Vec<&str> = argv.lines().skip(1).take(2).collect();
    assert_eq!(
        ins.iter().map(PathBuf::from).collect::<Vec<_>>(),
        [i.mzml.clone(), b.clone()],
        "{argv}"
    );
    assert!(
        folder.join("qpx/a.psm.parquet").is_file() && folder.join("qpx/b.psm.parquet").is_file()
    );
    let mapping: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("inputs.json")).unwrap()).unwrap();
    assert_eq!(
        mapping,
        json!([
            { "id": "f0", "index": 0, "link": "a.mzML", "stem": "a", "name": "a.mzML", "path": i.mzml },
            { "id": "f1", "index": 1, "link": "b.mzML.gz", "stem": "b", "name": "b.mzML.gz", "path": b },
        ])
    );
    let names: Vec<String> = fs::read_dir(&folder)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        !names
            .iter()
            .any(|n| n.ends_with(".mzML") || n.ends_with(".gz")),
        "{names:?}"
    );
}

/// Windows' way, run on every platform: two inputs of one name go to the tool as hard links in the
/// search folder, which are gone when the search is done; the user's files stay as they are.
#[test]
fn inputs_of_one_name_go_as_hard_links_that_the_finished_search_drops() {
    let run = Run::with_links(InputLinks::PathsOrHardLinks);
    let i = inputs();
    let first = i.dir.write("run1/sample.mzML", "<mzML>first</mzML>");
    let second = i.dir.write("run2/Sample.mzML", "<mzML>second</mzML>");
    let (id, rx) = run.start(
        request(&[&first, &second], &i.fasta, false, json!({})),
        None,
    );
    let id = id.unwrap();
    let folder = done_folder(&until_terminal(&rx, WAIT));
    assert_eq!(folder, run.dir().join(&id));
    let resolved = fs::read_to_string(folder.join("inputs.txt")).unwrap();
    let partial = run.dir().join(format!("{id}.partial"));
    for (n, name) in [(1, "1__sample.mzML"), (2, "2__Sample.mzML")] {
        let line = resolved.lines().nth(n - 1).unwrap_or_default();
        assert!(
            line.starts_with(&format!("{} ->", partial.join(name).display())),
            "{resolved}"
        );
        assert!(!folder.join(name).exists(), "{name} is gone");
    }
    assert!(
        folder.join("qpx/1__sample.psm.parquet").is_file()
            && folder.join("qpx/2__Sample.psm.parquet").is_file()
    );
    assert_eq!(fs::read_to_string(&first).unwrap(), "<mzML>first</mzML>");
    assert_eq!(fs::read_to_string(&second).unwrap(), "<mzML>second</mzML>");
    let mapping: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("inputs.json")).unwrap()).unwrap();
    assert_eq!(mapping[0]["link"], "1__sample.mzML");
    assert_eq!(mapping[1]["stem"], "2__Sample");
    assert_eq!(mapping[1]["path"], json!(second));
}

/// Windows' way: a hard link cannot leave its volume. Two inputs of one name, one of them on another
/// volume than the searches folder (on the CI runner: the checkout on D:, the temporary folder on C:),
/// are refused with a message that asks to rename one; nothing is copied, no folder is left.
#[test]
fn inputs_of_one_name_on_another_volume_are_refused() {
    let elsewhere =
        PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("volume-{}", std::process::id()));
    fs::create_dir_all(&elsewhere).unwrap();
    let far = elsewhere.join("sample.mzML");
    fs::write(&far, "<mzML>far</mzML>").unwrap();
    let run = Run::with_links(InputLinks::PathsOrHardLinks);
    fs::create_dir_all(run.dir()).unwrap();
    let probe = run.dir().join("probe");
    let same_volume = fs::hard_link(&far, &probe).is_ok();
    let _ = fs::remove_file(&probe);
    if same_volume {
        let _ = fs::remove_dir_all(&elsewhere);
        eprintln!(
            "skipped: {} and {} are on one volume",
            elsewhere.display(),
            run.dir().display()
        );
        return;
    }
    let i = inputs();
    let near = i.dir.write("near/sample.mzML", "<mzML>near</mzML>");
    let (result, _rx) = run.start(request(&[&near, &far], &i.fasta, false, json!({})), None);
    let err = result.unwrap_err();
    let _ = fs::remove_dir_all(&elsewhere);
    assert!(
        err.contains("Two inputs are named sample.mzML")
            && err.contains("Rename one of the files")
            && err.contains(&far.display().to_string()),
        "{err}"
    );
    assert!(
        run.listing().is_empty(),
        "no folder is left: {:?}",
        run.listing()
    );
}

#[test]
fn a_crash_becomes_search_failed_with_the_last_stage() {
    let run = Run::new();
    let i = inputs();
    let crash = i.dir.write("in/crash.mzML", "<mzML/>");
    let (id, rx) = run.start(
        request(&[&crash, &i.mzml], &i.fasta, false, json!({})),
        None,
    );
    let id = id.unwrap();
    let events = until_terminal(&rx, WAIT);
    let Some(SearchEvent::Failed(f)) = events.last() else {
        panic!("{events:?}")
    };
    assert_eq!(f.search_id, id);
    assert_eq!(
        f.stage, "Rescoring with Percolator...",
        "the last progress label"
    );
    assert_eq!(f.file, Some(0), "the input of the last report");
    assert_eq!(
        f.message,
        format!(
            "Error: Unable to read file (the input broke {})",
            crash.display()
        ),
        "the message names the user's file, not the link; noise lines are skipped"
    );
    assert!(
        run.listing().is_empty(),
        "the partial folder is removed: {:?}",
        run.listing()
    );
}

#[test]
fn a_failure_reaches_the_front_end_with_camel_case_fields() {
    let run = Run::new();
    let i = inputs();
    let crash = i.dir.write("in/crash.mzML", "<mzML/>");
    let (_, rx) = run.start(request(&[&crash], &i.fasta, false, json!({})), None);
    let events = until_terminal(&rx, WAIT);
    let Some(SearchEvent::Failed(f)) = events.last() else {
        panic!("{events:?}")
    };
    let v = serde_json::to_value(f).unwrap();
    assert_eq!(v["searchId"], f.search_id.as_str());
    assert!(v.get("stage").is_some() && v.get("message").is_some());
    assert_eq!(v["file"], 0);
    let p = serde_json::to_value(match &events[0] {
        SearchEvent::Progress(p) => p,
        e => panic!("{e:?}"),
    })
    .unwrap();
    assert!(
        p.get("searchId").is_some()
            && p.get("label").is_some()
            && p.get("file").is_some()
            && p.get("fraction").is_some()
    );
}

#[test]
fn invalid_requests_fail_before_anything_is_created() {
    let run = Run::new();
    let i = inputs();
    let (id, _rx) = run.start(
        request(&[&i.mzml], &i.fasta, false, json!({ "bogus": 1 })),
        None,
    );
    assert!(id.unwrap_err().contains("bogus"));
    let (id, _rx) = run.start(request(&[&i.mzml], &i.fasta, true, json!({})), None);
    assert!(
        id.unwrap_err().to_lowercase().contains("contaminant"),
        "no cRAP file given"
    );
    assert!(run.listing().is_empty());
}

#[test]
fn a_tool_that_cannot_start_is_an_error_and_leaves_no_folder() {
    let run = Run::new();
    let i = inputs();
    let (sink, _rx) = channel_sink();
    let err = run
        .searches
        .start(
            Path::new("/nonexistent/ProSE"),
            &run.dir(),
            None,
            request(&[&i.mzml], &i.fasta, false, json!({})),
            sink,
        )
        .unwrap_err();
    assert!(err.contains("/nonexistent/ProSE"), "{err}");
    assert!(run.listing().is_empty());
}

fn start_hanging(
    run: &Run,
    i: &Inputs,
    name: &str,
) -> (String, std::sync::mpsc::Receiver<SearchEvent>, PathBuf) {
    let hang = i.dir.write(&format!("in/{name}.mzML"), "<mzML/>");
    let (id, rx) = run.start(request(&[&hang], &i.fasta, false, json!({})), None);
    let id = id.unwrap();
    first_progress(&rx, WAIT);
    let partial = run.dir().join(format!("{id}.partial"));
    assert!(wait_for(WAIT, || partial.join("children.pid").is_file()
        && read_pids(&partial.join("children.pid")).len() == 2));
    (id, rx, partial)
}

#[test]
fn a_running_search_holds_the_lock_of_its_partial_folder_and_the_sweep_leaves_it() {
    use prose_desktop_lib::history::{sweep, SWEEP_GRACE};
    let run = Run::new();
    let i = inputs();
    let (id, _rx, partial) = start_hanging(&run, &i, "hang");
    // another app instance's startup sweep, however late: the partial folder is live
    let much_later = std::time::SystemTime::now() + SWEEP_GRACE * 1000;
    assert!(sweep(&run.dir(), much_later, SWEEP_GRACE).is_empty());
    assert!(partial.join("prose.log").exists() || partial.join("prose.pid").exists());
    // the lock is taken, by the search
    let file = fs::File::options()
        .read(true)
        .write(true)
        .open(partial.join(".lock"))
        .unwrap();
    assert!(file.try_lock().is_err(), "the search holds the lock");
    drop(file);
    // cancelled: the folder is removed, and the lock goes with it
    run.searches.cancel(&id).unwrap();
    assert!(!partial.exists());
}

#[test]
fn cancel_ends_the_process_and_its_children() {
    let run = Run::new();
    let i = inputs();
    let (id, rx, partial) = start_hanging(&run, &i, "hang");
    let tool_pid = read_pids(&partial.join("prose.pid"))[0];
    let children = read_pids(&partial.join("children.pid"));
    assert!(process_alive(tool_pid) && children.iter().all(|p| process_alive(*p)));

    let started = std::time::Instant::now();
    run.searches.cancel(&id).unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "SIGTERM was enough: {:?}",
        started.elapsed()
    );

    assert!(!process_alive(tool_pid), "the tool is gone");
    assert!(
        wait_for(Duration::from_secs(5), || children
            .iter()
            .all(|p| !process_alive(*p))),
        "its children are gone"
    );
    assert!(
        run.listing().is_empty(),
        "the partial folder is removed: {:?}",
        run.listing()
    );
    // a cancelled search sends neither done nor failed
    assert!(rx.try_iter().all(|e| matches!(e, SearchEvent::Progress(_))));
    // cancelling a finished or unknown search is not an error
    run.searches.cancel(&id).unwrap();
    run.searches.cancel("nonexistent").unwrap();
}

#[test]
fn cancel_kills_a_process_that_ignores_sigterm() {
    let run = Run::new();
    let i = inputs();
    let (id, _rx, partial) = start_hanging(&run, &i, "stubborn");
    let tool_pid = read_pids(&partial.join("prose.pid"))[0];
    let children = read_pids(&partial.join("children.pid"));
    run.searches.cancel(&id).unwrap();
    assert!(!process_alive(tool_pid));
    assert!(wait_for(Duration::from_secs(5), || children
        .iter()
        .all(|p| !process_alive(*p))));
    assert!(run.listing().is_empty());
}

#[test]
fn cancel_all_stops_every_running_search() {
    let run = Run::new();
    let i = inputs();
    let (_, _rx1, p1) = start_hanging(&run, &i, "hang");
    let (_, _rx2, p2) = start_hanging(&run, &i, "stubborn");
    let pids: Vec<u32> = [&p1, &p2]
        .iter()
        .flat_map(|p| read_pids(&p.join("prose.pid")))
        .collect();
    run.searches.cancel_all();
    assert!(pids.iter().all(|p| !process_alive(*p)));
    assert!(run.listing().is_empty());
}
