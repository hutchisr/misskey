/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { TextDecoder } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';

const MANIFEST_PATH = '/.well-known/fediverse-miniapp.json';
const MAX_URL_LENGTH = 2048;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MANIFEST_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 256;
const MAX_PENDING_REQUESTS = 32;
const SUPPORTED_SCOPES = new Set(['identify', 'write']);
const SUPPORTED_CAPABILITIES = new Set([
	'compose_note',
	'notifications.activitypub',
	'wallet.evm',
]);

export type MiniAppOAuthScope = 'identify' | 'write';
export type MiniAppCapability = 'compose_note' | 'notifications.activitypub' | 'wallet.evm';

export type MiniAppManifestV1 = {
	version: '1';
	name: string;
	publisher: {
		name: string;
		url: string;
	};
	homeUrl: string;
	iconUrl: string;
	splash: {
		imageUrl: string;
		backgroundColor: string;
	};
	oauth: {
		redirectUris: string[];
		scopes: MiniAppOAuthScope[];
		scopeAuthorizationMaxAgeSeconds: Record<string, number>;
	};
	activityPub: {
		actorUrl: string;
		publicNotes: boolean;
		transactionalMentions: boolean;
	};
	capabilities: MiniAppCapability[];
	cacheTtlSeconds: number;
};

export type ResolvedMiniAppManifest = {
	manifestUrl: string;
	appOrigin: string;
	launchUrl: string;
	expiresAt: string;
	manifest: MiniAppManifestV1;
};

export type MiniAppManifestErrorCode = 'invalid-url' | 'unavailable' | 'invalid-manifest';

export class MiniAppManifestError extends Error {
	constructor(public readonly code: MiniAppManifestErrorCode) {
		super(code);
		this.name = 'MiniAppManifestError';
	}
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	const object = value as Record<string, unknown>;
	const actualKeys = Object.keys(object);
	if (actualKeys.length !== keys.length || !keys.every(key => Object.hasOwn(object, key))) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return object;
}

function boundedString(value: unknown, maximumLength: number): string {
	if (
		typeof value !== 'string' ||
		value.length < 1 ||
		value.length > maximumLength ||
		value.trim() !== value ||
		[...value].some(character => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f)
	) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return value as number;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return value;
}

function stringArray(
	value: unknown,
	minimumItems: number,
	maximumItems: number,
	allowedValues: ReadonlySet<string>,
): string[] {
	if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	const items = value.map(item => boundedString(item, 128));
	if (new Set(items).size !== items.length || items.some(item => !allowedValues.has(item))) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return items;
}

function httpsUrl(value: unknown, expectedOrigin?: string, allowFragment = false): URL {
	if (typeof value !== 'string' || value.length < 1 || value.length > MAX_URL_LENGTH || value.trim() !== value) {
		throw new MiniAppManifestError('invalid-url');
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new MiniAppManifestError('invalid-url');
	}

	if (
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		url.hostname === '' ||
		url.port !== '' ||
		(!allowFragment && url.hash !== '') ||
		(expectedOrigin != null && url.origin !== expectedOrigin)
	) {
		throw new MiniAppManifestError('invalid-url');
	}

	return url;
}

function manifestUrl(value: string): URL {
	const url = httpsUrl(value);
	if (url.pathname !== MANIFEST_PATH || url.search !== '' || url.hash !== '') {
		throw new MiniAppManifestError('invalid-url');
	}

	return url;
}

function manifestHttpsUrl(value: unknown, expectedOrigin: string): string {
	try {
		return httpsUrl(value, expectedOrigin).href;
	} catch {
		throw new MiniAppManifestError('invalid-manifest');
	}
}

