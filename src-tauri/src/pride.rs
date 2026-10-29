//! Data files of an SDRF from PRIDE: the file list of a ProteomeXchange project (PRIDE Archive API v3,
//! `projects/<PXD>/files`), and downloads into a folder the user chose, through curl: resumed where a
//! `.partial` file was left, with progress, cancellable, checked against the size PRIDE gives. One download at a
//! time (`CANCEL`).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
pub use crate::net::{allowed_url, fetch, remote_size, CANCEL};
use crate::net::len;
use std::sync::atomic::Ordering;
#[cfg(test)]
use std::time::Duration;

/// The folder the user chose in the system's dialog for downloads (`choose_download_folder`): the only one
/// `download_data_files` writes into; the page never names it.
pub static FOLDER: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// The folder of the last `choose_download_folder`; an error if none was chosen.
pub fn chosen_folder() -> Result<PathBuf, String> {
    FOLDER.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "Choose the folder for the download first.".to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RemoteFile {
    pub name: String,
    /// Bytes; 0 if unknown.
    pub size: u64,
    pub url: String,
}

pub fn valid_accession(pxd: &str) -> bool {
    (pxd.starts_with("PXD") || pxd.starts_with("MSV")) && pxd.len() >= 9 && pxd[3..].bytes().all(|b| b.is_ascii_digit())
}

/// PRIDE's FTP address as HTTPS (the same server serves both; curl resumes over HTTPS).
pub fn https_of(url: &str) -> String {
    url.strip_prefix("ftp://ftp.pride.ebi.ac.uk/")
        .map(|rest| format!("https://ftp.pride.ebi.ac.uk/{rest}"))
        .unwrap_or_else(|| url.to_string())
}

/// The files of one page of `projects/<PXD>/files` (those with an FTP or HTTP location), and how many entries
/// the page had (with those without one: the page's length decides whether another page follows).
pub fn parse_files(body: &str) -> Result<(Vec<RemoteFile>, usize), String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("PRIDE answered no JSON ({e})."))?;
    let list = v.as_array().ok_or("PRIDE answered without a file list.")?;
    let files = list
        .iter()
        .filter_map(|f| {
            let name = f["fileName"].as_str()?;
            let url = f["publicFileLocations"]
                .as_array()?
                .iter()
                .filter_map(|l| l["value"].as_str())
                .find(|u| u.starts_with("ftp://") || u.starts_with("http"))?;
            Some(RemoteFile { name: name.to_string(), size: f["fileSizeBytes"].as_u64().unwrap_or(0), url: https_of(url) })
        })
        .collect();
    Ok((files, list.len()))
}

/// Pages of `PAGE_SIZE` files read at most: 50,000 files.
const PAGE_SIZE: usize = 500;
const MAX_PAGES: usize = 100;

/// All files of the project `pxd`.
pub fn project_files(pxd: &str) -> Result<Vec<RemoteFile>, String> {
    if !valid_accession(pxd) {
        return Err(format!("{pxd} is not a ProteomeXchange accession (PXD and digits)."));
    }
    let mut all = Vec::new();
    for page in 0..MAX_PAGES {
        let url = format!("https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{pxd}/files?pageSize={PAGE_SIZE}&page={page}");
        let (files, entries) = parse_files(&crate::net::get_text(&url, 60, "PRIDE")?)?;
        all.extend(files);
        if entries < PAGE_SIZE {
            return Ok(all);
        }
    }
    Err(format!("{pxd} has more than {} files in PRIDE; ProSE reads no more of its list.", PAGE_SIZE * MAX_PAGES))
}

/// A file name to write into the chosen folder on any system: no folders, nothing hidden, no drive or stream
/// (`C:x.raw`, `a:b`), no control characters or characters Windows refuses, no name Windows reserves (`CON`,
/// `NUL.raw`, `COM1`), no trailing dot or space.
pub fn safe_name(name: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
        "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let device = name.split('.').next().unwrap_or("").trim_end().to_lowercase();
    !name.is_empty()
        && !name.starts_with('.')
        && !name.ends_with(['.', ' '])
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !name.chars().any(char::is_control)
        && !RESERVED.contains(&device.as_str())
}

#[derive(Serialize, Clone)]
pub struct Progress {
    /// The file being downloaded (0-based) and how many there are.
    pub file: usize,
    pub files: usize,
    pub name: String,
    pub received: u64,
    pub size: u64,
}

