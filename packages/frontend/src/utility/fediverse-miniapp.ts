/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const FEDIVERSE_MINI_APP_PROTOCOL_VERSION = '1' as const;
export const FEDIVERSE_MINI_APP_READY_TIMEOUT_MS = 15_000;
export const FEDIVERSE_MINI_APP_MAX_MESSAGE_BYTES = 32 * 1024;

const launchIdPattern = /^[A-Za-z0-9_-]{43}$/;
const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const statePattern = /^[A-Za-z0-9_-]{43,256}$/;
const codeChallengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const handoffChallengePattern = /^[A-Za-z0-9_-]{43}$/;
const scopePattern = /^[A-Za-z][A-Za-z0-9:._-]{0,63}$/;

export type FediverseMiniAppCapability = string;

export type FediverseMiniAppManifest = {
	version: typeof FEDIVERSE_MINI_APP_PROTOCOL_VERSION;
	name: string;
	publisher: {
		name: string;
		url: string;
	};
	homeUrl: string;
	iconUrl: string;
	splash?: {
		imageUrl: string;
		backgroundColor: string;
	};
	oauth?: {
		redirectUris: string[];
		scopes: string[];
		scopeAuthorizationMaxAgeSeconds: Record<string, number>;
	};
	activityPub?: {
		actorUrl: string;
		publicNotes: boolean;
		transactionalMentions: boolean;
	};
	capabilities: FediverseMiniAppCapability[];
	cacheTtlSeconds?: number;
};

export type ResolvedFediverseMiniApp = {
	manifestUrl: string;
	appOrigin: string;
	launchUrl: string;
	expiresAt: string;
	manifest: FediverseMiniAppManifest;
};

export type FediverseMiniAppBootstrap = {
	type: 'fediverse-miniapp:bootstrap';
	version: typeof FEDIVERSE_MINI_APP_PROTOCOL_VERSION;
	launchId: string;
	hostOrigin: string;
	issuer: string;
	authorizationServerMetadata: string;
	authorizationResultRelay: string;
	capabilities: FediverseMiniAppCapability[];
};

export type FediverseMiniAppAuthorizationRequest = {
	requestId: string;
	completionMode: 'backend_handoff' | 'browser_code';
	clientId: string;
	redirectUri: string;
	scopes: string[];
	state: string;
	codeChallenge: string;
	authorizationLifetimeSeconds: number;
	handoffChallenge?: string;
};

export type FediverseMiniAppPortMessage =
	| { type: 'ready' }
	| { type: 'close'; requestId: string }
	| { type: 'requestAuth'; request: FediverseMiniAppAuthorizationRequest }
	| { type: 'invalidRequestAuth'; requestId: string }
	| { type: 'unknown' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === fields.length && keys.every(key => fields.includes(key));
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
	return typeof value === 'string' && value.length >= min && value.length <= max;
}

function parseHttpsUrl(value: unknown, allowFragment = false): URL | null {
	if (!isBoundedString(value, 1, 2048)) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
		if (!allowFragment && url.hash) return null;
		return url;
	} catch {
		return null;
	}
}

function isCanonicalHttpsOrigin(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const url = parseHttpsUrl(value);
	return url != null && url.origin === value && url.pathname === '/' && !url.search;
}

function isSameOriginHttpsUrl(value: unknown, origin: string, allowFragment = false): value is string {
	const url = parseHttpsUrl(value, allowFragment);
	return url != null && url.origin === origin;
}

function parsePublisher(value: unknown, origin: string): FediverseMiniAppManifest['publisher'] | null {
	if (!isRecord(value) || !hasExactFields(value, ['name', 'url'])) return null;
	if (!isBoundedString(value.name, 1, 128) || !isSameOriginHttpsUrl(value.url, origin)) return null;
	return { name: value.name, url: value.url };
}

function parseCapabilities(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > 32) return null;
	if (!value.every(capability => isBoundedString(capability, 1, 128))) return null;
	if (new Set(value).size !== value.length) return null;
	return [...value];
}

