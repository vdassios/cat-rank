CREATE TABLE `cats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`image_path` text NOT NULL,
	`likes_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cats_likes` ON `cats` (`likes_count`);--> statement-breakpoint
CREATE INDEX `idx_cats_created` ON `cats` (`created_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cat_id` integer NOT NULL,
	`user_token` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_comments_cat` ON `comments` (`cat_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_comments_user` ON `comments` (`cat_id`,`user_token`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cat_id` integer NOT NULL,
	`user_token` text NOT NULL,
	`ip_ua_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cat_id`) REFERENCES `cats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_votes_cat` ON `votes` (`cat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_votes_user_token` ON `votes` (`cat_id`,`user_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_votes_ip_ua_hash` ON `votes` (`cat_id`,`ip_ua_hash`);