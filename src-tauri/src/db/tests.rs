//! Unit tests for the persistence layer (see [`super`]).

use super::*;
use crate::models::MediaItem;

fn open() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init(&conn).unwrap();
    conn
}

fn item(id: &str, file_path: &str) -> MediaItem {
    MediaItem {
        id:           id.to_string(),
        file_path:    file_path.to_string(),
        source_path:  Some(format!("orig:{file_path}")),
        file_name:    "test.jpg".to_string(),
        display_name: "Test".to_string(),
        media_type:   "image".to_string(),
        created_at:   "2024-01-01T00:00:00+00:00".to_string(),
        updated_at:   "2024-01-01T00:00:00+00:00".to_string(),
        ..MediaItem::default()
    }
}

// ── OCR ─────────────────────────────────────────────────────────────────

#[test]
fn set_ocr_round_trips_and_flips_scanned() {
    let conn = open();
    insert(&conn, &item("a", "/x/a.jpg")).unwrap();

    // Unscanned image is a candidate; scanning removes it and stores text.
    assert_eq!(get_images_without_ocr(&conn).unwrap().len(), 1);
    set_ocr(&conn, "a", "invoice total 42").unwrap();

    let fetched = fetch_one(&conn, "a").unwrap();
    assert_eq!(fetched.ocr_text.as_deref(), Some("invoice total 42"));
    assert!(get_images_without_ocr(&conn).unwrap().is_empty());

    // Empty text still counts as scanned (no re-processing).
    insert(&conn, &item("b", "/x/b.jpg")).unwrap();
    set_ocr(&conn, "b", "").unwrap();
    assert!(get_images_without_ocr(&conn).unwrap().is_empty());

    let (scanned, total) = get_ocr_counts(&conn).unwrap();
    assert_eq!((scanned, total), (2, 2));
}

// ── MediaItem CRUD ──────────────────────────────────────────────────────

#[test]
fn insert_and_fetch_one() {
    let conn = open();
    let it = item("id-1", "/tmp/a.jpg");
    insert(&conn, &it).unwrap();

    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert_eq!(fetched.id,           "id-1");
    assert_eq!(fetched.file_path,    "/tmp/a.jpg");
    assert_eq!(fetched.display_name, "Test");
    assert_eq!(fetched.media_type,   "image");
    assert!(!fetched.starred);
    assert!(!fetched.favorited);
}

#[test]
fn insert_is_idempotent_on_same_path() {
    let conn = open();
    let it = item("id-1", "/tmp/a.jpg");
    insert(&conn, &it).unwrap();
    // INSERT OR IGNORE: second insert with same file_path is silently ignored
    let mut it2 = it.clone();
    it2.id = "id-2".to_string();
    insert(&conn, &it2).unwrap();

    let all = get_all(&conn).unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn get_all_excludes_deleted() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    insert(&conn, &item("id-2", "/tmp/b.jpg")).unwrap();
    trash_item(&conn, "id-1").unwrap();

    let all = get_all(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "id-2");
}

#[test]
fn update_fields() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    let updated = update(
        &conn, "id-1",
        "New Name",
        "A description",
        &["tag1".to_string(), "tag2".to_string()],
    ).unwrap();

    assert_eq!(updated.display_name, "New Name");
    assert_eq!(updated.description,  "A description");
    assert_eq!(updated.tags,         vec!["tag1", "tag2"]);
}

#[test]
fn toggle_star_flips_state() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    let after_first  = toggle_star(&conn, "id-1").unwrap();
    assert!(after_first.starred);

    let after_second = toggle_star(&conn, "id-1").unwrap();
    assert!(!after_second.starred);
}

#[test]
fn source_path_dedup() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    assert!(source_path_exists(&conn, "orig:/tmp/a.jpg").unwrap());
    assert!(!source_path_exists(&conn, "orig:/tmp/nonexistent.jpg").unwrap());
}

