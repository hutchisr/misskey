/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, nextTick, ref } from 'vue';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import './init';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkMiniApp from '@/components/MkMiniApp.vue';
import MkMiniAppWindow from '@/components/MkMiniAppWindow.vue';
import MkWindow from '@/components/MkWindow.vue';
import { popups } from '@/os.js';
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
	popups.value = [];
});

describe('MkWindow close lifecycle', () => {
	test('allows a close handler to call close again without recursion', async () => {
		const closeEvents = vi.fn();
		const ReentrantWindow = defineComponent({
			components: { MkWindow },
			setup() {
				const windowEl = ref<InstanceType<typeof MkWindow> | null>(null);
				function onClose(): void {
					closeEvents();
					windowEl.value?.close();
				}
				return { onClose, windowEl };
			},
			template: '<MkWindow ref="windowEl" @close="onClose"><span>Window content</span></MkWindow>',
		});
		const view = render(ReentrantWindow, {
			global: { components, directives },
		});
		const closeButton = Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.querySelector('.ti-x') != null);

		expect(closeButton).toBeDefined();
		await fireEvent.click(closeButton!);

		expect(closeEvents).toHaveBeenCalledOnce();
	});
});

describe('MkMiniApp launcher', () => {
	test('opens one Mini App window in the global popup host', async () => {
		const view = render(MkMiniApp, {
			props: { resolved },
			global: { components, directives },
		});
		const openButton = view.getByRole('button', { name: 'Open mini app' });

		await fireEvent.click(openButton);

		expect(popups.value).toHaveLength(1);
		expect(popups.value[0].component).toBe(MkMiniAppWindow);
		expect(popups.value[0].props.resolved).toStrictEqual(resolved);
		expect(view.emitted('open')).toHaveLength(1);
		expect((openButton as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.click(openButton);
		expect(popups.value).toHaveLength(1);

		popups.value[0].events.closed();
		await nextTick();
		expect(popups.value).toHaveLength(0);
		expect(view.emitted('closed')).toHaveLength(1);
		expect((openButton as HTMLButtonElement).disabled).toBe(false);

		await fireEvent.click(openButton);
		expect(popups.value).toHaveLength(1);

		view.unmount();
		const remountedView = render(MkMiniApp, {
			props: { resolved },
			global: { components, directives },
		});
		const remountedOpenButton = remountedView.getByRole('button', { name: 'Open mini app' });
		expect((remountedOpenButton as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(remountedOpenButton);
		expect(popups.value).toHaveLength(1);

		popups.value[0].events.closed();
		await nextTick();

		expect(popups.value).toHaveLength(0);
		expect((remountedOpenButton as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('MkMiniAppWindow authorization gate', () => {
	test('refuses to create an iframe for an app on the Misskey origin', async () => {
		const sameOrigin = window.location.origin;
		const sameOriginResolved: ResolvedFediverseMiniApp = {
			...resolved,
			appOrigin: sameOrigin,
			launchUrl: `${sameOrigin}/mini-app`,
			manifestUrl: `${sameOrigin}/.well-known/fediverse-miniapp.json`,
		};
		const view = render(MkMiniAppWindow, {
			props: { resolved: sameOriginResolved },
			global: { components, directives },
		});

		await nextTick();

		const windowRoot = view.container.firstElementChild as HTMLElement;
		expect(windowRoot.querySelector('.ti-rectangle')).not.toBeNull();
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

		const view = render(MkMiniAppWindow, {
			props: { resolved },
			global: {
				components,
				directives,
			},
		});

		const frame = await view.findByTitle('Open Farm Game') as HTMLIFrameElement;
		const closeButton = (): HTMLButtonElement | null => Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.querySelector('.ti-x') != null) ?? null;
		expect(closeButton()).not.toBeNull();
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
		expect(closeButton()).toBeNull();
		expect(view.getByText('Continue signing in to Open Farm Game?')).toBeTruthy();
		expect(frame.parentElement?.hasAttribute('inert')).toBe(true);
		expect(frame.parentElement?.getAttribute('aria-hidden')).toBe('true');
		expect(mocks.authorize).not.toHaveBeenCalled();
		const authorizeButton = view.getByRole('button', { name: 'Continue signing in' });
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
		expect(closeButton()).not.toBeNull();
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

		hostPort!.postMessage.mockClear();
		now = 23_000;
		hostPort!.onmessage?.({ data: authRequestEnvelope } as MessageEvent);
		const escapePrompt = await view.findByRole('alertdialog');
		await fireEvent.keyDown(escapePrompt, { key: 'Escape' });
		await nextTick();
		expect(view.queryByRole('alertdialog')).toBeNull();
		expect(hostPort!.postMessage).toHaveBeenCalledWith({
			type: 'authResult',
			version: '1',
			launchId,
			requestId: 'r'.repeat(22),
			status: 'cancelled',
		});
		expect(view.queryByTitle('Open Farm Game')).not.toBeNull();

		const connectedPort = hostPort!;
		await fireEvent.click(closeButton()!);
		await nextTick();
		expect(connectedPort.close).toHaveBeenCalledOnce();
		expect(view.queryByTitle('Open Farm Game')).toBeNull();
	});
});
