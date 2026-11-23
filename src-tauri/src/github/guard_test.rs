//! Write-guard: the only mutating GitHub calls the app may make live in `github/write.rs`
//! (workflow dispatch; create-repo in M5). These tests scan the Rust sources and the GraphQL
//! documents and fail if any other mutating request could exist.

use std::fs;
use std::path::{Path, PathBuf};

use super::graphql;

/// Pattern -> the only files (relative to src/, forward slashes) where it may appear.
const RULES: &[(&str, &[&str])] = &[
    // POST: GraphQL transport (read-only queries), OAuth device-flow handshake, write.rs.
    (".post(", &["github/graphql.rs", "auth/device_flow.rs", "github/write.rs"]),
    (".put(", &[]),
    (".patch(", &[]),
    (".delete(", &[]),
    (".request(", &[]),
    ("Method::", &[]),
    ("reqwest::get(", &[]),
    ("reqwest::blocking", &[]),
    // HTTP clients may only be built where the rules above are enforced.
    ("Client::builder", &["github/http.rs", "auth/device_flow.rs"]),
    ("Client::new", &["github/http.rs", "auth/device_flow.rs"]),
    ("ClientBuilder", &[]),
];

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Returns a list of violations instead of panicking, so it can be tested itself.
fn violations(files: &[(String, String)]) -> Vec<String> {
    let mut found = Vec::new();
    for (rel, text) in files {
        if rel == "github/guard_test.rs" {
            continue;
        }
        for (pattern, allowed) in RULES {
            if text.contains(pattern) && !allowed.contains(&rel.as_str()) {
                found.push(format!("`{pattern}` in src/{rel}"));
            }
        }
    }
    found
}

#[test]
fn no_mutating_http_calls_outside_the_allowlist() {
    let root = src_root();
    let mut paths = Vec::new();
    rust_files(&root, &mut paths);
    assert!(paths.len() > 5, "scanner found too few files; wrong root?");
    let files: Vec<(String, String)> = paths
        .iter()
        .map(|p| {
            let rel = p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
            (rel, fs::read_to_string(p).unwrap())
        })
        .collect();
    let v = violations(&files);
    assert!(v.is_empty(), "write-guard violations:\n  {}", v.join("\n  "));
}

/// Endpoints `write.rs` may target, as written in its `format!("{API}...")` strings.
const ALLOWED_WRITES: &[&str] = &[
    "/repos/{}/{}/actions/workflows/{workflow_id}/dispatches",
    "/user/repos",
];

#[test]
fn write_module_only_targets_allowed_endpoints() {
    let text = fs::read_to_string(src_root().join("github/write.rs")).unwrap();
    let urls: Vec<&str> = text
        .match_indices("\"{API}")
        .map(|(i, m)| {
            let rest = &text[i + m.len()..];
            &rest[..rest.find('"').unwrap()]
        })
        .collect();
    assert!(!urls.is_empty(), "no endpoints found in write.rs; did the URL style change?");
    for u in &urls {
        assert!(ALLOWED_WRITES.contains(u), "write.rs targets an endpoint not on the allowlist: {u}");
    }
    let posts = text.matches(".post(").count();
    assert_eq!(posts, urls.len(), "every POST in write.rs must use one of the listed endpoints");
}

#[test]
fn scanner_catches_a_stray_post() {
    let files = vec![(
        "sync/jobs/repos.rs".to_owned(),
        "client.post(\"https://api.github.com/repos/x/y/issues\")".to_owned(),
    )];
    assert_eq!(violations(&files).len(), 1);
}

#[test]
fn graphql_documents_are_queries_only() {
    let dir = src_root().join("github/queries");
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let doc = fs::read_to_string(&path).unwrap();
        assert!(!graphql::is_write_operation(&doc), "{} contains a mutation", path.display());
        assert!(doc.trim_start().starts_with("query"), "{} must start with `query`", path.display());
    }
    for q in graphql::ALL {
        assert!(!graphql::is_write_operation(q.doc), "query {} is a write operation", q.name);
    }
}

#[test]
fn mutation_detector_works() {
    assert!(graphql::is_write_operation("mutation { createIssue(input: {}) { clientMutationId } }"));
    assert!(graphql::is_write_operation("query A { x }\nmutation B { y }"));
    assert!(!graphql::is_write_operation("query { viewer { login } } # not a mutation here"));
    assert!(!graphql::is_write_operation("query { x { clientMutationId } }"));
}
