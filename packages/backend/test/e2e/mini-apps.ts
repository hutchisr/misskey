/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { MiAccessToken } from '@/models/AccessToken.js';
import { api, castAsError, initTestDb, origin, relativeFetch, signup } from '../utils.js';
import type { DataSource } from 'typeorm';
import type * as misskey from 'misskey-js';

describe('Fediverse Mini Apps API', () => {
	let db: DataSource;
	let alice: misskey.entities.SignupResponse;

	const fullToken = 'a'.repeat(128);
	const identifyToken = 'b'.repeat(128);
	const writeToken = 'c'.repeat(128);
	const fullCredential = { token: fullToken, bearer: true } as const;
	const identifyCredential = { token: identifyToken, bearer: true } as const;
	const writeCredential = { token: writeToken, bearer: true } as const;

	beforeAll(async () => {
		db = await initTestDb(true);
		alice = await signup({ username: 'miniapp_alice' });

		const expiresAt = new Date(Date.now() + (60 * 60 * 1000));
		await db.getRepository(MiAccessToken).insert([{
			id: 'a'.repeat(32),
			lastUsedAt: new Date(),
			token: fullToken,
			hash: fullToken,
			userId: alice.id,
			name: 'Full-scope mini app',
			permission: ['identify', 'write'],
			miniAppOAuthGrantId: 'd'.repeat(32),
			expiresAt,
		}, {
			id: 'b'.repeat(32),
			lastUsedAt: new Date(),
			token: identifyToken,
			hash: identifyToken,
			userId: alice.id,
			name: 'Identify-only mini app',
			permission: ['identify'],
			miniAppOAuthGrantId: 'e'.repeat(32),
			expiresAt,
		}, {
			id: 'c'.repeat(32),
			lastUsedAt: new Date(),
			token: writeToken,
			hash: writeToken,
			userId: alice.id,
			name: 'Write-only mini app',
			permission: ['write'],
			miniAppOAuthGrantId: 'f'.repeat(32),
			expiresAt,
		}]);
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await db.destroy();
	});

	describe('mini-apps/resolve', () => {
		test('validates the request body through the registered HTTP route', async () => {
			// @ts-expect-error url is required
			const res = await api('mini-apps/resolve', {}, alice);

			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'INVALID_PARAM');
		});

		test('maps an invalid app URL to the compatibility error', async () => {
			const res = await api('mini-apps/resolve', {
				url: 'http://miniapp.example/game',
			}, alice);

			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'INVALID_MINI_APP_URL');
		});

		test('accepts a valid URL shape and maps a guarded fetch failure', async () => {
			const res = await api('mini-apps/resolve', {
				// Loopback makes the failure deterministic without relying on an
				// external mini app or allowing a successful local fetch.
				url: 'https://127.0.0.1/game#launch',
			}, alice);

			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'MINI_APP_MANIFEST_UNAVAILABLE');
		});
	});

	describe('v1/mini-apps/identity', () => {
		test('supports GET with a mini app Bearer credential', async () => {
			const res = await relativeFetch('api/v1/mini-apps/identity', {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${fullToken}`,
				},
			});
			const body = await res.json() as {
				id: string;
				username: string;
				url: string;
			};

			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(body, {
				id: new URL(`/users/${alice.id}`, origin).toString(),
				username: alice.username,
				url: new URL(`/@${alice.username}`, origin).toString(),
			});
		});

		test('supports the generated POST API route', async () => {
			const res = await api('v1/mini-apps/identity', {}, fullCredential);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.username, alice.username);
		});

		test('rejects an ordinary user credential', async () => {
			const res = await api('v1/mini-apps/identity', {}, alice);

			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body).error.code, 'MINI_APP_CREDENTIAL_REQUIRED');
		});

		test('enforces the identify scope', async () => {
			const res = await api('v1/mini-apps/identity', {}, writeCredential);

			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body).error.code, 'PERMISSION_DENIED');
		});
	});

	describe('v1/statuses', () => {
		test('creates a public note with a mini app Bearer credential', async () => {
			const status = 'Planted a test crop';
			const res = await api('v1/statuses', { status }, fullCredential);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.url, new URL(`/notes/${res.body.id}`, origin).toString());

			const note = await api('notes/show', { noteId: res.body.id }, alice);
			assert.strictEqual(note.status, 200);
			assert.strictEqual(note.body.text, status);
			assert.strictEqual(note.body.visibility, 'public');
		});

		test('rejects an ordinary user credential', async () => {
			const res = await api('v1/statuses', { status: 'ordinary credential' }, alice);

			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body).error.code, 'MINI_APP_CREDENTIAL_REQUIRED');
		});

		test('enforces the write scope', async () => {
			const res = await api('v1/statuses', { status: 'identify only' }, identifyCredential);

			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body).error.code, 'PERMISSION_DENIED');
		});

		test('validates the compatibility request schema', async () => {
			// @ts-expect-error only public statuses are supported
			const res = await api('v1/statuses', { status: 'not public', visibility: 'followers' }, fullCredential);

			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'INVALID_PARAM');
		});

		test('cannot use a mini app credential on a regular Misskey endpoint', async () => {
			const res = await api('i', {}, fullCredential);

			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body).error.code, 'PERMISSION_DENIED');
			assert.strictEqual(castAsError(res.body).error.id, '327276a5-ac71-4f0f-8a0b-e7a9b9f5c8ad');
		});
	});
});
