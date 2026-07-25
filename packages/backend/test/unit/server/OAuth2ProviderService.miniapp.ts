/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import Fastify, { type FastifyInstance } from 'fastify';
import pkceChallenge from 'pkce-challenge';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccessTokensRepository, MiOAuthClient, OAuthClientsRepository, UsersRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import type { IdService } from '@/core/IdService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { MiniAppManifestService, ResolvedMiniAppManifest } from '@/core/MiniAppManifestService.js';
import type { CacheService } from '@/core/CacheService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { HtmlTemplateService } from '@/server/web/HtmlTemplateService.js';
import type { MiniAppOAuthTokenService, MiniAppOAuthTokenResponse } from '@/core/MiniAppOAuthTokenService.js';
import type { RateLimiterService } from '@/server/api/RateLimiterService.js';
import { OAuth2ProviderService } from '@/server/oauth/OAuth2ProviderService.js';
import { OAuthClientRegistrationService } from '@/server/oauth/OAuthClientRegistrationService.js';

vi.mock('re2', () => ({ default: RegExp }));

const issuer = 'https://misskey.example';
const appOrigin = 'https://farm.example';
const manifestUrl = `${appOrigin}/.well-known/fediverse-miniapp.json`;
const redirectUri = `${appOrigin}/oauth/callback`;
const registeredClientId = 'c'.repeat(32);
const state = 's'.repeat(43);

const resolvedManifest: ResolvedMiniAppManifest = {
	manifestUrl,
	appOrigin,
	launchUrl: `${appOrigin}/`,
	expiresAt: '2099-01-01T00:00:00.000Z',
	manifest: {
		version: '1',
		name: 'Open Farm Game',
		publisher: { name: 'Open Farm Game', url: `${appOrigin}/about` },
		homeUrl: `${appOrigin}/`,
		iconUrl: `${appOrigin}/icon.png`,
		splash: { imageUrl: `${appOrigin}/splash.png`, backgroundColor: '#173f2b' },
		oauth: {
			redirectUris: [redirectUri],
			scopes: ['identify', 'write'],
			scopeAuthorizationMaxAgeSeconds: { identify: 31_536_000, write: 31_536_000 },
		},
		activityPub: { actorUrl: `${appOrigin}/ap/actor`, publicNotes: true, transactionalMentions: false },
		capabilities: [],
		cacheTtlSeconds: 300,
	},
};

const tokenResponse: MiniAppOAuthTokenResponse = {
	access_token: 'a'.repeat(128),
	refresh_token: 'r'.repeat(128),
	token_type: 'Bearer',
	scope: 'identify write',
	expires_in: 3600,
	authorization_expires_in: 31_535_999,
};

function transactionIdFromHtml(html: string): string {
	const match = html.match(/name="misskey:oauth:transaction-id" content="([^"]+)"/);
	if (match == null) throw new Error('Missing OAuth transaction ID');
	return match[1];
}

