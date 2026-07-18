/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiUser } from '@/models/User.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiMiniAppOAuthRefreshToken } from '@/models/MiniAppOAuthRefreshToken.js';
import { IdService } from '@/core/IdService.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import type { DataSource, EntityManager } from 'typeorm';
import { InvalidGrantError } from '@/server/oauth/errors.js';

const accessTokenLifetimeSeconds = 60 * 60;
const minimumAuthorizationLifetimeSeconds = 5 * 60;
const maximumAuthorizationLifetimeSeconds = 365 * 24 * 60 * 60;
// Mini app backends reconstruct an absolute deadline from this relative value.
// Apply a fixed margin to rotated responses so ordinary response latency and
// whole-second rounding do not appear to extend the original client deadline.
const authorizationLifetimeSafetySecondsPerRefresh = 2 * 60;

export type MiniAppOAuthTokenResponse = {
	access_token: string;
	token_type: 'Bearer';
	scope: string;
	expires_in: number;
	refresh_token: string;
	authorization_expires_in: number;
};

export type IssuedMiniAppOAuthTokenResponse = {
	grantId: string;
	response: MiniAppOAuthTokenResponse;
};

type TokenSetParams = {
	grantId: string;
	userId: MiUser['id'];
	clientId: string;
	clientName: string;
	scope: string[];
	authorizationExpiresAt: Date;
	refreshSequence: number;
	now: Date;
};

