/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { nextTick } from 'vue';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import './init';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkMiniApp from '@/components/MkMiniApp.vue';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';

const mocks = vi.hoisted(() => ({
	authorize: vi.fn(),
}));

vi.mock('@/utility/fediverse-miniapp-auth.js', async importOriginal => {
	const actual = await importOriginal<typeof import('@/utility/fediverse-miniapp-auth.js')>();
	return {
		...actual,
		authorizeFediverseMiniAppBackend: mocks.authorize,
	};
});

vi.mock('@/utility/fediverse-miniapp.js', async importOriginal => {
	const actual = await importOriginal<typeof import('@/utility/fediverse-miniapp.js')>();
	return {
		...actual,
		buildFediverseMiniAppBootstrap: (hostOrigin: string, launchId: string, capabilities: string[]) => ({
			type: 'fediverse-miniapp:bootstrap',
			version: '1',
			launchId,
			hostOrigin,
			issuer: hostOrigin,
			authorizationServerMetadata: `${hostOrigin}/.well-known/oauth-authorization-server`,
			authorizationResultRelay: `${hostOrigin}/mini-apps/oauth/relay`,
			capabilities,
		}),
	};
});

const appOrigin = 'https://openfarmgame.example';
const resolved = {
	manifestUrl: `${appOrigin}/.well-known/fediverse-miniapp.json`,
	appOrigin,
	launchUrl: 'about:blank',
	expiresAt: '2099-01-01T00:00:00.000Z',
	manifest: {
		version: '1',
		name: 'Open Farm Game',
		publisher: { name: 'Open Farm Game', url: `${appOrigin}/about` },
		homeUrl: `${appOrigin}/`,
		iconUrl: `${appOrigin}/icon.png`,
		oauth: {
			redirectUris: [`${appOrigin}/oauth/callback`],
			scopes: ['identify', 'write'],
			scopeAuthorizationMaxAgeSeconds: { identify: 31_536_000, write: 31_536_000 },
		},
		capabilities: [],
	},
} satisfies ResolvedFediverseMiniApp;

class FakePort {
	public onmessage: ((event: MessageEvent) => void) | null = null;
	public onmessageerror: ((event: MessageEvent) => void) | null = null;
	public postMessage = vi.fn();
	public start = vi.fn();
	public close = vi.fn();
}

let hostPort: FakePort | null = null;

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	mocks.authorize.mockReset();
	hostPort = null;
});