#[test]
fn set_color_label_persists() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    let updated = set_color_label(&conn, "id-1", Some("red")).unwrap();
    assert_eq!(updated.color_label.as_deref(), Some("red"));

    let cleared = set_color_label(&conn, "id-1", None).unwrap();
    assert_eq!(cleared.color_label, None);
}

#[test]
fn update_sort_order_persists() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    update_sort_order(&conn, "id-1", 42).unwrap();
    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert_eq!(fetched.sort_order, 42);
}

#[test]
fn remove_hard_deletes() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    let path = remove(&conn, "id-1").unwrap();
    assert_eq!(path.as_deref(), Some("/tmp/a.jpg"));
    assert!(get_all(&conn).unwrap().is_empty());
}

// ── Trash ───────────────────────────────────────────────────────────────

#[test]
fn trash_and_restore() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    trash_item(&conn, "id-1").unwrap();
    assert!(get_all(&conn).unwrap().is_empty());
    assert_eq!(get_trash(&conn).unwrap().len(), 1);

    restore_item(&conn, "id-1").unwrap();
    assert_eq!(get_all(&conn).unwrap().len(), 1);
    assert!(get_trash(&conn).unwrap().is_empty());
}

#[test]
fn empty_trash_returns_file_paths() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    insert(&conn, &item("id-2", "/tmp/b.jpg")).unwrap();
    trash_item(&conn, "id-1").unwrap();
    trash_item(&conn, "id-2").unwrap();

    let paths = empty_trash(&conn).unwrap();
    assert_eq!(paths.len(), 2);
    assert!(paths.contains(&"/tmp/a.jpg".to_string()));
    assert!(paths.contains(&"/tmp/b.jpg".to_string()));
    assert!(get_trash(&conn).unwrap().is_empty());
}

// ── Groups ──────────────────────────────────────────────────────────────

#[test]
fn collections_create_get_delete() {
    let conn = open();
    let g = create_collection(&conn, "Vacation", "#ff0000", Some("🌴"), "folder").unwrap();

    assert!(!g.id.is_empty());
    assert_eq!(g.name,  "Vacation");
    assert_eq!(g.color, "#ff0000");
    assert_eq!(g.emoji.as_deref(), Some("🌴"));
    assert_eq!(g.kind,  "folder");
    assert!(g.pinned);

    let all = get_collections(&conn).unwrap();
    assert_eq!(all.len(), 1);

    delete_collection(&conn, &g.id).unwrap();
    assert!(get_collections(&conn).unwrap().is_empty());
}

#[test]
fn rename_collection_persists() {
    let conn = open();
    let g = create_collection(&conn, "Old Name", "#fff", None, "album").unwrap();

    let renamed = rename_collection(&conn, &g.id, "New Name").unwrap();
    assert_eq!(renamed.name, "New Name");
    // Other fields unchanged
    assert_eq!(renamed.color, "#fff");
    assert_eq!(renamed.kind,  "album");
}

#[test]
fn collection_name_taken_is_case_insensitive_and_kind_scoped() {
    let conn = open();
    create_collection(&conn, "Trips", "#fff", None, "folder").unwrap();

    // Same kind, any case → taken
    assert!(collection_name_taken(&conn, "Trips", "folder", None).unwrap());
    assert!(collection_name_taken(&conn, "trips", "folder", None).unwrap());
    // Different kind → free (folders and albums are separate namespaces)
    assert!(!collection_name_taken(&conn, "Trips", "album", None).unwrap());
    // Unused name → free
    assert!(!collection_name_taken(&conn, "Other", "folder", None).unwrap());
}

#[test]
fn collection_name_taken_excludes_self_for_rename() {
    let conn = open();
    let g = create_collection(&conn, "Keep", "#fff", None, "folder").unwrap();
    // Renaming a group to its own (cased) name must not count as a clash.
    assert!(!collection_name_taken(&conn, "keep", "folder", Some(&g.id)).unwrap());
}

