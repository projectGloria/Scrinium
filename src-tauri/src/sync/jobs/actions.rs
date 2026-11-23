//! GitHub Actions: workflow list (REST, ETag), dispatch inputs (parsed from the workflow
//! files, one GraphQL request) and recent runs (REST, ETag).

use std::collections::HashMap;

use yaml_rust2::{Yaml, YamlLoader};

use crate::db::actions::{self as store, Actions, DispatchInput, Run, Workflow};
use crate::db::{self, content, repos, state, Db};
use crate::error::Result;
use crate::github::model::parse_timestamp;
use crate::github::{Cached, ReadApi};

/// Rapid refreshes (e.g. polling after a dispatch) reuse the cache within this window.
const TTL: i64 = 4;

pub async fn refresh(db: &Db, gh: &ReadApi, repo_id: i64) -> Result<Actions> {
    let loc = repos::locate(&db.read(), repo_id)?;
    let key = store::state_key(repo_id);
    let last = state::sync_state(&db.read(), &key)?.last_success_at;
    if last.is_some_and(|t| db::now() - t < TTL) {
        return store::get(&db.read(), repo_id);
    }
    // ETags are only valid while we hold what they describe.
    let have = last.is_some();

    let wf_url = ReadApi::workflows_path(&loc.owner, &loc.name);
    let wf_etag = etag_for(db, &wf_url, have)?;
    if let Cached::Fresh { etag, value } = gh.workflows(&loc.owner, &loc.name, wf_etag.as_deref()).await? {
        let files = gh.workflow_files(&loc.owner, &loc.name).await?;
        let mut info: HashMap<String, (bool, Vec<DispatchInput>)> = HashMap::new();
        for e in files.map(|t| t.entries).unwrap_or_default() {
            let path = e.path.unwrap_or(e.name);
            if let Some(text) = e.object.and_then(|o| o.text) {
                info.insert(path, parse_dispatch(&text));
            }
        }
        let rows: Vec<Workflow> = value
            .workflows
            .into_iter()
            .map(|w| {
                let (dispatchable, inputs) = info.remove(&w.path).unwrap_or_default();
                Workflow {
                    id: w.id,
                    name: w.name,
                    path: w.path,
                    state: w.state,
                    dispatchable,
                    inputs,
                    html_url: w.html_url,
                }
            })
            .collect();
        let mut w = db.write();
        store::set_workflows(&mut w, repo_id, &rows)?;
        content::set_cache_entry(&w, &wf_url, etag.as_deref(), None, db::now())?;
    }

    let runs_url = ReadApi::runs_path(&loc.owner, &loc.name);
    let runs_etag = etag_for(db, &runs_url, have)?;
    if let Cached::Fresh { etag, value } = gh.runs(&loc.owner, &loc.name, runs_etag.as_deref()).await? {
        let runs: Vec<Run> = value
            .workflow_runs
            .into_iter()
            .map(|r| Run {
                id: r.id,
                workflow_id: r.workflow_id,
                name: r.name,
                title: r.display_title,
                run_number: r.run_number,
                event: r.event,
                status: r.status,
                conclusion: r.conclusion,
                head_branch: r.head_branch,
                actor: r.actor.map(|a| a.login),
                html_url: r.html_url,
                created_at: parse_timestamp(&r.created_at).unwrap_or(0),
                updated_at: parse_timestamp(&r.updated_at).unwrap_or(0),
            })
            .collect();
        let mut w = db.write();
        store::set_runs(&mut w, repo_id, &runs)?;
        content::set_cache_entry(&w, &runs_url, etag.as_deref(), None, db::now())?;
    }

    state::sync_success(&db.write(), &key, db::now())?;
    store::get(&db.read(), repo_id)
}

fn etag_for(db: &Db, url: &str, have: bool) -> Result<Option<String>> {
    if !have {
        return Ok(None);
    }
    Ok(content::cache_entry(&db.read(), url)?.and_then(|e| e.etag))
}

/// Whether a workflow file has an `on: workflow_dispatch` trigger, and its inputs.
pub fn parse_dispatch(text: &str) -> (bool, Vec<DispatchInput>) {
    let Ok(docs) = YamlLoader::load_from_str(text) else { return (false, Vec::new()) };
    let Some(Yaml::Hash(root)) = docs.into_iter().next() else { return (false, Vec::new()) };
    // YAML 1.1 parsers read a bare `on` as `true`; accept both spellings.
    let on = root.get(&Yaml::String("on".into())).or_else(|| root.get(&Yaml::Boolean(true)));
    let wd = Yaml::String("workflow_dispatch".into());
    match on {
        Some(Yaml::String(s)) => (s == "workflow_dispatch", Vec::new()),
        Some(Yaml::Array(a)) => (a.contains(&wd), Vec::new()),
        Some(Yaml::Hash(h)) => match h.get(&wd) {
            Some(spec) => (true, inputs(spec)),
            None => (false, Vec::new()),
        },
        _ => (false, Vec::new()),
    }
}

fn inputs(spec: &Yaml) -> Vec<DispatchInput> {
    let Yaml::Hash(h) = &spec["inputs"] else { return Vec::new() };
    h.iter()
        .filter_map(|(k, v)| {
            let name = scalar(k)?;
            let kind = v["type"].as_str().unwrap_or("string").to_owned();
            let options = match &v["options"] {
                Yaml::Array(a) => a.iter().filter_map(scalar).collect(),
                _ => Vec::new(),
            };
            Some(DispatchInput {
                name,
                description: v["description"].as_str().map(str::to_owned),
                required: v["required"].as_bool().unwrap_or(false) || v["required"].as_str() == Some("true"),
                default: scalar(&v["default"]),
                kind,
                options,
            })
        })
        .collect()
}

fn scalar(y: &Yaml) -> Option<String> {
    match y {
        Yaml::String(s) | Yaml::Real(s) => Some(s.clone()),
        Yaml::Integer(i) => Some(i.to_string()),
        Yaml::Boolean(b) => Some(b.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_dispatch_forms() {
        assert!(parse_dispatch("on: workflow_dispatch\njobs: {}").0);
        assert!(parse_dispatch("on: [push, workflow_dispatch]\njobs: {}").0);
        assert!(parse_dispatch("on:\n  push:\n  workflow_dispatch:\njobs: {}").0);
        assert!(!parse_dispatch("on: [push]\njobs: {}").0);
        assert!(!parse_dispatch("not: [valid").0);
    }

    #[test]
    fn parses_inputs() {
        let y = r#"
name: Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: Version to release
        required: true
      channel:
        type: choice
        options: [stable, beta]
        default: stable
      dry_run:
        type: boolean
        default: false
"#;
        let (ok, inputs) = parse_dispatch(y);
        assert!(ok);
        assert_eq!(inputs.len(), 3);
        assert_eq!(inputs[0].name, "version");
        assert!(inputs[0].required);
        assert_eq!(inputs[0].kind, "string");
        assert_eq!(inputs[1].options, vec!["stable", "beta"]);
        assert_eq!(inputs[1].default.as_deref(), Some("stable"));
        assert_eq!(inputs[2].kind, "boolean");
        assert_eq!(inputs[2].default.as_deref(), Some("false"));
    }
}
