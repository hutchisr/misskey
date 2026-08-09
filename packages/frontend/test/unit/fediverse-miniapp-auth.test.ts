/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import {
	authorizeFediverseMiniAppBackend,
	buildFediverseMiniAppAuthorizationUrl,
	buildFediverseMiniAppAuthResult,
	parseFediverseMiniAppAuthCompletion,
} from '@/utility/fediverse-miniapp-auth.js';
import type { FediverseMiniAppAuthorizationRequest } from '@/utility/fediverse-miniapp.js';

const hostOrigin = 'https://misskey.example';
const appOrigin = 'https://openfarmgame.example';
const launchId = 'l'.repeat(43);
const state = 's'.repeat(43);
const handoffCode = 'h'.repeat(43);

const request = {
	requestId: 'r'.repeat(22),
	completionMode: 'backend_handoff',
	clientId: `${appOrigin}/.well-known/fediverse-miniapp.json`,
	redirectUri: `${appOrigin}/oauth/callback`,
	scopes: ['identify', 'write'],
	state,
	codeChallenge: 'c'.repeat(43),
	handoffChallenge: 'v'.repeat(43),
	authorizationLifetimeSeconds: 31_536_000,
} satisfies FediverseMiniAppAuthorizationRequest;

function successEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: 'fediverse-miniapp:auth-completion',
		version: '1',
		launchId,
		state,
		status: 'success',
		handoffCode,
		...overrides,
	};
}

describe('Fediverse Mini App authorization relay', () => {
	test('builds the exact issuer authorization request required by OpenFarm', () => {
		const url = new URL(buildFediverseMiniAppAuthorizationUrl(hostOrigin, request));
		expect(url.origin + url.pathname).toBe(`${hostOrigin}/oauth/authorize`);
		expect([...url.searchParams.keys()]).toEqual([
			'response_type',
			'client_id',
			'redirect_uri',
			'scope',
			'state',
			'code_challenge',
			'code_challenge_method',
			'authorization_lifetime_seconds',
		]);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			response_type: 'code',
			client_id: request.clientId,
			redirect_uri: request.redirectUri,
			scope: 'identify write',
			state,
			code_challenge: request.codeChallenge,
			code_challenge_method: 'S256',
			authorization_lifetime_seconds: '31536000',
		});
	});

	test('accepts only the exact correlated relay completion', () => {
		expect(parseFediverseMiniAppAuthCompletion(successEnvelope(), launchId, state)).toEqual({
			status: 'success',
			handoffCode,
		});
		expect(parseFediverseMiniAppAuthCompletion(successEnvelope({ launchId: 'x'.repeat(43) }), launchId, state)).toBeNull();
		expect(parseFediverseMiniAppAuthCompletion(successEnvelope({ extra: true }), launchId, state)).toBeNull();
		expect(parseFediverseMiniAppAuthCompletion({
			type: 'fediverse-miniapp:auth-completion',
			version: '1',
			launchId,
			state,
			status: 'cancelled',
		}, launchId, state)).toEqual({ status: 'cancelled' });
	});

	test('builds the exact SDK backend-handoff result envelope', () => {
		expect(buildFediverseMiniAppAuthResult(launchId, request.requestId, 'success', handoffCode)).toEqual({
			type: 'authResult',
			version: '1',
			launchId,
			requestId: request.requestId,
			status: 'success',
			handoffCode,
		});
		expect(Object.keys(buildFediverseMiniAppAuthResult(launchId, request.requestId, 'cancelled'))).toHaveLength(5);
	});

	test('listens before opening, returns the handoff, and cleans up', async () => {
		const handlers: {
			onmessage: ((event: MessageEvent) => void) | null;
			onmessageerror: ((event: MessageEvent) => void) | null;
		} = { onmessage: null, onmessageerror: null };
		const closeChannel = vi.fn();
		const closePopup = vi.fn();
		const clearTimer = vi.fn();
		let openedWithListener = false;

		const pending = authorizeFediverseMiniAppBackend(hostOrigin, launchId, request, {
			createBroadcastChannel: name => {
				expect(name).toBe(`fediverse-miniapp-auth:${launchId}:${state}`);
				return {
					get onmessage() { return handlers.onmessage; },
					set onmessage(value) { handlers.onmessage = value; },
					get onmessageerror() { return handlers.onmessageerror; },
					set onmessageerror(value) { handlers.onmessageerror = value; },
					close: closeChannel,
				};
			},
			openAuthorizationWindow: () => {
				openedWithListener = handlers.onmessage != null;
				return { close: closePopup };
			},
			setTimer: () => 7,
			clearTimer,
		});

		expect(openedWithListener).toBe(true);
		handlers.onmessage?.({ data: successEnvelope() } as MessageEvent);
		await expect(pending).resolves.toEqual({ status: 'success', handoffCode });
		expect(clearTimer).toHaveBeenCalledWith(7);
		expect(closeChannel).toHaveBeenCalledOnce();
		expect(closePopup).toHaveBeenCalledOnce();
	});

	test('times out and closes both the popup and relay channel', async () => {
		const timer = { callback: null as (() => void) | null };
		const closeChannel = vi.fn();
		const closePopup = vi.fn();

		const pending = authorizeFediverseMiniAppBackend(hostOrigin, launchId, request, {
			createBroadcastChannel: () => ({
				onmessage: null,
				onmessageerror: null,
				close: closeChannel,
			}),
			openAuthorizationWindow: () => ({ close: closePopup }),
			setTimer: callback => {
				timer.callback = callback;
				return 9;
			},
			clearTimer: vi.fn(),
		});

		timer.callback?.();
		await expect(pending).resolves.toEqual({ status: 'error' });
		expect(closeChannel).toHaveBeenCalledOnce();
		expect(closePopup).toHaveBeenCalledOnce();
	});
});
