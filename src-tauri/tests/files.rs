//! The front end's access to files: the search folder's files (scoped), what the New search page shows
//! of an input (counts, never contents), and the bundled example.

mod common;

use common::TempDir;
use prose_desktop_lib::files::{
    example_files, inspect, parse_database_file, read_search_file, ReadError,
};
use std::fs;
use std::path::Path;

#[cfg(unix)]
fn link(original: &Path, link: &Path) {
    std::os::unix::fs::symlink(original, link).unwrap();
}

/// A searches folder with one finished search `1-0` (a summary naming `database`) and a user folder
/// beside it with an input and the database.
fn search_with(database: &str) -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new("files");
    let searches = tmp.path().join("searches");
    let folder = searches.join("1-0");
    fs::create_dir_all(folder.join("qpx")).unwrap();
    fs::write(folder.join("inputs.json"), "[]").unwrap();
    fs::write(folder.join("qpx/1__a.psm.parquet"), b"PAR1....PAR1").unwrap();
    let yaml = format!(
        "shared:\n  database_file: \"{}\"\n  enzyme: \"Trypsin\"\nper_file:\n",
        database.replace('\\', "\\\\").replace('"', "\\\"")
    );
    fs::write(folder.join("summary.yaml"), yaml).unwrap();
    tmp.write("user/a.mzML", "<mzML/>");
    (tmp, searches)
}

fn not_found(result: Result<Vec<u8>, ReadError>) -> bool {
    matches!(
        result,
        Err(ReadError {
            not_found: true,
            ..
        })
    )
}

fn refused(result: Result<Vec<u8>, ReadError>) -> bool {
    matches!(
        result,
        Err(ReadError {
            not_found: false,
            ..
        })
    )
}

#[test]
fn a_file_of_the_search_folder_is_served() {
    let (_tmp, searches) = search_with("/nowhere/db.fasta");
    assert_eq!(
        read_search_file(&searches, "1-0", "inputs.json").unwrap(),
        b"[]"
    );
    assert_eq!(
        read_search_file(&searches, "1-0", "qpx/1__a.psm.parquet").unwrap(),
        b"PAR1....PAR1"
    );
}

#[test]
fn a_missing_file_rejects_with_not_found_and_a_message() {
    let (_tmp, searches) = search_with("/nowhere/db.fasta");
    let error = read_search_file(&searches, "1-0", "oms/merged.pg.parquet").unwrap_err();
    assert!(error.not_found);
    assert!(
        error.message.contains("oms/merged.pg.parquet"),
        "{}",
        error.message
    );
    // serialised for the front end as { notFound, message }
    let json = serde_json::to_value(&error).unwrap();
    assert_eq!(json["notFound"], true);
    assert!(json["message"].is_string());
    // a search that does not exist: its files do not exist either
    assert!(not_found(read_search_file(&searches, "9-9", "inputs.json")));
}

#[test]
fn names_that_leave_the_folder_are_refused() {
    let (tmp, searches) = search_with("/nowhere/db.fasta");
    tmp.write("searches/secret.txt", "secret");
    for name in [
        "../secret.txt",
        "qpx/../../secret.txt",
        "./inputs.json",
        "qpx/./1__a.psm.parquet",
        "",
        "qpx",
        "/etc/passwd",
    ] {
        assert!(
            refused(read_search_file(&searches, "1-0", name)),
            "{name:?} was not refused"
        );
    }
}

/// On Windows a search's inputs of one name are hard links in the folder while ProSE runs (removed
/// when it ends): regular files inside the folder, which are still the user's and never served.
#[test]
fn the_inputs_hard_links_are_not_served() {
    let (tmp, searches) = search_with("/nowhere/db.fasta");
    fs::hard_link(
        tmp.path().join("user/a.mzML"),
        searches.join("1-0/1__a.mzML"),
    )
    .unwrap();
    assert!(refused(read_search_file(&searches, "1-0", "1__a.mzML")));
    let err = read_search_file(&searches, "1-0", "1__a.mzML").unwrap_err();
    assert!(err.message.contains("input"), "{}", err.message);
}