function parseOAuth(value: unknown, origin: string): FediverseMiniAppManifest['oauth'] | null {
	if (!isRecord(value) || !hasExactFields(value, ['redirectUris', 'scopes', 'scopeAuthorizationMaxAgeSeconds'])) return null;
	if (!Array.isArray(value.redirectUris) || value.redirectUris.length === 0 || value.redirectUris.length > 16) return null;
	if (!value.redirectUris.every(url => isSameOriginHttpsUrl(url, origin))) return null;
	if (!Array.isArray(value.scopes) || value.scopes.length === 0 || value.scopes.length > 16) return null;
	if (!value.scopes.every(scope => typeof scope === 'string' && scopePattern.test(scope))) return null;
	if (new Set(value.scopes).size !== value.scopes.length) return null;
	const scopeAuthorizationMaxAgeSeconds = value.scopeAuthorizationMaxAgeSeconds;
	if (!isRecord(scopeAuthorizationMaxAgeSeconds)) return null;
	if (!hasExactFields(scopeAuthorizationMaxAgeSeconds, value.scopes)) return null;
	if (!value.scopes.every(scope => {
		const maxAge = scopeAuthorizationMaxAgeSeconds[scope];
		return Number.isInteger(maxAge) && (maxAge as number) >= 300 && (maxAge as number) <= 31_536_000;
	})) return null;

	return {
		redirectUris: [...value.redirectUris] as string[],
		scopes: [...value.scopes] as string[],
		scopeAuthorizationMaxAgeSeconds: Object.fromEntries(value.scopes.map(scope => [scope, scopeAuthorizationMaxAgeSeconds[scope] as number])),
	};
}

function parseActivityPub(value: unknown, origin: string): FediverseMiniAppManifest['activityPub'] | null {
	if (!isRecord(value) || !hasExactFields(value, ['actorUrl', 'publicNotes', 'transactionalMentions'])) return null;
	if (!isSameOriginHttpsUrl(value.actorUrl, origin)) return null;
	if (typeof value.publicNotes !== 'boolean' || typeof value.transactionalMentions !== 'boolean') return null;
	return {
		actorUrl: value.actorUrl,
		publicNotes: value.publicNotes,
		transactionalMentions: value.transactionalMentions,
	};
}

function parseManifest(value: unknown, origin: string): FediverseMiniAppManifest | null {
	if (!isRecord(value)) return null;
	if (value.version !== FEDIVERSE_MINI_APP_PROTOCOL_VERSION) return null;
	if (!isBoundedString(value.name, 1, 128)) return null;
	const publisher = parsePublisher(value.publisher, origin);
	if (publisher == null) return null;
	if (!isSameOriginHttpsUrl(value.homeUrl, origin, true)) return null;
	if (!isSameOriginHttpsUrl(value.iconUrl, origin)) return null;
	const capabilities = parseCapabilities(value.capabilities);
	if (capabilities == null) return null;

	let splash: FediverseMiniAppManifest['splash'];
	if (value.splash != null) {
		if (!isRecord(value.splash) || !hasExactFields(value.splash, ['imageUrl', 'backgroundColor'])) return null;
		if (!isSameOriginHttpsUrl(value.splash.imageUrl, origin)) return null;
		if (typeof value.splash.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.splash.backgroundColor)) return null;
		splash = {
			imageUrl: value.splash.imageUrl,
			backgroundColor: value.splash.backgroundColor,
		};
	}

	let oauth: FediverseMiniAppManifest['oauth'];
	if (value.oauth != null) {
		oauth = parseOAuth(value.oauth, origin) ?? undefined;
		if (oauth == null) return null;
	}

	let activityPub: FediverseMiniAppManifest['activityPub'];
	if (value.activityPub != null) {
		activityPub = parseActivityPub(value.activityPub, origin) ?? undefined;
		if (activityPub == null) return null;
	}

	let cacheTtlSeconds: number | undefined;
	if (value.cacheTtlSeconds != null) {
		if (!Number.isInteger(value.cacheTtlSeconds) || (value.cacheTtlSeconds as number) < 1 || (value.cacheTtlSeconds as number) > 86_400) return null;
		cacheTtlSeconds = value.cacheTtlSeconds as number;
	}

	return {
		version: FEDIVERSE_MINI_APP_PROTOCOL_VERSION,
		name: value.name,
		publisher,
		homeUrl: value.homeUrl as string,
		iconUrl: value.iconUrl as string,
		...(splash == null ? {} : { splash }),
		...(oauth == null ? {} : { oauth }),
		...(activityPub == null ? {} : { activityPub }),
		capabilities,
		...(cacheTtlSeconds == null ? {} : { cacheTtlSeconds }),
	};
}

