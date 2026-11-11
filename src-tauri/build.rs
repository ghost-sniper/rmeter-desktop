fn main() {
    // Windows embeds the ICO in the executable during the build script.
    // Rebuild resources when branding changes, including incremental builds.
    println!("cargo:rerun-if-changed=icons");
    println!(
        "cargo:rustc-env=RMETER_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
