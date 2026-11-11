fn main() {
    println!(
        "cargo:rustc-env=RMETER_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
