/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { FEDIVERSE_MINI_APP_PROTOCOL_VERSION } from '@/utility/fediverse-miniapp.js';
import type { FediverseMiniAppAuthorizationRequest } from '@/utility/fediverse-miniapp.js';

// OpenFarm allows five minutes for SDK requests. Finish slightly before that
// outer deadline so the game receives a deterministic terminal result.
export const FEDIVERSE_MINI_APP_AUTH_TIMEOUT_MS = 295_000;

const launchIdPattern = /^[A-Za-z0-9_-]{43}$/;
const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const statePattern = /^[A-Za-z0-9_-]{43,256}$/;
const codeChallengePattern = /^[A-Za-z0-9_-]{43,128}$/;
const handoffCodePattern = /^[A-Za-z0-9_-]{16,512}$/;

export type FediverseMiniAppAuthCompletion =
	| { status: 'success'; handoffCode: string }
	| { status: 'cancelled' }
	| { status: 'error' }
	| { status: 'aborted' };

export type FediverseMiniAppAuthResult =
	| { type: 'authResult'; version: typeof FEDIVERSE_MINI_APP_PROTOCOL_VERSION; launchId: string; requestId: string; status: 'success'; handoffCode: string }
	| { type: 'authResult'; version: typeof FEDIVERSE_MINI_APP_PROTOCOL_VERSION; launchId: string; requestId: string; status: 'cancelled' | 'error' | 'invalid_request' };

