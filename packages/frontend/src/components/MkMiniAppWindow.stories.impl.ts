/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import MkMiniAppWindow from './MkMiniAppWindow.vue';
import type { StoryObj } from '@storybook/vue3';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';

const openFarm = {
	manifestUrl: 'https://openfarmgame.example/.well-known/fediverse-miniapp.json',
	appOrigin: 'https://openfarmgame.example',
	launchUrl: 'about:blank',
	expiresAt: '2099-01-01T00:00:00.000Z',
	manifest: {
		version: '1',
		name: 'Open Farm Game',
		publisher: {
			name: 'Open Farm Game',
			url: 'https://openfarmgame.example/about',
		},
		homeUrl: 'https://openfarmgame.example/',
		iconUrl: 'https://openfarmgame.example/images/openfarm-card.jpg',
		oauth: {
			redirectUris: ['https://openfarmgame.example/oauth/callback'],
			scopes: ['identify', 'write'],
			scopeAuthorizationMaxAgeSeconds: {
				identify: 31_536_000,
				write: 31_536_000,
			},
		},
		capabilities: [],
	},
} satisfies ResolvedFediverseMiniApp;

export const Default = {
	args: {
		resolved: openFarm,
	},
	parameters: {
		layout: 'fullscreen',
	},
} satisfies StoryObj<typeof MkMiniAppWindow>;