#[test]
fn search_ids_that_are_paths_are_refused() {
    let (tmp, searches) = search_with("/nowhere/db.fasta");
    tmp.write("secret/inputs.json", "secret");
    for id in [
        "",
        "..",
        "../secret",
        "1-0/qpx",
        "/tmp",
        "1-0.partial",
        "a b",
    ] {
        assert!(
            refused(read_search_file(&searches, id, "inputs.json")),
            "{id:?} was not refused"
        );
    }
}

#[cfg(unix)]
#[test]
fn the_input_links_and_other_symlinks_cannot_lead_out_of_the_folder() {
    let (tmp, searches) = search_with("/nowhere/db.fasta");
    let folder = searches.join("1-0");
    // the shim's input link, to the user's file
    link(&tmp.path().join("user/a.mzML"), &folder.join("1__a.mzML"));
    assert!(refused(read_search_file(&searches, "1-0", "1__a.mzML")));
    // a link to a folder outside, and a file through it
    link(&tmp.path().join("user"), &folder.join("out"));
    assert!(refused(read_search_file(&searches, "1-0", "out/a.mzML")));
    // a link inside the folder to a file inside is fine
    link(&folder.join("inputs.json"), &folder.join("again.json"));
    assert_eq!(
        read_search_file(&searches, "1-0", "again.json").unwrap(),
        b"[]"
    );
}

