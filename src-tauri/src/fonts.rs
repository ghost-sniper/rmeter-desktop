use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, serde::Serialize)]
pub struct SystemFont {
    family: String,
    monospaced: bool,
}

fn scan_fonts() -> Vec<SystemFont> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut families = BTreeMap::<String, (String, bool)>::new();
    for face in database.faces() {
        for (family, _) in &face.families {
            let family = family.trim();
            if family.is_empty() || family.starts_with('@') {
                continue;
            }
            families
                .entry(family.to_lowercase())
                .and_modify(|entry| entry.1 |= face.monospaced)
                .or_insert_with(|| (family.to_owned(), face.monospaced));
        }
    }
    families
        .into_values()
        .map(|(family, monospaced)| SystemFont { family, monospaced })
        .collect()
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    static FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();
    tauri::async_runtime::spawn_blocking(|| FONTS.get_or_init(scan_fonts).clone())
        .await
        .map_err(|error| format!("无法读取系统字体：{error}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn system_fonts_are_deduplicated_and_sorted() {
        let fonts = super::scan_fonts();
        assert!(
            fonts
                .windows(2)
                .all(|pair| pair[0].family.to_lowercase() < pair[1].family.to_lowercase())
        );
        #[cfg(target_os = "windows")]
        {
            assert!(!fonts.is_empty());
            assert!(fonts.iter().any(|font| font.monospaced));
        }
    }
}