function parseManifest(value: unknown, appOrigin: string): MiniAppManifestV1 {
	const input = exactObject(value, [
		'version',
		'name',
		'publisher',
		'homeUrl',
		'iconUrl',
		'splash',
		'oauth',
		'activityPub',
		'capabilities',
		'cacheTtlSeconds',
	]);

	if (input.version !== '1') {
		throw new MiniAppManifestError('invalid-manifest');
	}

	const publisher = exactObject(input.publisher, ['name', 'url']);
	const splash = exactObject(input.splash, ['imageUrl', 'backgroundColor']);
	const oauth = exactObject(input.oauth, ['redirectUris', 'scopes', 'scopeAuthorizationMaxAgeSeconds']);
	const activityPub = exactObject(input.activityPub, ['actorUrl', 'publicNotes', 'transactionalMentions']);
	const scopes = stringArray(oauth.scopes, 1, 2, SUPPORTED_SCOPES) as MiniAppOAuthScope[];

	if (!Array.isArray(oauth.redirectUris) || oauth.redirectUris.length < 1 || oauth.redirectUris.length > 8) {
		throw new MiniAppManifestError('invalid-manifest');
	}
	const redirectUris = oauth.redirectUris.map(url => manifestHttpsUrl(url, appOrigin));
	if (new Set(redirectUris).size !== redirectUris.length) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	if (typeof oauth.scopeAuthorizationMaxAgeSeconds !== 'object' || oauth.scopeAuthorizationMaxAgeSeconds === null || Array.isArray(oauth.scopeAuthorizationMaxAgeSeconds)) {
		throw new MiniAppManifestError('invalid-manifest');
	}
	const scopeAuthorizationMaxAgeSecondsInput = oauth.scopeAuthorizationMaxAgeSeconds as Record<string, unknown>;
	const authorizationMaxAgeKeys = Object.keys(scopeAuthorizationMaxAgeSecondsInput);
	if (
		authorizationMaxAgeKeys.length !== scopes.length ||
		!scopes.every(scope => Object.hasOwn(scopeAuthorizationMaxAgeSecondsInput, scope))
	) {
		throw new MiniAppManifestError('invalid-manifest');
	}
	const scopeAuthorizationMaxAgeSeconds = Object.fromEntries(scopes.map(scope => [
		scope,
		integer(scopeAuthorizationMaxAgeSecondsInput[scope], 300, 31_536_000),
	]));

	const backgroundColor = boundedString(splash.backgroundColor, 7);
	if (!/^#[0-9a-fA-F]{6}$/.test(backgroundColor)) {
		throw new MiniAppManifestError('invalid-manifest');
	}

	return {
		version: '1',
		name: boundedString(input.name, 128),
		publisher: {
			name: boundedString(publisher.name, 128),
			url: manifestHttpsUrl(publisher.url, appOrigin),
		},
		homeUrl: manifestHttpsUrl(input.homeUrl, appOrigin),
		iconUrl: manifestHttpsUrl(input.iconUrl, appOrigin),
		splash: {
			imageUrl: manifestHttpsUrl(splash.imageUrl, appOrigin),
			backgroundColor,
		},
		oauth: {
			redirectUris,
			scopes,
			scopeAuthorizationMaxAgeSeconds,
		},
		activityPub: {
			actorUrl: manifestHttpsUrl(activityPub.actorUrl, appOrigin),
			publicNotes: boolean(activityPub.publicNotes),
			transactionalMentions: boolean(activityPub.transactionalMentions),
		},
		capabilities: stringArray(input.capabilities, 0, 3, SUPPORTED_CAPABILITIES) as MiniAppCapability[],
		cacheTtlSeconds: integer(input.cacheTtlSeconds, 30, 3600),
	};
}

@Injectable()
export class MiniAppManifestService {
	private readonly cache = new Map<string, ResolvedMiniAppManifest>();
	private readonly pending = new Map<string, Promise<ResolvedMiniAppManifest>>();

	constructor(
		private httpRequestService: HttpRequestService,

		@Inject(DI.config)
		private config: Config,
	) {
	}

