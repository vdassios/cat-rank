import { sqliteTable, integer, text, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const cats = sqliteTable(
  'cats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    thumbnailPath: text('thumbnail_path').notNull(),
    imagePath: text('image_path').notNull(),
    likesCount: integer('likes_count').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_cats_likes').on(sql`${table.likesCount} DESC`),
    index('idx_cats_created').on(sql`${table.createdAt} DESC`),
  ],
);

export const votes = sqliteTable(
  'votes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    catId: integer('cat_id')
      .notNull()
      .references(() => cats.id),
    userToken: text('user_token').notNull(),
    ipUaHash: text('ip_ua_hash').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_votes_cat').on(table.catId),
    unique('unique_votes_user_token').on(table.catId, table.userToken),
    unique('unique_votes_ip_ua_hash').on(table.catId, table.ipUaHash),
  ],
);

export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    catId: integer('cat_id')
      .notNull()
      .references(() => cats.id),
    userToken: text('user_token').notNull(),
    text: text('text').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_comments_cat').on(table.catId, table.createdAt),
    unique('unique_comments_user').on(table.catId, table.userToken),
  ],
);

export type Cat = typeof cats.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type Comment = typeof comments.$inferSelect;