mod bridge;
mod fonts;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bridge::RunManager::default())
        .setup(|_| {
            let _ = bridge::configure_worker();
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<bridge::RunManager>().cancel();
            }
        })
        .invoke_handler(tauri::generate_handler![
            fonts::list_system_fonts,
            bridge::read_script,
            bridge::write_script,
            bridge::validate_script,
            bridge::start_run,
            bridge::stop_run,
            bridge::worker_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