	@bindThis
	public async resolveAppUrl(value: string): Promise<ResolvedMiniAppManifest> {
		const launchUrl = httpsUrl(value, undefined, true);
		if (launchUrl.origin === new URL(this.config.url).origin) {
			throw new MiniAppManifestError('invalid-url');
		}
		const resolved = await this.resolveManifestUrl(`${launchUrl.origin}${MANIFEST_PATH}`);

		return {
			...resolved,
			launchUrl: launchUrl.href,
		};
	}

	@bindThis
	public async resolveManifestUrl(value: string): Promise<ResolvedMiniAppManifest> {
		const url = manifestUrl(value);
		if (url.origin === new URL(this.config.url).origin) {
			throw new MiniAppManifestError('invalid-url');
		}
		const key = url.href;
		const now = Date.now();
		const cached = this.cache.get(key);
		if (cached != null && Date.parse(cached.expiresAt) > now) {
			this.cache.delete(key);
			this.cache.set(key, cached);
			return cached;
		}
		this.cache.delete(key);

		const alreadyPending = this.pending.get(key);
		if (alreadyPending != null) return await alreadyPending;
		if (this.pending.size >= MAX_PENDING_REQUESTS) {
			throw new MiniAppManifestError('unavailable');
		}

		const promise = this.fetchManifest(url);
		this.pending.set(key, promise);
		try {
			return await promise;
		} finally {
			if (this.pending.get(key) === promise) this.pending.delete(key);
		}
	}

	private async fetchManifest(url: URL): Promise<ResolvedMiniAppManifest> {
		// A generic forward proxy resolves CONNECT destinations itself, outside
		// HttpRequestService's private-address guard. Require an administrator to
		// opt each mini app host into guarded direct egress instead of leaking a
		// request around a configured proxy or accepting an SSRF gap.
		if (this.config.proxy != null && !(this.config.proxyBypassHosts ?? []).includes(url.hostname)) {
			throw new MiniAppManifestError('unavailable');
		}

		let response;
		try {
			response = await this.httpRequestService.send(url.href, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'Accept-Encoding': 'identity',
				},
				timeout: MANIFEST_TIMEOUT_MS,
				size: MAX_MANIFEST_BYTES,
				isLocalAddressAllowed: false,
				redirect: 'error',
			}, {
				throwErrorWhenResponseNotOk: true,
			});
		} catch {
			throw new MiniAppManifestError('unavailable');
		}

		if (response.status !== 200 || response.url !== url.href) {
			throw new MiniAppManifestError('unavailable');
		}

		const contentType = response.headers.get('content-type');
		if (contentType == null || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
			throw new MiniAppManifestError('invalid-manifest');
		}

		const contentLength = response.headers.get('content-length');
		if (contentLength != null && (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > MAX_MANIFEST_BYTES)) {
			throw new MiniAppManifestError('invalid-manifest');
		}

		let value: unknown;
		try {
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength < 1 || bytes.byteLength > MAX_MANIFEST_BYTES) {
				throw new MiniAppManifestError('invalid-manifest');
			}
			value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		} catch (error) {
			if (error instanceof MiniAppManifestError) throw error;
			throw new MiniAppManifestError('invalid-manifest');
		}

		const manifest = parseManifest(value, url.origin);
		const resolved: ResolvedMiniAppManifest = {
			manifestUrl: url.href,
			appOrigin: url.origin,
			launchUrl: manifest.homeUrl,
			expiresAt: new Date(Date.now() + (manifest.cacheTtlSeconds * 1000)).toISOString(),
			manifest,
		};

		this.pruneCache();
		this.cache.set(url.href, resolved);
		return resolved;
	}

	private pruneCache(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (Date.parse(entry.expiresAt) <= now) this.cache.delete(key);
		}

		while (this.cache.size >= MAX_CACHE_ENTRIES) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey == null) break;
			this.cache.delete(oldestKey);
		}
	}
}
