/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, assert, afterEach } from 'vitest';
import { render, cleanup, waitFor, type RenderResult } from '@testing-library/vue';
import type { SummalyResult } from '@misskey-dev/summaly';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkUrlPreview from '@/components/MkUrlPreview.vue';

describe('MkUrlPreview', () => {
	const renderPreviewBy = async (
		summary: Partial<SummalyResult>,
		miniAppResponse?: unknown,
		previewProps: Partial<{ detail: boolean; compact: boolean; showActions: boolean }> = {},
	): Promise<RenderResult> => {
		if (!summary.player) {
			summary.player = {
				url: null,
				width: null,
				height: null,
				allow: [],
			};
		}

		fetchMock.mockIf((req) => {
			const url = new URL(req.url);
			return url.pathname === '/api/mini-apps/resolve' || url.pathname === '/url';
		}, (req) => {
			const url = new URL(req.url);
			if (url.pathname === '/api/mini-apps/resolve') {
				return miniAppResponse == null
					? { status: 404 }
					: { status: 200, body: JSON.stringify(miniAppResponse) };
			}
			return {
				status: 200,
				body: JSON.stringify(summary),
			};
		});

		const result = render(MkUrlPreview, {
			props: { url: summary.url!, ...previewProps },
			global: { directives, components },
		});

		await new Promise<void>(resolve => {
			const observer = new MutationObserver(() => {
				resolve();
				observer.disconnect();
			});
			observer.observe(result.container, { childList: true, subtree: true });
		});

		return result;
	};

	const renderAndOpenPreview = async (summary: Partial<SummalyResult>): Promise<HTMLIFrameElement | null> => {
		const mkUrlPreview = await renderPreviewBy(summary);
		const buttons = mkUrlPreview.getAllByRole('button');
		buttons[0].click();
		// Wait for the click event to be fired
		await Promise.resolve();

		return mkUrlPreview.container.querySelector('iframe');
	};

	afterEach(() => {
		fetchMock.resetMocks();
		cleanup();
	});

	test('Should render the description', async () => {
		const mkUrlPreview = await renderPreviewBy({
			url: 'https://example.local',
			description: 'Mocked description',
		});
		mkUrlPreview.getByText('Mocked description');
	});

	test('A resolved Mini App is shown as an explicit launch action', async () => {
		const appOrigin = 'https://openfarmgame.example';
		const mkUrlPreview = await renderPreviewBy({
			url: `${appOrigin}/`,
			description: 'Mocked description',
		}, {
			manifestUrl: `${appOrigin}/.well-known/fediverse-miniapp.json`,
			appOrigin,
			launchUrl: `${appOrigin}/`,
			expiresAt: '2099-01-01T00:00:00.000Z',
			manifest: {
				version: '1',
				name: 'Open Farm Game',
				publisher: {
					name: 'Open Farm Game',
					url: `${appOrigin}/about`,
				},
				homeUrl: `${appOrigin}/`,
				iconUrl: `${appOrigin}/icon.png`,
				splash: {
					imageUrl: `${appOrigin}/splash.png`,
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
			},
		});

		await mkUrlPreview.findAllByText('Open Farm Game');
		assert.strictEqual(mkUrlPreview.getAllByRole('button').length, 1);
		assert.notExists(mkUrlPreview.container.querySelector('iframe'));
	});

	test('A compact timeline preview discovers a Mini App only after its explicit action', async () => {
		const mkUrlPreview = await renderPreviewBy({
			url: 'https://example.local/',
			description: 'Mocked description',
		}, undefined, {
			compact: true,
			detail: false,
		});

		assert.isFalse(fetchMock.mock.calls.some(([request]) => {
			const requestUrl = typeof request === 'string' ? request : 'url' in request ? request.url : request.toString();
			return new URL(requestUrl, window.location.href).pathname === '/api/mini-apps/resolve';
		}));

		mkUrlPreview.getByRole('button').click();
		await waitFor(() => {
			assert.isTrue(fetchMock.mock.calls.some(([request]) => {
				const requestUrl = typeof request === 'string' ? request : 'url' in request ? request.url : request.toString();
				return new URL(requestUrl, window.location.href).pathname === '/api/mini-apps/resolve';
			}));
			assert.notExists(mkUrlPreview.queryByRole('button'));
		});
	});

	test('Having a player should render a button', async () => {
		const mkUrlPreview = await renderPreviewBy({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: null,
				allow: [],
			},
		});
		const buttons = mkUrlPreview.getAllByRole('button');
		assert.strictEqual(buttons.length, 2, 'two buttons');
	});

	test('Having a player should setup the iframe', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: null,
				allow: [],
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.src, 'https://example.local/player?autoplay=1&auto_play=1');
		assert.strictEqual(
			iframe?.sandbox.toString(),
			'allow-popups allow-popups-to-escape-sandbox allow-scripts allow-storage-access-by-user-activation allow-same-origin',
		);
	});

	test('Having a player with `allow` field should set permissions', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: null,
				allow: ['fullscreen', 'web-share'],
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.allow, 'fullscreen;web-share');
	});

	test('A Summaly proxy response without allow falls back to the default', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: null,
				allow: undefined as any,
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.allow, 'autoplay;encrypted-media;fullscreen');
	});

	test('Filtering the allow list from the Summaly proxy', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: null,
				allow: ['autoplay', 'camera', 'fullscreen'],
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.allow, 'autoplay;fullscreen');
	});

	test('Having a player width should keep the fixed aspect ratio', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: 400,
				height: 200,
				allow: [],
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.parentElement?.style.paddingTop, '50%');
	});

	test('Having a player width should keep the fixed height', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://example.local',
			player: {
				url: 'https://example.local/player',
				width: null,
				height: 200,
				allow: [],
			},
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.parentElement?.style.paddingTop, '200px');
	});

	test('Loading a tweet in iframe', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://twitter.com/i/web/status/1685072521782325249',
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.getAttribute('allow'), 'fullscreen;web-share');
		assert.strictEqual(iframe?.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin');
	});

	test('Loading a post in iframe', async () => {
		const iframe = await renderAndOpenPreview({
			url: 'https://x.com/i/web/status/1685072521782325249',
		});
		assert.exists(iframe, 'iframe should exist');
		assert.strictEqual(iframe?.getAttribute('allow'), 'fullscreen;web-share');
		assert.strictEqual(iframe?.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin');
	});
});