#[test]
fn pin_collection_toggle() {
    let conn = open();
    let g = create_collection(&conn, "G", "#fff", None, "folder").unwrap();
    assert!(g.pinned); // default is pinned=1

    let unpinned = pin_collection(&conn, &g.id, false).unwrap();
    assert!(!unpinned.pinned);

    let repinned = pin_collection(&conn, &g.id, true).unwrap();
    assert!(repinned.pinned);
}

#[test]
fn set_sidebar_pin_toggle() {
    let conn = open();
    let g = create_collection(&conn, "G", "#fff", None, "folder").unwrap();
    assert!(!g.sidebar_pin);

    let pinned = set_sidebar_pin(&conn, &g.id, true).unwrap();
    assert!(pinned.sidebar_pin);
}

#[test]
fn set_collection_cover_persists() {
    let conn = open();
    let g = create_collection(&conn, "G", "#fff", None, "folder").unwrap();
    insert(&conn, &item("item-1", "/tmp/a.jpg")).unwrap();

    let updated = set_collection_cover(&conn, &g.id, Some("item-1")).unwrap();
    assert_eq!(updated.cover_item_id.as_deref(), Some("item-1"));

    let cleared = set_collection_cover(&conn, &g.id, None).unwrap();
    assert!(cleared.cover_item_id.is_none());
}

#[test]
fn set_collection_clears_on_delete() {
    let conn = open();
    let g = create_collection(&conn, "G", "#fff", None, "folder").unwrap();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    add_to_collection(&conn, "id-1", &g.id).unwrap();

    delete_collection(&conn, &g.id).unwrap();

    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert!(fetched.collection_ids.is_empty());
}

// ── Embeddings / AI ─────────────────────────────────────────────────────

#[test]
fn embedding_set_and_get() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    let bytes = vec![0x3f, 0x80, 0x00, 0x00u8]; // 1.0f32 LE
    let tags  = vec!["mountain".to_string(), "sunset".to_string()];
    set_embedding(&conn, "id-1", &bytes, &tags).unwrap();

    let retrieved = get_embedding(&conn, "id-1").unwrap().unwrap();
    assert_eq!(retrieved, bytes);
}

#[test]
fn get_items_without_embeddings() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    insert(&conn, &item("id-2", "/tmp/b.jpg")).unwrap();

    // Index only id-1
    set_embedding(&conn, "id-1", &[0u8; 4], &[]).unwrap();

    let unindexed = super::get_items_without_embeddings(&conn).unwrap();
    assert_eq!(unindexed.len(), 1);
    assert_eq!(unindexed[0].0, "id-2");
}

#[test]
fn fetch_items_by_ids_batch() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    insert(&conn, &item("id-2", "/tmp/b.jpg")).unwrap();
    insert(&conn, &item("id-3", "/tmp/c.jpg")).unwrap();

    let ids = vec!["id-1".to_string(), "id-3".to_string()];
    let fetched = fetch_items_by_ids(&conn, &ids).unwrap();

    assert_eq!(fetched.len(), 2);
    let ids_found: Vec<_> = fetched.iter().map(|i| i.id.as_str()).collect();
    assert!(ids_found.contains(&"id-1"));
    assert!(ids_found.contains(&"id-3"));
    assert!(!ids_found.contains(&"id-2"));
}

#[test]
fn fetch_items_by_ids_empty_slice() {
    let conn = open();
    let result = fetch_items_by_ids(&conn, &[]).unwrap();
    assert!(result.is_empty());
}

#[test]
fn fetch_items_by_ids_excludes_trashed() {
    let conn = open();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    trash_item(&conn, "id-1").unwrap();

    let fetched = fetch_items_by_ids(&conn, &["id-1".to_string()]).unwrap();
    assert!(fetched.is_empty(), "trashed items should not be returned");
}

