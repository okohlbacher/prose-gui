//! Where the data files an SDRF names are: beside the SDRF (its relative path), else anywhere below a folder
//! the user chose (by name, any case). A vendor file may have been converted, so the same stem as `.mzML` or
//! `.mzML.gz` counts too; a Bruker `.d` is a folder. The walk skips hidden folders and stops at a depth and
//! a number of entries.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const MAX_DEPTH: usize = 8;
pub const MAX_ENTRIES: usize = 200_000;

/// What was found for one name: the file itself, and an mzML of the same stem.
#[derive(Serialize, Default, Clone, Debug, PartialEq)]
pub struct Located {
    pub exact: Option<String>,
    pub mzml: Option<String>,
}

/// The extensions of mass spectrometry data files that a data file's stem leaves out (one, after a `.gz`).
const STEM_EXTENSIONS: [&str; 8] = ["mzml", "mzxml", "mzpeak", "mgf", "raw", "d", "wiff", "wiff2"];

/// A data file's stem, in lower case: no folders, no `.gz`, no mass spectrometry extension (`A1.wiff` and
/// `a1.mzML.gz` are `a1`). The same rule as `runStem` in src/lib/design/sdrf-table.ts; both are tested on
/// src/lib/design/sdrf-fixtures/stems.json.
pub fn data_file_stem(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).to_lowercase();
    let base = base.strip_suffix(".gz").unwrap_or(&base).to_string();
    match base.rfind('.') {
        Some(i) if i > 0 && STEM_EXTENSIONS.contains(&&base[i + 1..]) => base[..i].to_string(),
        _ => base,
    }
}

/// The stem with its case, for the names of the converted files looked for (`A1.wiff` -> `A1`).
fn stem(name: &str) -> &str {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let n = data_file_stem(base).len();
    &base[..n]
}

fn exists(p: &Path) -> bool {
    p.is_file() || p.is_dir()
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// For each of `names` (as written in comment[data file], maybe with folders): its path relative to `base`
/// (the SDRF's folder), then a search below `folder`.
pub fn locate(base: &Path, names: &[String], folder: Option<&Path>) -> Vec<Located> {
    let mut out: Vec<Located> = names
        .iter()
        .map(|n| {
            let s = stem(n);
            let dir = base.join(n).parent().map(Path::to_path_buf).unwrap_or_else(|| base.to_path_buf());
            Located {
                exact: Some(base.join(n)).filter(|p| exists(p)).map(|p| text(&p)),
                mzml: [format!("{s}.mzML"), format!("{s}.mzML.gz")]
                    .iter()
                    .map(|m| dir.join(m))
                    .find(|p| p.is_file())
                    .map(|p| text(&p)),
            }
        })
        .collect();
    let Some(folder) = folder else { return out };
    if out.iter().all(|l| l.exact.is_some()) {
        return out;
    }

    // lower-case file name -> (index, exact?) for what is still missing
    let mut wanted: HashMap<String, Vec<(usize, bool)>> = HashMap::new();
    for (i, (n, l)) in names.iter().zip(&out).enumerate() {
        let base = n.rsplit(['/', '\\']).next().unwrap_or(n).to_lowercase();
        let s = stem(n).to_lowercase();
        if l.exact.is_none() {
            wanted.entry(base).or_default().push((i, true));
        }
        if l.mzml.is_none() {
            for m in [format!("{s}.mzml"), format!("{s}.mzml.gz")] {
                wanted.entry(m).or_default().push((i, false));
            }
        }
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(folder.to_path_buf(), 0)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                return out;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if let Some(hits) = wanted.get(&name.to_lowercase()) {
                for &(i, exact) in hits {
                    let slot = if exact { &mut out[i].exact } else { &mut out[i].mzml };
                    // (a .d is a folder; an mzML is a file)
                    if slot.is_none() && (exact || !is_dir) {
                        *slot = Some(text(&path));
                    }
                }
            }
            // a Bruker .d is a match, not a folder to walk into
            if is_dir && depth < MAX_DEPTH && !name.to_lowercase().ends_with(".d") {
                stack.push((path, depth + 1));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stem_rule_is_the_front_ends() {
        let table: Vec<(String, String)> =
            serde_json::from_str(include_str!("../../src/lib/design/sdrf-fixtures/stems.json")).unwrap();
        for (name, expected) in table {
            assert_eq!(data_file_stem(&name), expected, "{name}");
        }
        assert_eq!(stem("A1.WIFF"), "A1");
    }

    #[test]
    fn finds_beside_the_sdrf_then_below_a_folder() {
        let root = std::env::temp_dir().join(format!("prose-locate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sdrf/raw")).unwrap();
        std::fs::create_dir_all(root.join("data/deep/B1.d")).unwrap();
        std::fs::create_dir_all(root.join("data/.hidden")).unwrap();
        std::fs::write(root.join("sdrf/raw/a.mzML"), "").unwrap();
        std::fs::write(root.join("data/deep/C1.mzML.gz"), "").unwrap();
        std::fs::write(root.join("data/.hidden/D1.mzML"), "").unwrap();
        let names: Vec<String> = ["raw/a.mzML", "b1.d", "C1.raw", "D1.mzML"].iter().map(|s| s.to_string()).collect();

        let near = locate(&root.join("sdrf"), &names, None);
        assert!(near[0].exact.as_deref().unwrap().ends_with("raw/a.mzML"));
        assert_eq!(near[0].mzml, near[0].exact);
        assert_eq!(near[1], Located::default());

        let found = locate(&root.join("sdrf"), &names, Some(&root.join("data")));
        assert!(found[1].exact.as_deref().unwrap().ends_with("B1.d"));
        assert_eq!(found[2].exact, None);
        assert!(found[2].mzml.as_deref().unwrap().ends_with("C1.mzML.gz"));
        assert_eq!(found[3], Located::default());
        let _ = std::fs::remove_dir_all(&root);
    }
}
