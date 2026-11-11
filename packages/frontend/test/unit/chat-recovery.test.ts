/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'eventemitter3';
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import type * as Misskey from 'misskey-js';
import ChatRoom from '@/pages/chat/room.vue';

const mocks = vi.hoisted(() => ({
	api: vi.fn(),
	useStream: vi.fn(),
	alert: vi.fn(),
	sound: vi.fn(),
}));

vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: mocks.api }));
vi.mock('@/stream.js', () => ({ useStream: mocks.useStream }));
vi.mock('@/os.js', () => ({ alert: mocks.alert }));
vi.mock('@/i.js', () => ({ ensureSignin: () => ({ id: 'me', policies: { chatAvailability: 'available' } }) }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: mocks.sound }));
vi.mock('@/composables/use-mutation-observer.js', () => ({ useMutationObserver: vi.fn() }));
vi.mock('@/pages/chat/XMessage.vue', () => ({ default: { props: ['message'], template: '<div data-testid="message">{{ message.id }}</div>' } }));
vi.mock('@/pages/chat/room.form.vue', () => ({ default: { template: '<textarea aria-label="Draft" />' } }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.members.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.info.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot /></button>' } }));
vi.mock('@/components/MkInfo.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const channel = Object.assign(new EventEmitter(), { send: vi.fn(), dispose: vi.fn() });
const stream = Object.assign(new EventEmitter(), {
	state: 'connected',
	useChannel: vi.fn(() => channel),
});
const otherUser = {
	id: 'other', name: 'Other', username: 'other', host: null, canChat: true,
	avatarUrl: '', avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown' as const,
};
const timeline = vi.fn<(params: { limit: number; sinceId?: string; untilId?: string }) => Promise<Misskey.entities.ChatMessageLite[]>>();

function message(n: number): Misskey.entities.ChatMessageLite {
	return {
		id: n.toString().padStart(4, '0'),
		createdAt: '2026-01-01T00:00:00.000Z',
		fromUserId: otherUser.id,
		fromUser: otherUser,
		text: `Message ${n}`,
		reactions: [],
	};
}

function messages(from: number, to: number) {
	return Array.from({ length: to - from + 1 }, (_, i) => message(from + i));
}

function disconnect() {
	stream.state = 'reconnecting';
	stream.emit('_disconnected_');
}

function connect() {
	stream.state = 'connected';
	stream.emit('_connected_');
}

async function openChat(kind: 'user' | 'room', initial = [message(1)]) {
	timeline.mockResolvedValueOnce(initial).mockResolvedValue([]);
	const active = ref(true);
	const props = kind === 'user' ? { userId: 'other' } : { roomId: 'room' };
	const view = render(defineComponent({
		setup: () => () => h(KeepAlive, null, { default: () => active.value ? h(ChatRoom, props) : null }),
	}), {
		global: {
			components: { PageWithHeader: { template: '<main><slot /><slot name="footer" /></main>' } },
			stubs: { MkLoading: true },
		},
	});
	const draft = await view.findByRole('textbox', { name: 'Draft' });
	await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
	await nextTick();
	return { view, active, draft };
}

beforeEach(() => {
	vi.clearAllMocks();
	stream.removeAllListeners();
	channel.removeAllListeners();
	stream.state = 'connected';
	channel.dispose.mockImplementation(() => { channel.removeAllListeners(); });
	mocks.useStream.mockReturnValue(stream);
	timeline.mockReset();
	mocks.api.mockImplementation((endpoint, params) => {
		if (endpoint === 'users/show') return Promise.resolve(otherUser);
		if (endpoint === 'chat/rooms/show') return Promise.resolve({ id: 'room', name: 'Room', ownerId: 'me' });
		return timeline(params);
	});
});

afterEach(cleanup);

describe('chat reconnect recovery', () => {
	test.each(['user', 'room'] as const)('%s recovers every page without letting live duplicates skip the gap or replace the draft', async kind => {
		const { view, draft } = await openChat(kind);
		await fireEvent.update(draft, 'Unsent draft');
		const { promise, resolve } = Promise.withResolvers<Misskey.entities.ChatMessageLite[]>();
		timeline.mockReturnValueOnce(promise)
			.mockResolvedValueOnce(messages(102, 201))
			.mockResolvedValueOnce(messages(202, 205));

		disconnect();
		connect();
		channel.emit('message', message(205));
		channel.emit('message', message(101));
		await waitFor(() => expect(timeline).toHaveBeenCalledTimes(3));
		resolve(messages(2, 101));

		await waitFor(() => expect(view.getAllByTestId('message').map(el => el.textContent)).toEqual(messages(1, 205).map(m => m.id)));
		expect(timeline.mock.calls.slice(2).map(([params]) => params.sinceId)).toEqual(['0001', '0101', '0201']);
		expect(mocks.api.mock.calls.filter(([endpoint]) => endpoint.includes('timeline')).every(([endpoint]) => endpoint === `chat/messages/${kind}-timeline`)).toBe(true);
		expect(view.getByRole('textbox', { name: 'Draft' })).toBe(draft);
		expect((draft as HTMLTextAreaElement).value).toBe('Unsent draft');
		expect(mocks.sound).toHaveBeenCalledTimes(2);
	});

	test.each(['user', 'room'] as const)('%s recovers an initially empty chat by walking all descending pages', async kind => {
		const { view } = await openChat(kind, []);
		timeline.mockResolvedValueOnce(messages(106, 205).reverse())
			.mockResolvedValueOnce(messages(6, 105).reverse())
			.mockResolvedValueOnce(messages(1, 5).reverse());

		disconnect();
		connect();
		channel.emit('message', message(205));

		await waitFor(() => expect(view.getAllByTestId('message').map(el => el.textContent)).toEqual(messages(1, 205).map(m => m.id)));
		expect(timeline.mock.calls.slice(2).map(([params]) => [params.sinceId, params.untilId])).toEqual([
			[undefined, undefined], [undefined, '0106'], [undefined, '0006'],
		]);
	});

	test('ignores stale recovery after another disconnect, defers while deactivated, and cleans up on unmount', async () => {
		const { view, active, draft } = await openChat('user');
		const stale = Promise.withResolvers<Misskey.entities.ChatMessageLite[]>();
		timeline.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce(messages(2, 4));
		disconnect();
		connect();
		await waitFor(() => expect(timeline).toHaveBeenCalledTimes(3));
		channel.emit('message', message(4));

		disconnect();
		active.value = false;
		await nextTick();
		connect();
		stale.resolve([message(99)]);
		await nextTick();
		await nextTick();
		expect(timeline).toHaveBeenCalledTimes(3);

		active.value = true;
		await nextTick();
		await waitFor(() => expect(view.getAllByTestId('message').map(el => el.textContent)).toEqual(messages(1, 4).map(m => m.id)));
		expect(timeline.mock.calls[3][0].sinceId).toBe('0001');
		expect(view.getByRole('textbox', { name: 'Draft' })).toBe(draft);

		const unmounted = Promise.withResolvers<Misskey.entities.ChatMessageLite[]>();
		timeline.mockReturnValueOnce(unmounted.promise);
		disconnect();
		connect();
		await waitFor(() => expect(timeline).toHaveBeenCalledTimes(5));
		view.unmount();
		expect(channel.dispose).toHaveBeenCalledOnce();
		expect(stream.listenerCount('_connected_')).toBe(0);
		expect(stream.listenerCount('_disconnected_')).toBe(0);
		unmounted.resolve(messages(5, 104));
		await nextTick();
		await nextTick();
		expect(timeline).toHaveBeenCalledTimes(5);
		expect(mocks.alert).not.toHaveBeenCalled();
	});

	test('reports a failed page and keeps the original gap cursor for the next reconnect', async () => {
		const { view } = await openChat('room');
		timeline.mockRejectedValueOnce(new Error('Offline'));
		disconnect();
		connect();
		channel.emit('message', message(4));
		await waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
		expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));

		timeline.mockResolvedValueOnce(messages(2, 4));
		disconnect();
		connect();
		await waitFor(() => expect(view.getAllByTestId('message').map(el => el.textContent)).toEqual(messages(1, 4).map(m => m.id)));
		expect(timeline.mock.calls[3][0].sinceId).toBe('0001');
	});
});