#[test]
fn audio_meta_roundtrip() {
    let conn = open();
    let mut it = item("id-1", "/tmp/song.mp3");
    it.media_type = "audio".to_string();
    insert(&conn, &it).unwrap();

    let updated = update_audio_meta(
        &conn, "id-1",
        Some("Artist Name"), Some("Album Name"), Some("Song Title"),
        Some(2023), Some(3),
    ).unwrap();

    assert_eq!(updated.audio_artist.as_deref(), Some("Artist Name"));
    assert_eq!(updated.audio_album.as_deref(),  Some("Album Name"));
    assert_eq!(updated.audio_title.as_deref(),  Some("Song Title"));
    assert_eq!(updated.audio_year,              Some(2023));
    assert_eq!(updated.audio_track,             Some(3));
}

#[test]
fn set_audio_cover_persists() {
    let conn = open();
    let mut it = item("id-1", "/tmp/song.mp3");
    it.media_type = "audio".to_string();
    insert(&conn, &it).unwrap();

    let updated = set_audio_cover(&conn, "id-1", Some("/tmp/cover.jpg")).unwrap();
    assert_eq!(updated.audio_cover.as_deref(), Some("/tmp/cover.jpg"));

    let cleared = set_audio_cover(&conn, "id-1", None).unwrap();
    assert!(cleared.audio_cover.is_none());
}

#[test]
fn get_audio_tracks_only_returns_audio() {
    let conn = open();
    let mut audio = item("id-1", "/tmp/song.mp3");
    audio.media_type = "audio".to_string();
    insert(&conn, &audio).unwrap();
    insert(&conn, &item("id-2", "/tmp/photo.jpg")).unwrap(); // image

    let tracks = get_audio_tracks(&conn).unwrap();
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].id, "id-1");
}

#[test]
fn get_audio_tracks_excludes_trashed() {
    let conn = open();
    let mut audio = item("id-1", "/tmp/song.mp3");
    audio.media_type = "audio".to_string();
    insert(&conn, &audio).unwrap();
    trash_item(&conn, "id-1").unwrap();

    assert!(get_audio_tracks(&conn).unwrap().is_empty());
}

#[test]
fn get_library_stats_counts_correctly() {
    let conn = open();
    let mut img = item("id-1", "/tmp/a.jpg");
    img.media_type = "image".to_string();
    insert(&conn, &img).unwrap();

    let mut vid = item("id-2", "/tmp/b.mp4");
    vid.media_type = "video".to_string();
    insert(&conn, &vid).unwrap();

    let mut aud = item("id-3", "/tmp/c.mp3");
    aud.media_type = "audio".to_string();
    insert(&conn, &aud).unwrap();

    // Index the image only
    set_embedding(&conn, "id-1", &[0u8; 4], &["mountain".to_string()]).unwrap();

    let (images, videos, audio, indexed, unindexed, _tags, _size) =
        get_library_stats(&conn).unwrap();

    assert_eq!(images,    1);
    assert_eq!(videos,    1);
    assert_eq!(audio,     1);
    assert_eq!(indexed,   1); // only the image
    assert_eq!(unindexed, 1); // the video
}

#[test]
fn delete_collection_is_atomic() {
    let conn = open();
    let g = create_collection(&conn, "G", "#fff", None, "folder").unwrap();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();
    add_to_collection(&conn, "id-1", &g.id).unwrap();

    delete_collection(&conn, &g.id).unwrap();

    // Collection is gone
    assert!(get_collections(&conn).unwrap().is_empty());
    // Member item still exists but is ungrouped
    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert!(fetched.collection_ids.is_empty());
}

#[test]
fn item_can_belong_to_multiple_collections() {
    let conn = open();
    let a = create_collection(&conn, "A", "#fff", None, "album").unwrap();
    let b = create_collection(&conn, "B", "#fff", None, "album").unwrap();
    insert(&conn, &item("id-1", "/tmp/a.jpg")).unwrap();

    add_to_collection(&conn, "id-1", &a.id).unwrap();
    add_to_collection(&conn, "id-1", &b.id).unwrap();

    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert_eq!(fetched.collection_ids.len(), 2);
    assert!(fetched.collection_ids.contains(&a.id));
    assert!(fetched.collection_ids.contains(&b.id));

    remove_from_collection(&conn, "id-1", &a.id).unwrap();
    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert_eq!(fetched.collection_ids, vec![b.id.clone()]);
}

