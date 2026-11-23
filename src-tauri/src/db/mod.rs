//! SQLite cache. The UI reads only from here; the sync engine is the only writer of GitHub data.

mod migrations;
pub mod repos;
pub mod state;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::Result;

/// One writer connection plus one reader connection. WAL mode lets the reader run
/// while a sync transaction is open, so UI queries never wait on the network-driven writer.
pub struct Db {
    writer: Mutex<Connection>,
    reader: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let writer = Connection::open(path)?;
        configure(&writer)?;
        migrations::run(&writer)?;
        let reader = Connection::open(path)?;
        configure(&reader)?;
        Ok(Self { writer: Mutex::new(writer), reader: Mutex::new(reader) })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        // Shared-cache in-memory DB so both connections see the same data.
        let uri = format!(
            "file:scrinium_test_{}?mode=memory&cache=shared",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let flags = rusqlite::OpenFlags::default() | rusqlite::OpenFlags::SQLITE_OPEN_URI;
        let writer = Connection::open_with_flags(&uri, flags)?;
        writer.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::run(&writer)?;
        let reader = Connection::open_with_flags(&uri, flags)?;
        reader.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Self { writer: Mutex::new(writer), reader: Mutex::new(reader) })
    }

    pub fn read(&self) -> MutexGuard<'_, Connection> {
        self.reader.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn write(&self) -> MutexGuard<'_, Connection> {
        self.writer.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;",
    )?;
    Ok(())
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
