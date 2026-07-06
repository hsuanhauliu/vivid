use std::path::PathBuf;

fn main() {
    // Compile the Swift helper binary (Vision OCR, etc.) and bundle it as a
    // resource. macOS-only; the rest of the app already depends on macOS tools.
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = manifest.join("resources").join("vivid-helper");

    #[cfg(target_os = "macos")]
    {
        let src = manifest.join("swift").join("vivid-helper.swift");
        println!("cargo:rerun-if-changed={}", src.display());
        std::fs::create_dir_all(out.parent().unwrap()).unwrap();

        // Only (re)compile when the source is newer than the existing binary.
        // swiftc rewrites the output every run, so recompiling unconditionally
        // would make the dev file-watcher see a "changed" artifact and rebuild
        // in a loop. (resources/vivid-helper is also listed in .taurignore.)
        let mtime = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        let needs_build = match (mtime(&out), mtime(&src)) {
            (Some(out_t), Some(src_t)) => src_t > out_t,
            _ => true, // binary missing (or can't stat) → build
        };

        if needs_build {
            let status = std::process::Command::new("swiftc")
                .args(["-O", "-o"])
                .arg(&out)
                .arg(&src)
                .status()
                .expect("failed to run swiftc — install Xcode Command Line Tools");
            if !status.success() {
                panic!("swiftc failed to compile swift/vivid-helper.swift");
            }
        }
    }

    // Baked-in absolute path used as a dev-mode fallback when the binary isn't
    // resolvable via the bundle's resource dir. Always emitted so `env!` compiles.
    println!("cargo:rustc-env=VIVID_HELPER_PATH={}", out.display());

    tauri_build::build()
}
