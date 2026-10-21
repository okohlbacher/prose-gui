//! History: the search folders of the app's data folder, listed, renamed, deleted, imported from a
//! project file's entries, and the sweep of what an interrupted search left.

mod common;

use common::TempDir;
use prose_desktop_lib::history::{
    delete, folder_files, frame, import, list, read_project_file, rename, save, sweep, SWEEP_GRACE,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

fn record(id: &str, name: &str) -> String {
    format!(
        r#"{{"schema":1,"id":"{id}","name":"{name}","createdAt":"2026-10-20T10:00:00.000Z","appVersion":"0.1.0","toolVersion":"3.6.0","files":["a.mzML","b.mzML"],"database":"human.fasta","psms":42,"design":{{}},"settings":{{}}}}"#
    )
}

/// A searches folder.
fn searches() -> (TempDir, PathBuf) {
    let tmp = TempDir::new("history");
    let dir = tmp.path().join("searches");
    fs::create_dir_all(&dir).unwrap();
    (tmp, dir)
}

/// A finished search folder with outputs, saved to History under `name`.
fn saved(dir: &Path, id: &str, name: &str) {
    let folder = dir.join(id);
    fs::create_dir_all(folder.join("qpx")).unwrap();
    fs::write(folder.join("qpx/1__a.psm.parquet"), b"PAR1....PAR1").unwrap();
    fs::write(folder.join("inputs.json"), "[]").unwrap();
    save(dir, id, &record(id, name), ">P1 first\nPEPTIDE\n").unwrap();
}

fn json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn history_lists_renames_and_deletes() {
    let (_tmp, dir) = searches();
    saved(&dir, "1-0", "first");
    saved(&dir, "2-0", "second");
    // the newest first; the entry says what History shows
    let entries = list(&dir);
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|e| e.error.is_none()));
    let first = entries.iter().find(|e| e.id == "1-0").unwrap();
    assert_eq!(first.name.as_deref(), Some("first"));
    assert_eq!(first.files, ["a.mzML", "b.mzML"]);
    assert_eq!(first.psms, Some(42));
    assert_eq!(first.database.as_deref(), Some("human.fasta"));
    assert!(
        first.bytes > 12,
        "the folder's size, not zero: {}",
        first.bytes
    );
    // save wrote proteins.fasta and search.json
    assert_eq!(
        fs::read_to_string(dir.join("1-0/proteins.fasta")).unwrap(),
        ">P1 first\nPEPTIDE\n"
    );

    rename(&dir, "1-0", "  renamed  ").unwrap();
    assert_eq!(json(&dir.join("1-0/search.json"))["name"], "renamed");
    // everything else of the record is kept
    assert_eq!(json(&dir.join("1-0/search.json"))["psms"], 42);
    assert!(rename(&dir, "1-0", "   ").is_err());
    assert!(rename(&dir, "1-0", "two\nlines").is_err());
    assert!(rename(&dir, "../1-0", "x").is_err());
    assert!(rename(&dir, "9-9", "x").is_err());

    delete(&dir, "1-0").unwrap();
    assert!(!dir.join("1-0").exists());
    assert_eq!(list(&dir).len(), 1);
    // a search that is gone is gone
    delete(&dir, "1-0").unwrap();
    // only ids of the searches folder
    assert!(delete(&dir, "..").is_err());
    assert!(delete(&dir, "2-0/qpx").is_err());
    assert!(dir.join("2-0/qpx").exists());
}

#[test]
fn delete_does_not_follow_a_link() {
    let (tmp, dir) = searches();
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keep"), "x").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, dir.join("3-0")).unwrap();
    assert!(delete(&dir, "3-0").is_err());
    assert!(outside.join("keep").exists());
    // a link inside a search folder is removed as a link
    saved(&dir, "4-0", "x");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, dir.join("4-0/0__input")).unwrap();
    delete(&dir, "4-0").unwrap();
    assert!(outside.join("keep").exists());
}

