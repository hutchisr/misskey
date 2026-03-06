/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddMrfPolicies1762000000000 {
    name = 'AddMrfPolicies1762000000000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "mrfPolicies" jsonb NOT NULL DEFAULT '{"enabled":[],"simple":{"reject":[],"mediaRemoval":[],"mediaNsfw":[],"reportRemoval":[],"followersOnly":[]},"keyword":{"reject":[],"replace":[]},"hellthread":{"rejectThreshold":0,"delistThreshold":0}}'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "mrfPolicies"`);
    }
}
