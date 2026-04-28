use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

fn sibling_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("path has no parent")?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy())
        .ok_or("path has no file name")?;
    Ok(parent.join(format!(
        ".{name}.{label}.{}.{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    )))
}

#[cfg(unix)]
pub fn sync_parent_dir(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let dir = fs::File::open(parent).map_err(|e| format!("open parent dir: {e}"))?;
    dir.sync_all()
        .map_err(|e| format!("sync parent dir {}: {e}", parent.display()))
}

#[cfg(not(unix))]
pub fn sync_parent_dir(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;

    let tmp = sibling_path(path, "tmp")?;
    let old = sibling_path(path, "old")?;
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| format!("create temp file {}: {e}", tmp.display()))?;
        file.write_all(bytes)
            .map_err(|e| format!("write temp file {}: {e}", tmp.display()))?;
        file.sync_all()
            .map_err(|e| format!("sync temp file {}: {e}", tmp.display()))?;
    }

    let had_existing = path.exists();
    if had_existing {
        fs::rename(path, &old).map_err(|e| format!("move old file aside: {e}"))?;
    }

    if let Err(err) = fs::rename(&tmp, path) {
        if had_existing {
            let _ = fs::rename(&old, path);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("install temp file: {err}"));
    }

    if had_existing {
        if old.is_dir() {
            let _ = fs::remove_dir_all(&old);
        } else {
            let _ = fs::remove_file(&old);
        }
    }
    sync_parent_dir(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, b"old").unwrap();

        write(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
    }
}
