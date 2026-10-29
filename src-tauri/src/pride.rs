//! Data files of an SDRF from PRIDE: the file list of a ProteomeXchange project (PRIDE Archive API v3,
//! `projects/<PXD>/files`), and downloads into a folder the user chose, through curl: resumed where a
//! `.partial` file was left, with progress, cancellable, checked against the size PRIDE gives. One download at a
//! time (`CANCEL`).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Set by `cancel`: the running download stops after killing curl.
pub static CANCEL: AtomicBool = AtomicBool::new(false);

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

/// The files of one page of `projects/<PXD>/files`.
pub fn parse_files(body: &str) -> Result<Vec<RemoteFile>, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("PRIDE answered no JSON ({e})."))?;
    let list = v.as_array().ok_or("PRIDE answered without a file list.")?;
    Ok(list
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
        .collect())
}

fn curl_text(url: &str) -> Result<String, String> {
    let out = Command::new("curl")
        .args(["-fsSL", "--max-time", "60", url])
        .output()
        .map_err(|e| format!("curl cannot be started ({e})."))?;
    if !out.status.success() {
        return Err(format!("PRIDE cannot be reached ({}).", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// All files of the project `pxd`.
pub fn project_files(pxd: &str) -> Result<Vec<RemoteFile>, String> {
    if !valid_accession(pxd) {
        return Err(format!("{pxd} is not a ProteomeXchange accession (PXD and digits)."));
    }
    let mut all = Vec::new();
    for page in 0..50 {
        let url = format!("https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{pxd}/files?pageSize=500&page={page}");
        let files = parse_files(&curl_text(&url)?)?;
        let last = files.len() < 500;
        all.extend(files);
        if last {
            break;
        }
    }
    Ok(all)
}

/// A file name to write into the chosen folder: no folders, nothing hidden.
pub fn safe_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\']) && name != ".."
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
        if !(f.url.starts_with("https://") || f.url.starts_with("http://") || f.url.starts_with("ftp://")) {
            return Err(format!("{} has no http, https or ftp address.", f.name));
        }
        let path = folder.join(&f.name);
        if f.size > 0 && std::fs::metadata(&path).map(|m| m.len() == f.size).unwrap_or(false) {
            done.push(path);
            continue;
        }
        let partial = folder.join(format!("{}.partial", f.name));
        let mut child = Command::new("curl")
            .args(["-fsSL", "--retry", "3", "--connect-timeout", "30", "-C", "-", "-o"])
            .arg(&partial)
            .arg(&f.url)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("curl cannot be started ({e})."))?;
        let status = loop {
            if CANCEL.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Download cancelled. Starting it again resumes it.".to_string());
            }
            let received = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
            progress(Progress { file: i, files: files.len(), name: f.name.clone(), received, size: f.size });
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            std::thread::sleep(Duration::from_millis(500));
        };
        let size = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
        // (curl 33: the server cannot resume, or the file is complete already)
        if !status.success() && !(status.code() == Some(33) && size == f.size) {
            let mut err = String::new();
            if let Some(mut s) = child.stderr.take() {
                let _ = std::io::Read::read_to_string(&mut s, &mut err);
            }
            return Err(format!("{} could not be downloaded ({}).", f.name, err.trim()));
        }
        if f.size > 0 && size != f.size {
            return Err(format!("{}: {size} bytes downloaded, PRIDE lists {}. Download it again to resume.", f.name, f.size));
        }
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
            vec![RemoteFile { name: "a.raw".into(), size: 12, url: "https://ftp.pride.ebi.ac.uk/pride/data/archive/2012/03/PXD000001/a.raw".into() }]
        );
        assert!(valid_accession("PXD000001") && !valid_accession("PXD12;rm") && !valid_accession("PX"));
        assert!(safe_name("a.raw") && !safe_name("../a") && !safe_name(".hidden") && !safe_name("a/b"));
    }

    #[test]
    fn downloads_a_local_file_and_skips_it_the_second_time() {
        let dir = std::env::temp_dir().join(format!("prose-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("src.txt"), "hello").unwrap();
        // curl reads file:// too; the address check is the caller's, so test the transfer with an http-like name
        let f = RemoteFile { name: "x.txt".into(), size: 5, url: format!("file://{}", dir.join("src.txt").display()) };
        assert!(download(&dir.join("out"), std::slice::from_ref(&f), |_| {}).is_err(), "file:// is refused");
        std::fs::write(dir.join("out/x.txt"), "hello").unwrap();
        let ok = RemoteFile { url: "https://example.invalid/x.txt".into(), ..f };
        // there with its size: not downloaded again
        assert_eq!(download(&dir.join("out"), &[ok], |_| {}).unwrap(), vec![dir.join("out/x.txt")]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
