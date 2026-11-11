/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'eventemitter3';
import { effectScope } from 'vue';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { StreamEvents } from 'misskey-js';
import { Paginator } from '@/utility/paginator.js';
import type { MisskeyEntity } from '@/utility/paginator.js';
import { useStreamReconnect } from '@/composables/use-stream-reconnect.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const stream = Object.assign(new EventEmitter<StreamEvents>(), { state: 'connected' });
vi.mock('@/stream.js', () => ({ useStream: () => stream }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
const api = vi.mocked(misskeyApi);
const item = (n: number) => ({ id: String(n).padStart(4, '0'), createdAt: '2026-11-09T00:00:00Z' });
const makePaginator = () => new Paginator('notes/timeline', {});

beforeEach(() => {
	api.mockReset();
	stream.removeAllListeners();
	stream.state = 'connected';
});

describe('stream recovery', () => {
	test('recovers every page after reconnect despite simultaneous live arrivals', async () => {
		const paginator = makePaginator();
		api.mockResolvedValueOnce([item(1)]);
		await paginator.init();
		const missed = Array.from({ length: 64 }, (_, i) => item(i + 2));
		let firstPage = true;
		api.mockImplementation(async (_endpoint, params) => {
			if (firstPage) {
				firstPage = false;
				paginator.prepend(item(65) as never);
			}
			const { sinceId, limit } = params as { sinceId: string; limit: number };
			return missed.filter(x => x.id > sinceId).slice(0, limit);
		});
		const scope = effectScope();
		let recovery: Promise<void> | undefined;
		scope.run(() => useStreamReconnect(signal => { recovery = paginator.catchUp({ signal }); }));
		stream.emit('_connected_');
		await Promise.resolve();
		expect(recovery).toBeUndefined();
		stream.emit('_disconnected_');
		stream.emit('_connected_');
		await Promise.resolve();
		await recovery;
		expect(paginator.items.value.map(x => x.id)).toEqual(Array.from({ length: 65 }, (_, i) => item(65 - i).id));
		expect(paginator.error.value).toBe(false);
		scope.stop();
		stream.emit('_disconnected_');
		stream.emit('_connected_');
		expect(stream.listenerCount('_connected_')).toBe(0);
	});

	test('queues short pages without duplicates when the reader scrolls during recovery', async () => {
		const paginator = makePaginator();
		api.mockResolvedValueOnce([item(1)]);
		await paginator.init();
		paginator.enqueue(item(2) as never);
		let scrolled = false;
		api.mockImplementationOnce(async () => {
			paginator.enqueue(item(4) as never);
			scrolled = true;
			return [item(3), item(4)];
		}).mockResolvedValueOnce([item(5)]).mockResolvedValueOnce([]);
		await paginator.catchUp({ toQueue: () => scrolled });
		expect(paginator.items.value.map(x => x.id)).toEqual(['0001']);
		expect(paginator.queuedAheadItemsCount.value).toBe(4);
		paginator.releaseQueue();
		expect(paginator.items.value.map(x => x.id)).toEqual(['0005', '0004', '0003', '0002', '0001']);
	});

	test('retains the replay boundary after cancellation and ignores stale results after reload', async () => {
		const paginator = makePaginator();
		api.mockResolvedValueOnce([item(1)]);
		await paginator.init();
		const firstPage = Promise.withResolvers<MisskeyEntity[]>();
		api.mockReturnValueOnce(firstPage.promise);
		const controller = new AbortController();
		const first = paginator.catchUp({ signal: controller.signal });
		controller.abort();
		paginator.prepend(item(5) as never);
		firstPage.resolve([item(2)]);
		await first;
		api.mockResolvedValueOnce([item(2), item(3), item(4), item(5)]).mockResolvedValueOnce([]);
		await paginator.catchUp();
		expect(paginator.items.value.map(x => x.id)).toEqual(['0005', '0004', '0003', '0002', '0001']);

		const stalePage = Promise.withResolvers<MisskeyEntity[]>();
		api.mockReturnValueOnce(stalePage.promise);
		const stale = paginator.catchUp();
		api.mockResolvedValueOnce([item(20)]);
		await paginator.reload();
		stalePage.resolve([item(6)]);
		await stale;
		expect(paginator.items.value.map(x => x.id)).toEqual(['0020']);
	});

	test('surfaces failure and replays from the original boundary on the next recovery', async () => {
		const paginator = makePaginator();
		api.mockResolvedValueOnce([item(1)]);
		await paginator.init();
		api.mockResolvedValueOnce([item(2)]).mockRejectedValueOnce(new Error('offline'));
		await paginator.catchUp();
		expect(paginator.error.value).toBe(true);
		paginator.prepend(item(4) as never);
		api.mockResolvedValueOnce([item(2), item(3), item(4)]).mockResolvedValueOnce([]);
		await paginator.catchUp();
		expect(paginator.items.value.map(x => x.id)).toEqual(['0004', '0003', '0002', '0001']);
		expect(paginator.error.value).toBe(false);
	});

	test('defers recovery until initialization completes and handles an empty view', async () => {
		const paginator = makePaginator();
		const initialPage = Promise.withResolvers<MisskeyEntity[]>();
		api.mockReturnValueOnce(initialPage.promise);
		const initial = paginator.init();
		await paginator.catchUp();
		api.mockResolvedValueOnce([item(3), item(2)]);
		initialPage.resolve([]);
		await initial;
		expect(paginator.items.value.map(x => x.id)).toEqual(['0003', '0002']);
		expect(paginator.canFetchOlder.value).toBe(true);
	});
});
