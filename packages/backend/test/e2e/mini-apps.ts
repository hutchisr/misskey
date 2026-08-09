/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { api, castAsError, initTestDb, origin, relativeFetch, signup } from '../utils.js';
import type { DataSource } from 'typeorm';
import type * as misskey from 'misskey-js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiOAuthGrant } from '@/models/OAuthGrant.js';
import { MiOAuthClient } from '@/models/OAuthClient.js';

function createRestoreProof(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	return {
		verifier,
		challenge: createHash('sha256').update(verifier).digest('base64url'),
	};
}

async function postJson(
	path: string,
	payload: Record<string, unknown>,
	credential?: { token: string },
	headers: Record<string, string> = {},
) {
	const response = await relativeFetch(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...headers,
		},
		body: JSON.stringify(credential == null ? payload : { ...payload, i: credential.token }),
	});
	const body = await response.json() as Record<string, unknown>;
	return { response, body };
}

describe('Fediverse Mini Apps API', () => {
	let db: DataSource;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	const fullToken = 'a'.repeat(128);
	const identifyToken = 'b'.repeat(128);
	const writeToken = 'c'.repeat(128);
	const fullCredential = { token: fullToken, bearer: true } as const;
	const identifyCredential = { token: identifyToken, bearer: true } as const;
	const writeCredential = { token: writeToken, bearer: true } as const;

	beforeAll(async () => {
		db = await initTestDb(true);
		alice = await signup({ username: 'miniapp_alice' });
		bob = await signup({ username: 'miniapp_bob' });

		const expiresAt = new Date(Date.now() + (60 * 60 * 1000));
		await db.getRepository(MiAccessToken).insert([{
			id: 'a'.repeat(32),
			lastUsedAt: new Date(),
			token: fullToken,
			hash: fullToken,
			userId: alice.id,
			name: 'Full-scope mini app',
			permission: ['identify', 'write'],
			oauthGrantId: 'd'.repeat(32),
			oauthClientKind: 'miniapp',
			expiresAt,
		}, {
			id: 'b'.repeat(32),
			lastUsedAt: new Date(),
			token: identifyToken,
			hash: identifyToken,
			userId: alice.id,
			name: 'Identify-only mini app',
			permission: ['identify'],
			oauthGrantId: 'e'.repeat(32),
			oauthClientKind: 'miniapp',
			expiresAt,
		}, {
			id: 'c'.repeat(32),
			lastUsedAt: new Date(),
			token: writeToken,
			hash: writeToken,
			userId: alice.id,
			name: 'Write-only mini app',
			permission: ['write'],
			oauthGrantId: 'f'.repeat(32),
			oauthClientKind: 'miniapp',
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

	describe('mini-apps/list', () => {
		beforeAll(async () => {
			const older = new Date('2026-01-01T00:00:00.000Z');
			const newer = new Date('2026-01-02T00:00:00.000Z');
			const authorizationExpiresAt = new Date(Date.now() + (60 * 60 * 1000));
			await db.getRepository(MiOAuthClient).insert([{
				id: '1'.repeat(32),
				createdAt: older,
				kind: 'miniapp',
				metadata: {
					redirect_uris: ['https://older-miniapp.example/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					scope: 'identify write',
					fediverse_miniapp_manifest_uri: 'https://older-miniapp.example/.well-known/fediverse-miniapp.json',
					client_uri: 'https://older-miniapp.example/',
					client_name: 'Older Mini App',
				},
			}, {
				id: '2'.repeat(32),
				createdAt: newer,
				kind: 'miniapp',
				metadata: {
					redirect_uris: ['https://newer-miniapp.example/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					scope: 'identify write',
					fediverse_miniapp_manifest_uri: 'https://newer-miniapp.example/.well-known/fediverse-miniapp.json',
					client_uri: 'https://newer-miniapp.example/play',
					client_name: 'Newer Mini App',
					logo_uri: 'https://newer-miniapp.example/icon.png',
				},
			}, {
				id: '3'.repeat(32),
				createdAt: newer,
				kind: 'miniapp',
				metadata: {
					redirect_uris: ['https://bob-miniapp.example/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					scope: 'identify write',
					fediverse_miniapp_manifest_uri: 'https://bob-miniapp.example/.well-known/fediverse-miniapp.json',
					client_uri: 'https://bob-miniapp.example/',
					client_name: 'Bob Mini App',
				},
			}]);
			await db.getRepository(MiOAuthGrant).insert([{
				id: '4'.repeat(32),
				tokenHash: '4'.repeat(64),
				grantId: '7'.repeat(32),
				userId: alice.id,
				clientId: '1'.repeat(32),
				clientKind: 'miniapp',
				clientName: 'Older Mini App',
				scope: ['identify', 'write'],
				authorizationExpiresAt,
				refreshSequence: 0,
			}, {
				id: '5'.repeat(32),
				tokenHash: '5'.repeat(64),
				grantId: '8'.repeat(32),
				userId: alice.id,
				clientId: '2'.repeat(32),
				clientKind: 'miniapp',
				clientName: 'Newer Mini App',
				scope: ['identify', 'write'],
				authorizationExpiresAt,
				refreshSequence: 0,
			}, {
				id: '6'.repeat(32),
				tokenHash: '6'.repeat(64),
				grantId: '9'.repeat(32),
				userId: bob.id,
				clientId: '3'.repeat(32),
				clientKind: 'miniapp',
				clientName: 'Bob Mini App',
				scope: ['identify', 'write'],
				authorizationExpiresAt,
				refreshSequence: 0,
			}]);
			await db.getRepository(MiAccessToken).insert([{
				id: '7'.repeat(32),
				lastUsedAt: older,
				token: 'd'.repeat(128),
				hash: 'd'.repeat(128),
				userId: alice.id,
				name: 'Older Mini App',
				permission: ['identify', 'write'],
				oauthGrantId: '7'.repeat(32),
				oauthClientKind: 'miniapp',
				expiresAt: authorizationExpiresAt,
			}, {
				id: '8'.repeat(32),
				lastUsedAt: newer,
				token: 'e'.repeat(128),
				hash: 'e'.repeat(128),
				userId: alice.id,
				name: 'Newer Mini App',
				permission: ['identify', 'write'],
				oauthGrantId: '8'.repeat(32),
				oauthClientKind: 'miniapp',
				expiresAt: authorizationExpiresAt,
			}, {
				id: '9'.repeat(32),
				lastUsedAt: newer,
				token: 'f'.repeat(128),
				hash: 'f'.repeat(128),
				userId: bob.id,
				name: 'Bob Mini App',
				permission: ['identify', 'write'],
				oauthGrantId: '9'.repeat(32),
				oauthClientKind: 'miniapp',
				expiresAt: authorizationExpiresAt,
			}]);
		});

		test('lists only the current user\'s authorized clients, most recently used first', async () => {
			const res = await api('mini-apps/list', { limit: 12 }, alice);

			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body.map(app => app.name), ['Newer Mini App', 'Older Mini App']);
			assert.strictEqual(res.body[0].iconUrl, 'https://newer-miniapp.example/icon.png');
		});

		test('honors the requested limit', async () => {
			const res = await api('mini-apps/list', { limit: 1 }, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.length, 1);
			assert.strictEqual(res.body[0].name, 'Newer Mini App');
		});

		test('requires an authenticated user', async () => {
			const res = await api('mini-apps/list', { limit: 12 });

			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as unknown as Record<string, unknown>).error.code, 'ACCESS_DENIED');
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

	describe('Mini App session restore', () => {
		const restoreClientId = 'a'.repeat(32);
		const restoreGrantId = 'c'.repeat(32);
		const restoreManifestUrl = 'https://restore-miniapp.example/.well-known/fediverse-miniapp.json';

		beforeAll(async () => {
			await db.getRepository(MiOAuthClient).insert({
				id: restoreClientId,
				createdAt: new Date(),
				kind: 'miniapp',
				metadata: {
					redirect_uris: ['https://restore-miniapp.example/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					scope: 'identify write',
					fediverse_miniapp_manifest_uri: restoreManifestUrl,
					client_uri: 'https://restore-miniapp.example/',
					client_name: 'Restore Mini App',
				},
			});
			await db.getRepository(MiOAuthGrant).insert({
				id: 'b'.repeat(32),
				tokenHash: 'a'.repeat(64),
				grantId: restoreGrantId,
				userId: alice.id,
				clientId: restoreClientId,
				clientKind: 'miniapp',
				clientName: 'Restore Mini App',
				scope: ['identify', 'write'],
				authorizationExpiresAt: new Date(Date.now() + (60 * 60 * 1000)),
				refreshSequence: 0,
			});
		});

		test('creates and consumes a one-time S256-bound identity proof', async () => {
			const proof = createRestoreProof();
			const created = await postJson('api/mini-apps/session-restores/create', {
				clientId: restoreClientId,
				manifestUrl: restoreManifestUrl,
				restoreChallenge: proof.challenge,
			}, alice);

			assert.strictEqual(created.response.status, 200);
			assert.strictEqual(created.body.status, 'success');
			assert.match(created.body.restoreCode as string, /^[A-Za-z0-9_-]{43}$/);

			const consumed = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: proof.verifier,
			});
			assert.strictEqual(consumed.response.status, 200);
			assert.deepStrictEqual(consumed.body, {
				issuer: origin,
				sub: new URL(`/users/${alice.id}`, origin).toString(),
				acct: `${alice.username}@${new URL(origin).host}`,
			});

			const replayed = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: proof.verifier,
			});
			assert.strictEqual(replayed.response.status, 400);
			assert.strictEqual(castAsError(replayed.body).error.code, 'INVALID_MINI_APP_SESSION_RESTORE');
		});

		test('burns a proof when verifier validation fails', async () => {
			const proof = createRestoreProof();
			const created = await postJson('api/mini-apps/session-restores/create', {
				clientId: restoreClientId,
				manifestUrl: restoreManifestUrl,
				restoreChallenge: proof.challenge,
			}, alice);

			const wrongVerifier = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: 'wrong',
			});
			assert.strictEqual(wrongVerifier.response.status, 400);
			assert.strictEqual(castAsError(wrongVerifier.body).error.code, 'INVALID_MINI_APP_SESSION_RESTORE');

			const correctVerifier = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: proof.verifier,
			});
			assert.strictEqual(correctVerifier.response.status, 400);
			assert.strictEqual(castAsError(correctVerifier.body).error.code, 'INVALID_MINI_APP_SESSION_RESTORE');
		});

		test('rejects browser-origin consumption without burning the backend proof', async () => {
			const proof = createRestoreProof();
			const created = await postJson('api/mini-apps/session-restores/create', {
				clientId: restoreClientId,
				manifestUrl: restoreManifestUrl,
				restoreChallenge: proof.challenge,
			}, alice);

			const browserAttempt = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: proof.verifier,
			}, undefined, {
				Origin: 'https://restore-miniapp.example',
			});
			assert.strictEqual(browserAttempt.response.status, 400);
			assert.strictEqual(castAsError(browserAttempt.body).error.code, 'INVALID_MINI_APP_SESSION_RESTORE');

			const backendAttempt = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: created.body.restoreCode,
				restoreVerifier: proof.verifier,
			});
			assert.strictEqual(backendAttempt.response.status, 200);
		});

		test('returns the fixed interaction-required shape for a client/manifest mismatch', async () => {
			const proof = createRestoreProof();
			const created = await postJson('api/mini-apps/session-restores/create', {
				clientId: restoreClientId,
				manifestUrl: 'https://other.example/.well-known/fediverse-miniapp.json',
				restoreChallenge: proof.challenge,
			}, alice);

			assert.strictEqual(created.response.status, 200);
			assert.deepStrictEqual(created.body, {
				status: 'interaction_required',
				restoreCode: null,
			});
		});

		test('validates both endpoint request schemas', async () => {
			const invalidCreate = await postJson('api/mini-apps/session-restores/create', {
				clientId: restoreClientId,
				manifestUrl: restoreManifestUrl,
				restoreChallenge: 'not-s256',
			}, alice);
			assert.strictEqual(invalidCreate.response.status, 400);
			assert.strictEqual(castAsError(invalidCreate.body).error.code, 'INVALID_PARAM');

			const invalidConsume = await postJson('api/v1/mini-apps/session-restores/consume', {
				restoreCode: 'a'.repeat(43),
			});
			assert.strictEqual(invalidConsume.response.status, 400);
			assert.strictEqual(castAsError(invalidConsume.body).error.code, 'INVALID_PARAM');
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
