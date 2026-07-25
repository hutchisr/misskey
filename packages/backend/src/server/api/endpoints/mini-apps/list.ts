/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { UserMiniAppService } from '@/core/UserMiniAppService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	stability: 'experimental',
	tags: ['app', 'account'],
	description: 'List dynamically registered Fediverse Mini Apps authorized by the current user.',
	requireCredential: true,
	kind: 'read:account',
	secure: true,
	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: {
					type: 'string',
					format: 'misskey:id',
					optional: false, nullable: false,
				},
				manifestUrl: {
					type: 'string',
					format: 'uri',
					optional: false, nullable: false,
				},
				launchUrl: {
					type: 'string',
					format: 'uri',
					optional: false, nullable: false,
				},
				name: {
					type: 'string',
					optional: false, nullable: false,
				},
				iconUrl: {
					type: 'string',
					format: 'uri',
					optional: false, nullable: true,
				},
				createdAt: {
					type: 'string',
					format: 'date-time',
					optional: false, nullable: false,
				},
				lastDiscoveredAt: {
					type: 'string',
					format: 'date-time',
					optional: false, nullable: false,
				},
			},
			required: ['id', 'manifestUrl', 'launchUrl', 'name', 'iconUrl', 'createdAt', 'lastDiscoveredAt'],
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 24, default: 12 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private userMiniAppService: UserMiniAppService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const miniApps = await this.userMiniAppService.list(me.id, ps.limit);
			return miniApps.map(miniApp => ({
				id: miniApp.id,
				manifestUrl: miniApp.manifestUrl,
				launchUrl: miniApp.launchUrl,
				name: miniApp.name,
				iconUrl: miniApp.iconUrl,
				createdAt: miniApp.createdAt.toISOString(),
				lastDiscoveredAt: miniApp.lastDiscoveredAt.toISOString(),
			}));
		});
	}
}