#[test]
fn history_lists_an_incomplete_folder_with_its_message() {
    let (_tmp, dir) = searches();
    saved(&dir, "1-0", "good");
    // a record that is not JSON, one without a schema, a newer one, one of another kind
    fs::create_dir_all(dir.join("2-0")).unwrap();
    fs::write(dir.join("2-0/search.json"), "{ not json").unwrap();
    fs::create_dir_all(dir.join("3-0")).unwrap();
    fs::write(dir.join("3-0/search.json"), r#"{"name":"x"}"#).unwrap();
    fs::create_dir_all(dir.join("4-0")).unwrap();
    fs::write(
        dir.join("4-0/search.json"),
        r#"{"schema":2,"id":"4-0","name":"future"}"#,
    )
    .unwrap();
    fs::create_dir_all(dir.join("5-0")).unwrap();
    fs::write(dir.join("5-0/search.json"), "[1,2]").unwrap();
    fs::create_dir_all(dir.join("6-0")).unwrap();
    fs::write(dir.join("6-0/search.json"), vec![0xff, 0xfe, 0x00]).unwrap();
    // search.json is a folder
    fs::create_dir_all(dir.join("7-0/search.json")).unwrap();
    // wrong types of fields do not matter
    fs::create_dir_all(dir.join("8-0")).unwrap();
    fs::write(
        dir.join("8-0/search.json"),
        r#"{"schema":1,"id":"8-0","name":5,"files":"a","psms":"many"}"#,
    )
    .unwrap();
    // not listed: no search.json (unfinished), a partial folder, a file, a name that is no id
    fs::create_dir_all(dir.join("9-0")).unwrap();
    fs::create_dir_all(dir.join("10-0.partial")).unwrap();
    fs::write(dir.join("loose.txt"), "x").unwrap();
    fs::create_dir_all(dir.join("not an id")).unwrap();
    fs::write(dir.join("not an id/search.json"), record("x", "x")).unwrap();

    let entries = list(&dir);
    let ids: Vec<&str> = entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(entries.len(), 8, "{ids:?}");
    let get = |id: &str| entries.iter().find(|e| e.id == id).unwrap();
    assert!(get("1-0").error.is_none());
    for id in ["2-0", "3-0", "5-0", "6-0", "7-0"] {
        assert!(get(id).error.is_some(), "{id} lists with an error");
    }
    assert!(get("2-0").error.as_ref().unwrap().contains("search.json"));
    let newer = get("4-0").error.as_ref().unwrap();
    assert!(
        newer.contains("newer version of ProSE") && newer.contains("schema 2"),
        "{newer}"
    );
    // the good one first, the broken ones after
    assert_eq!(entries[0].id, "1-0");
    // a record of schema 1 with odd fields still lists
    let odd = get("8-0");
    assert!(odd.error.is_none());
    assert_eq!(odd.name.as_deref(), None);
    assert!(odd.files.is_empty());
    assert_eq!(odd.psms, None);
    // a rename of a broken one is refused with the message, not a crash
    assert!(rename(&dir, "2-0", "x").is_err());
    assert!(rename(&dir, "4-0", "x").is_err());
    // a missing searches folder lists nothing
    assert!(list(&dir.join("absent")).is_empty());
}

#[test]
fn save_refuses_what_is_not_a_record() {
    let (_tmp, dir) = searches();
    fs::create_dir_all(dir.join("1-0")).unwrap();
    assert!(save(&dir, "1-0", "not json", "").is_err());
    assert!(save(&dir, "1-0", r#"{"schema":2,"id":"1-0"}"#, "").is_err());
    assert!(
        save(&dir, "1-0", &record("other", "x"), "").is_err(),
        "the id is the folder's"
    );
    assert!(
        save(&dir, "2-0", &record("2-0", "x"), "").is_err(),
        "no such folder"
    );
    assert!(save(&dir, "../x", &record("../x", "x"), "").is_err());
    assert!(
        !dir.join("1-0/search.json").exists(),
        "a refused save leaves no record"
    );
    save(&dir, "1-0", &record("1-0", "x"), ">A\nB\n").unwrap();
    // a record is written once; History's name is changed by rename
    assert!(save(&dir, "1-0", &record("1-0", "y"), "").is_err());
    assert_eq!(json(&dir.join("1-0/search.json"))["name"], "x");
    // no leftovers of the atomic write
    let mut names: Vec<String> = fs::read_dir(dir.join("1-0"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["proteins.fasta", "search.json"]);
}

#[test]
fn folder_files_lists_regular_files_only() {
    let (_tmp, dir) = searches();
    saved(&dir, "1-0", "x");
    #[cfg(unix)]
    std::os::unix::fs::symlink("/etc/hostname", dir.join("1-0/0__a.mzML")).unwrap();
    let files = folder_files(&dir, "1-0").unwrap();
    let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "inputs.json",
            "proteins.fasta",
            "qpx/1__a.psm.parquet",
            "search.json"
        ]
    );
    assert_eq!(files[2].size, 12);
    assert!(folder_files(&dir, "9-9").is_err());
    assert!(folder_files(&dir, "..").is_err());
}

/// A project's entries as the app sends them.
fn project(id: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let rec = record(id, "imported");
    let mut entries: Vec<(&str, &[u8])> = vec![("search.json", rec.as_bytes())];
    entries.extend_from_slice(extra);
    frame(&entries)
}

#[test]
fn import_writes_a_fresh_folder() {
    let (_tmp, dir) = searches();
    let body = project(
        "old-id",
        &[
            ("qpx/1__a.psm.parquet", b"PAR1"),
            ("proteins.fasta", b">P\nAA\n"),
        ],
    );
    let id = import(&dir, &body).unwrap();
    assert_ne!(id, "old-id");
    let folder = dir.join(&id);
    assert_eq!(
        fs::read(folder.join("qpx/1__a.psm.parquet")).unwrap(),
        b"PAR1"
    );
    assert_eq!(
        fs::read(folder.join("proteins.fasta")).unwrap(),
        b">P\nAA\n"
    );
    // the record belongs to the new folder
    assert_eq!(json(&folder.join("search.json"))["id"], id.as_str());
    assert_eq!(json(&folder.join("search.json"))["name"], "imported");
    assert!(!dir.join(format!("{id}.partial")).exists());
    // twice: two searches
    let again = import(&dir, &body).unwrap();
    assert_ne!(again, id);
    assert_eq!(list(&dir).len(), 2);
    assert!(list(&dir).iter().all(|e| e.error.is_none()));
}

#[test]
fn import_rechecks_every_path() {
    let (_tmp, dir) = searches();
    let bad: [&str; 11] = [
        "../escape.txt",
        "a/../../escape.txt",
        "/etc/escape.txt",
        "a//b",
        "./a",
        "a/./b",
        "a\\b",
        "C:evil",
        "trailing/",
        "",
        "with\nnewline",
    ];
    for name in bad {
        let body = project("x", &[(name, b"x")]);
        let err = import(&dir, &body).unwrap_err();
        assert!(err.contains("not a plain"), "{name:?}: {err}");
    }
    // a name used twice, a file that is also a folder
    assert!(import(&dir, &project("x", &[("a", b"1"), ("a", b"2")])).is_err());
    assert!(import(&dir, &project("x", &[("a", b"1"), ("a/b", b"2")])).is_err());
    assert!(import(&dir, &project("x", &[("a/b", b"1"), ("a", b"2")])).is_err());
    // nothing was written, in or beside the searches folder
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    assert!(!dir.parent().unwrap().join("escape.txt").exists());
}

#[test]
fn import_needs_a_record_of_this_schema() {
    let (_tmp, dir) = searches();
    // no search.json
    assert!(import(&dir, &frame(&[("qpx/a", b"x")]))
        .unwrap_err()
        .contains("search.json"));
    // not JSON, no schema
    assert!(import(&dir, &frame(&[("search.json", b"{")])).is_err());
    assert!(import(&dir, &frame(&[("search.json", b"{}")])).is_err());
    // a newer schema: refused, with a message
    let err = import(&dir, &frame(&[("search.json", br#"{"schema":2}"#)])).unwrap_err();
    assert!(
        err.contains("newer version of ProSE") && err.contains("schema 2"),
        "{err}"
    );
    // nothing is empty
    assert!(import(&dir, &[]).is_err());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
}

#[test]
fn import_refuses_a_damaged_body() {
    let (_tmp, dir) = searches();
    let good = project("x", &[("a", b"hello")]);
    for cut in [1, 5, good.len() - 1] {
        assert!(import(&dir, &good[..cut]).is_err(), "cut at {cut}");
    }
    // a length that exceeds the body
    let mut huge = Vec::new();
    huge.extend_from_slice(&11u32.to_be_bytes());
    huge.extend_from_slice(b"search.json");
    huge.extend_from_slice(&u64::MAX.to_be_bytes());
    assert!(import(&dir, &huge).is_err());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
}

#[test]
fn frames_have_a_fixed_layout() {
    // [u32 BE name length][name][u64 BE data length][data], repeated: the app's encoder makes the same bytes
    assert_eq!(
        frame(&[("ab", b"xyz")]),
        [0, 0, 0, 2, b'a', b'b', 0, 0, 0, 0, 0, 0, 0, 3, b'x', b'y', b'z']
    );
}

#[test]
fn read_project_file_serves_prose_files_only() {
    let tmp = TempDir::new("project");
    let good = tmp.write("a.prose", "zip");
    assert_eq!(read_project_file(good.to_str().unwrap()).unwrap(), b"zip");
    let upper = tmp.write("B.PROSE", "zip");
    assert!(read_project_file(upper.to_str().unwrap()).is_ok());
    let other = tmp.write("a.txt", "zip");
    assert!(read_project_file(other.to_str().unwrap())
        .unwrap_err()
        .contains(".prose"));
    assert!(read_project_file("a.prose").is_err(), "absolute paths only");
    assert!(read_project_file(tmp.path().join("absent.prose").to_str().unwrap()).is_err());
    fs::create_dir_all(tmp.path().join("dir.prose")).unwrap();
    assert!(read_project_file(tmp.path().join("dir.prose").to_str().unwrap()).is_err());
}

#[test]
fn the_sweep_removes_what_a_search_left() {
    let (_tmp, dir) = searches();
    saved(&dir, "1-0", "kept");
    // a partial folder of an interrupted search, at any age
    fs::create_dir_all(dir.join("2-0.partial/qpx")).unwrap();
    fs::write(dir.join("2-0.partial/prose.log"), "x").unwrap();
    // a finished folder that never got its record
    fs::create_dir_all(dir.join("3-0")).unwrap();
    fs::write(dir.join("3-0/summary.yaml"), "x").unwrap();
    // things that are not searches stay
    fs::write(dir.join("loose.txt"), "x").unwrap();
    fs::create_dir_all(dir.join("not an id")).unwrap();
    fs::create_dir_all(dir.join("x.partial.keep")).unwrap();

    // now: the finished folder without record is younger than the grace, and stays; the partial goes
    let removed = sweep(&dir, SystemTime::now(), SWEEP_GRACE);
    assert_eq!(removed, ["2-0.partial"]);
    assert!(dir.join("3-0").exists());
    // later than the grace
    let later = SystemTime::now() + SWEEP_GRACE + Duration::from_secs(60);
    let removed = sweep(&dir, later, SWEEP_GRACE);
    assert_eq!(removed, ["3-0"]);
    // a saved search, a loose file and odd names are never touched
    assert!(dir.join("1-0/search.json").exists());
    assert!(dir.join("loose.txt").exists());
    assert!(dir.join("not an id").exists());
    assert!(dir.join("x.partial.keep").exists());
    // a missing searches folder is fine
    assert!(sweep(&dir.join("absent"), later, SWEEP_GRACE).is_empty());
}

#[test]
fn the_sweep_spares_a_folder_that_was_just_written() {
    let (_tmp, dir) = searches();
    // a folder whose own time is old but whose log was written a moment ago (a long search that has just finished)
    fs::create_dir_all(dir.join("3-0")).unwrap();
    fs::write(dir.join("3-0/prose.log"), "x").unwrap();
    let old = SystemTime::now() - Duration::from_secs(3600);
    fs::File::open(dir.join("3-0"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    assert!(sweep(&dir, SystemTime::now(), SWEEP_GRACE).is_empty());
    // and one whose log is old too goes
    fs::File::options()
        .write(true)
        .open(dir.join("3-0/prose.log"))
        .unwrap()
        .set_modified(old)
        .unwrap();
    assert_eq!(sweep(&dir, SystemTime::now(), SWEEP_GRACE), ["3-0"]);
}

#[cfg(unix)]
#[test]
fn the_sweep_does_not_follow_links() {
    let (tmp, dir) = searches();
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keep"), "x").unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("5-0.partial")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("6-0")).unwrap();
    let later = SystemTime::now() + SWEEP_GRACE * 2;
    sweep(&dir, later, SWEEP_GRACE);
    assert!(outside.join("keep").exists());
}
