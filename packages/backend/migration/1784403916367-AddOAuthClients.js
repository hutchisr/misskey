/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class AddOAuthClients1784403916367 {
	name = 'AddOAuthClients1784403916367';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "oauth_client" ("id" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "kind" character varying(16) NOT NULL, "metadata" jsonb NOT NULL, CONSTRAINT "PK_d6e58a7e0ec3ac17a67ba7f97cd" PRIMARY KEY ("id"))`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP TABLE "oauth_client"`);
	}
}