describe('OAuth2ProviderService Fediverse Mini App profile', () => {
	let fastify: FastifyInstance;
	let service: OAuth2ProviderService;
	const resolveManifestUrl = vi.fn();
	const issueAuthorization = vi.fn();
	const refreshAuthorization = vi.fn();
	const revoke = vi.fn();
	const limit = vi.fn();
	const findOAuthClient = vi.fn();
	const insertOAuthClient = vi.fn();
	const registeredClients = new Map<string, MiOAuthClient>();

	beforeAll(async () => {
		const idService = { gen: vi.fn(() => registeredClientId) } as unknown as IdService;
		const manifestService = { resolveManifestUrl } as unknown as MiniAppManifestService;
		const oauthClientsRepository = {
			findOneBy: findOAuthClient,
			insert: insertOAuthClient,
		} as unknown as OAuthClientsRepository;
		const oauthClientRegistrationService = new OAuthClientRegistrationService(
			oauthClientsRepository,
			idService,
			manifestService,
		);
		const miniAppOAuthTokenService = {
			issueAuthorization,
			refreshAuthorization,
			revoke,
			revokeGrant: vi.fn(),
		} as unknown as MiniAppOAuthTokenService;
		service = new OAuth2ProviderService(
			{ url: issuer } as Config,
			{ insert: vi.fn(), delete: vi.fn() } as unknown as AccessTokensRepository,
			{} as UsersRepository,
			idService,
			{} as HttpRequestService,
			manifestService,
			miniAppOAuthTokenService,
			oauthClientRegistrationService,
			{ limit } as unknown as RateLimiterService,
			{
				localUserByNativeTokenCache: {
					fetch: vi.fn(async () => ({
						id: 'user1',
						username: 'alice',
						host: null,
						isBot: false,
						isCat: false,
					})),
				},
			} as unknown as CacheService,
			{
				getCommonData: vi.fn(async () => ({
					version: 'test',
					config: { url: issuer },
					langs: [],
					instanceName: 'Misskey',
					instanceUrl: issuer,
					federationEnabled: true,
					frontendViteFiles: null,
					frontendBootloaderJs: null,
					frontendBootloaderCss: null,
				})),
			} as unknown as HtmlTemplateService,
			{
				getLogger: () => ({ info: vi.fn(), error: vi.fn() }),
			} as unknown as LoggerService,
		);

		fastify = Fastify();
		await fastify.register(service.createServer, { prefix: '/oauth' });
		await fastify.register(service.createTokenServer, { prefix: '/oauth/token' });
		await fastify.ready();
	});

	beforeEach(() => {
		registeredClients.clear();
		registeredClients.set(registeredClientId, {
			id: registeredClientId,
			createdAt: new Date('2026-07-18T00:00:00.000Z'),
			kind: 'miniapp',
			metadata: {
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: 'identify write',
				client_name: resolvedManifest.manifest.name,
				client_uri: resolvedManifest.manifest.homeUrl,
				logo_uri: resolvedManifest.manifest.iconUrl,
				fediverse_miniapp_manifest_uri: manifestUrl,
			},
		});
		findOAuthClient.mockReset().mockImplementation(async ({ id }: { id: string }) => registeredClients.get(id) ?? null);
		insertOAuthClient.mockReset().mockImplementation(async (client: MiOAuthClient) => {
			registeredClients.set(client.id, client);
			return { identifiers: [{ id: client.id }], generatedMaps: [], raw: [] };
		});
		resolveManifestUrl.mockReset().mockResolvedValue(resolvedManifest);
		issueAuthorization.mockReset().mockResolvedValue({ grantId: 'grant1', response: tokenResponse });
		refreshAuthorization.mockReset().mockResolvedValue(tokenResponse);
		revoke.mockReset().mockResolvedValue(undefined);
		limit.mockReset().mockResolvedValue(null);
	});

	afterAll(async () => {
		service.dispose();
		await fastify.close();
	});

	test('advertises and dynamically registers the exact OpenFarm profile', async () => {
		expect(service.generateRFC8414()).toMatchObject({
			issuer,
			fediverse_miniapp_profile: '1',
			registration_endpoint: new URL('/oauth/register', issuer),
			revocation_endpoint: new URL('/oauth/revoke', issuer),
			grant_types_supported: ['authorization_code', 'refresh_token'],
			token_endpoint_auth_methods_supported: ['none'],
		});

		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/register',
			payload: {
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: 'identify write',
				manifest_url: manifestUrl,
			},
		});
		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			client_id: registeredClientId,
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			scope: 'identify write',
			client_name: resolvedManifest.manifest.name,
			client_uri: resolvedManifest.manifest.homeUrl,
			logo_uri: resolvedManifest.manifest.iconUrl,
			fediverse_miniapp_manifest_uri: manifestUrl,
		});
		expect(response.json().client_id_issued_at).toEqual(expect.any(Number));
		expect(insertOAuthClient).toHaveBeenCalledWith(expect.objectContaining({ kind: 'miniapp' }));
		expect(response.headers['cache-control']).toBe('no-store');
		expect(response.headers['content-length']).toBeDefined();
		expect(response.headers['transfer-encoding']).toBeUndefined();
	});

	test('rejects conflicting Mini App manifest registration extensions', async () => {
		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/register',
			payload: {
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: 'identify write',
				manifest_url: manifestUrl,
				fediverse_miniapp_manifest_uri: 'https://other.example/.well-known/fediverse-miniapp.json',
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ error: 'invalid_client_metadata' });
		expect(resolveManifestUrl).not.toHaveBeenCalled();
		expect(insertOAuthClient).not.toHaveBeenCalled();
	});

	test('registers an ordinary public OAuth client without the Mini App extension', async () => {
		resolveManifestUrl.mockClear();
		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/register',
			payload: {
				redirect_uris: ['https://client.example/oauth/callback'],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
				scope: 'read:account write:notes',
				client_name: 'Example Client',
				client_uri: 'https://client.example/',
				ignored_extension: true,
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			client_id: registeredClientId,
			redirect_uris: ['https://client.example/oauth/callback'],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code'],
			response_types: ['code'],
			scope: 'read:account write:notes',
			client_name: 'Example Client',
			client_uri: 'https://client.example/',
		});
		expect(response.json()).not.toHaveProperty('ignored_extension');
		expect(resolveManifestUrl).not.toHaveBeenCalled();
		expect(insertOAuthClient).toHaveBeenCalledWith(expect.objectContaining({ kind: 'oauth' }));
	});

	test('authorizes a registered ordinary OAuth client without fetching a manifest', async () => {
		registeredClients.set(registeredClientId, {
			id: registeredClientId,
			createdAt: new Date('2026-07-18T00:00:00.000Z'),
			kind: 'oauth',
			metadata: {
				redirect_uris: ['https://client.example/oauth/callback'],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
				scope: 'read:account write:notes',
				client_name: 'Example Client',
			},
		});
		const challenge = await pkceChallenge(64);
		const response = await fastify.inject({
			method: 'GET',
			url: '/oauth/authorize',
			query: {
				client_id: registeredClientId,
				redirect_uri: 'https://client.example/oauth/callback',
				response_type: 'code',
				state: 'ordinary-oauth-state',
				scope: 'read:account',
				code_challenge: challenge.code_challenge,
				code_challenge_method: 'S256',
			},
		});

			expect(response.statusCode).toBe(200);
			expect(response.body).toContain('Example Client');
			expect(response.body).toContain('[https://client.example]');
			expect(resolveManifestUrl).not.toHaveBeenCalled();
		});

		test('shows the selected redirect origin for clients with multiple registered origins', async () => {
			registeredClients.set(registeredClientId, {
				id: registeredClientId,
				createdAt: new Date('2026-07-18T00:00:00.000Z'),
				kind: 'oauth',
				metadata: {
					redirect_uris: ['https://trusted.example/oauth/callback', 'https://selected.example/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code'],
					response_types: ['code'],
					scope: 'read:account',
					client_name: 'Example Client',
				},
			});
			const challenge = await pkceChallenge(64);
			const response = await fastify.inject({
				method: 'GET',
				url: '/oauth/authorize',
				query: {
					client_id: registeredClientId,
					redirect_uri: 'https://selected.example/oauth/callback',
					response_type: 'code',
					state: 'multiple-origin-oauth-state',
					scope: 'read:account',
					code_challenge: challenge.code_challenge,
					code_challenge_method: 'S256',
				},
			});

			expect(response.statusCode).toBe(200);
			expect(response.body).toContain('[https://selected.example]');
			expect(response.body).not.toContain('[https://trusted.example]');
		});

		test('requires native private-use redirect schemes to use reverse-domain notation', async () => {
			const response = await fastify.inject({
				method: 'POST',
				url: '/oauth/register',
				payload: {
					redirect_uris: ['openfarmgame:/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code'],
					response_types: ['code'],
					scope: 'read:account',
				},
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
			expect(insertOAuthClient).not.toHaveBeenCalled();

			const reverseDomainResponse = await fastify.inject({
				method: 'POST',
				url: '/oauth/register',
				payload: {
					redirect_uris: ['com.example.openfarmgame:/oauth/callback'],
					token_endpoint_auth_method: 'none',
					grant_types: ['authorization_code'],
					response_types: ['code'],
					scope: 'read:account',
				},
			});

			expect(reverseDomainResponse.statusCode).toBe(201);
		});

	test('allows a native client to choose a loopback redirect port at authorization time', async () => {
		registeredClients.set(registeredClientId, {
			id: registeredClientId,
			createdAt: new Date('2026-07-18T00:00:00.000Z'),
			kind: 'oauth',
			metadata: {
				redirect_uris: ['http://127.0.0.1/oauth/callback'],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
				scope: 'read:account',
				client_name: 'Native Client',
			},
		});
		const challenge = await pkceChallenge(64);
		const response = await fastify.inject({
			method: 'GET',
			url: '/oauth/authorize',
			query: {
				client_id: registeredClientId,
				redirect_uri: 'http://127.0.0.1:49152/oauth/callback',
				response_type: 'code',
				state: 'native-oauth-state',
				scope: 'read:account',
				code_challenge: challenge.code_challenge,
				code_challenge_method: 'S256',
			},
		});

		expect(response.statusCode).toBe(200);
	});

	test('rejects Mini App registration metadata that disagrees with the manifest', async () => {
		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/register',
			payload: {
				redirect_uris: ['https://attacker.example/oauth/callback'],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: 'identify write',
				fediverse_miniapp_manifest_uri: manifestUrl,
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ error: 'invalid_redirect_uri' });
		expect(insertOAuthClient).not.toHaveBeenCalled();
	});

	test('does not expose the former custom Mini App registration route', async () => {
		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/mini-app/register',
			payload: { manifest_url: manifestUrl },
		});

		expect(response.statusCode).toBe(404);
	});

	test('rate limits unauthenticated dynamic registration before resolving a manifest', async () => {
		limit.mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: { resetMs: Date.now() + 60_000 } });

		const response = await fastify.inject({
			method: 'POST',
			url: '/oauth/register',
			payload: {
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: 'identify write',
				fediverse_miniapp_manifest_uri: manifestUrl,
			},
		});

		expect(response.statusCode).toBe(429);
		expect(response.headers['retry-after']).toBe('60');
		expect(response.json()).toMatchObject({ error: 'temporarily_unavailable' });
		expect(resolveManifestUrl).not.toHaveBeenCalled();
	});

	test('rate limits mini app authorization before resolving a manifest', async () => {
		limit.mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: { resetMs: Date.now() + 60_000 } });
		const challenge = await pkceChallenge(64);

		const response = await fastify.inject({
			method: 'GET',
			url: '/oauth/authorize',
			query: {
				client_id: registeredClientId,
				redirect_uri: redirectUri,
				response_type: 'code',
				state,
				scope: 'identify write',
				code_challenge: challenge.code_challenge,
				code_challenge_method: 'S256',
				authorization_lifetime_seconds: '31536000',
			},
		});

		expect(response.statusCode).toBe(429);
		expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
		expect(response.headers['cache-control']).toContain('no-store');
		expect(response.json()).toMatchObject({ error: 'temporarily_unavailable' });
		expect(resolveManifestUrl).not.toHaveBeenCalled();
	});

	test('continues accepting a manifest URL as a legacy Mini App client ID', async () => {
		const challenge = await pkceChallenge(64);
		const response = await fastify.inject({
			method: 'GET',
			url: '/oauth/authorize',
			query: {
				client_id: manifestUrl,
				redirect_uri: redirectUri,
				response_type: 'code',
				state,
				scope: 'identify write',
				code_challenge: challenge.code_challenge,
				code_challenge_method: 'S256',
				authorization_lifetime_seconds: '31536000',
			},
		});

		expect(response.statusCode).toBe(200);
		expect(resolveManifestUrl).toHaveBeenCalledWith(manifestUrl);
	});

	test('rate limits refresh and revocation before token-service database work', async () => {
		limit.mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: { resetMs: Date.now() + 60_000 } });
		const refreshResponse = await fastify.inject({
			method: 'POST',
			url: '/oauth/token',
			payload: {
				grant_type: 'refresh_token',
				refresh_token: `${'r'.repeat(32)}_${'s'.repeat(128)}`,
				client_id: registeredClientId,
			},
		});
		expect(refreshResponse.statusCode).toBe(429);
		expect(refreshAuthorization).not.toHaveBeenCalled();

		limit.mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: { resetMs: Date.now() + 60_000 } });
		const revokeResponse = await fastify.inject({
			method: 'POST',
			url: '/oauth/revoke',
			payload: { token: 'r'.repeat(128) },
		});
		expect(revokeResponse.statusCode).toBe(429);
		expect(revoke).not.toHaveBeenCalled();
	});

	test('completes authorization without adding iss to the strict game callback', async () => {
		const pkce = await pkceChallenge(64);
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: registeredClientId,
			redirect_uri: redirectUri,
			scope: 'identify write',
			state,
			code_challenge: pkce.code_challenge,
			code_challenge_method: 'S256',
			authorization_lifetime_seconds: '31536000',
		});
		const authorization = await fastify.inject({ method: 'GET', url: `/oauth/authorize?${query}` });
		expect(authorization.statusCode).toBe(200);
		expect(authorization.body).toContain('misskey:oauth:authorization-lifetime-seconds');

		const decision = await fastify.inject({
			method: 'POST',
			url: '/oauth/decision',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			payload: new URLSearchParams({
				transaction_id: transactionIdFromHtml(authorization.body),
				login_token: 'native-token',
			}).toString(),
		});
		expect(decision.statusCode).toBe(302);
		if (decision.headers.location == null) throw new Error('Missing callback location');
		const callback = new URL(decision.headers.location);
		expect([...callback.searchParams.keys()]).toEqual(['code', 'state']);
		expect(callback.searchParams.get('state')).toBe(state);

		const code = callback.searchParams.get('code');
		if (code == null) throw new Error('Missing authorization code');
		const token = await fastify.inject({
			method: 'POST',
			url: '/oauth/token',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			payload: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: registeredClientId,
				redirect_uri: redirectUri,
				code_verifier: pkce.code_verifier,
			}).toString(),
		});
		expect(token.statusCode).toBe(200);
		expect(token.json()).toEqual(tokenResponse);
		expect(issueAuthorization).toHaveBeenCalledWith(expect.objectContaining({
			userId: 'user1',
			clientId: registeredClientId,
			clientName: 'Open Farm Game',
			scope: ['identify', 'write'],
		}));
	});

	test('rejects a manifest-exceeding lifetime through a callback without iss', async () => {
		const pkce = await pkceChallenge(64);
		const query = new URLSearchParams({
			response_type: 'code',
			client_id: registeredClientId,
			redirect_uri: redirectUri,
			scope: 'identify write',
			state,
			code_challenge: pkce.code_challenge,
			code_challenge_method: 'S256',
			authorization_lifetime_seconds: '31536001',
		});
		const response = await fastify.inject({ method: 'GET', url: `/oauth/authorize?${query}` });
		expect(response.statusCode).toBe(302);
		if (response.headers.location == null) throw new Error('Missing callback location');
		const callback = new URL(response.headers.location);
		expect(callback.searchParams.get('error')).toBe('invalid_request');
		expect(callback.searchParams.get('state')).toBe(state);
		expect(callback.searchParams.has('iss')).toBe(false);
	});

	test('rotates and revokes mini app credentials through public OAuth endpoints', async () => {
		const refresh = await fastify.inject({
			method: 'POST',
			url: '/oauth/token',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			payload: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: 'old-refresh',
				client_id: registeredClientId,
			}).toString(),
		});
		expect(refresh.statusCode).toBe(200);
		expect(refresh.json()).toEqual(tokenResponse);
		expect(refreshAuthorization).toHaveBeenCalledWith('old-refresh', registeredClientId);

		const revocation = await fastify.inject({
			method: 'POST',
			url: '/oauth/revoke',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			payload: new URLSearchParams({ token: tokenResponse.refresh_token }).toString(),
		});
		expect(revocation.statusCode).toBe(200);
		expect(revoke).toHaveBeenCalledWith(tokenResponse.refresh_token);
	});
});
