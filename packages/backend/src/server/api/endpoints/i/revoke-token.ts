/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AccessTokensRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { OAuthTokenService } from '@/core/OAuthTokenService.js';

export const meta = {
	requireCredential: true,

	secure: true,
} as const;

export const paramDef = {
	anyOf: [
		{
			type: 'object',
			properties: {
				tokenId: { type: 'string', format: 'misskey:id' },
			},
			required: ['tokenId'],
		},
		{
			type: 'object',
			properties: {
				token: { type: 'string', nullable: true },
			},
			required: ['token'],
		},
	],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.accessTokensRepository)
		private accessTokensRepository: AccessTokensRepository,

		private oauthTokenService: OAuthTokenService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const accessToken = 'tokenId' in ps
				? await this.accessTokensRepository.findOneBy({ id: ps.tokenId, userId: me.id })
				: ps.token
					? await this.accessTokensRepository.findOneBy({ token: ps.token, userId: me.id })
					: null;
			if (accessToken == null) return;

			if (accessToken.oauthGrantId != null) {
				await this.oauthTokenService.revokeGrant(accessToken.oauthGrantId);
			} else {
				await this.accessTokensRepository.delete(accessToken.id);
			}
		});
	}
}
