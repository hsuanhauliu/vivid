# About Vivid

Vivid is a personal media manager project developed primarily for myself and close friends and family. I've decided to open-source it so others can use, study, and modify it freely.

## Contributing

**I'm not actively accepting feature pull requests.** This project is maintained for my own needs, and priorities may not align with external contributions.

**You're very welcome to:**

- **Fork the project** and modify it however you like for personal use
- **Report bugs** — if you find something broken, please open an issue with steps to reproduce
- **Submit bug fixes** — small, focused PRs to fix bugs are welcome (no major refactors)
- **Clone and build** — follow the [Setup section of the README](README.md#setup) to get it running locally

## Getting set up

See the [Setup section of the README](README.md#setup) for prerequisites
(macOS, Node 18+, Rust, Xcode Command Line Tools). Then:

```bash
git clone https://github.com/hsuanhauliu/vivid.git
cd vivid
npm install
npm run tauri dev
```

## Project layout

| Path               | What's there                                          |
| ------------------ | ----------------------------------------------------- |
| `src/`             | React frontend — `components/`, `hooks/`, `locales/`  |
| `src-tauri/src/`   | Rust backend — `commands/`, `db.rs`, AI/model modules |
| `src-tauri/swift/` | Swift helper (Vision OCR), compiled by `build.rs`     |

## Development workflow

- **Frontend changes** hot-reload instantly via Vite.
- **Backend (Rust) changes** trigger a recompile on the next save.
- Before opening a PR, please run:
  ```bash
  npm run build                       # frontend type/build check
  cd src-tauri && cargo build         # backend compiles
  cd src-tauri && cargo test          # backend unit tests pass
  ```

## Code style & conventions

- **Match the surrounding code.** Mirror the existing naming, comment density, and idioms in the file you're editing.
- **Rust:** keep `cargo build` warning-free; add unit tests for new DB/logic where practical.
- **React:** prefer small, focused components and hooks; keep expensive work out of render.
- **Backend ↔ frontend:** new Tauri commands go in `src-tauri/src/commands/` and must be registered in `src-tauri/src/lib.rs`.

## Internationalization

Vivid ships with **English, 繁體中文, and 日本語**. If you add or change any
user-facing text:

- Add the key to **all three** locale files: `src/locales/en.json`, `zh-TW.json`, `ja.json`.
- Keep keys in the same place across files, and prefer natural phrasing over literal translation.

## Reporting bugs

Please use the issue templates. Include your macOS version, repro steps, and
(for crashes) anything from **Settings → System Log**.

## License

The project is licensed under the [MIT License](LICENSE).