export function parseResolvedFediverseMiniApp(value: unknown, now = Date.now(), hostOrigin?: string): ResolvedFediverseMiniApp | null {
	if (!isRecord(value)) return null;
	if (!isCanonicalHttpsOrigin(value.appOrigin)) return null;
	if (hostOrigin != null && value.appOrigin === new URL(hostOrigin).origin) return null;
	if (!isSameOriginHttpsUrl(value.manifestUrl, value.appOrigin)) return null;
	const manifestUrl = new URL(value.manifestUrl);
	if (manifestUrl.pathname !== '/.well-known/fediverse-miniapp.json' || manifestUrl.search) return null;
	if (!isSameOriginHttpsUrl(value.launchUrl, value.appOrigin, true)) return null;

	let expiresAt: string;
	let expiresAtMs: number;
	if (typeof value.expiresAt === 'string') {
		expiresAtMs = Date.parse(value.expiresAt);
		expiresAt = value.expiresAt;
	} else if (typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt)) {
		expiresAtMs = value.expiresAt;
		expiresAt = new Date(value.expiresAt).toISOString();
	} else {
		return null;
	}
	if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return null;

	const manifest = parseManifest(value.manifest, value.appOrigin);
	if (manifest == null) return null;

	return {
		manifestUrl: value.manifestUrl,
		appOrigin: value.appOrigin,
		launchUrl: value.launchUrl,
		expiresAt,
		manifest,
	};
}

export function createFediverseMiniAppLaunchId(cryptoObject: Pick<Crypto, 'getRandomValues'> = crypto): string {
	const bytes = cryptoObject.getRandomValues(new Uint8Array(32));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function buildFediverseMiniAppBootstrap(
	hostOrigin: string,
	launchId: string,
	capabilities: readonly FediverseMiniAppCapability[] = [],
): FediverseMiniAppBootstrap {
	if (!isCanonicalHttpsOrigin(hostOrigin)) throw new TypeError('Mini app host origin must be canonical HTTPS');
	if (!launchIdPattern.test(launchId)) throw new TypeError('Invalid mini app launch ID');
	const normalizedCapabilities = parseCapabilities(capabilities);
	if (normalizedCapabilities == null) throw new TypeError('Invalid mini app capabilities');

	return {
		type: 'fediverse-miniapp:bootstrap',
		version: FEDIVERSE_MINI_APP_PROTOCOL_VERSION,
		launchId,
		hostOrigin,
		issuer: hostOrigin,
		authorizationServerMetadata: `${hostOrigin}/.well-known/oauth-authorization-server`,
		authorizationResultRelay: `${hostOrigin}/mini-apps/oauth/relay`,
		capabilities: normalizedCapabilities,
	};
}

function withinMessageBudget(value: unknown): boolean {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength <= FEDIVERSE_MINI_APP_MAX_MESSAGE_BYTES;
	} catch {
		return false;
	}
}

