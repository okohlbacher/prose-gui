//! The app's one way to the network: curl, HTTPS only, also after a redirect (`--proto =https --proto-redir =https`).
//! Texts (PRIDE's file lists, OLS answers), sizes (a HEAD request) and files (PRIDE downloads, UniProt proteomes),
//! the files resumed from the bytes already there and checked against their size.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Set by `cancel`: the running download stops after killing curl.
pub static CANCEL: AtomicBool = AtomicBool::new(false);

/// The protocols curl may use, also after a redirect: HTTPS only (the unit tests' local server speaks HTTP).
const PROTO: &str = if cfg!(test) { "=http,https" } else { "=https" };

/// An address the app downloads from: HTTPS (PRIDE's FTP addresses are made HTTPS by `pride::https_of`).
pub fn allowed_url(url: &str) -> bool {
    url.starts_with("https://") || (cfg!(test) && url.starts_with("http://127.0.0.1:"))
}

/// curl for `url` with the protocols restricted (`PROTO`); an error for an address that is not HTTPS.
fn curl(url: &str) -> Result<Command, String> {
    if !allowed_url(url) {
        return Err(format!("{url} is no HTTPS address: the app connects over HTTPS only."));
    }
    let mut cmd = Command::new("curl");
    cmd.args(["--proto", PROTO, "--proto-redir", PROTO]);
    Ok(cmd)
}

/// The text at `url` (within `max_seconds`); `what` names the server in the error.
pub fn get_text(url: &str, max_seconds: u32, what: &str) -> Result<String, String> {
    let out = curl(url)?
        .args(["-fsSL", "--max-time", &max_seconds.to_string(), url])
        .output()
        .map_err(|e| format!("curl cannot be started ({e})."))?;
    if !out.status.success() {
        return Err(format!("{what} cannot be reached ({}).", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The size the server gives for `url` (the Content-Length of a HEAD request, after redirects); None if it says none.
pub fn remote_size(url: &str) -> Option<u64> {
    let out = curl(url).ok()?.args(["-sIL", "--connect-timeout", "30", "--max-time", "60", url]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let head = String::from_utf8_lossy(&out.stdout);
    // (the last response's: a redirect has its own)
    let last = head.rsplit("\r\n\r\n").find(|block| !block.trim().is_empty())?;
    last.lines()
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
        .filter(|&n: &u64| n > 0)
}

/// Attempts at one file; each resumes from the size the partial file actually has.
const ATTEMPTS: usize = 5;

pub fn len(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Fetches `url` into `partial` until it has `size` bytes (0: unknown size, until curl succeeds). Resumes from
/// the bytes already there with an explicit offset (never curl's --retry, whose retries resume from the offset
/// the first attempt started at and so append data twice); a server that ignores the range (curl 33), or a file
/// that grows past `size`, starts again from 0. The final size must be `size`.
pub fn fetch(url: &str, partial: &Path, size: u64, progress: impl Fn(u64)) -> Result<(), String> {
    let mut last = String::new();
    for _ in 0..ATTEMPTS {
        let mut offset = len(partial);
        if size > 0 && offset > size {
            let _ = std::fs::remove_file(partial);
            offset = 0;
        }
        if size > 0 && offset == size {
            return Ok(());
        }
        let mut cmd = curl(url)?;
        cmd.args(["-fsSL", "--connect-timeout", "30"]);
        if offset > 0 {
            cmd.args(["-C", &offset.to_string()]);
        }
        let mut child = cmd
            .arg("-o")
            .arg(partial)
            .arg(url)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("curl cannot be started ({e})."))?;
        let mut overrun = false;
        let status = loop {
            if CANCEL.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("download cancelled. Starting it again resumes it.".to_string());
            }
            let received = len(partial);
            if size > 0 && received > size {
                let _ = child.kill();
                overrun = true;
                break child.wait().map_err(|e| e.to_string())?;
            }
            progress(received);
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            std::thread::sleep(Duration::from_millis(500));
        };
        let received = len(partial);
        if overrun || (size > 0 && received > size) {
            // (more bytes than the file has: never keep them)
            let _ = std::fs::remove_file(partial);
            last = format!("the server sent more than the {size} bytes it gives as the file's size");
            continue;
        }
        if status.success() {
            if size == 0 || received == size {
                progress(received);
                return Ok(());
            }
            last = format!("{received} bytes downloaded, the server gives {size}");
            continue;
        }
        let mut err = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut s, &mut err);
        }
        last = err.trim().to_string();
        if status.code() == Some(33) || status.code() == Some(36) {
            // the server cannot resume: start again from 0
            let _ = std::fs::remove_file(partial);
        }
    }
    Err(format!("could not be downloaded ({last})."))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_leaves_the_app() {
        for url in ["http://example.org/x", "ftp://ftp.pride.ebi.ac.uk/x", "file:///etc/hosts", "scp://h/x", "-o/tmp/x"] {
            assert!(curl(url).is_err(), "{url}");
            assert!(get_text(url, 1, "x").unwrap_err().contains("HTTPS"), "{url}");
            assert_eq!(remote_size(url), None);
        }
        let args: Vec<String> = curl("https://example.org/").unwrap().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args[..4], ["--proto", PROTO, "--proto-redir", PROTO]);
        let dir = std::env::temp_dir().join(format!("prose-net-{}", std::process::id()));
        assert!(fetch("ftp://x/y", &dir.join("y.partial"), 0, |_| {}).unwrap_err().contains("HTTPS"));
    }

    /// Against the real servers (network; `cargo test -- --ignored`): OLS answers, and a UniProt stream of unknown
    /// size arrives whole.
    #[test]
    #[ignore]
    fn live_ols_and_uniprot_over_https() {
        let ols = get_text("https://www.ebi.ac.uk/ols4/api/search?q=liver&ontology=uberon&rows=1", 30, "OLS").unwrap();
        assert!(ols.contains("UBERON"));
        let dir = std::env::temp_dir().join(format!("prose-net-live-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let partial = dir.join("p.fasta.partial");
        let url = "https://rest.uniprot.org/uniprotkb/stream?compressed=false&format=fasta&query=accession%3AP02768";
        fetch(url, &partial, 0, |_| {}).unwrap();
        assert!(std::fs::read_to_string(&partial).unwrap().starts_with(">sp|P02768|ALBU_HUMAN"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