#[test]
fn set_collection_parent_moves_album_into_and_out_of_group() {
    let conn = open();
    let group = create_collection(&conn, "Trips", "#fff", None, "album_group").unwrap();
    let album = create_collection(&conn, "Japan", "#fff", None, "album").unwrap();
    assert!(album.parent_id.is_none());

    let moved = set_collection_parent(&conn, &album.id, Some(&group.id)).unwrap();
    assert_eq!(moved.parent_id.as_deref(), Some(group.id.as_str()));

    let ungrouped = set_collection_parent(&conn, &album.id, None).unwrap();
    assert!(ungrouped.parent_id.is_none());
}

#[test]
fn deleting_album_group_ungroups_its_children_instead_of_orphaning() {
    let conn = open();
    let group = create_collection(&conn, "Trips", "#fff", None, "album_group").unwrap();
    let album = create_collection(&conn, "Japan", "#fff", None, "album").unwrap();
    set_collection_parent(&conn, &album.id, Some(&group.id)).unwrap();

    delete_collection(&conn, &group.id).unwrap();

    let collections = get_collections(&conn).unwrap();
    assert!(collections.iter().all(|g| g.id != group.id));
    let surviving_album = collections.iter().find(|g| g.id == album.id).unwrap();
    assert!(surviving_album.parent_id.is_none());
}

// ── Folders (on-disk directory tree) ─────────────────────────────────────

#[test]
fn list_folders_always_includes_virtual_uncategorized() {
    let conn = open();
    // No real folders exist yet — the virtual Uncategorized bucket is still
    // present so root-level files always have somewhere to show up.
    let folders = list_folders(&conn).unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].id, UNCATEGORIZED_ID);
    assert_eq!(folders[0].rel_path, UNCATEGORIZED);
    assert!(folders[0].parent_id.is_none());
}

#[test]
fn create_fetch_and_list_folders() {
    let conn = open();
    let f = create_folder(&conn, "Trip", None, "Trip").unwrap();
    assert_eq!(f.name, "Trip");
    assert_eq!(f.rel_path, "Trip");
    assert!(f.parent_id.is_none());

    let fetched = fetch_folder(&conn, &f.id).unwrap();
    assert_eq!(fetched.id, f.id);

    assert_eq!(folder_id_by_rel_path(&conn, "Trip").unwrap(), Some(f.id.clone()));
    assert_eq!(folder_id_by_rel_path(&conn, "Nope").unwrap(), None);

    // Real folder + the always-present virtual Uncategorized entry.
    assert_eq!(list_folders(&conn).unwrap().len(), 2);
}

#[test]
fn folder_name_taken_is_case_insensitive_and_parent_scoped() {
    let conn = open();
    create_folder(&conn, "Trip", None, "Trip").unwrap();

    // Same parent (root, i.e. None), any case → taken.
    assert!(folder_name_taken(&conn, None, "Trip", None).unwrap());
    assert!(folder_name_taken(&conn, None, "trip", None).unwrap());
    // Unused name at the same level → free.
    assert!(!folder_name_taken(&conn, None, "Other", None).unwrap());

    // Same name nested under a different parent is a different namespace → free.
    let parent = create_folder(&conn, "Parent", None, "Parent").unwrap();
    assert!(!folder_name_taken(&conn, Some(&parent.id), "Trip", None).unwrap());
}

#[test]
fn folder_name_taken_excludes_self_for_rename() {
    let conn = open();
    let f = create_folder(&conn, "Trip", None, "Trip").unwrap();
    // Renaming a folder to its own (cased) name must not count as a clash.
    assert!(!folder_name_taken(&conn, None, "trip", Some(&f.id)).unwrap());
}

