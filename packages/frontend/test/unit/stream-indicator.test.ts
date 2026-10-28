/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'eventemitter3';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import type { StreamEvents } from 'misskey-js';
import StreamIndicator from '@/ui/_common_/stream-indicator.vue';
import { i18n } from '@/i18n.js';

const stream = new EventEmitter<StreamEvents>();

vi.mock('@/stream.js', () => ({ useStream: () => stream }));
vi.mock('@/store.js', () => ({ store: { s: { realtimeMode: true } } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { serverDisconnectedBehavior: 'quiet' } } }));
vi.mock('@/os.js', () => ({ claimZIndex: () => 1000 }));

describe('stream disconnect indicator', () => {
	beforeEach(() => {
		stream.removeAllListeners();
	});

	afterEach(() => {
		cleanup();
	});

	test('dismisses on reconnect and shows again after a later disconnect', async () => {
		const view = render(StreamIndicator);
		expect(view.queryByText(i18n.ts.disconnectedFromServer)).toBeNull();

		stream.emit('_disconnected_');
		await nextTick();
		expect(view.getByText(i18n.ts.disconnectedFromServer)).toBeTruthy();

		stream.emit('_connected_');
		await nextTick();
		expect(view.queryByText(i18n.ts.disconnectedFromServer)).toBeNull();

		stream.emit('_disconnected_');
		await nextTick();
		expect(view.getByText(i18n.ts.disconnectedFromServer)).toBeTruthy();
	});

	test('still allows manual dismissal while disconnected', async () => {
		const view = render(StreamIndicator);
		stream.emit('_disconnected_');
		await nextTick();

		await fireEvent.click(view.getByRole('button', { name: i18n.ts.doNothing }));
		expect(view.queryByText(i18n.ts.disconnectedFromServer)).toBeNull();

		stream.emit('_connected_');
		await nextTick();
		expect(view.queryByText(i18n.ts.disconnectedFromServer)).toBeNull();
	});

	test('removes both stream listeners when unmounted', () => {
		const view = render(StreamIndicator);
		expect(stream.listenerCount('_connected_')).toBe(1);
		expect(stream.listenerCount('_disconnected_')).toBe(1);

		view.unmount();
		expect(stream.listenerCount('_connected_')).toBe(0);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
	});
});
