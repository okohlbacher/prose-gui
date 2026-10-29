//! Proteomes by organism name, for organisms that are not in the app's list: the name is looked up in NCBI
//! Taxonomy (E-utilities: esearch on all names, scientific and common, then esummary for the matches), and
//! UniProt is asked for the proteomes of the taxa found (reference proteomes first). Only on the user's request,
//! over HTTPS (`net`).

use crate::net;
use serde::Serialize;
use serde_json::Value;

/// A proteome UniProt has for a taxon NCBI found.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProteomeHit {
    pub upid: String,
    pub organism: String,
    pub taxid: u64,
    pub rank: String,
    pub proteins: u64,
    pub reference: bool,
    pub strain: String,
}

/// `text` for a URL query: unreserved characters as they are, everything else as %XX of its UTF-8 bytes.
pub fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The NCBI taxa of `name` (at most `max`): their id, scientific name and rank.
fn taxa(name: &str, max: usize) -> Result<Vec<(u64, String, String)>, String> {
    let base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
    let term = encode(&format!("{name}[All Names]"));
    let found: Value = serde_json::from_str(&net::get_text(&format!("{base}/esearch.fcgi?db=taxonomy&retmode=json&retmax={max}&term={term}"), 20, "NCBI Taxonomy")?)
        .map_err(|e| format!("NCBI Taxonomy answered something unexpected ({e})."))?;
    let ids: Vec<String> = found["esearchresult"]["idlist"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_string)).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let summary: Value = serde_json::from_str(&net::get_text(&format!("{base}/esummary.fcgi?db=taxonomy&retmode=json&id={}", ids.join(",")), 20, "NCBI Taxonomy")?)
        .map_err(|e| format!("NCBI Taxonomy answered something unexpected ({e})."))?;
    Ok(ids
        .iter()
        .filter_map(|id| {
            let t = &summary["result"][id];
            Some((id.parse().ok()?, t["scientificname"].as_str()?.to_string(), t["rank"].as_str().unwrap_or("").to_string()))
        })
        .collect())
}

/// The proteomes UniProt lists for `json` (a proteomes search answer), for the taxon `taxid` of `rank`.
pub fn parse_proteomes(json: &str, taxid: u64, rank: &str) -> Vec<ProteomeHit> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some(ProteomeHit {
                upid: p["id"].as_str()?.to_string(),
                organism: p["taxonomy"]["scientificName"].as_str().unwrap_or("").to_string(),
                taxid,
                rank: rank.to_string(),
                proteins: p["proteinCount"].as_u64().unwrap_or(0),
                reference: p["proteomeType"].as_str().is_some_and(|t| t.starts_with("Reference")),
                strain: p["strain"].as_str().unwrap_or("").to_string(),
            })
        })
        .filter(|h| h.upid.len() == 11 && h.upid.starts_with("UP"))
        .collect()
}

/// The proteomes of the organisms NCBI finds for `name`, reference proteomes first, at most 20.
pub fn find_proteomes(name: &str) -> Result<Vec<ProteomeHit>, String> {
    let name = name.trim();
    if name.len() < 3 || name.len() > 100 || name.chars().any(|c| c.is_control()) {
        return Err("Type at least three letters of the organism's name.".to_string());
    }
    let mut hits = Vec::new();
    for (taxid, _, rank) in taxa(name, 8)? {
        let url = format!("https://rest.uniprot.org/proteomes/search?query=organism_id:{taxid}&fields=upid,organism,organism_id,protein_count&format=json&size=5");
        hits.extend(parse_proteomes(&net::get_text(&url, 20, "UniProt")?, taxid, &rank));
    }
    hits.sort_by(|a, b| b.reference.cmp(&a.reference).then(b.proteins.cmp(&a.proteins)));
    hits.truncate(20);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_parses() {
        assert_eq!(encode("Chlamydomonas reinhardtii[All Names]"), "Chlamydomonas%20reinhardtii%5BAll%20Names%5D");
        let json = r#"{"results":[{"id":"UP000006906","taxonomy":{"scientificName":"Chlamydomonas reinhardtii","taxonId":3055},"proteomeType":"Reference proteome","strain":"CC-503","proteinCount":18840},{"id":"bad"}]}"#;
        let hits = parse_proteomes(json, 3055, "species");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].upid, "UP000006906");
        assert!(hits[0].reference);
        assert_eq!(hits[0].proteins, 18840);
    }

    /// Against the live services (on demand: `cargo test --lib taxonomy -- --ignored`).
    #[test]
    #[ignore]
    fn finds_a_non_model_organism() {
        let hits = find_proteomes("Chlamydomonas reinhardtii").unwrap();
        assert!(hits.iter().any(|h| h.upid == "UP000006906" && h.reference), "{hits:?}");
        let common = find_proteomes("baker's yeast").unwrap();
        assert!(common.iter().any(|h| h.taxid == 559292 || h.organism.contains("cerevisiae")), "{common:?}");
    }
}