#[test]
fn set_folder_parent_reparents() {
    let conn = open();
    let a = create_folder(&conn, "A", None, "A").unwrap();
    let b = create_folder(&conn, "B", None, "B").unwrap();

    set_folder_parent(&conn, &b.id, Some(&a.id)).unwrap();

    let updated = fetch_folder(&conn, &b.id).unwrap();
    assert_eq!(updated.parent_id.as_deref(), Some(a.id.as_str()));
}

#[test]
fn set_item_folder_updates_folder_id_and_path() {
    let conn = open();
    let f = create_folder(&conn, "Trip", None, "Trip").unwrap();
    insert(&conn, &item("id-1", "/lib/a.jpg")).unwrap();

    set_item_folder(&conn, "id-1", Some(&f.id), "/lib/Trip/a.jpg").unwrap();

    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert_eq!(fetched.folder_id.as_deref(), Some(f.id.as_str()));
    assert_eq!(fetched.file_path, "/lib/Trip/a.jpg");
}

#[test]
fn set_item_folder_to_none_moves_to_uncategorized() {
    let conn = open();
    let f = create_folder(&conn, "Trip", None, "Trip").unwrap();
    insert(&conn, &item("id-1", "/lib/Trip/a.jpg")).unwrap();
    set_item_folder(&conn, "id-1", Some(&f.id), "/lib/Trip/a.jpg").unwrap();

    set_item_folder(&conn, "id-1", None, "/lib/a.jpg").unwrap();

    let fetched = fetch_one(&conn, "id-1").unwrap();
    assert!(fetched.folder_id.is_none());
    assert_eq!(fetched.file_path, "/lib/a.jpg");
}

#[test]
fn delete_folder_subtree_removes_descendants_but_not_siblings() {
    let conn = open();
    create_folder(&conn, "Trip", None, "Trip").unwrap();
    create_folder(&conn, "Beach", None, "Trip/Beach").unwrap();
    // A sibling whose name merely starts with the same prefix must survive —
    // guards the LIKE pattern's '/' boundary (`Trip/%`, not `Trip%`).
    create_folder(&conn, "TripOther", None, "TripOther").unwrap();

    delete_folder_subtree(&conn, "Trip").unwrap();

    let remaining: Vec<String> = list_folders(&conn).unwrap().into_iter().map(|f| f.rel_path).collect();
    // The virtual Uncategorized entry is always present alongside real folders.
    assert_eq!(remaining, vec![UNCATEGORIZED.to_string(), "TripOther".to_string()]);
}

#[test]
fn items_under_including_trashed_matches_direct_and_nested_children_only() {
    let conn = open();
    let root = "/lib";
    insert(&conn, &item("direct", &format!("{root}/Trip/a.jpg"))).unwrap();
    insert(&conn, &item("nested", &format!("{root}/Trip/Beach/b.jpg"))).unwrap();
    // Prefix look-alike sibling — must NOT be matched (no '/' right after "Trip").
    insert(&conn, &item("sibling", &format!("{root}/TripOther/c.jpg"))).unwrap();
    // Unrelated folder — must NOT be matched.
    insert(&conn, &item("unrelated", &format!("{root}/Other/d.jpg"))).unwrap();

    let found = items_under_including_trashed(&conn, "Trip", root).unwrap();
    let ids: Vec<&str> = found.iter().map(|i| i.id.as_str()).collect();

    assert_eq!(found.len(), 2);
    assert!(ids.contains(&"direct"));
    assert!(ids.contains(&"nested"));
}

#[test]
fn items_under_including_trashed_finds_both() {
    // Regression guard: folder deletion needs the trashed item too — see
    // `delete_folder`'s doc comment — otherwise its file gets swept away by
    // the directory removal with nothing to relocate it first, and its
    // folder_id is left dangling once the folder row is gone.
    let conn = open();
    let root = "/lib";
    insert(&conn, &item("active", &format!("{root}/Trip/a.jpg"))).unwrap();
    insert(&conn, &item("trashed", &format!("{root}/Trip/b.jpg"))).unwrap();
    trash_item(&conn, "trashed").unwrap();

    let found = items_under_including_trashed(&conn, "Trip", root).unwrap();
    let ids: Vec<&str> = found.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(found.len(), 2);
    assert!(ids.contains(&"active"));
    assert!(ids.contains(&"trashed"));
}

