/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Config } from '@/config.js';
import { MiniAppSessionRestoreService } from '@/core/MiniAppSessionRestoreService.js';
import { MiOAuthClient } from '@/models/OAuthClient.js';
import { MiOAuthGrant } from '@/models/OAuthGrant.js';
import type { MiUser } from '@/models/User.js';
import type * as Redis from 'ioredis';
import type { DataSource } from 'typeorm';

const issuer = 'https://misskey.example';
const manifestUrl = 'https://farm.example/.well-known/fediverse-miniapp.json';
const clientId = 'c'.repeat(32);
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function makeUser(overrides: Partial<MiUser> = {}): MiUser {
	return {
		id: 'user1',
		username: 'alice',
		host: null,
		isSuspended: false,
		isDeleted: false,
		...overrides,
	} as MiUser;
}

function makeGrant(user: MiUser, overrides: Partial<MiOAuthGrant> = {}): MiOAuthGrant {
	return {
		id: 'refresh1',
		tokenHash: 'a'.repeat(64),
		grantId: 'grant1',
		userId: user.id,
		user,
		clientId,
		clientKind: 'miniapp',
		clientName: 'Open Farm Game',
		scope: ['identify', 'write'],
		authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
		refreshSequence: 0,
		...overrides,
	};
}

function makeClient(overrides: Partial<MiOAuthClient> = {}): MiOAuthClient {
	return {
		id: clientId,
		createdAt: new Date(),
		kind: 'miniapp',
		metadata: {
			redirect_uris: ['https://farm.example/oauth/callback'],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			scope: 'identify write',
			fediverse_miniapp_manifest_uri: manifestUrl,
		},
		...overrides,
	};
}

function createHarness() {
	const user = makeUser();
	const grants = [makeGrant(user)];
	const clients = [makeClient()];
	const redisValues = new Map<string, string>();
	const set = vi.fn(async (key: string, value: string, ...options: (string | number)[]) => {
		if (options.includes('NX') && redisValues.has(key)) return null;
		redisValues.set(key, value);
		return 'OK';
	});
	const getdel = vi.fn(async (key: string) => {
		const value = redisValues.get(key) ?? null;
		redisValues.delete(key);
		return value;
	});
	const grantRepository = {
		findOne: vi.fn(async (options: { where: Record<string, unknown> }) => {
			const where = options.where;
			if (typeof where.grantId === 'string') {
				return grants.find(grant => grant.grantId === where.grantId) ?? null;
			}

			return grants.find(grant => (
				grant.userId === where.userId &&
				grant.clientId === where.clientId &&
				grant.clientKind === where.clientKind
			)) ?? null;
		}),
	};
	const clientRepository = {
		findOneBy: vi.fn(async (where: { id: string; kind: string }) => (
			clients.find(client => client.id === where.id && client.kind === where.kind) ?? null
		)),
	};
	const db = {
		getRepository: (entity: typeof MiOAuthGrant | typeof MiOAuthClient) => {
			if (entity === MiOAuthGrant) return grantRepository;
			if (entity === MiOAuthClient) return clientRepository;
			throw new Error('Unexpected repository');
		},
	} as unknown as DataSource;
	const redisClient = { set, getdel } as unknown as Redis.Redis;
	const service = new MiniAppSessionRestoreService({
		url: issuer,
		host: 'misskey.example',
	} as Config, db, redisClient);

	return {
		service,
		user,
		grants,
		clients,
		redisValues,
		set,
		getdel,
	};
}