type BroadcastChannelLike = {
	onmessage: ((event: MessageEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	close(): void;
};

type PopupLike = {
	close(): void;
};

export type FediverseMiniAppAuthorizationOptions = {
	signal?: AbortSignal;
	timeoutMs?: number;
	createBroadcastChannel?: (name: string) => BroadcastChannelLike;
	openAuthorizationWindow?: (url: string, launchId: string) => PopupLike | null;
	setTimer?: (callback: () => void, timeoutMs: number) => number;
	clearTimer?: (timer: number) => void;
};

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === fields.length && keys.every(key => fields.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalHttpsOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.origin === value && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
	} catch {
		return false;
	}
}

function defaultOpenAuthorizationWindow(url: string, launchId: string): Window | null {
	const popup = window.open('about:blank', `fediverse-miniapp-auth-${launchId}`, 'popup,width=600,height=760,resizable=yes,scrollbars=yes');
	if (popup == null) return null;

	try {
		popup.opener = null;
		popup.location.replace(url);
		return popup;
	} catch {
		popup.close();
		return null;
	}
}

export function buildFediverseMiniAppAuthorizationUrl(
	hostOrigin: string,
	request: FediverseMiniAppAuthorizationRequest,
): string {
	if (!isCanonicalHttpsOrigin(hostOrigin)) throw new TypeError('Mini app issuer must be a canonical HTTPS origin');
	if (request.completionMode !== 'backend_handoff') throw new TypeError('Unsupported mini app authorization completion mode');
	if (!/^[\x21-\x7e]{1,255}$/.test(request.clientId)) throw new TypeError('Invalid mini app OAuth client ID');
	if (!statePattern.test(request.state)) throw new TypeError('Invalid mini app OAuth state');
	if (!codeChallengePattern.test(request.codeChallenge)) throw new TypeError('Invalid mini app OAuth code challenge');
	if (!Number.isSafeInteger(request.authorizationLifetimeSeconds) || request.authorizationLifetimeSeconds < 300 || request.authorizationLifetimeSeconds > 31_536_000) {
		throw new TypeError('Invalid mini app authorization lifetime');
	}

	const url = new URL('/oauth/authorize', hostOrigin);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', request.clientId);
	url.searchParams.set('redirect_uri', request.redirectUri);
	url.searchParams.set('scope', request.scopes.join(' '));
	url.searchParams.set('state', request.state);
	url.searchParams.set('code_challenge', request.codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('authorization_lifetime_seconds', request.authorizationLifetimeSeconds.toString());
	return url.toString();
}

export function parseFediverseMiniAppAuthCompletion(
	value: unknown,
	launchId: string,
	state: string,
): Exclude<FediverseMiniAppAuthCompletion, { status: 'aborted' }> | null {
	if (!isRecord(value)) return null;
	if (
		value.type !== 'fediverse-miniapp:auth-completion' ||
		value.version !== FEDIVERSE_MINI_APP_PROTOCOL_VERSION ||
		value.launchId !== launchId ||
		value.state !== state
	) return null;

	if (value.status === 'success') {
		if (!hasExactFields(value, ['type', 'version', 'launchId', 'state', 'status', 'handoffCode'])) return null;
		if (typeof value.handoffCode !== 'string' || !handoffCodePattern.test(value.handoffCode)) return null;
		return { status: 'success', handoffCode: value.handoffCode };
	}

	if (value.status === 'cancelled' || value.status === 'error') {
		if (!hasExactFields(value, ['type', 'version', 'launchId', 'state', 'status'])) return null;
		return { status: value.status };
	}

	return null;
}

export function buildFediverseMiniAppAuthResult(
	launchId: string,
	requestId: string,
	status: 'success' | 'cancelled' | 'error' | 'invalid_request',
	handoffCode?: string,
): FediverseMiniAppAuthResult {
	if (!launchIdPattern.test(launchId) || !requestIdPattern.test(requestId)) throw new TypeError('Invalid mini app authorization correlation');
	if (status === 'success') {
		if (handoffCode == null || !handoffCodePattern.test(handoffCode)) throw new TypeError('Invalid mini app authorization handoff');
		return {
			type: 'authResult',
			version: FEDIVERSE_MINI_APP_PROTOCOL_VERSION,
			launchId,
			requestId,
			status,
			handoffCode,
		};
	}

	return {
		type: 'authResult',
		version: FEDIVERSE_MINI_APP_PROTOCOL_VERSION,
		launchId,
		requestId,
		status,
	};
}

export function authorizeFediverseMiniAppBackend(
	hostOrigin: string,
	launchId: string,
	request: FediverseMiniAppAuthorizationRequest,
	options: FediverseMiniAppAuthorizationOptions = {},
): Promise<FediverseMiniAppAuthCompletion> {
	if (!launchIdPattern.test(launchId)) return Promise.resolve({ status: 'error' });

	let authorizationUrl: string;
	try {
		authorizationUrl = buildFediverseMiniAppAuthorizationUrl(hostOrigin, request);
	} catch {
		return Promise.resolve({ status: 'error' });
	}

	const createBroadcastChannel = options.createBroadcastChannel ?? (name => new BroadcastChannel(name));
	const openAuthorizationWindow = options.openAuthorizationWindow ?? defaultOpenAuthorizationWindow;
	const setTimer = options.setTimer ?? ((callback, timeoutMs) => window.setTimeout(callback, timeoutMs));
	const clearTimer = options.clearTimer ?? (timer => window.clearTimeout(timer));
	const channelName = `fediverse-miniapp-auth:${launchId}:${request.state}`;

	let channel: BroadcastChannelLike;
	try {
		channel = createBroadcastChannel(channelName);
	} catch {
		return Promise.resolve({ status: 'error' });
	}

	return new Promise(resolve => {
		let popup: PopupLike | null = null;
		let timer: number | null = null;
		let settled = false;

		const cleanup = (): void => {
			if (timer != null) clearTimer(timer);
			options.signal?.removeEventListener('abort', onAbort);
			channel.onmessage = null;
			channel.onmessageerror = null;
			channel.close();
			popup?.close();
		};

		const finish = (result: FediverseMiniAppAuthCompletion): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};

		const onAbort = (): void => finish({ status: 'aborted' });

		channel.onmessage = event => {
			const completion = parseFediverseMiniAppAuthCompletion(event.data, launchId, request.state);
			if (completion != null) finish(completion);
		};
		channel.onmessageerror = () => finish({ status: 'error' });

		if (options.signal?.aborted) {
			finish({ status: 'aborted' });
			return;
		}
		options.signal?.addEventListener('abort', onAbort, { once: true });
		timer = setTimer(() => finish({ status: 'error' }), options.timeoutMs ?? FEDIVERSE_MINI_APP_AUTH_TIMEOUT_MS);

		try {
			// The relay listener is live before this call can navigate the popup.
			popup = openAuthorizationWindow(authorizationUrl, launchId);
			if (popup == null) finish({ status: 'error' });
		} catch {
			finish({ status: 'error' });
		}
	});
}