/// One rule for a search folder that is a link, in the reader and in History: refused (a link in the
/// searches folder could lead anywhere).
#[cfg(unix)]
#[test]
fn a_search_folder_that_is_a_link_is_refused_by_the_reader_and_by_history() {
    use prose_desktop_lib::history;
    let (tmp, searches) = search_with("/nowhere/db.fasta");
    let folder = searches.join("1-0");
    fs::write(
        folder.join("search.json"),
        r#"{"schema":1,"id":"1-0","name":"x"}"#,
    )
    .unwrap();
    let elsewhere = tmp.path().join("elsewhere");
    fs::rename(&folder, &elsewhere).unwrap();
    link(&elsewhere, &folder);
    for name in ["inputs.json", "search.json", "qpx/1__a.psm.parquet"] {
        let result = read_search_file(&searches, "1-0", name);
        assert!(refused(result.clone()), "{name}: {result:?}");
        assert!(result.unwrap_err().message.contains("not a folder"));
    }
    assert!(history::rename(&searches, "1-0", "y").is_err());
    assert!(history::folder_files(&searches, "1-0").is_err());
    assert!(
        history::save_record(&searches, "1-0", r#"{"schema":1,"id":"1-0","name":"x"}"#).is_err()
    );
    assert!(history::save_proteins(&searches, "1-0", ">A\nB\n").is_err());
    assert!(history::delete(&searches, "1-0").is_err());
    // the list leaves it out, and nothing behind the link was touched
    assert!(history::list(&searches).is_empty());
    assert!(elsewhere.join("inputs.json").exists());
    assert!(!elsewhere.join("proteins.fasta").exists());
    // the same folder, not a link, is served
    fs::remove_file(&folder).unwrap();
    fs::rename(&elsewhere, &folder).unwrap();
    assert_eq!(
        read_search_file(&searches, "1-0", "inputs.json").unwrap(),
        b"[]"
    );
}

#[test]
fn the_database_that_summary_yaml_records_is_served_and_no_other_absolute_path() {
    let tmp0 = TempDir::new("db");
    // (a name with quotes for ProSE's quoted YAML; Windows allows no '"' in names, its paths have '\')
    let name = if cfg!(windows) {
        "my folder/it's db.fasta"
    } else {
        "my folder/\"quoted\" db.fasta"
    };
    let db = tmp0.write(name, ">P1\nPEPTIDE\n");
    let other = tmp0.write("other.fasta", ">P2\nPEPTIDE\n");
    let (_tmp, searches) = search_with(db.to_str().unwrap());
    assert_eq!(
        read_search_file(&searches, "1-0", db.to_str().unwrap()).unwrap(),
        b">P1\nPEPTIDE\n"
    );
    assert!(refused(read_search_file(
        &searches,
        "1-0",
        other.to_str().unwrap()
    )));
    // the recorded database gone (moved): not found, so the reader goes on without it
    fs::remove_file(&db).unwrap();
    assert!(not_found(read_search_file(
        &searches,
        "1-0",
        db.to_str().unwrap()
    )));
}

#[test]
fn an_imported_search_never_reads_the_database_path_of_its_summary() {
    let tmp0 = TempDir::new("db");
    let db = tmp0.write("db.fasta", ">P1\nPEPTIDE\n");
    let name = db.to_str().unwrap();
    let (_tmp, searches) = search_with(name);
    let record = searches.join("1-0/search.json");
    // a search of this app (a record without the mark, or none yet): served
    assert!(read_search_file(&searches, "1-0", name).is_ok());
    fs::write(&record, r#"{"schema":1,"id":"1-0"}"#).unwrap();
    assert!(read_search_file(&searches, "1-0", name).is_ok());
    fs::write(&record, r#"{"schema":1,"id":"1-0","imported":false}"#).unwrap();
    assert!(read_search_file(&searches, "1-0", name).is_ok());
    // an imported one: refused, with a message that is no not-found (the reader goes on to its own files)
    fs::write(&record, r#"{"schema":1,"id":"1-0","imported":true}"#).unwrap();
    let err = read_search_file(&searches, "1-0", name).unwrap_err();
    assert!(
        !err.not_found && err.message.contains("imported"),
        "{err:?}"
    );
    // its own files are served as before
    assert!(read_search_file(&searches, "1-0", "qpx/1__a.psm.parquet").is_ok());
    // a record that cannot be read is not trusted either
    fs::write(&record, "{ broken").unwrap();
    assert!(refused(read_search_file(&searches, "1-0", name)));
    fs::remove_file(&record).unwrap();
    fs::create_dir(&record).unwrap();
    assert!(refused(read_search_file(&searches, "1-0", name)));
}

#[test]
fn a_recorded_database_that_is_not_a_fasta_file_is_not_served() {
    let tmp0 = TempDir::new("db");
    let secret = tmp0.write("notes.txt", "secret");
    let (_tmp, searches) = search_with(secret.to_str().unwrap());
    assert!(refused(read_search_file(
        &searches,
        "1-0",
        secret.to_str().unwrap()
    )));
}

#[test]
fn the_database_path_is_read_from_proses_quoted_yaml() {
    assert_eq!(
        parse_database_file("shared:\n  database_file: \"/a/b c.fasta\"\n").as_deref(),
        Some("/a/b c.fasta")
    );
    assert_eq!(
        parse_database_file("shared:\n  database_file: \"/a/\\\"q\\\"\\\\x\\x41.fasta\"\n")
            .as_deref(),
        Some("/a/\"q\"\\xA.fasta")
    );
    assert_eq!(
        parse_database_file("shared:\n  database_file: \"/ä/ö.fasta\"\n").as_deref(),
        Some("/ä/ö.fasta")
    );
    // only shared's key, not one of another section
    assert_eq!(
        parse_database_file("per_file:\n  database_file: \"/x.fasta\"\nshared:\n  enzyme: \"T\"\n"),
        None
    );
    assert_eq!(parse_database_file("shared:\n"), None);
}

#[test]
fn an_mzml_shows_its_size_and_spectrum_count() {
    let tmp = TempDir::new("inspect");
    let mzml = tmp.write(
        "run 1.mzML",
        "<?xml?>\n<mzML><run><spectrumList count=\"2789\" defaultDataProcessingRef=\"x\">",
    );
    let facts = inspect(mzml.to_str().unwrap());
    assert_eq!(facts.name, "run 1.mzML");
    assert_eq!(facts.size, fs::metadata(&mzml).unwrap().len());
    assert_eq!(facts.spectra, Some(2789));
    assert_eq!(facts.proteins, None);
    assert_eq!(facts.error, None);
    // compressed: the count is not known without decompressing
    let gz = tmp.write("run.mzML.gz", "\u{1f}\u{8b}not really");
    let facts = inspect(gz.to_str().unwrap());
    assert_eq!(facts.spectra, None);
    assert_eq!(facts.error, None);
}

#[test]
fn a_fasta_shows_its_proteins_and_residues() {
    let tmp = TempDir::new("inspect");
    let fasta = tmp.write("db.fasta", ">sp|P1|A desc\nPEPTIDE\nKR\r\n>sp|P2|B\nAC*\n");
    let facts = inspect(fasta.to_str().unwrap());
    assert_eq!(facts.proteins, Some(2));
    assert_eq!(facts.residues, Some(11));
    assert_eq!(facts.spectra, None);
}

#[test]
fn what_is_not_an_absolute_existing_file_has_an_error() {
    let tmp = TempDir::new("inspect");
    for path in [
        "relative.mzML".to_string(),
        tmp.path()
            .join("missing.mzML")
            .to_string_lossy()
            .into_owned(),
        tmp.path().to_string_lossy().into_owned(),
    ] {
        let facts = inspect(&path);
        assert!(facts.error.is_some(), "{path}: no error");
        assert_eq!(facts.spectra, None);
    }
}

#[test]
fn the_example_is_two_named_links_to_the_bundled_run_and_its_fasta() {
    let source = TempDir::new("example-src");
    source.write("DatabaseSuitability_in_spec.mzML", "<mzML/>");
    source.write("DatabaseSuitability_database.fasta", ">P\nK\n");
    let data = TempDir::new("example-data");
    let example = example_files(source.path(), data.path()).unwrap();
    let names: Vec<_> = example
        .spectra
        .iter()
        .map(|p| {
            Path::new(p)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(
        names,
        ["DatabaseSuitability_1.mzML", "DatabaseSuitability_2.mzML"]
    );
    for p in &example.spectra {
        assert!(Path::new(p).is_absolute());
        assert_eq!(fs::read_to_string(p).unwrap(), "<mzML/>");
    }
    assert_eq!(
        Path::new(&example.database).file_name().unwrap(),
        "DatabaseSuitability_database.fasta"
    );
    // again (the links exist): the same answer
    let again = example_files(source.path(), data.path()).unwrap();
    assert_eq!(again.spectra, example.spectra);
    // no bundled example: an error, nothing made
    let empty = TempDir::new("example-none");
    assert!(example_files(empty.path(), data.path()).is_err());
}

#[test]
fn the_bundled_crap_has_the_counts_new_search_shows() {
    // CRAP_PROTEINS and CRAP_RESIDUES of src/lib/search/form.svelte.ts
    let crap = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fasta/crap.fasta");
    let facts = inspect(crap.to_str().unwrap());
    assert_eq!(facts.proteins, Some(116));
    assert_eq!(facts.residues, Some(38459));
}

#[test]
fn the_bundled_example_is_the_web_apps() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/example");
    let run = inspect(
        example
            .join("DatabaseSuitability_in_spec.mzML")
            .to_str()
            .unwrap(),
    );
    assert_eq!(run.spectra, Some(2789));
    let fasta = inspect(
        example
            .join("DatabaseSuitability_database.fasta")
            .to_str()
            .unwrap(),
    );
    assert_eq!(fasta.proteins, Some(49));
}

#[test]
fn only_spectrum_and_fasta_files_are_inspected() {
    let tmp = TempDir::new("inspect");
    let secret = tmp.write("id_rsa", "-----BEGIN PRIVATE KEY-----");
    let notes = tmp.write("notes.txt", "secret");
    for path in [&secret, &notes] {
        let facts = inspect(path.to_str().unwrap());
        assert!(facts.error.is_some(), "{} was inspected", path.display());
        // nothing about the file: not its size
        assert_eq!(facts.size, 0);
    }
    // a missing file of another kind says nothing about its existence either
    let missing = inspect(tmp.path().join("missing.key").to_str().unwrap());
    let other = inspect(secret.to_str().unwrap());
    assert_eq!(
        missing.error.unwrap().replace("missing.key", "X"),
        other.error.unwrap().replace("id_rsa", "X")
    );
}
