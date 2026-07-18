/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { action } from 'storybook/actions';
import type { StoryObj } from '@storybook/vue3';
import MkMiniApp from './MkMiniApp.vue';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';

const openFarm = {
	manifestUrl: 'https://openfarmgame.example/.well-known/fediverse-miniapp.json',
	appOrigin: 'https://openfarmgame.example',
	launchUrl: 'https://openfarmgame.example/',
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
		splash: {
			imageUrl: 'https://openfarmgame.example/images/dirt.jpg',
			backgroundColor: '#173f2b',
		},
		oauth: {
			redirectUris: ['https://openfarmgame.example/oauth/callback'],
			scopes: ['identify', 'write'],
			scopeAuthorizationMaxAgeSeconds: {
				identify: 31_536_000,
				write: 31_536_000,
			},
		},
		activityPub: {
			actorUrl: 'https://openfarmgame.example/ap/actor',
			publicNotes: true,
			transactionalMentions: false,
		},
		capabilities: [],
		cacheTtlSeconds: 300,
	},
} satisfies ResolvedFediverseMiniApp;

export const Default = {
	render(args) {
		return {
			components: { MkMiniApp },
			setup() {
				return { args };
			},
			computed: {
				events() {
					return {
						open: action('open'),
						closed: action('closed'),
					};
				},
			},
			template: '<div style="width: min(600px, calc(100vw - 32px));"><MkMiniApp v-bind="args" v-on="events" /></div>',
		};
	},
	args: {
		resolved: openFarm,
		compact: false,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkMiniApp>;

export const Compact = {
	...Default,
	args: {
		...Default.args,
		compact: true,
	},
} satisfies StoryObj<typeof MkMiniApp>;