describe('MkMiniApp authorization gate', () => {
	test('refuses to create an iframe for an app on the Misskey origin', async () => {
		const sameOrigin = window.location.origin;
		const sameOriginResolved: ResolvedFediverseMiniApp = {
			...resolved,
			appOrigin: sameOrigin,
			launchUrl: `${sameOrigin}/mini-app`,
			manifestUrl: `${sameOrigin}/.well-known/fediverse-miniapp.json`,
		};
		const view = render(MkMiniApp, {
			props: { resolved: sameOriginResolved },
			global: { components, directives },
		});

		await fireEvent.click(view.getByRole('button'));
		await nextTick();

		expect(view.container.querySelector('iframe')).toBeNull();
		expect(view.getByRole('alert')).toBeTruthy();
	});

	test('keeps requestAuth pending until a host button click and lets the user cancel', async () => {
		let now = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const postMessage = vi.fn();
		vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({ postMessage } as unknown as Window);
		vi.stubGlobal('MessageChannel', class {
			public port1 = hostPort = new FakePort();
			public port2 = new FakePort();
		});

		let authorizationSignal: AbortSignal | undefined;
		let authorizationTimeoutMs: number | undefined;
		mocks.authorize.mockImplementation((_origin, _launchId, _request, options) => {
			authorizationSignal = options.signal;
			authorizationTimeoutMs = options.timeoutMs;
			return new Promise(() => {});
		});

		const view = render(MkMiniApp, {
			props: { resolved },
			global: {
				components,
				directives,
			},
		});

		await fireEvent.click(view.getByRole('button'));
		const frame = await view.findByTitle('Open Farm Game') as HTMLIFrameElement;
		await fireEvent.load(frame);
		expect(hostPort).not.toBeNull();
		const bootstrap = postMessage.mock.calls.at(-1)?.[0] as { launchId?: unknown } | undefined;
		expect(bootstrap?.launchId).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const launchId = bootstrap!.launchId as string;

		hostPort!.onmessage?.({ data: { type: 'ready', version: '1', launchId } } as MessageEvent);
		await nextTick();
		frame.focus();
		expect(window.document.activeElement).toBe(frame);
		const authRequestEnvelope = {
			type: 'requestAuth',
			version: '1',
			launchId,
			requestId: 'r'.repeat(22),
			clientId: resolved.manifestUrl,
			redirectUri: `${appOrigin}/oauth/callback`,
			scopes: ['identify', 'write'],
			state: 's'.repeat(43),
			codeChallenge: 'c'.repeat(43),
			codeChallengeMethod: 'S256',
			handoffChallenge: 'h'.repeat(43),
			authorizationLifetimeSeconds: 31_536_000,
		};
		const deadline = { callback: null as (() => void) | null };
		const nativeSetTimeout = window.setTimeout.bind(window);
		vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
			if (timeout === 295_000) {
				deadline.callback = callback as () => void;
				return 4242;
			}
			return nativeSetTimeout(callback, timeout, ...args);
		}) as typeof window.setTimeout);
		hostPort!.onmessage?.({ data: authRequestEnvelope } as MessageEvent);

		const prompt = await view.findByRole('alertdialog');
		expect(prompt.getAttribute('aria-modal')).toBe('true');
		expect(frame.parentElement?.hasAttribute('inert')).toBe(true);
		expect(frame.parentElement?.getAttribute('aria-hidden')).toBe('true');
		expect(mocks.authorize).not.toHaveBeenCalled();
		const authorizeButton = view.getByRole('button', { name: 'ログインを続ける' });
		const cancelButton = view.getByRole('button', { name: /Cancel|キャンセル/ });
		await nextTick();
		expect(window.document.activeElement).toBe(authorizeButton);

		cancelButton.focus();
		await fireEvent.keyDown(cancelButton, { key: 'Tab' });
		expect(window.document.activeElement).toBe(authorizeButton);
		authorizeButton.focus();
		await fireEvent.keyDown(authorizeButton, { key: 'Tab', shiftKey: true });
		expect(window.document.activeElement).toBe(cancelButton);
		frame.focus();
		expect(prompt.contains(window.document.activeElement)).toBe(true);
		expect(window.document.activeElement).not.toBe(frame);

		now = 21_000;
		await fireEvent.click(authorizeButton);
		expect(mocks.authorize).toHaveBeenCalledOnce();
		expect(authorizationTimeoutMs).toBe(275_000);
		expect(authorizationSignal?.aborted).toBe(false);

		await fireEvent.click(cancelButton);
		expect(authorizationSignal?.aborted).toBe(true);
		expect(hostPort!.postMessage).toHaveBeenCalledWith({
			type: 'authResult',
			version: '1',
			launchId,
			requestId: 'r'.repeat(22),
			status: 'cancelled',
		});
		await nextTick();
		await nextTick();
		expect(frame.parentElement?.hasAttribute('inert')).toBe(false);
		expect(window.document.activeElement).toBe(frame);

		hostPort!.postMessage.mockClear();
		now = 22_000;
		frame.focus();
		hostPort!.onmessage?.({ data: authRequestEnvelope } as MessageEvent);
		await view.findByRole('alertdialog');
		deadline.callback?.();
		await nextTick();
		expect(view.queryByRole('alertdialog')).toBeNull();
		expect(hostPort!.postMessage).toHaveBeenCalledWith({
			type: 'authResult',
			version: '1',
			launchId,
			requestId: 'r'.repeat(22),
			status: 'error',
		});
		await nextTick();
		expect(window.document.activeElement).toBe(frame);
	});
});
