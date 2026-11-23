fn main() {
    // Device-flow client ID is baked in at compile time; rebuild when it changes.
    println!("cargo:rerun-if-env-changed=SCRINIUM_GITHUB_CLIENT_ID");
    tauri_build::build()
}
