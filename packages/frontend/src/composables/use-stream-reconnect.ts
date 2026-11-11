/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onScopeDispose } from 'vue';
import { useStream } from '@/stream.js';

export function useStreamReconnect(callback: (signal: AbortSignal) => void): void {
	const stream = useStream();
	let disconnected = stream.state === 'reconnecting';
	let recovery: AbortController | null = null;

	function onDisconnected(): void {
		disconnected = true;
		recovery?.abort();
	}

	function onConnected(): void {
		if (!disconnected) return;
		disconnected = false;
		recovery = new AbortController();
		const { signal } = recovery;
		// The SDK resubscribes channels after emitting _connected_.
		queueMicrotask(() => {
			if (!signal.aborted) callback(signal);
		});
	}

	stream.on('_disconnected_', onDisconnected);
	stream.on('_connected_', onConnected);
	onScopeDispose(() => {
		stream.off('_disconnected_', onDisconnected);
		recovery?.abort();
		stream.off('_connected_', onConnected);
	});
}
