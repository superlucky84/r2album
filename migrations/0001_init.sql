-- r2album initial schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS allowed_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
  caption TEXT DEFAULT '',
  original_filename TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  has_exif_date INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  display_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  display_bytes INTEGER NOT NULL,
  thumb_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_images_taken_desc ON images (taken_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_images_album_taken_desc ON images (album_id, taken_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags (tag_id, image_id);
