/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { preferState } from './init.js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';

const mocks = vi.hoisted(() => {
	const miniApps = { value: [] as unknown[] };
	return {
		miniApps,
		misskeyApi: vi.fn(async (endpoint: string) => endpoint === 'mini-apps/list' ? miniApps.value : {}),
		resolveFediverseMiniApp: vi.fn(),
		openFediverseMiniApp: vi.fn(),
	};
});

vi.mock('@/i.js', () => ({
	$i: {
		id: 'test-user',
		token: 'test-token',
		isAdmin: false,
		isModerator: false,
		hasUnreadNotification: false,
		unreadNotificationsCount: 0,
		hasPendingReceivedFollowRequest: false,
		hasUnreadAnnouncement: false,
		policies: {
			canSearchNotes: false,
			canSearchUsers: false,
		},
	},
	iAmAdmin: false,
	iAmModerator: false,
}));

vi.mock('@/utility/misskey-api.js', () => ({
	misskeyApi: mocks.misskeyApi,
}));

vi.mock('@/utility/resolve-fediverse-miniapp.js', () => ({
	resolveFediverseMiniApp: mocks.resolveFediverseMiniApp,
}));

vi.mock('@/utility/open-fediverse-miniapp.js', () => ({
	openFediverseMiniApp: mocks.openFediverseMiniApp,
}));

vi.mock('@/os.js', async importOriginal => {
	const original = await importOriginal<typeof import('@/os.js')>();
	return {
		...original,
		promiseDialog: (promise: Promise<unknown>) => promise,
		alert: vi.fn(),
	};
});

import MkLaunchPad from '@/components/MkLaunchPad.vue';

describe('MkLaunchPad Mini Apps', () => {
	const appOrigin = 'https://farm-miniapp.example';
	const manifestUrl = `${appOrigin}/.well-known/fediverse-miniapp.json`;
	const manifest = {
		version: '1' as const,
		name: 'Farm Mini App',
		publisher: { name: 'Farm Publisher', url: `${appOrigin}/about` },
		homeUrl: `${appOrigin}/home`,
		iconUrl: `${appOrigin}/icon.png`,
		splash: { imageUrl: `${appOrigin}/splash.png`, backgroundColor: '#173f2b' },
		oauth: {
			redirectUris: [`${appOrigin}/oauth/callback`],
			scopes: ['identify' as const],
			scopeAuthorizationMaxAgeSeconds: { identify: 31_536_000 },
		},
		activityPub: {
			actorUrl: `${appOrigin}/ap/actor`,
			publicNotes: true,
			transactionalMentions: false,
		},
		capabilities: [],
		cacheTtlSeconds: 300,
	};

	beforeEach(() => {
		preferState.menu = [];
		mocks.misskeyApi.mockClear();
		mocks.resolveFediverseMiniApp.mockReset();
		mocks.openFediverseMiniApp.mockReset();
		mocks.miniApps.value = [{
			id: 'a'.repeat(32),
			manifestUrl,
			launchUrl: `${appOrigin}/saved`,
			name: manifest.name,
			iconUrl: manifest.iconUrl,
			createdAt: '2026-01-01T00:00:00.000Z',
			lastDiscoveredAt: '2026-01-02T00:00:00.000Z',
		}];
		mocks.resolveFediverseMiniApp.mockResolvedValue({
			manifestUrl,
			appOrigin,
			launchUrl: `${appOrigin}/saved`,
			expiresAt: '2099-01-01T00:00:00.000Z',
			manifest,
		});
	});

	afterEach(() => {
		cleanup();
	});

	test('lists a saved Mini App and opens its canonical home URL', async () => {
		const view = render(MkLaunchPad, {
			global: { components, directives },
		});

		const button = await view.findByRole('button', { name: manifest.name });
		const icon = button.querySelector('img');
		assert.ok(icon);
		expect(icon.getAttribute('src')).toBe(manifest.iconUrl);
		expect(icon.classList.contains('icon')).toBe(true);
		expect(button.querySelector('.ti-device-gamepad-2')).toBeNull();

		await fireEvent.click(button);
		await waitFor(() => {
			expect(mocks.resolveFediverseMiniApp).toHaveBeenCalledWith(`${appOrigin}/saved`);
			expect(mocks.openFediverseMiniApp).toHaveBeenCalledWith(expect.objectContaining({
				manifestUrl,
				launchUrl: manifest.homeUrl,
			}));
		});
	});

	test('uses the game icon only when the Mini App icon fails to load', async () => {
		const view = render(MkLaunchPad, {
			global: { components, directives },
		});

		const button = await view.findByRole('button', { name: manifest.name });
		const icon = button.querySelector('img');
		assert.ok(icon);
		await fireEvent.error(icon);

		await waitFor(() => {
			expect(button.querySelector('img')).toBeNull();
			expect(button.querySelector('.ti-device-gamepad-2')).not.toBeNull();
		});
	});
});
