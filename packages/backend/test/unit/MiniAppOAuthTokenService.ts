/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { IdService } from '@/core/IdService.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiMiniAppOAuthRefreshToken } from '@/models/MiniAppOAuthRefreshToken.js';
import { MiniAppOAuthTokenService } from '@/core/MiniAppOAuthTokenService.js';
import RevokeTokenEndpoint from '@/server/api/endpoints/i/revoke-token.js';
import type { AccessTokensRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

type StoredAccessToken = Pick<MiAccessToken, 'id' | 'token' | 'miniAppOAuthGrantId' | 'expiresAt' | 'name'> & Partial<MiAccessToken>;
type StoredRefreshToken = Pick<MiMiniAppOAuthRefreshToken, 'id' | 'tokenHash' | 'grantId' | 'userId' | 'clientId' | 'clientName' | 'scope' | 'authorizationExpiresAt' | 'refreshSequence'>;

function matches(value: ObjectLiteral, criteria: ObjectLiteral): boolean {
	return Object.entries(criteria).every(([key, expected]) => value[key] === expected);
}

function createHarness(): {
	service: MiniAppOAuthTokenService;
	accessTokens: StoredAccessToken[];
	refreshTokens: StoredRefreshToken[];
} {
	const accessTokens: StoredAccessToken[] = [];
	const refreshTokens: StoredRefreshToken[] = [];
	let sequence = 0;

	const manager = {
		async insert(entity: typeof MiAccessToken | typeof MiMiniAppOAuthRefreshToken, value: ObjectLiteral): Promise<void> {
			if (entity === MiAccessToken) accessTokens.push(value as StoredAccessToken);
			if (entity === MiMiniAppOAuthRefreshToken) refreshTokens.push(value as StoredRefreshToken);
		},
		async update(entity: typeof MiMiniAppOAuthRefreshToken, id: string, value: ObjectLiteral): Promise<void> {
			if (entity !== MiMiniAppOAuthRefreshToken) return;
			const current = refreshTokens.find(token => token.id === id);
			if (current != null) Object.assign(current, value);
		},
		async delete(entity: typeof MiAccessToken | typeof MiMiniAppOAuthRefreshToken, criteria: ObjectLiteral | string): Promise<void> {
			const values = entity === MiAccessToken ? accessTokens : refreshTokens;
			const normalizedCriteria = typeof criteria === 'string' ? { id: criteria } : criteria;
			for (let i = values.length - 1; i >= 0; i--) {
				if (matches(values[i], normalizedCriteria)) values.splice(i, 1);
			}
		},
		getRepository(entity: typeof MiAccessToken | typeof MiMiniAppOAuthRefreshToken) {
			const values = entity === MiAccessToken ? accessTokens : refreshTokens;
			let refreshTokenId: string | undefined;
			const query = {
				setLock: () => query,
				where: (_condition: string, parameters: { refreshTokenId: string }) => {
					refreshTokenId = parameters.refreshTokenId;
					return query;
				},
				getOne: async () => entity === MiMiniAppOAuthRefreshToken
					? refreshTokens.find(value => value.id === refreshTokenId) ?? null
					: null,
			};
			return {
				createQueryBuilder: () => query,
				findOneBy: async (criteria: ObjectLiteral) => values.find(value => matches(value, criteria)) ?? null,
			};
		},
	} as unknown as EntityManager;

	const db = {
		transaction: async <T>(callback: (transactionManager: EntityManager) => Promise<T>) => await callback(manager),
	} as DataSource;
	const idService = {
		gen: () => `id${++sequence}`,
	} as IdService;

	return {
		service: new MiniAppOAuthTokenService(db, idService),
		accessTokens,
		refreshTokens,
	};
}

async function issue(harness: ReturnType<typeof createHarness>) {
	return await harness.service.issueAuthorization({
		userId: 'user1',
		clientId: 'https://farm.example/.well-known/fediverse-miniapp.json',
		clientName: 'Open Farm Game',
		scope: ['identify', 'write'],
		authorizationExpiresAt: new Date(Date.now() + 31_536_000_000),
	});
}

describe('MiniAppOAuthTokenService', () => {
	test('issues a bounded access token and one current refresh row', async () => {
		const harness = createHarness();
		const issued = await issue(harness);

		expect(issued.response).toMatchObject({
			token_type: 'Bearer',
			scope: 'identify write',
			expires_in: 3600,
		});
		expect(issued.response.authorization_expires_in).toBeGreaterThanOrEqual(31_535_999);
		expect(harness.accessTokens).toHaveLength(1);
		expect(harness.accessTokens[0].name).toBe('Open Farm Game');
		expect(harness.accessTokens[0].miniAppOAuthGrantId).toBe(issued.grantId);
		expect(harness.refreshTokens).toHaveLength(1);
		expect(harness.refreshTokens[0].grantId).toBe(issued.grantId);
	});

	test('rotates in place and revokes the family when an old refresh token is replayed', async () => {
		const harness = createHarness();
		const issued = await issue(harness);
		const stableAccessTokenId = harness.accessTokens[0].id;
		const rotated = await harness.service.refreshAuthorization(issued.response.refresh_token, 'https://farm.example/.well-known/fediverse-miniapp.json');

		expect(rotated.refresh_token).not.toBe(issued.response.refresh_token);
		expect(rotated.access_token).not.toBe(issued.response.access_token);
		expect(rotated.authorization_expires_in).toBeLessThanOrEqual(issued.response.authorization_expires_in - 120);
		expect(harness.accessTokens).toHaveLength(1);
		expect(harness.accessTokens[0].id).toBe(stableAccessTokenId);
		expect(stableAccessTokenId).toBe(issued.grantId);
		expect(harness.refreshTokens).toHaveLength(1);

		await expect(harness.service.refreshAuthorization(issued.response.refresh_token, 'https://farm.example/.well-known/fediverse-miniapp.json')).rejects.toMatchObject({ error: 'invalid_grant' });
		expect(harness.accessTokens).toHaveLength(0);
		expect(harness.refreshTokens).toHaveLength(0);
	});

	test('a settings token id captured before refresh still revokes the rotated grant', async () => {
		const harness = createHarness();
		const issued = await issue(harness);
		const settingsTokenId = harness.accessTokens[0].id;
		await harness.service.refreshAuthorization(issued.response.refresh_token, 'https://farm.example/.well-known/fediverse-miniapp.json');

		const endpoint = new RevokeTokenEndpoint({
			findOneBy: async (criteria: ObjectLiteral) => harness.accessTokens.find(token => matches(token, criteria)) ?? null,
			delete: async (criteria: ObjectLiteral | string) => {
				const id = typeof criteria === 'string' ? criteria : criteria.id;
				const index = harness.accessTokens.findIndex(token => token.id === id);
				if (index >= 0) harness.accessTokens.splice(index, 1);
			},
		} as unknown as AccessTokensRepository, harness.service);
		const user = { id: 'user1', host: null, uri: null } as MiLocalUser;

		await endpoint.exec({ tokenId: settingsTokenId }, user, null);
		expect(harness.accessTokens).toHaveLength(0);
		expect(harness.refreshTokens).toHaveLength(0);
	});

	test('a wrong client cannot rotate or revoke the legitimate family', async () => {
		const harness = createHarness();
		const issued = await issue(harness);

		await expect(harness.service.refreshAuthorization(issued.response.refresh_token, 'https://other.example/.well-known/fediverse-miniapp.json')).rejects.toMatchObject({ error: 'invalid_grant' });
		expect(harness.accessTokens).toHaveLength(1);
		expect(harness.refreshTokens).toHaveLength(1);
	});

	test('a forged refresh lookup prefix cannot revoke another grant', async () => {
		const harness = createHarness();
		await issue(harness);

		await expect(harness.service.refreshAuthorization(`${'z'.repeat(32)}_${'x'.repeat(128)}`, 'https://farm.example/.well-known/fediverse-miniapp.json')).rejects.toMatchObject({ error: 'invalid_grant' });
		expect(harness.accessTokens).toHaveLength(1);
		expect(harness.refreshTokens).toHaveLength(1);
	});

	test('uses a constant refresh safety margin instead of shortening the grant on every rotation', async () => {
		const harness = createHarness();
		const issued = await issue(harness);
		const first = await harness.service.refreshAuthorization(issued.response.refresh_token, 'https://farm.example/.well-known/fediverse-miniapp.json');
		const second = await harness.service.refreshAuthorization(first.refresh_token, 'https://farm.example/.well-known/fediverse-miniapp.json');

		expect(first.authorization_expires_in).toBeLessThanOrEqual(issued.response.authorization_expires_in - 120);
		expect(second.authorization_expires_in).toBeGreaterThanOrEqual(issued.response.authorization_expires_in - 125);
	});

	test('revoking an access token removes its complete refresh family', async () => {
		const harness = createHarness();
		const issued = await issue(harness);

		await harness.service.revoke(issued.response.access_token);
		expect(harness.accessTokens).toHaveLength(0);
		expect(harness.refreshTokens).toHaveLength(0);
	});

	test('revoking a legacy OAuth access token deletes that token', async () => {
		const harness = createHarness();
		harness.accessTokens.push({
			id: 'legacy1',
			token: 'legacy-access-token',
			miniAppOAuthGrantId: null,
			expiresAt: null,
			name: 'Legacy OAuth client',
		});

		await harness.service.revoke('legacy-access-token');
		expect(harness.accessTokens).toHaveLength(0);
	});
});
