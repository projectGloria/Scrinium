//! Ordered, embedded migrations. The applied version is stored in `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::Result;

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_init.sql"),
    include_str!("migrations/0002_content.sql"),
    include_str!("migrations/0003_files.sql"),
    include_str!("migrations/0004_issues.sql"),
    include_str!("migrations/0005_local_clone.sql"),
];

pub fn run(conn: &Connection) -> Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
pub fn latest() -> usize {
    MIGRATIONS.len()
}
