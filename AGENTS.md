# AGENTS.md — Vivid architecture & working notes

Orientation for coding agents. Read this before diving into files; it captures
the structure, conventions, and non-obvious gotchas so you don't have to
re-derive them by re-reading the whole tree.

## What Vivid is

An on-device media library desktop app: **Tauri v2** (Rust backend) + **React 18**
(Vite) frontend. macOS-first (uses `sips`, `open`). All media, metadata,
embeddings, OCR, and thumbnails live locally; there is no server.

## Layout

```
src/                       React frontend
  App.jsx                  Root: owns view/selection/library state, wires everything (large)
  components/              One component per file
  hooks/                   Reusable React hooks + extracted App domains
                           (useFolders = folder tree state/CRUD,
                            useImport = pick/download/screenshot/drag-drop)
  utils/                   Pure helpers (format, sort, cover, translateTag)
  locales/                 i18n: en.json, zh-TW.json, ja.json (keep all three in sync)
  stores/                  Lightweight shared stores (e.g. downloadStore)
  i18n.js                  i18next setup
src-tauri/src/             Rust backend
  lib.rs                   App setup + the invoke_handler command registry
  db/                      SQLite (rusqlite), split by domain. mod.rs owns the
                           schema (init), row_to_item, SELECT_MEDIA, and
                           re-exports every submodule flat so callers use
                           `db::<fn>`. Submodules: media, trash, collections
                           (albums/playlists), folders, embeddings, stats;
                           tests in db/tests.rs.
  models.rs                Serde structs shared over IPC (MediaItem, Folder, ...)
  commands/                Tauri #[command] fns, grouped by domain
    mod.rs                 Import pipeline + shared helpers (media_dir, unique_path, ...)
    folders.rs  export.rs  thumbs.rs  ai.rs  download.rs  ocr.rs  tools.rs
    sync.rs                One-way mirror backup (up to 3 targets) — see Sync below
    upload.rs              Temporary LAN upload server (phone → library) — see Sync below
  clip.rs                  CLIP embeddings + media helpers (frame/cover extraction)
  multilingual_clip.rs     Multilingual CLIP text encoder
  logger.rs                tracing setup (rolling daily logs, 14-day cap)
```

## Build / test / run

```bash
npm run build          # vite build — fast, catches JS parse/type-ish errors
npm run lint           # ESLint — unused imports are errors; fix before committing
npx vitest run         # frontend unit tests (utils/hooks)
cd src-tauri && cargo build    # backend; cargo test for Rust unit tests
npm run tauri dev      # full app (needs the Rust toolchain + macOS)
```

ESLint is configured (`eslint.config.js`). `no-unused-vars` is an **error** — always
remove unused imports when you delete their last use. React hook rules
(`exhaustive-deps`, `react-hooks/refs`, etc.) are **warnings**; don't introduce new ones.

## Frontend conventions

- **i18n everywhere.** User-facing strings go through `t('namespace.key')`.
  When adding a key, add it to **all three** locale files (en, zh-TW, ja).
- **Shared code — reuse, don't re-implement.** Before writing a helper, check:
  - `utils/format.js` — `formatBytes`, `formatDate`, `formatDateShort`,
    `formatDateTime`, `formatDuration` (clock "3:05"), `formatClock` (0:00 floor).
    StatsPage keeps a _humanized_ "1h 30m" duration locally on purpose.
  - `hooks/useDisplayableSrc.js` — path → webview `src`, transcoding HEIC/HEIF
    via the `get_displayable_path` command. Use this for any **original-file**
    preview (returns `null` while HEIC converts → render a skeleton).
  - `utils/cover.js` `resolveCoverItem(group, items, { allowAny })` — a
    collection's cover item. `utils/sort.js` — library sorting.
- **Icons:** `lucide-react`. **No CSS-in-JS framework**; every component pairs with
  its own `ComponentName.css` next to it. `src/App.css` holds `:root` CSS variables
  (e.g. `--surface`, `--accent`) plus shared/global classes (`.btn`, `.icon-btn`,
  empty states, light theme overrides) reused across components — check it before
  adding a new "shared-looking" class. Note some CSS rules of equal specificity
  (e.g. a plain `.my-button` class vs. base `.btn`) can be overridden depending on
  which stylesheet the bundler happens to load last; if a component-specific
  override to `.btn` styling silently gets clobbered, raise its specificity with
  a compound selector (`.btn.my-button`) rather than reordering imports.
- **Backend calls:** `invoke('command_name', { camelCaseArgs })`. Tauri maps
  `snake_case` Rust params to `camelCase` on the JS side.

## Backend conventions

