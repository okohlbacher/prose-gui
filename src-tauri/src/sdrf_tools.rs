//! What the SDRF editor needs from outside the page: ontology terms from OLS4 (cached on disk, so a term
//! looked up once is there offline), and the validator of sdrf-pipelines (`parse_sdrf`) when it is installed.
//! Both go through programs of the system (curl, parse_sdrf), as the UniProt download does.

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Term {
    pub label: String,
    pub accession: String,
}

/// `text` for a URL query.
pub fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The terms of an OLS4 search response (`response.docs[].{label, obo_id}`).
pub fn parse_ols(body: &str) -> Result<Vec<Term>, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("OLS answered no JSON ({e})."))?;
    let docs = v["response"]["docs"].as_array().ok_or("OLS answered without terms.")?;
    let mut out: Vec<Term> = Vec::new();
    for d in docs {
        let (Some(label), Some(accession)) = (d["label"].as_str(), d["obo_id"].as_str()) else { continue };
        let term = Term { label: label.to_string(), accession: accession.to_string() };
        if !out.contains(&term) {
            out.push(term);
        }
    }
    Ok(out)
}

/// Terms of `ontologies` (OLS ids: ncbitaxon, uberon, cl, mondo, efo, ms, pride, ...) matching `query`: from the
/// cache in `cache_dir`, else, if `online`, from OLS4 (and then cached). Offline without a cached answer: an
/// error; not `online` without one: no terms (typing consults the cache only; the user asks OLS explicitly).
pub fn ols_search(cache_dir: &Path, query: &str, ontologies: &[String], online: bool) -> Result<Vec<Term>, String> {
    let query = query.trim();
    if query.len() < 2 {
        return Ok(vec![]);
    }
    let mut h = DefaultHasher::new();
    (query.to_lowercase(), ontologies).hash(&mut h);
    let cached = cache_dir.join(format!("{:016x}.json", h.finish()));
    if let Ok(body) = std::fs::read_to_string(&cached) {
        return parse_ols(&body);
    }
    if !online {
        return Ok(vec![]);
    }
    let url = format!(
        "https://www.ebi.ac.uk/ols4/api/search?q={}&ontology={}&rows=20&fieldList=label,obo_id",
        encode(query),
        encode(&ontologies.join(","))
    );
    let out = Command::new("curl")
        .args(["-fsS", "--max-time", "10", &url])
        .output()
        .map_err(|e| format!("curl cannot be started ({e})."))?;
    if !out.status.success() {
        return Err("OLS cannot be reached: offline? Type the term, or choose from the list.".to_string());
    }
    let body = String::from_utf8_lossy(&out.stdout).into_owned();
    let terms = parse_ols(&body)?;
    let _ = std::fs::create_dir_all(cache_dir).and_then(|_| std::fs::write(&cached, &body));
    Ok(terms)
}

/// `parse_sdrf` of sdrf-pipelines: on the PATH, or where pip and uv put it (an app started from the Finder does
/// not get the shell's PATH).
pub fn find_parse_sdrf() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = home {
        dirs.push(home.join(".local/bin"));
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    let name = if cfg!(windows) { "parse_sdrf.exe" } else { "parse_sdrf" };
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

#[derive(Serialize)]
pub struct Validation {
    /// parse_sdrf was found.
    pub available: bool,
    /// It found no errors.
    pub ok: bool,
    /// What it printed.
    pub output: String,
}

/// Runs `parse_sdrf validate-sdrf` on `text` (written to a file of its own in `tmp`) with `template`.
pub fn validate(tmp: &Path, text: &str, template: Option<&str>) -> Result<Validation, String> {
    let Some(tool) = find_parse_sdrf() else {
        return Ok(Validation { available: false, ok: false, output: String::new() });
    };
    std::fs::create_dir_all(tmp).map_err(|e| e.to_string())?;
    let file = tmp.join(format!("validate-{}.sdrf.tsv", std::process::id()));
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(tool);
    cmd.arg("validate-sdrf").arg("--sdrf_file").arg(&file);
    if let Some(t) = template.filter(|t| t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        cmd.args(["--template", t]);
    }
    let out = cmd.output().map_err(|e| format!("parse_sdrf cannot be started ({e})."))?;
    let _ = std::fs::remove_file(&file);
    let output = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok(Validation { available: true, ok: out.status.success(), output: output.trim().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_parses() {
        assert_eq!(encode("Homo sapiens/1"), "Homo%20sapiens%2F1");
        let body = r#"{"response":{"docs":[{"label":"liver","obo_id":"UBERON:0002107"},{"label":"liver","obo_id":"UBERON:0002107"},{"label":"x"}]}}"#;
        assert_eq!(parse_ols(body).unwrap(), vec![Term { label: "liver".into(), accession: "UBERON:0002107".into() }]);
        assert!(parse_ols("nope").is_err());
    }

    #[test]
    fn a_cached_answer_is_used_offline() {
        let dir = std::env::temp_dir().join(format!("prose-ols-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ont = vec!["uberon".to_string()];
        let mut h = DefaultHasher::new();
        ("liver".to_string(), &ont).hash(&mut h);
        std::fs::write(dir.join(format!("{:016x}.json", h.finish())), r#"{"response":{"docs":[{"label":"liver","obo_id":"UBERON:0002107"}]}}"#).unwrap();
        assert_eq!(ols_search(&dir, " Liver ", &ont, false).unwrap()[0].accession, "UBERON:0002107");
        // not cached and not online: no terms, and no request
        assert_eq!(ols_search(&dir, "kidney", &ont, false).unwrap(), vec![]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
