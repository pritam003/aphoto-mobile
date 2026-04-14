import { pgTable, text, boolean, integer, bigint, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const photosTable = pgTable("photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  filename: text("filename").notNull(),
  blobName: text("blob_name").notNull(),
  description: text("description"),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  favorite: boolean("favorite").default(false).notNull(),
  trashed: boolean("trashed").default(false).notNull(),
  trashedAt: timestamp("trashed_at"),
  hidden: boolean("hidden").default(false).notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  takenAt: timestamp("taken_at"),
}, (t) => [
  index("photos_user_uploaded_idx").on(t.userId, t.uploadedAt),
  index("photos_user_trashed_idx").on(t.userId, t.trashed),
  index("photos_user_hidden_idx").on(t.userId, t.hidden),
  index("photos_user_favorite_idx").on(t.userId, t.favorite),
]);

export const albumsTable = pgTable("albums", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  trashed: boolean("trashed").default(false).notNull(),
  trashedAt: timestamp("trashed_at"),
});

export const albumPhotosTable = pgTable("album_photos", {
  albumId: uuid("album_id").notNull().references(() => albumsTable.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photosTable.id, { onDelete: "cascade" }),
});

export const shareLinksTable = pgTable("share_links", {
  token: text("token").primaryKey(),
  photoId: uuid("photo_id").notNull().references(() => photosTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  archiveTotpSecret: text("archive_totp_secret"),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, uploadedAt: true });
export const insertAlbumSchema = createInsertSchema(albumsTable).omit({ id: true, createdAt: true });

export type Photo = typeof photosTable.$inferSelect;
export type Album = typeof albumsTable.$inferSelect;
export type AlbumPhoto = typeof albumPhotosTable.$inferSelect;
export type ShareLink = typeof shareLinksTable.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type InsertAlbum = z.infer<typeof insertAlbumSchema>;