- **Logging:** use `tracing` (`tracing::info!/warn!/error!`), never `println!`.
- **No data duplication in the DB** — derive, don't copy. New columns are added
  idempotently via the `column_exists` guard in `db/mod.rs`.
- **Commands** are thin: validate, call a `db::` function and/or a `commands::`
  helper, map errors to `String`. Register every new command in `lib.rs`'s
  `invoke_handler` (and it's re-exported via `commands::*`).
- **macOS shell-outs:** `sips` (HEIC/image convert), `open -R` (reveal in Finder).
  Video work (poster frames, trim, GIF export, audio cover fallback) goes
  through the bundled Swift helper (`swift/vivid-helper.swift`, built by
  `build.rs`, invoked via `commands::helper_path(&app)`) using AVFoundation/
  ImageIO — **not ffmpeg**. ffmpeg is intentionally not a dependency; it's used
  in exactly two optional, best-effort spots that AVFoundation structurally
  can't replace: `get_playable_video_path`'s transcoding of wmv/avi/flv/mkv
  (containers AVFoundation can't demux at all) and yt-dlp's own internal
  stream-merging during downloads. Both resolve ffmpeg via
  `commands::resolve("ffmpeg")` and degrade gracefully if it's absent — never
  add a new ffmpeg call site without a similarly-graceful fallback.

## Data model & key concepts (don't confuse these)

`MediaItem` (models.rs) is the central record. Notable fields:

- **`folder_id` vs `collection_id`** — two _independent_ organizing axes:
  - **Folder** = a real on-disk directory under the managed library root
    (`app_data_dir/media/<rel_path>/`). Files physically live in exactly one
    folder. Tree stored in the `folders` table (`parent_id` + unique `rel_path`).
    Default root folder is **`Uncategorized`**. Moving a folder/file does
    `fs::rename` + rewrites `file_path`/`rel_path`. UI: `FolderTree`/`SecondaryPanel`.
  - **Collection** = a metadata-only album (image/video) or playlist
    (audio). An item has at most one. No files move.
- **`thumb_path` vs `audio_cover`** — both can supply an audio tile image:
  - `thumb_path` = auto-generated thumbnail. For audio, the backend extracts
    **embedded** cover art here (lofty first, Swift-helper/AVFoundation
    fallback — see `clip.rs` `extract_audio_cover` and `thumbs.rs`).
  - `audio_cover` = a **user-chosen custom** cover (via `set_audio_cover`).
  - Frontend display order is `audio_cover || thumb_path` (MediaCard, MediaGrid,
    MusicView, FileViewer, CollectionDragGhost). Keep these in sync if you touch one.
- **Thumbnails/embeddings/OCR are keyed by item `id`** in separate dirs, so moving
  a file only changes `file_path` — nothing else needs updating.

## Views

`App.jsx` switches on a `view` string. Valid values: `library`, `worldmap`,
`settings`, `music`, `trash`, `tags`, `stats`, `system-messages`, `log-viewer`.
Albums/playlists are **not** a separate view — they're a filter within
`library`. The secondary panel (`SecondaryPanel`) is a different piece of state
(`null | 'folders' | 'albums' | 'playlists' | 'tags' | 'stats'`) shown
alongside the main view; don't confuse the two.

## Sync & transfer features

- **Mirror backup** (`commands/sync.rs`, `hooks/useSync.js`): up to 3 one-way
  mirror targets (library → destination folder, `rsync --delete` semantics;
  destination → library is additive-only — new files get imported, edits/
  deletes of already-mirrored files are reverted). Each target keeps a
  persisted manifest (rel_path → size+mtime) to distinguish "library deleted
  this" from "a new file appeared" and to suppress echo events from its own
  writes. Single worker thread per app, fed by watchers, keeps manifests
  race-free.
- **LAN upload receive** (`commands/upload.rs`): a temporary axum server so a
  phone on the same network can upload files straight into the library. Only
  starts on explicit user action, uses an unguessable per-session token in the
  URL path (no auth otherwise), and auto-expires. Uploaded files go through the
  normal import pipeline (dedup, thumbnails, embeddings, live events).
- **URL download** (`commands/download.rs`): fetches a URL and imports it the
  same way, for pasting a link instead of picking a local file.

## Gotchas

- **Browser preview can't exercise backend flows.** A plain Vite preview has no
  Tauri runtime, so `invoke` calls (library data, folders, moves, thumbnails)
  don't resolve. Verify data-driven features in the real app, not the preview.
- **Context menus** (`ContextMenu.jsx`) measure their own size with
  `useLayoutEffect` to stay anchored at the cursor — don't reintroduce
  fixed-height position math.
- On startup, `db::ensure_uncategorized` seeds the default folder row and its
  on-disk directory — this is the only folder-related startup work; there is no
  migration sweep.
