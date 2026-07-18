/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MiniAppManifestError, MiniAppManifestService } from '@/core/MiniAppManifestService.js';
import { UserMiniAppService } from '@/core/UserMiniAppService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	stability: 'experimental',
	tags: ['app'],
	description: 'Resolve and validate a Fediverse Mini Apps V1 manifest for a linked application URL.',
	requireCredential: true,
	secure: true,
	limit: {
		duration: 60 * 60 * 1000,
		max: 120,
	},
	errors: {
		invalidUrl: {
			message: 'The mini app URL is invalid.',
			code: 'INVALID_MINI_APP_URL',
			id: '3a99e141-8dd0-48cd-b432-b86dedf22d3e',
		},
		manifestUnavailable: {
			message: 'The mini app manifest could not be fetched.',
			code: 'MINI_APP_MANIFEST_UNAVAILABLE',
			id: '6ee79f22-f6c8-4666-b887-85e6049dcf21',
		},
		invalidManifest: {
			message: 'The mini app manifest is invalid.',
			code: 'INVALID_MINI_APP_MANIFEST',
			id: 'b1c66c9b-1bef-4f62-b2cd-e6e5ce284474',
		},
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			manifestUrl: {
				type: 'string',
				format: 'uri',
				optional: false, nullable: false,
			},
			appOrigin: {
				type: 'string',
				format: 'uri',
				optional: false, nullable: false,
			},
			launchUrl: {
				type: 'string',
				format: 'uri',
				optional: false, nullable: false,
			},
			expiresAt: {
				type: 'string',
				format: 'date-time',
				optional: false, nullable: false,
			},
			manifest: {
				type: 'object',
				optional: false, nullable: false,
				properties: {
					version: {
						type: 'string',
						enum: ['1'],
						optional: false, nullable: false,
					},
					name: {
						type: 'string',
						optional: false, nullable: false,
					},
					publisher: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							name: {
								type: 'string',
								optional: false, nullable: false,
							},
							url: {
								type: 'string',
								format: 'uri',
								optional: false, nullable: false,
							},
						},
						required: ['name', 'url'],
					},
					homeUrl: {
						type: 'string',
						format: 'uri',
						optional: false, nullable: false,
					},
					iconUrl: {
						type: 'string',
						format: 'uri',
						optional: false, nullable: false,
					},
					splash: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							imageUrl: {
								type: 'string',
								format: 'uri',
								optional: false, nullable: false,
							},
							backgroundColor: {
								type: 'string',
								optional: false, nullable: false,
							},
						},
						required: ['imageUrl', 'backgroundColor'],
					},
					oauth: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							redirectUris: {
								type: 'array',
								optional: false, nullable: false,
								items: {
									type: 'string',
									format: 'uri',
									optional: false, nullable: false,
								},
							},
							scopes: {
								type: 'array',
								optional: false, nullable: false,
								items: {
									type: 'string',
									enum: ['identify', 'write'],
									optional: false, nullable: false,
								},
							},
							scopeAuthorizationMaxAgeSeconds: {
								type: 'object',
								optional: false, nullable: false,
								additionalProperties: {
									anyOf: [{
										type: 'integer',
										optional: false, nullable: false,
									}],
								},
							},
						},
						required: ['redirectUris', 'scopes', 'scopeAuthorizationMaxAgeSeconds'],
					},
					activityPub: {
						type: 'object',
						optional: false, nullable: false,
						properties: {
							actorUrl: {
								type: 'string',
								format: 'uri',
								optional: false, nullable: false,
							},
							publicNotes: {
								type: 'boolean',
								optional: false, nullable: false,
							},
							transactionalMentions: {
								type: 'boolean',
								optional: false, nullable: false,
							},
						},
						required: ['actorUrl', 'publicNotes', 'transactionalMentions'],
					},
					capabilities: {
						type: 'array',
						optional: false, nullable: false,
						items: {
							type: 'string',
							enum: ['compose_note', 'notifications.activitypub', 'wallet.evm'],
							optional: false, nullable: false,
						},
					},
					cacheTtlSeconds: {
						type: 'integer',
						optional: false, nullable: false,
					},
				},
				required: [
					'version',
					'name',
					'publisher',
					'homeUrl',
					'iconUrl',
					'splash',
					'oauth',
					'activityPub',
					'capabilities',
					'cacheTtlSeconds',
				],
			},
		},
		required: ['manifestUrl', 'appOrigin', 'launchUrl', 'expiresAt', 'manifest'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		url: {
			type: 'string',
			minLength: 1,
			maxLength: 2048,
		},
	},
	required: ['url'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private miniAppManifestService: MiniAppManifestService,
		private userMiniAppService: UserMiniAppService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const resolved = await this.miniAppManifestService.resolveAppUrl(ps.url);
				await this.userMiniAppService.recordResolved(me.id, resolved);
				return resolved;
			} catch (error) {
				if (!(error instanceof MiniAppManifestError)) throw error;

				switch (error.code) {
					case 'invalid-url':
						throw new ApiError(meta.errors.invalidUrl);
					case 'unavailable':
						throw new ApiError(meta.errors.manifestUnavailable);
					case 'invalid-manifest':
						throw new ApiError(meta.errors.invalidManifest);
				}
			}
		});
	}
}
