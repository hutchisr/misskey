/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Response } from 'node-fetch';
import type { Mocked } from 'vitest';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type { Config } from '@/config.js';
import {
	MiniAppManifestService,
} from '@/core/MiniAppManifestService.js';

const appOrigin = 'https://app.example';
const hostOrigin = 'https://misskey.example';
const manifestUrl = `${appOrigin}/.well-known/fediverse-miniapp.json`;

type TestManifest = {
	[key: string]: unknown;
	version: string;
	name: string;
	publisher: { name: string, url: string };
	homeUrl: string;
	iconUrl: string;
	splash: { imageUrl: string, backgroundColor: string };
	oauth: {
		redirectUris: string[];
		scopes: string[];
		scopeAuthorizationMaxAgeSeconds: Record<string, number>;
	};
	activityPub: { actorUrl: string, publicNotes: boolean, transactionalMentions: boolean };
	capabilities: string[];
	cacheTtlSeconds: number;
};

function validManifest(): TestManifest {
	return {
		version: '1',
		name: 'Open Farm Game',
		publisher: {
			name: 'Open Farm Game',
			url: `${appOrigin}/about`,
		},
		homeUrl: `${appOrigin}/`,
		iconUrl: `${appOrigin}/images/icon.jpg`,
		splash: {
			imageUrl: `${appOrigin}/images/splash.jpg`,
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
	};
}

function jsonResponse(value: unknown, options?: { contentType?: string, url?: string }): Response {
	const body = JSON.stringify(value);
	const response = new Response(body, {
		status: 200,
		headers: {
			'content-type': options?.contentType ?? 'application/json; charset=utf-8',
			'content-length': String(Buffer.byteLength(body)),
		},
	});
	Object.defineProperty(response, 'url', { value: options?.url ?? manifestUrl });
	return response;
}

describe('MiniAppManifestService', () => {
	let httpRequestService: Mocked<HttpRequestService>;
	let service: MiniAppManifestService;

	beforeEach(() => {
		httpRequestService = {
			send: vi.fn(),
		} as unknown as Mocked<HttpRequestService>;
		service = new MiniAppManifestService(httpRequestService, { url: hostOrigin } as Config);
	});

	test('resolves a linked URL, validates the manifest, and retains the launch URL', async () => {
		httpRequestService.send.mockResolvedValue(jsonResponse(validManifest()));

		const resolved = await service.resolveAppUrl(`${appOrigin}/farm?plot=1#water`);

		expect(resolved).toMatchObject({
			manifestUrl,
			appOrigin,
			launchUrl: `${appOrigin}/farm?plot=1#water`,
			manifest: {
				version: '1',
				name: 'Open Farm Game',
				oauth: {
					redirectUris: [`${appOrigin}/oauth/callback`],
					scopes: ['identify', 'write'],
				},
				activityPub: {
					actorUrl: `${appOrigin}/ap/actor`,
				},
			},
		});
		expect(Date.parse(resolved.expiresAt)).toBeGreaterThan(Date.now());
		expect(httpRequestService.send).toHaveBeenCalledWith(manifestUrl, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Accept-Encoding': 'identity',
			},
			timeout: 5000,
			size: 32 * 1024,
			isLocalAddressAllowed: false,
			redirect: 'error',
		}, {
			throwErrorWhenResponseNotOk: true,
		});
	});

	test('caches manifests by origin while retaining each linked launch URL', async () => {
		httpRequestService.send.mockResolvedValue(jsonResponse(validManifest()));

		const first = await service.resolveAppUrl(`${appOrigin}/farm/one`);
		const second = await service.resolveAppUrl(`${appOrigin}/farm/two`);

		expect(first.launchUrl).toBe(`${appOrigin}/farm/one`);
		expect(second.launchUrl).toBe(`${appOrigin}/farm/two`);
		expect(httpRequestService.send).toHaveBeenCalledTimes(1);
	});

	test.each([
		'http://app.example/',
		'https://user@app.example/',
		'https://app.example:8443/',
	])('rejects an unsafe linked URL: %s', async (url) => {
		await expect(service.resolveAppUrl(url)).rejects.toMatchObject({
			code: 'invalid-url',
		});
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('requires an exact well-known URL when resolving a manifest directly', async () => {
		await expect(service.resolveManifestUrl(`${appOrigin}/manifest.json`)).rejects.toMatchObject({
			code: 'invalid-url',
		});
		await expect(service.resolveManifestUrl(`${manifestUrl}#fragment`)).rejects.toMatchObject({
			code: 'invalid-url',
		});
	});

	test('rejects an app on the Misskey origin before its iframe can become same-origin', async () => {
		await expect(service.resolveAppUrl(`${hostOrigin}/mini-app`)).rejects.toMatchObject({
			code: 'invalid-url',
		});
		await expect(service.resolveManifestUrl(`${hostOrigin}/.well-known/fediverse-miniapp.json`)).rejects.toMatchObject({
			code: 'invalid-url',
		});
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test.each([
		['unknown top-level fields', (manifest: TestManifest) => { manifest.extra = true; }],
		['a non-V1 version', (manifest: TestManifest) => { manifest.version = '2'; }],
		['cross-origin URLs', (manifest: TestManifest) => { manifest.iconUrl = 'https://cdn.example/icon.jpg'; }],
		['URL fragments', (manifest: TestManifest) => { manifest.homeUrl = `${appOrigin}/#fragment`; }],
		['unsupported capabilities', (manifest: TestManifest) => { manifest.capabilities = ['camera']; }],
		['duplicate redirect URIs', (manifest: TestManifest) => { manifest.oauth.redirectUris = [`${appOrigin}/callback`, `${appOrigin}/callback`]; }],
		['scope/max-age mismatches', (manifest: TestManifest) => { delete manifest.oauth.scopeAuthorizationMaxAgeSeconds.write; }],
	] as const)('rejects manifests with %s', async (_label, mutate) => {
		const manifest = validManifest();
		mutate(manifest);
		httpRequestService.send.mockResolvedValue(jsonResponse(manifest));

		await expect(service.resolveManifestUrl(manifestUrl)).rejects.toMatchObject({
			code: 'invalid-manifest',
		});
	});

	test('rejects non-JSON responses', async () => {
		httpRequestService.send.mockResolvedValue(jsonResponse(validManifest(), { contentType: 'text/plain' }));

		await expect(service.resolveManifestUrl(manifestUrl)).rejects.toMatchObject({
			code: 'invalid-manifest',
		});
	});

	test('maps fetch failures to an unavailable manifest', async () => {
		httpRequestService.send.mockRejectedValue(new Error('network failure'));

		await expect(service.resolveManifestUrl(manifestUrl)).rejects.toMatchObject({
			code: 'unavailable',
		});
	});

	test('requires an explicit direct-egress allowlist when an outbound proxy is configured', async () => {
		service = new MiniAppManifestService(httpRequestService, {
			url: hostOrigin,
			proxy: 'http://proxy.example:3128',
			proxyBypassHosts: [],
		} as unknown as Config);

		await expect(service.resolveManifestUrl(manifestUrl)).rejects.toMatchObject({
			code: 'unavailable',
		});
		expect(httpRequestService.send).not.toHaveBeenCalled();
	});

	test('bounds concurrent manifest fetches across origins', async () => {
		httpRequestService.send.mockImplementation(async () => await new Promise(() => {}));

		for (let i = 0; i < 32; i++) {
			void service.resolveManifestUrl(`https://app-${i}.example/.well-known/fediverse-miniapp.json`);
		}

		await expect(service.resolveManifestUrl('https://overflow.example/.well-known/fediverse-miniapp.json')).rejects.toMatchObject({
			code: 'unavailable',
		});
		expect(httpRequestService.send).toHaveBeenCalledTimes(32);
	});
});