function validAuthorizationRequest(
	message: Record<string, unknown>,
	resolved: ResolvedFediverseMiniApp,
): FediverseMiniAppAuthorizationRequest | null {
	const manifest = resolved.manifest;
	const backendFields = [
		'type', 'version', 'launchId', 'requestId', 'clientId', 'redirectUri', 'scopes', 'state',
		'codeChallenge', 'codeChallengeMethod', 'handoffChallenge', 'authorizationLifetimeSeconds',
	] as const;
	const browserFields = [
		'type', 'version', 'launchId', 'requestId', 'clientId', 'redirectUri', 'scopes', 'state',
		'codeChallenge', 'codeChallengeMethod', 'completionMode', 'authorizationLifetimeSeconds',
	] as const;
	const isBackend = hasExactFields(message, backendFields);
	const isBrowser = hasExactFields(message, browserFields) && message.completionMode === 'browser_code';
	if (!isBackend && !isBrowser) return null;
	if (typeof message.clientId !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(message.clientId)) return null;
	if (typeof message.redirectUri !== 'string' || !manifest.oauth?.redirectUris.includes(message.redirectUri)) return null;
	if (!Array.isArray(message.scopes) || message.scopes.length === 0 || message.scopes.length > 16) return null;
	if (!message.scopes.every(scope => typeof scope === 'string' && manifest.oauth?.scopes.includes(scope))) return null;
	if (new Set(message.scopes).size !== message.scopes.length) return null;
	if (typeof message.state !== 'string' || !statePattern.test(message.state)) return null;
	if (typeof message.codeChallenge !== 'string' || !codeChallengePattern.test(message.codeChallenge)) return null;
	if (message.codeChallengeMethod !== 'S256') return null;
	if (!Number.isSafeInteger(message.authorizationLifetimeSeconds)) return null;
	if ((message.authorizationLifetimeSeconds as number) < 300 || (message.authorizationLifetimeSeconds as number) > 31_536_000) return null;
	if (!message.scopes.every(scope => (message.authorizationLifetimeSeconds as number) <= (manifest.oauth?.scopeAuthorizationMaxAgeSeconds[scope as string] ?? 0))) return null;
	if (isBackend && (typeof message.handoffChallenge !== 'string' || !handoffChallengePattern.test(message.handoffChallenge))) return null;

	return {
		requestId: message.requestId as string,
		completionMode: isBrowser ? 'browser_code' : 'backend_handoff',
		clientId: message.clientId,
		redirectUri: message.redirectUri,
		scopes: [...message.scopes] as string[],
		state: message.state,
		codeChallenge: message.codeChallenge,
		authorizationLifetimeSeconds: message.authorizationLifetimeSeconds as number,
		...(isBackend ? { handoffChallenge: message.handoffChallenge as string } : {}),
	};
}

export function parseFediverseMiniAppPortMessage(
	value: unknown,
	launchId: string,
	resolved: ResolvedFediverseMiniApp,
): FediverseMiniAppPortMessage {
	if (!isRecord(value)) return { type: 'unknown' };
	if (value.version !== FEDIVERSE_MINI_APP_PROTOCOL_VERSION || value.launchId !== launchId) return { type: 'unknown' };
	if (!withinMessageBudget(value)) return { type: 'unknown' };

	if (value.type === 'ready') {
		return hasExactFields(value, ['type', 'version', 'launchId']) ? { type: 'ready' } : { type: 'unknown' };
	}

	if (value.type === 'close') {
		if (!hasExactFields(value, ['type', 'version', 'launchId', 'requestId'])) return { type: 'unknown' };
		if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId)) return { type: 'unknown' };
		return { type: 'close', requestId: value.requestId };
	}

	if (value.type === 'requestAuth') {
		if (typeof value.requestId !== 'string' || !requestIdPattern.test(value.requestId)) return { type: 'unknown' };
		const request = validAuthorizationRequest(value, resolved);
		if (request == null) return { type: 'invalidRequestAuth', requestId: value.requestId };
		return { type: 'requestAuth', request };
	}

	return { type: 'unknown' };
}
