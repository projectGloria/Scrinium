//! Response shapes for the GitHub endpoints we read.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct User {
    pub login: String,
    pub id: i64,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ViewerReposData {
    pub viewer: ViewerRepos,
}

#[derive(Debug, Deserialize)]
pub struct ViewerRepos {
    pub repositories: ReposPage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReposPage {
    pub page_info: PageInfo,
    pub nodes: Vec<Option<RepoNode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoNode {
    pub database_id: Option<i64>,
    pub id: String,
    pub name: String,
    pub name_with_owner: String,
    pub owner: Owner,
    pub description: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_topics: Nodes<TopicNode>,
    pub primary_language: Option<Named>,
    pub is_private: bool,
    pub is_fork: bool,
    pub is_archived: bool,
    pub default_branch_ref: Option<Named>,
    pub stargazer_count: i64,
    pub fork_count: i64,
    pub issues: Count,
    pub pull_requests: Count,
    pub pushed_at: Option<String>,
    pub updated_at: Option<String>,
    pub url: String,
    pub ssh_url: String,
    pub languages: Option<LanguageConnection>,
}

#[derive(Debug, Deserialize)]
pub struct Owner {
    #[serde(rename = "__typename")]
    pub typename: String,
    pub login: String,
}

#[derive(Debug, Deserialize)]
pub struct Nodes<T> {
    pub nodes: Vec<Option<T>>,
}

#[derive(Debug, Deserialize)]
pub struct TopicNode {
    pub topic: Named,
}

#[derive(Debug, Deserialize)]
pub struct Named {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    pub total_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct LanguageConnection {
    pub edges: Vec<Option<LanguageEdge>>,
}

#[derive(Debug, Deserialize)]
pub struct LanguageEdge {
    pub size: i64,
    pub node: LanguageNode,
}

#[derive(Debug, Deserialize)]
pub struct LanguageNode {
    pub name: String,
    pub color: Option<String>,
}

/// Parses GitHub's `YYYY-MM-DDTHH:MM:SSZ` timestamps into Unix seconds.
pub fn parse_timestamp(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + se)
}

#[cfg(test)]
mod tests {
    use super::parse_timestamp;

    #[test]
    fn parses_github_timestamps() {
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_timestamp("2024-02-29T12:34:56Z"), Some(1_709_210_096));
        assert_eq!(parse_timestamp("garbage"), None);
    }
}
