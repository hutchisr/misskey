/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['account'],
	requireCredential: true,
	kind: 'identify',
	allowMiniAppCredential: true,
	allowGet: true,
	description: 'Returns the narrow OAuth identity projection for a Fediverse Mini App credential.',
	errors: {
		miniAppCredentialRequired: {
			message: 'A mini app OAuth credential is required.',
			code: 'MINI_APP_CREDENTIAL_REQUIRED',
			id: '702f6c70-b369-4633-b8e8-f7bb50c575af',
			httpStatusCode: 403,
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			sub: { type: 'string', optional: false, nullable: false },
			acct: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,
	) {
		super(meta, paramDef, async (_ps, me, token) => {
			if (token?.oauthGrantId == null || token.oauthClientKind !== 'miniapp') {
				throw new ApiError(meta.errors.miniAppCredentialRequired);
			}

			return {
				sub: new URL(`/users/${me.id}`, this.config.url).toString(),
				acct: `${me.username}@${this.config.host}`,
			};
		});
	}
}