/// Downloads `files` into `folder`, skipping those that are there with their size; `progress` is called about
/// twice a second. Returns the paths written (or found).
pub fn download(folder: &Path, files: &[RemoteFile], progress: impl Fn(Progress)) -> Result<Vec<PathBuf>, String> {
    CANCEL.store(false, Ordering::SeqCst);
    let mut done = Vec::new();
    for (i, f) in files.iter().enumerate() {
        if !safe_name(&f.name) {
            return Err(format!("{} is not a file name ProSE writes.", f.name));
        }
        if !allowed_url(&f.url) {
            return Err(format!("{} has no HTTPS address ({}): the app downloads over HTTPS only.", f.name, f.url));
        }
        // the server's size: PRIDE's file list has outdated sizes for some files (its generated/ ones)
        let size = remote_size(&f.url).unwrap_or(f.size);
        let path = folder.join(&f.name);
        if size > 0 && len(&path) == size {
            done.push(path);
            continue;
        }
        let partial = folder.join(format!("{}.partial", f.name));
        fetch(&f.url, &partial, size, |received| {
            progress(Progress { file: i, files: files.len(), name: f.name.clone(), received, size })
        })
        .map_err(|e| format!("{}: {e}", f.name))?;
        std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
        done.push(path);
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_prides_file_list() {
        let body = r#"[{"fileName":"a.raw","fileSizeBytes":12,"publicFileLocations":[
            {"name":"Aspera Protocol","value":"prd_ascp@fasp.ebi.ac.uk:pride/x/a.raw"},
            {"name":"FTP Protocol","value":"ftp://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/a.raw"}]},
            {"fileName":"b.raw","publicFileLocations":[]}]"#;
        assert_eq!(
            parse_files(body).unwrap(),
            (
                vec![RemoteFile { name: "a.raw".into(), size: 12, url: "https://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/a.raw".into() }],
                // (the page had two entries: the one without a location counts for the paging)
                2
            )
        );
        assert!(valid_accession("PXD000001") && !valid_accession("PXD12;rm") && !valid_accession("PX"));
    }

    #[test]
    fn writes_only_names_safe_on_every_system_and_downloads_over_https_only() {
        for ok in ["a.raw", "A1.wiff.scan", "run 1.mzML", "console.raw"] {
            assert!(safe_name(ok), "{ok}");
        }
        for bad in ["../a", ".hidden", "a/b", "a\\b", "C:x.raw", "foo:stream", "CON", "nul.raw", "com1.txt", "a\u{7}.raw", "a.raw.", "a.raw ", "a*b", ".."] {
            assert!(!safe_name(bad), "{bad}");
        }
        assert!(allowed_url("https://ftp.pride.ebi.ac.uk/x"));
        assert!(!allowed_url("ftp://ftp.pride.ebi.ac.uk/x") && !allowed_url("http://example.org/x") && !allowed_url("file:///etc/hosts"));
        let dir = tmp("proto");
        let ftp = RemoteFile { name: "x.raw".into(), size: 5, url: "ftp://example.org/x.raw".into() };
        assert!(download(&dir, &[ftp], |_| {}).unwrap_err().contains("HTTPS"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn downloads_go_only_into_the_folder_chosen_in_the_dialog() {
        *FOLDER.lock().unwrap() = None;
        assert!(chosen_folder().unwrap_err().contains("Choose the folder"));
        *FOLDER.lock().unwrap() = Some(PathBuf::from("/chosen"));
        assert_eq!(chosen_folder().unwrap(), PathBuf::from("/chosen"));
        *FOLDER.lock().unwrap() = None;
    }

    #[test]
    fn replaces_a_final_file_of_another_size() {
        let dir = tmp("replace");
        let b = body();
        std::fs::write(dir.join("f.raw"), b"old and short").unwrap();
        let url = serve(b.clone(), true, None);
        download(&dir, &[RemoteFile { name: "f.raw".into(), size: b.len() as u64, url }], |_| {}).unwrap();
        assert_eq!(std::fs::read(dir.join("f.raw")).unwrap(), b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A one-connection-at-a-time HTTP server for `body`: honours a Range header if `ranges`, and cuts the
    /// first response off after `cut` bytes (a dropped connection). Returns its address.
    fn serve(body: Vec<u8>, ranges: bool, cut: Option<usize>) -> String {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let mut first = true;
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut from = 0usize;
                let mut head_only = false;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if line.starts_with("HEAD ") {
                        head_only = true;
                    }
                    if let Some(r) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        from = r.trim().trim_end_matches('-').parse().unwrap_or(0);
                    }
                }
                let mut out = stream;
                let part = ranges && from > 0;
                let data = if part { &body[from..] } else { &body[..] };
                let head = if part {
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\nConnection: close\r\n\r\n", data.len(), body.len() - 1, body.len())
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", data.len())
                };
                let _ = out.write_all(head.as_bytes());
                if head_only {
                    continue;
                }
                let n = match cut { Some(c) if first => c.min(data.len()), _ => data.len() };
                let _ = out.write_all(&data[..n]);
                first = false;
            }
        });
        format!("http://{addr}/f.raw")
    }

    fn body() -> Vec<u8> {
        (0..300_000u32).map(|i| (i % 251) as u8).collect()
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("prose-dl-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resumes_a_dropped_download_where_it_stopped() {
        let dir = tmp("resume");
        let b = body();
        let url = serve(b.clone(), true, Some(100_000));
        let f = RemoteFile { name: "f.raw".into(), size: b.len() as u64, url };
        assert_eq!(download(&dir, std::slice::from_ref(&f), |_| {}).unwrap(), vec![dir.join("f.raw")]);
        assert_eq!(std::fs::read(dir.join("f.raw")).unwrap(), b);
        // there with its size: not downloaded again
        assert_eq!(download(&dir, &[f], |_| {}).unwrap(), vec![dir.join("f.raw")]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_server_without_ranges_restarts_from_zero_instead_of_appending() {
        let dir = tmp("noranges");
        let b = body();
        std::fs::write(dir.join("f.raw.partial"), &b[..50_000]).unwrap();
        let url = serve(b.clone(), false, None);
        let f = RemoteFile { name: "f.raw".into(), size: b.len() as u64, url };
        download(&dir, &[f], |p| assert!(p.received <= p.size, "{} > {}", p.received, p.size)).unwrap();
        assert_eq!(std::fs::read(dir.join("f.raw")).unwrap(), b);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_partial_file_larger_than_the_file_is_thrown_away_and_the_servers_size_counts() {
        let dir = tmp("size");
        let b = body();
        let mut big = b.clone();
        big.extend_from_slice(&b[..1000]);
        std::fs::write(dir.join("f.raw.partial"), &big).unwrap();
        let url = serve(b.clone(), true, None);
        let ok = RemoteFile { name: "f.raw".into(), size: b.len() as u64, url: url.clone() };
        download(&dir, &[ok], |_| {}).unwrap();
        assert_eq!(std::fs::read(dir.join("f.raw")).unwrap(), b);
        // PRIDE lists another size than the server gives (its list is outdated for some files): the server's counts
        let outdated = RemoteFile { name: "g.raw".into(), size: b.len() as u64 + 10, url: url.clone() };
        download(&dir, &[outdated], |p| assert_eq!(p.size, b.len() as u64)).unwrap();
        assert_eq!(std::fs::read(dir.join("g.raw")).unwrap(), b);
        assert_eq!(remote_size(&url), Some(b.len() as u64));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_other_addresses() {
        let dir = tmp("refuse");
        let f = RemoteFile { name: "x.txt".into(), size: 5, url: "file:///etc/hosts".into() };
        assert!(download(&dir, &[f], |_| {}).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Against PRIDE itself (network; `cargo test -- --ignored`): PXD000001's file list, a download cancelled
    /// half-way and resumed, ending with PRIDE's size.
    #[test]
    #[ignore]
    fn live_pride_download_cancelled_and_resumed() {
        let files = project_files("PXD000001").unwrap();
        let f = files.into_iter().find(|f| f.name == "PRIDE_Exp_Complete_Ac_22134.pride.mgf.gz").unwrap();
        // (PRIDE's list says 16,448,103 bytes for this file; the server has 5,984,662)
        let size = remote_size(&f.url).unwrap();
        let dir = tmp("live");
        let watcher = {
            let partial = dir.join(format!("{}.partial", f.name));
            std::thread::spawn(move || loop {
                if len(&partial) > 2_000_000 {
                    CANCEL.store(true, Ordering::SeqCst);
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            })
        };
        let e = download(&dir, std::slice::from_ref(&f), |_| {}).unwrap_err();
        watcher.join().unwrap();
        assert!(e.contains("cancelled"), "{e}");
        let partial = len(&dir.join(format!("{}.partial", f.name)));
        assert!(partial > 0 && partial < size, "{partial}");
        download(&dir, std::slice::from_ref(&f), |p| assert!(p.received <= p.size)).unwrap();
        assert_eq!(len(&dir.join(&f.name)), size);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
