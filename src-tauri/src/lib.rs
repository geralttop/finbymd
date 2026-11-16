use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

const TEMPLATE: &str = "```finance\n```\n";

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ChatSettings {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
}

#[tauri::command]
fn load_data_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = config_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&file).map_err(|err| err.to_string())?;
    let dir = text.trim();
    if dir.is_empty() {
        return Ok(None);
    }
    let path = PathBuf::from(dir);
    if !path.is_dir() {
        return Err(format!("Папка не найдена: {dir}"));
    }
    prepare(&app, &path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_data_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !path.is_dir() {
        return Err("Это не папка".to_string());
    }
    let canonical = std::fs::canonicalize(&path).map_err(|err| err.to_string())?;
    prepare(&app, &canonical)?;
    let file = config_file(&app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = canonical.to_string_lossy().to_string();
    std::fs::write(file, &text).map_err(|err| err.to_string())?;
    Ok(text)
}

fn prepare(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(dir, true)
        .map_err(|err| err.to_string())?;
    std::fs::create_dir_all(dir.join("transactions")).map_err(|err| err.to_string())?;
    for name in ["accounts.md", "categories.md", "recurring.md"] {
        let path = dir.join(name);
        if !path.exists() {
            std::fs::write(&path, TEMPLATE).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|err| err.to_string())?
        .join("data-dir.txt"))
}

fn chat_settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|err| err.to_string())?
        .join("chat-settings.json"))
}

#[tauri::command]
fn load_chat_settings(app: tauri::AppHandle) -> Result<Option<ChatSettings>, String> {
    let file = chat_settings_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&file).map_err(|err| err.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| format!("Настройки чата повреждены: {err}"))
}

#[tauri::command]
fn save_chat_settings(app: tauri::AppHandle, settings: ChatSettings) -> Result<(), String> {
    let file = chat_settings_file(&app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    std::fs::write(&file, text).map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            load_data_dir,
            save_data_dir,
            load_chat_settings,
            save_chat_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
