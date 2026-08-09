/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MiniAppSessionRestoreService } from '@/core/MiniAppSessionRestoreService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	stability: 'experimental',
	tags: ['app', 'account'],
	description: 'Create a short-lived, one-time Mini App session restore proof for an existing authorization.',
	requireCredential: true,
	kind: 'read:account',
	secure: true,
	limit: {
		duration: 60 * 60 * 1000,
		max: 120,
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			status: {
				type: 'string',
				enum: ['success', 'interaction_required'],
				optional: false, nullable: false,
			},
			restoreCode: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
		required: ['status', 'restoreCode'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		clientId: { type: 'string', minLength: 1, maxLength: 255 },
		manifestUrl: { type: 'string', minLength: 1, maxLength: 2048 },
		restoreChallenge: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
	},
	required: ['clientId', 'manifestUrl', 'restoreChallenge'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private miniAppSessionRestoreService: MiniAppSessionRestoreService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const restoreCode = await this.miniAppSessionRestoreService.create(
				me.id,
				ps.clientId,
				ps.manifestUrl,
				ps.restoreChallenge,
			);

			return restoreCode == null
				? { status: 'interaction_required', restoreCode: null }
				: { status: 'success', restoreCode };
		});
	}
}