#[test]
fn init_clears_folder_id_dangling_at_a_nonexistent_folder() {
    let conn = open();
    insert(&conn, &item("a", "/lib/wherever/a.jpg")).unwrap();
    // A dangling reference can't normally be created (foreign keys reject
    // it) — simulates one already existing in a database from before this
    // cleanup, or before `delete_folder` accounted for trashed items.
    conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    conn.execute("UPDATE media_items SET folder_id = 'ghost-id' WHERE id = 'a'", []).unwrap();

    init(&conn).unwrap();

    let fetched = fetch_one(&conn, "a").unwrap();
    assert_eq!(fetched.folder_id, None);
}

#[test]
fn rename_folder_tree_rewrites_rel_paths_file_paths_and_name() {
    let conn = open();
    let root = "/lib";
    let trip = create_folder(&conn, "Trip", None, "Trip").unwrap();
    create_folder(&conn, "Beach", Some(&trip.id), "Trip/Beach").unwrap();
    // Sibling that merely shares a prefix — must be untouched.
    create_folder(&conn, "TripOther", None, "TripOther").unwrap();

    insert(&conn, &item("direct", &format!("{root}/Trip/a.jpg"))).unwrap();
    insert(&conn, &item("nested", &format!("{root}/Trip/Beach/b.jpg"))).unwrap();
    insert(&conn, &item("sibling", &format!("{root}/TripOther/c.jpg"))).unwrap();

    rename_folder_tree(&conn, &trip.id, "Vacation", "Trip", "Vacation", root).unwrap();

    // The renamed folder itself: new name + new rel_path.
    let renamed = fetch_folder(&conn, &trip.id).unwrap();
    assert_eq!(renamed.name, "Vacation");
    assert_eq!(renamed.rel_path, "Vacation");

    // The descendant folder's rel_path shifted along with it.
    let all = list_folders(&conn).unwrap();
    let beach = all.iter().find(|f| f.name == "Beach").unwrap();
    assert_eq!(beach.rel_path, "Vacation/Beach");

    // Items directly in and nested under the renamed folder both moved.
    assert_eq!(fetch_one(&conn, "direct").unwrap().file_path, format!("{root}/Vacation/a.jpg"));
    assert_eq!(fetch_one(&conn, "nested").unwrap().file_path, format!("{root}/Vacation/Beach/b.jpg"));

    // The prefix-look-alike sibling folder and its item are untouched.
    let sibling = all.iter().find(|f| f.name == "TripOther").unwrap();
    assert_eq!(sibling.rel_path, "TripOther");
    assert_eq!(fetch_one(&conn, "sibling").unwrap().file_path, format!("{root}/TripOther/c.jpg"));
}

#[test]
fn rename_folder_tree_rolls_back_on_conflict() {
    let conn = open();
    let trip = create_folder(&conn, "Trip", None, "Trip").unwrap();
    // A folder already occupies the destination rel_path — the UNIQUE
    // constraint on rel_path should fail the rename and roll it back whole.
    create_folder(&conn, "Vacation", None, "Vacation").unwrap();
    insert(&conn, &item("direct", "/lib/Trip/a.jpg")).unwrap();

    let result = rename_folder_tree(&conn, &trip.id, "Vacation", "Trip", "Vacation", "/lib");
    assert!(result.is_err());

    // Nothing was changed: original folder and item path both survive intact.
    let unchanged = fetch_folder(&conn, &trip.id).unwrap();
    assert_eq!(unchanged.rel_path, "Trip");
    assert_eq!(fetch_one(&conn, "direct").unwrap().file_path, "/lib/Trip/a.jpg");
}
