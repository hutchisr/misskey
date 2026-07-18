/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
export class UserMiniApps1784355574097 {
	name = 'UserMiniApps1784355574097';

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "user_mini_app" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "manifestUrl" character varying(512) NOT NULL, "launchUrl" character varying(2048) NOT NULL, "name" character varying(128) NOT NULL, "iconUrl" character varying(2048), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastDiscoveredAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_d92b0f348f14b7ce7c56bf718e2" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE INDEX "IDX_60f425237c78ebd971787c7312" ON "user_mini_app" ("userId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b12d4b132cde8847699d5d0db5" ON "user_mini_app" ("userId", "manifestUrl")`);
		await queryRunner.query(`CREATE INDEX "IDX_9dbdde7375ef6f535cd39f9e64" ON "user_mini_app" ("userId", "lastDiscoveredAt")`);
		await queryRunner.query(`ALTER TABLE "user_mini_app" ADD CONSTRAINT "FK_60f425237c78ebd971787c73129" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`INSERT INTO "user_mini_app" ("id", "userId", "manifestUrl", "launchUrl", "name", "iconUrl", "createdAt", "lastDiscoveredAt") SELECT DISTINCT ON ("userId", "clientId") "grantId", "userId", "clientId", regexp_replace("clientId", '/\\.well-known/fediverse-miniapp\\.json$', '/'), "clientName", NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "mini_app_oauth_refresh_token" WHERE "authorizationExpiresAt" > CURRENT_TIMESTAMP ORDER BY "userId", "clientId", "authorizationExpiresAt" DESC ON CONFLICT ("userId", "manifestUrl") DO NOTHING`);
	}

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_mini_app" DROP CONSTRAINT "FK_60f425237c78ebd971787c73129"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_9dbdde7375ef6f535cd39f9e64"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_b12d4b132cde8847699d5d0db5"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_60f425237c78ebd971787c7312"`);
		await queryRunner.query(`DROP TABLE "user_mini_app"`);
	}
}
