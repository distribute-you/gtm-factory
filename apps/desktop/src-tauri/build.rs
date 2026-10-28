fn main() {
    // Declaring the app's commands turns on Tauri's access control for them: a page may call
    // `claude_complete` only if a capability grants it (see tauri.conf.json, remote origin only).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["claude_complete"])),
    )
    .expect("failed to run tauri-build");
}
