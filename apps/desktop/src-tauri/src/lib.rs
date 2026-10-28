mod claude;

use claude::Runner;

/// Runs one prompt through the user's own `claude` CLI and resolves to the answer text.
/// Rejects with a plain message when the CLI is missing, not logged in, limited or too slow.
#[tauri::command]
async fn claude_complete(prompt: String, runner: tauri::State<'_, Runner>) -> Result<String, String> {
    runner.complete(&prompt).await
}

pub fn run() {
    tauri::Builder::default()
        .manage(Runner::default())
        .invoke_handler(tauri::generate_handler![claude_complete])
        .run(tauri::generate_context!())
        .expect("error while running GTM Factory");
}
