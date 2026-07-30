/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { Config } from '@/config.js';
import type { NoteCreateService } from '@/core/NoteCreateService.js';
import type { OAuthTokenService } from '@/core/OAuthTokenService.js';
import type { MiniAppManifestService, ResolvedMiniAppManifest } from '@/core/MiniAppManifestService.js';
import type { AccessTokensRepository, AppsRepository, UsersRepository } from '@/models/_.js';
import type { MiAccessToken } from '@/models/AccessToken.js';
import type { MiLocalUser } from '@/models/User.js';
import { AuthenticateService } from '@/server/api/AuthenticateService.js';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import IdentityEndpoint from '@/server/api/endpoints/v1/mini-apps/identity.js';
import StatusesEndpoint from '@/server/api/endpoints/v1/statuses.js';
import RevokeTokenEndpoint from '@/server/api/endpoints/i/revoke-token.js';
import ResolveMiniAppEndpoint from '@/server/api/endpoints/mini-apps/resolve.js';
import { meta as notesShowMeta, paramDef as notesShowParamDef } from '@/server/api/endpoints/notes/show.js';
import type { CacheService } from '@/core/CacheService.js';
import type { RateLimiterService } from '@/server/api/RateLimiterService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { ApiLoggerService } from '@/server/api/ApiLoggerService.js';
import type { MiMeta, UserIpsRepository } from '@/models/_.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

vi.mock('re2', () => ({ default: RegExp }));

const config = { url: 'https://misskey.example/' } as Config;
const user = { id: 'user1', username: 'alice', host: null, uri: null } as MiLocalUser;
const miniAppToken = { id: 'token1', oauthGrantId: 'grant1', oauthClientKind: 'miniapp' } as MiAccessToken;
const ordinaryToken = { id: 'token2', oauthGrantId: 'grant2', oauthClientKind: 'oauth' } as MiAccessToken;

describe('Fediverse Mini App compatibility API', () => {
	test('resolving a mini app returns its canonical launch metadata', async () => {
		const resolved = {
			manifestUrl: 'https://farm.example/.well-known/fediverse-miniapp.json',
			appOrigin: 'https://farm.example',
			launchUrl: 'https://farm.example/from-note',
			expiresAt: '2026-01-01T00:05:00.000Z',
			manifest: {
				homeUrl: 'https://farm.example/play',
				name: 'Open Farm Game',
				iconUrl: 'https://farm.example/icon.png',
			},
		} as unknown as ResolvedMiniAppManifest;
		const resolveAppUrl = vi.fn(async () => resolved);
		const endpoint = new ResolveMiniAppEndpoint(
			{ resolveAppUrl } as unknown as MiniAppManifestService,
		);

		await expect(endpoint.exec({ url: resolved.launchUrl }, user, null)).resolves.toBe(resolved);
		expect(resolveAppUrl).toHaveBeenCalledWith(resolved.launchUrl);
	});

	test('identity returns a same-origin profile only for mini app credentials', async () => {
		const endpoint = new IdentityEndpoint(config);

		await expect(endpoint.exec({}, user, ordinaryToken)).rejects.toMatchObject({
			code: 'MINI_APP_CREDENTIAL_REQUIRED',
		});
		await expect(endpoint.exec({}, user, null)).rejects.toMatchObject({
			code: 'MINI_APP_CREDENTIAL_REQUIRED',
		});
		await expect(endpoint.exec({}, user, miniAppToken)).resolves.toEqual({
			id: 'https://misskey.example/users/user1',
			username: 'alice',
			url: 'https://misskey.example/@alice',
		});
	});

	test('statuses creates an ordinary public Misskey note only for mini app credentials', async () => {
		const create = vi.fn(async () => ({ id: 'note1' }));
		const endpoint = new StatusesEndpoint(config, { create } as unknown as NoteCreateService);

		await expect(endpoint.exec({ status: 'Harvest complete' }, user, ordinaryToken)).rejects.toMatchObject({
			code: 'MINI_APP_CREDENTIAL_REQUIRED',
		});
		await expect(endpoint.exec({ status: 'Harvest complete' }, user, miniAppToken)).resolves.toEqual({
			id: 'note1',
			url: 'https://misskey.example/notes/note1',
		});
		expect(create).toHaveBeenCalledWith(user, {
			text: 'Harvest complete',
			visibility: 'public',
			localOnly: false,
		});
	});

	test('i/revoke-token revokes a mini app token family and enforces ownership in its lookup', async () => {
		const findOneBy = vi.fn(async () => miniAppToken);
		const deleteToken = vi.fn();
		const revokeGrant = vi.fn();
		const endpoint = new RevokeTokenEndpoint(
			{ findOneBy, delete: deleteToken } as unknown as AccessTokensRepository,
			{ revokeGrant } as unknown as OAuthTokenService,
		);

		await endpoint.exec({ tokenId: 'token1' }, user, null);

		expect(findOneBy).toHaveBeenCalledWith({ id: 'token1', userId: user.id });
		expect(revokeGrant).toHaveBeenCalledWith('grant1');
		expect(deleteToken).not.toHaveBeenCalled();
	});

	test('authentication rejects and removes an expired access token', async () => {
		const deleteToken = vi.fn();
		const update = vi.fn();
		const service = new AuthenticateService(
			{} as UsersRepository,
			{
				findOne: vi.fn(async () => ({
					id: 'expired1',
					expiresAt: new Date(Date.now() - 1000),
				})),
				delete: deleteToken,
				update,
			} as unknown as AccessTokensRepository,
			{} as AppsRepository,
			{} as CacheService,
		);

		await expect(service.authenticate('x'.repeat(128))).rejects.toMatchObject({
			message: 'token expired',
		});
		expect(deleteToken).toHaveBeenCalledWith('expired1');
		expect(update).not.toHaveBeenCalled();
		service.dispose();
	});

	test('the API dispatcher rejects a mini app credential on an ordinary optional-auth endpoint', async () => {
		const authenticate = vi.fn(async () => [user, miniAppToken] as const);
		const exec = vi.fn();
		let finish!: () => void;
		const sent = new Promise<void>(resolve => { finish = resolve; });
		const reply = {
			code: vi.fn(function (this: unknown) { return this; }),
			header: vi.fn(function (this: unknown) { return this; }),
			send: vi.fn(() => { finish(); }),
		} as unknown as FastifyReply;
		const service = new ApiCallService(
			{ enableIpLogging: false } as unknown as MiMeta,
			{ enableIpRateLimit: false } as unknown as Config,
			{} as UserIpsRepository,
			{ authenticate } as unknown as AuthenticateService,
			{} as RateLimiterService,
			{} as RoleService,
			{ logger: { error: vi.fn(), warn: vi.fn() } } as unknown as ApiLoggerService,
		);
		const request = {
			method: 'POST',
			headers: { authorization: `Bearer ${'x'.repeat(128)}` },
			body: { noteId: 'note1' },
			query: {},
			ip: '203.0.113.10',
		} as unknown as FastifyRequest<{ Body: Record<string, unknown>, Querystring: Record<string, unknown> }>;

		service.handleRequest({
			name: 'notes/show',
			meta: notesShowMeta,
			params: notesShowParamDef,
			exec,
		}, request, reply);
		await sent;

		expect(exec).not.toHaveBeenCalled();
		expect(reply.code).toHaveBeenCalledWith(403);
		expect(reply.send).toHaveBeenCalledWith({
			error: expect.objectContaining({ code: 'PERMISSION_DENIED' }),
		});
		service.dispose();
	});
});
