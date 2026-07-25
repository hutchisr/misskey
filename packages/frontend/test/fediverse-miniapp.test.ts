/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildFediverseMiniAppBootstrap,
	createFediverseMiniAppLaunchId,
	parseFediverseMiniAppPortMessage,
	parseResolvedFediverseMiniApp,
} from '@/utility/fediverse-miniapp.js';
import type { FediverseMiniAppManifest } from '@/utility/fediverse-miniapp.js';

const appOrigin = 'https://openfarmgame.example';
const hostOrigin = 'https://misskey.example';
const launchId = 'l'.repeat(43);

const manifest = {
	version: '1',
	name: 'Open Farm Game',
	publisher: {
		name: 'Open Farm Game',
		url: `${appOrigin}/about`,
	},
	homeUrl: `${appOrigin}/`,
	iconUrl: `${appOrigin}/images/openfarm-card.jpg`,
	splash: {
		imageUrl: `${appOrigin}/images/dirt.jpg`,
		backgroundColor: '#173f2b',
	},
	oauth: {
		redirectUris: [`${appOrigin}/oauth/callback`],
		scopes: ['identify', 'write'],
		scopeAuthorizationMaxAgeSeconds: {
			identify: 31_536_000,
			write: 31_536_000,
		},
	},
	activityPub: {
		actorUrl: `${appOrigin}/ap/actor`,
		publicNotes: true,
		transactionalMentions: false,
	},
	capabilities: [],
	cacheTtlSeconds: 300,
} satisfies FediverseMiniAppManifest;

const resolvedResponse = {
	manifestUrl: `${appOrigin}/.well-known/fediverse-miniapp.json`,
	appOrigin,
	launchUrl: `${appOrigin}/?plot=123`,
	expiresAt: '2099-01-01T00:00:00.000Z',
	manifest,
};

describe('Fediverse Mini App protocol', () => {
	test('parses a validated resolver response without losing manifest fields', () => {
		expect(parseResolvedFediverseMiniApp(resolvedResponse, Date.parse('2026-01-01T00:00:00.000Z'))).toEqual(resolvedResponse);
	});

	test('rejects a launch URL that leaves the validated app origin', () => {
		expect(parseResolvedFediverseMiniApp({
			...resolvedResponse,
			launchUrl: 'https://attacker.example/',
		}, Date.parse('2026-01-01T00:00:00.000Z'))).toBeNull();
	});

	test('rejects an app on the host origin so scripts cannot become same-origin with Misskey', () => {
		expect(parseResolvedFediverseMiniApp(
			resolvedResponse,
			Date.parse('2026-01-01T00:00:00.000Z'),
			appOrigin,
		)).toBeNull();
	});

	test('rejects an expired resolver response', () => {
		expect(parseResolvedFediverseMiniApp({
			...resolvedResponse,
			expiresAt: '2025-01-01T00:00:00.000Z',
		}, Date.parse('2026-01-01T00:00:00.000Z'))).toBeNull();
	});

	test('creates an unpadded 43-character base64url launch ID', () => {
		const fakeCrypto = {
			getRandomValues<T extends ArrayBufferView | null>(array: T): T {
				return array;
			},
		};
		const result = createFediverseMiniAppLaunchId(fakeCrypto);
		expect(result).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(result).toBe('A'.repeat(43));
	});

	test('builds the exact eight-field OpenFarm V1 bootstrap', () => {
		const bootstrap = buildFediverseMiniAppBootstrap(hostOrigin, launchId);
		expect(Object.keys(bootstrap)).toHaveLength(8);
		expect(bootstrap).toEqual({
			type: 'fediverse-miniapp:bootstrap',
			version: '1',
			launchId,
			hostOrigin,
			issuer: hostOrigin,
			authorizationServerMetadata: `${hostOrigin}/.well-known/oauth-authorization-server`,
			authorizationResultRelay: `${hostOrigin}/mini-apps/oauth/relay`,
			capabilities: [],
		});
	});

	test('accepts only the exact ready envelope', () => {
		expect(parseFediverseMiniAppPortMessage({
			type: 'ready',
			version: '1',
			launchId,
		}, launchId, resolvedResponse)).toEqual({ type: 'ready' });
		expect(parseFediverseMiniAppPortMessage({
			type: 'ready',
			version: '1',
			launchId,
			extra: true,
		}, launchId, resolvedResponse)).toEqual({ type: 'unknown' });
	});

	test('validates the OpenFarm backend-handoff authorization request', () => {
		const requestId = 'r'.repeat(22);
		const message = {
			type: 'requestAuth',
			version: '1',
			launchId,
			requestId,
			clientId: `${appOrigin}/.well-known/fediverse-miniapp.json`,
			redirectUri: `${appOrigin}/oauth/callback`,
			scopes: ['identify', 'write'],
			state: 's'.repeat(43),
			codeChallenge: 'c'.repeat(43),
			codeChallengeMethod: 'S256',
			handoffChallenge: 'h'.repeat(43),
			authorizationLifetimeSeconds: 31_536_000,
		};

		expect(parseFediverseMiniAppPortMessage(message, launchId, resolvedResponse)).toEqual({
			type: 'requestAuth',
			request: {
				requestId,
				completionMode: 'backend_handoff',
				clientId: `${appOrigin}/.well-known/fediverse-miniapp.json`,
				redirectUri: `${appOrigin}/oauth/callback`,
				scopes: ['identify', 'write'],
				state: 's'.repeat(43),
				codeChallenge: 'c'.repeat(43),
				handoffChallenge: 'h'.repeat(43),
				authorizationLifetimeSeconds: 31_536_000,
			},
		});

		const registeredClientId = 'ap3cl139zk';
		expect(parseFediverseMiniAppPortMessage({
			...message,
			clientId: registeredClientId,
		}, launchId, resolvedResponse)).toEqual({
			type: 'requestAuth',
			request: {
				requestId,
				completionMode: 'backend_handoff',
				clientId: registeredClientId,
				redirectUri: `${appOrigin}/oauth/callback`,
				scopes: ['identify', 'write'],
				state: 's'.repeat(43),
				codeChallenge: 'c'.repeat(43),
				handoffChallenge: 'h'.repeat(43),
				authorizationLifetimeSeconds: 31_536_000,
			},
		});

		expect(parseFediverseMiniAppPortMessage({
			...message,
			redirectUri: 'https://attacker.example/callback',
		}, launchId, resolvedResponse)).toEqual({ type: 'invalidRequestAuth', requestId });

		expect(parseFediverseMiniAppPortMessage({
			...message,
			padding: 'x'.repeat(33 * 1024),
		}, launchId, resolvedResponse)).toEqual({ type: 'unknown' });
	});
});
