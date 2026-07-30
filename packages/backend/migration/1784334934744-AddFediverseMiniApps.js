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
		await queryRunner.query(`CREATE TABLE "oauth_grant" ("id" character varying(32) NOT NULL, "tokenHash" character varying(64) NOT NULL, "grantId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "clientId" character varying(512) NOT NULL, "clientKind" character varying(16) NOT NULL, "clientName" character varying(128) NOT NULL, "scope" character varying(64) array NOT NULL, "authorizationExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "refreshSequence" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_7ef975b60977497b796babe82ca" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6b70fcec15d61a3124851ef569" ON "oauth_grant" ("tokenHash")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d1e3cc19391a00426c099dd9ed" ON "oauth_grant" ("grantId")`);
		await queryRunner.query(`CREATE INDEX "IDX_6127add15dba82aff695013716" ON "oauth_grant" ("userId")`);
		await queryRunner.query(`ALTER TABLE "oauth_grant" ADD CONSTRAINT "FK_6127add15dba82aff695013716a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "access_token" ADD "oauthGrantId" character varying(32)`);
		await queryRunner.query(`ALTER TABLE "access_token" ADD "oauthClientKind" character varying(16)`);
		await queryRunner.query(`ALTER TABLE "access_token" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`);
		await queryRunner.query(`CREATE INDEX "IDX_e871d5d36d153e1bd88bd81b8f" ON "access_token" ("oauthGrantId")`);
	}

	/**
	 * @param {QueryRunner} queryRunner
	 */
	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_e871d5d36d153e1bd88bd81b8f"`);
		await queryRunner.query(`ALTER TABLE "access_token" DROP COLUMN "expiresAt"`);
		await queryRunner.query(`ALTER TABLE "access_token" DROP COLUMN "oauthClientKind"`);
		await queryRunner.query(`ALTER TABLE "access_token" DROP COLUMN "oauthGrantId"`);
		await queryRunner.query(`ALTER TABLE "oauth_grant" DROP CONSTRAINT "FK_6127add15dba82aff695013716a"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_6127add15dba82aff695013716"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_d1e3cc19391a00426c099dd9ed"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_6b70fcec15d61a3124851ef569"`);
		await queryRunner.query(`DROP TABLE "oauth_grant"`);
	}
}