@Injectable()
export class MiniAppOAuthTokenService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
	) {
	}

	public async issueAuthorization(params: {
		userId: MiUser['id'];
		clientId: string;
		clientName: string;
		scope: string[];
		authorizationExpiresAt: Date;
	}): Promise<IssuedMiniAppOAuthTokenResponse> {
		const now = new Date();
		const authorizationLifetimeMilliseconds = params.authorizationExpiresAt.getTime() - now.getTime();
		if (!Number.isFinite(params.authorizationExpiresAt.getTime()) ||
			authorizationLifetimeMilliseconds <= 0 ||
			authorizationLifetimeMilliseconds > maximumAuthorizationLifetimeSeconds * 1000) {
			throw new InvalidGrantError();
		}

		const grantId = this.idService.gen(now.getTime());
		const response = await this.db.transaction(async manager => await this.createTokenSet(manager, {
			grantId,
			userId: params.userId,
			clientId: params.clientId,
			clientName: params.clientName,
			scope: [...params.scope],
			authorizationExpiresAt: params.authorizationExpiresAt,
			refreshSequence: 0,
			now,
		}));

		return { grantId, response };
	}

	public async refreshAuthorization(refreshToken: string, clientId: string): Promise<MiniAppOAuthTokenResponse> {
		const refreshTokenId = this.refreshTokenIdFromRefreshToken(refreshToken);
		if (refreshTokenId == null) throw new InvalidGrantError();

		const tokenHash = this.hashToken(refreshToken);
		const result = await this.db.transaction(async manager => {
			const refreshTokensRepository = manager.getRepository(MiMiniAppOAuthRefreshToken);
			const current = await refreshTokensRepository.createQueryBuilder('token')
				.setLock('pessimistic_write')
				.where('token.id = :refreshTokenId', { refreshTokenId })
				.getOne();

			if (current == null || current.clientId !== clientId) {
				return null;
			}

			if (!this.hashesMatch(current.tokenHash, tokenHash)) {
				await this.deleteGrant(manager, current.grantId);
				return null;
			}

			if (current.authorizationExpiresAt.getTime() <= Date.now() + minimumAuthorizationLifetimeSeconds * 1000) {
				await this.deleteGrant(manager, current.grantId);
				return null;
			}

			const now = new Date();
			await manager.delete(MiAccessToken, { miniAppOAuthGrantId: current.grantId });

			return await this.createTokenSet(manager, {
				grantId: current.grantId,
				userId: current.userId,
				clientId: current.clientId,
				clientName: current.clientName,
				scope: [...current.scope],
				authorizationExpiresAt: current.authorizationExpiresAt,
				refreshSequence: current.refreshSequence + 1,
				now,
			}, current.id);
		});

		if (result == null) {
			throw new InvalidGrantError();
		}

		return result;
	}

	public async revoke(token: string): Promise<void> {
		const tokenHash = this.hashToken(token);
		await this.db.transaction(async manager => {
			const refreshTokenId = this.refreshTokenIdFromRefreshToken(token);
			const refreshToken = refreshTokenId == null
				? null
				: await manager.getRepository(MiMiniAppOAuthRefreshToken).findOneBy({ id: refreshTokenId });
			if (refreshToken != null && this.hashesMatch(refreshToken.tokenHash, tokenHash)) {
				await this.deleteGrant(manager, refreshToken.grantId);
				return;
			}

			const accessToken = await manager.getRepository(MiAccessToken).findOneBy({ token });
			if (accessToken?.miniAppOAuthGrantId != null) {
				await this.deleteGrant(manager, accessToken.miniAppOAuthGrantId);
			} else if (accessToken != null) {
				await manager.delete(MiAccessToken, accessToken.id);
			}
		});
	}

	public async revokeGrant(grantId: string): Promise<void> {
		await this.db.transaction(async manager => await this.deleteGrant(manager, grantId));
	}

	private async createTokenSet(manager: EntityManager, params: TokenSetParams, refreshTokenId?: string): Promise<MiniAppOAuthTokenResponse> {
		const authorizationExpiresIn = Math.floor((params.authorizationExpiresAt.getTime() - params.now.getTime()) / 1000) -
			(params.refreshSequence === 0 ? 0 : authorizationLifetimeSafetySecondsPerRefresh);
		if (authorizationExpiresIn < minimumAuthorizationLifetimeSeconds) {
			throw new InvalidGrantError();
		}

		const expiresIn = Math.min(accessTokenLifetimeSeconds, authorizationExpiresIn);
		const accessToken = secureRndstr(128);
		const currentRefreshTokenId = refreshTokenId ?? secureRndstr(32);
		const refreshToken = `${currentRefreshTokenId}_${secureRndstr(128)}`;

		await manager.insert(MiAccessToken, {
			// Keep the row identifier stable across refresh rotation so a revoke
			// action opened from the user's app settings cannot become stale.
			id: params.grantId,
			lastUsedAt: params.now,
			userId: params.userId,
			token: accessToken,
			hash: accessToken,
			name: params.clientName,
			permission: [...params.scope],
			miniAppOAuthGrantId: params.grantId,
			expiresAt: new Date(params.now.getTime() + expiresIn * 1000),
		});

		const refreshTokenState = {
			tokenHash: this.hashToken(refreshToken),
			grantId: params.grantId,
			userId: params.userId,
			clientId: params.clientId,
			clientName: params.clientName,
			scope: [...params.scope],
			authorizationExpiresAt: params.authorizationExpiresAt,
			refreshSequence: params.refreshSequence,
		};
		if (refreshTokenId == null) {
			await manager.insert(MiMiniAppOAuthRefreshToken, {
				// This ID is also the refresh-token lookup prefix. It must be
				// unguessable so a forged prefix cannot revoke another grant.
				id: currentRefreshTokenId,
				...refreshTokenState,
			});
		} else {
			await manager.update(MiMiniAppOAuthRefreshToken, refreshTokenId, refreshTokenState);
		}

		return {
			access_token: accessToken,
			token_type: 'Bearer',
			scope: params.scope.join(' '),
			expires_in: expiresIn,
			refresh_token: refreshToken,
			authorization_expires_in: authorizationExpiresIn,
		};
	}

	private async deleteGrant(manager: EntityManager, grantId: string): Promise<void> {
		await manager.delete(MiAccessToken, { miniAppOAuthGrantId: grantId });
		await manager.delete(MiMiniAppOAuthRefreshToken, { grantId });
	}

	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}

	private hashesMatch(left: string, right: string): boolean {
		if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
		return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
	}

	private refreshTokenIdFromRefreshToken(token: string): string | null {
		const separator = token.indexOf('_');
		if (separator < 1 || separator > 64) return null;
		if (!/^[0-9A-Za-z]+$/.test(token.slice(0, separator))) return null;
		if (!/^[0-9A-Za-z]{128}$/.test(token.slice(separator + 1))) return null;
		return token.slice(0, separator);
	}
}
