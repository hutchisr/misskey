/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import './init';
import { resolveFediverseMiniApp } from '@/utility/resolve-fediverse-miniapp.js';

const account = vi.hoisted(() => ({
	value: { token: 'test-token' } as { token: string } | null,
}));

vi.mock('@/i.js', () => ({
	get $i() {
		return account.value;
	},
}));

function resolvedResponse(appOrigin: string, launchUrl: string): object {
	return {
		manifestUrl: `${appOrigin}/.well-known/fediverse-miniapp.json`,
		appOrigin,
		launchUrl,
		expiresAt: '2099-01-01T00:00:00.000Z',
		manifest: {
			version: '1',
			name: 'Cached Farm Game',
			publisher: {
				name: 'Cached Farm Game',
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
	};
}

afterEach(() => {
	account.value = { token: 'test-token' };
	fetchMock.resetMocks();
});

describe('resolveFediverseMiniApp', () => {
	test('does not resolve Mini Apps while signed out', async () => {
		account.value = null;

		await expect(resolveFediverseMiniApp('https://signed-out-miniapp.example/farm')).resolves.toBeNull();

		expect(fetchMock.mock.calls).toHaveLength(0);
	});

	test('coalesces an origin and preserves each requested launch URL', async () => {
		const appOrigin = 'https://coalesced-miniapp.example';
		const firstUrl = `${appOrigin}/farm/one`;
		const secondUrl = `${appOrigin}/farm/two#plot`;
		fetchMock.mockResponseOnce(JSON.stringify(resolvedResponse(appOrigin, firstUrl)));

		const [first, second] = await Promise.all([
			resolveFediverseMiniApp(firstUrl),
			resolveFediverseMiniApp(secondUrl),
		]);
		const third = await resolveFediverseMiniApp(`${appOrigin}/farm/three`);

		expect(fetchMock.mock.calls).toHaveLength(1);
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toStrictEqual({
			url: firstUrl,
			i: 'test-token',
		});
		expect(first?.launchUrl).toBe(firstUrl);
		expect(second?.launchUrl).toBe(secondUrl);
		expect(third?.launchUrl).toBe(`${appOrigin}/farm/three`);
	});

	test('briefly caches a missing manifest for the whole origin', async () => {
		const appOrigin = 'https://ordinary-link.example';
		fetchMock.mockResponseOnce('', { status: 404 });

		await expect(resolveFediverseMiniApp(`${appOrigin}/one`)).resolves.toBeNull();
		await expect(resolveFediverseMiniApp(`${appOrigin}/two`)).resolves.toBeNull();

		expect(fetchMock.mock.calls).toHaveLength(1);
	});

	test('never runs more than four origin resolutions at once', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const releases: Array<() => void> = [];
		fetchMock.mockImplementation((request, init) => {
			const body = JSON.parse(init?.body as string) as { url: string };
			const launchUrl = new URL(body.url);
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise<Response>(resolve => {
				releases.push(() => {
					inFlight--;
					resolve(new Response(JSON.stringify(resolvedResponse(launchUrl.origin, launchUrl.href)), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}));
				});
			});
		});

		const resolutions = Array.from({ length: 8 }, (_, index) => {
			return resolveFediverseMiniApp(`https://concurrent-miniapp-${index}.example/farm`);
		});
		await vi.waitFor(() => expect(fetchMock.mock.calls).toHaveLength(4));

		for (let expectedCalls = 5; expectedCalls <= 8; expectedCalls++) {
			releases.shift()?.();
			await vi.waitFor(() => expect(fetchMock.mock.calls).toHaveLength(expectedCalls));
			expect(maxInFlight).toBeLessThanOrEqual(4);
		}
		for (const release of releases) release();
		await Promise.all(resolutions);

		expect(maxInFlight).toBe(4);
	});

	test('removes an aborted resolution from the concurrency queue', async () => {
		const releases: Array<() => void> = [];
		fetchMock.mockImplementation((request, init) => {
			const body = JSON.parse(init?.body as string) as { url: string };
			const launchUrl = new URL(body.url);
			return new Promise<Response>((resolve, reject) => {
				const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
				(init?.signal as AbortSignal | undefined)?.addEventListener('abort', onAbort, { once: true });
				releases.push(() => resolve(new Response(JSON.stringify(resolvedResponse(launchUrl.origin, launchUrl.href)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})));
			});
		});

		const active = Array.from({ length: 4 }, (_, index) => {
			return resolveFediverseMiniApp(`https://active-miniapp-${index}.example/farm`);
		});
		await vi.waitFor(() => expect(fetchMock.mock.calls).toHaveLength(4));

		const abortController = new AbortController();
		const queued = resolveFediverseMiniApp('https://queued-miniapp.example/farm', abortController.signal);
		abortController.abort();
		await expect(queued).rejects.toMatchObject({ name: 'AbortError' });

		for (const release of releases) release();
		await Promise.all(active);
		expect(fetchMock.mock.calls).toHaveLength(4);
	});
});