describe('MiniAppSessionRestoreService', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('stores a digest-indexed proof with a bounded TTL and returns narrow identity once', async () => {
		const harness = createHarness();
		const restoreCode = await harness.service.create(harness.user.id, clientId, manifestUrl, challenge);
		expect(restoreCode).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const key = `miniapp:sessionRestore:${createHash('sha256').update(restoreCode!).digest('hex')}`;
		expect([...harness.redisValues.keys()]).toEqual([key]);
		expect(key).not.toContain(restoreCode!);
		expect(JSON.parse(harness.redisValues.get(key)!)).toEqual({
			grantId: 'grant1',
			clientId,
			manifestUrl,
			restoreChallenge: challenge,
		});
		expect(harness.set).toHaveBeenCalledWith(key, expect.any(String), 'EX', 300, 'NX');

		await expect(harness.service.consume(restoreCode!, verifier)).resolves.toEqual({
			issuer,
			sub: `${issuer}/users/user1`,
			acct: 'alice@misskey.example',
		});
		await expect(harness.service.consume(restoreCode!, verifier)).resolves.toBeNull();
	});

	test('allows only a canonical manifest URL as a legacy client id', async () => {
		const harness = createHarness();
		harness.clients.length = 0;
		harness.grants[0].clientId = manifestUrl;
		harness.grants[0].authorizationExpiresAt = new Date(Date.now() + 59 * 1000);

		const restoreCode = await harness.service.create(harness.user.id, manifestUrl, manifestUrl, challenge);
		expect(restoreCode).not.toBeNull();
		expect(harness.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 59, 'NX');
		await expect(harness.service.consume(restoreCode!, verifier)).resolves.toEqual({
			issuer,
			sub: `${issuer}/users/user1`,
			acct: 'alice@misskey.example',
		});

		const unsafeHarness = createHarness();
		unsafeHarness.clients.length = 0;
		unsafeHarness.grants[0].clientId = 'opaque-client-id';
		await expect(unsafeHarness.service.create(
			unsafeHarness.user.id,
			'opaque-client-id',
			'opaque-client-id',
			challenge,
		)).resolves.toBeNull();
		expect(unsafeHarness.set).not.toHaveBeenCalled();
	});

	test('requires exact dynamic client metadata and an active identify grant for the current user', async () => {
		const metadataMismatch = createHarness();
		metadataMismatch.clients[0].metadata.fediverse_miniapp_manifest_uri = 'https://other.example/.well-known/fediverse-miniapp.json';
		await expect(metadataMismatch.service.create(metadataMismatch.user.id, clientId, manifestUrl, challenge)).resolves.toBeNull();

		const wrongUser = createHarness();
		await expect(wrongUser.service.create('user2', clientId, manifestUrl, challenge)).resolves.toBeNull();

		const expired = createHarness();
		expired.grants[0].authorizationExpiresAt = new Date(Date.now());
		await expect(expired.service.create(expired.user.id, clientId, manifestUrl, challenge)).resolves.toBeNull();

		const ordinaryOAuth = createHarness();
		ordinaryOAuth.grants[0].clientKind = 'oauth';
		await expect(ordinaryOAuth.service.create(ordinaryOAuth.user.id, clientId, manifestUrl, challenge)).resolves.toBeNull();

		const noIdentify = createHarness();
		noIdentify.grants[0].scope = ['write'];
		await expect(noIdentify.service.create(noIdentify.user.id, clientId, manifestUrl, challenge)).resolves.toBeNull();

		for (const harness of [metadataMismatch, wrongUser, expired, ordinaryOAuth, noIdentify]) {
			expect(harness.set).not.toHaveBeenCalled();
		}
	});

	test('burns the proof before verifier validation', async () => {
		const harness = createHarness();
		const restoreCode = await harness.service.create(harness.user.id, clientId, manifestUrl, challenge);

		await expect(harness.service.consume(restoreCode!, 'too-short')).resolves.toBeNull();
		expect(harness.getdel).toHaveBeenCalledTimes(1);
		await expect(harness.service.consume(restoreCode!, verifier)).resolves.toBeNull();
		expect(harness.getdel).toHaveBeenCalledTimes(2);
	});

	test('rechecks the dynamic client and manifest binding at consume time', async () => {
		const removedClient = createHarness();
		const removedClientCode = await removedClient.service.create(removedClient.user.id, clientId, manifestUrl, challenge);
		removedClient.clients.length = 0;
		await expect(removedClient.service.consume(removedClientCode!, verifier)).resolves.toBeNull();

		const changedManifest = createHarness();
		const changedManifestCode = await changedManifest.service.create(changedManifest.user.id, clientId, manifestUrl, challenge);
		changedManifest.clients[0].metadata.fediverse_miniapp_manifest_uri = 'https://other.example/.well-known/fediverse-miniapp.json';
		await expect(changedManifest.service.consume(changedManifestCode!, verifier)).resolves.toBeNull();
	});

	test.each([
		['revoked grant', (harness: ReturnType<typeof createHarness>) => harness.grants.splice(0)],
		['expired grant', (harness: ReturnType<typeof createHarness>) => { harness.grants[0].authorizationExpiresAt = new Date(Date.now() - 1); }],
		['lost identify scope', (harness: ReturnType<typeof createHarness>) => { harness.grants[0].scope = ['write']; }],
		['suspended user', (harness: ReturnType<typeof createHarness>) => { harness.user.isSuspended = true; }],
		['deleted user', (harness: ReturnType<typeof createHarness>) => { harness.user.isDeleted = true; }],
	])('rejects a proof after its %s is no longer active', async (_label, deactivate) => {
		const harness = createHarness();
		const restoreCode = await harness.service.create(harness.user.id, clientId, manifestUrl, challenge);
		deactivate(harness);

		await expect(harness.service.consume(restoreCode!, verifier)).resolves.toBeNull();
		expect(harness.redisValues).toHaveLength(0);
	});
});
