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
export class AddFediverseMiniApps1784334934744 {
	/**
	 * @param {QueryRunner} queryRunner
	 */
	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "mini_app_oauth_refresh_token" ("id" character varying(32) NOT NULL, "tokenHash" character varying(64) NOT NULL, "grantId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "clientId" character varying(512) NOT NULL, "clientName" character varying(128) NOT NULL, "scope" character varying(64) array NOT NULL, "authorizationExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "refreshSequence" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_36f6f8602aeefcb118606a8b276" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_473dd09fb0105048c534e793b8" ON "mini_app_oauth_refresh_token" ("tokenHash")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6f91e9b40c3e03cde2cddb1c5c" ON "mini_app_oauth_refresh_token" ("grantId")`);
		await queryRunner.query(`CREATE INDEX "IDX_15d471c4411b2c7c92a62762ae" ON "mini_app_oauth_refresh_token" ("userId")`);
		await queryRunner.query(`ALTER TABLE "mini_app_oauth_refresh_token" ADD CONSTRAINT "FK_15d471c4411b2c7c92a62762ae2" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "access_token" ADD "miniAppOAuthGrantId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "access_token" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE INDEX "IDX_d962d1d18e4b12ead5a5419c51" ON "access_token" ("miniAppOAuthGrantId")`);
	}

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_d962d1d18e4b12ead5a5419c51"`);
		await queryRunner.query(`ALTER TABLE "access_token" DROP COLUMN "expiresAt"`);
		await queryRunner.query(`ALTER TABLE "access_token" DROP COLUMN "miniAppOAuthGrantId"`);
		await queryRunner.query(`ALTER TABLE "mini_app_oauth_refresh_token" DROP CONSTRAINT "FK_15d471c4411b2c7c92a62762ae2"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_15d471c4411b2c7c92a62762ae"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_6f91e9b40c3e03cde2cddb1c5c"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_473dd09fb0105048c534e793b8"`);
		await queryRunner.query(`DROP TABLE "mini_app_oauth_refresh_token"`);
	}
}
