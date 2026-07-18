/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { parseResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';

const MAX_CACHE_ENTRIES = 256;
const MAX_CONCURRENT_RESOLUTIONS = 4;
const MAX_QUEUED_RESOLUTIONS = 32;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedFediverseMiniApp = Omit<ResolvedFediverseMiniApp, 'launchUrl'>;
type PendingResolution = {
	promise: Promise<CachedFediverseMiniApp | null>;
	abortController: AbortController;
	consumers: number;
};

const resolvedCache = new Map<string, CachedFediverseMiniApp>();
const unavailableCache = new Map<string, number>();
const pendingResolutions = new Map<string, PendingResolution>();
const resolutionQueue: Array<() => void> = [];
let activeResolutions = 0;

export async function resolveFediverseMiniApp(url: string, signal?: AbortSignal): Promise<ResolvedFediverseMiniApp | null> {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
	if ($i == null) return null;
	const token = $i.token;

	let launchUrl: URL;
	try {
		launchUrl = new URL(url);
	} catch {
		return null;
	}
	if (
		launchUrl.protocol !== 'https:' ||
		launchUrl.username !== '' ||
		launchUrl.password !== '' ||
		launchUrl.hostname === '' ||
		launchUrl.port !== '' ||
		launchUrl.origin === window.location.origin
	) {
		return null;
	}

	const key = launchUrl.origin;
	const now = Date.now();
	const cached = resolvedCache.get(key);
	if (cached != null) {
		if (Date.parse(cached.expiresAt) > now) {
			resolvedCache.delete(key);
			resolvedCache.set(key, cached);
			return { ...cached, launchUrl: launchUrl.href };
		}
		resolvedCache.delete(key);
	}

	const unavailableUntil = unavailableCache.get(key);
	if (unavailableUntil != null) {
		if (unavailableUntil > now) return null;
		unavailableCache.delete(key);
	}

	let pending = pendingResolutions.get(key);
	if (pending == null) {
		const abortController = new AbortController();
		const promise = runWithResolutionSlot(async () => {
			const response = await window.fetch(`${apiUrl}/mini-apps/resolve`, {
				method: 'POST',
				body: JSON.stringify({
					url: launchUrl.href,
					i: token,
				}),
				credentials: 'omit',
				cache: 'no-cache',
				headers: {
					'Content-Type': 'application/json',
				},
				signal: abortController.signal,
			});

			if (!response.ok) {
				if (response.status >= 400 && response.status < 500 && ![401, 403, 429].includes(response.status)) {
					setBounded(unavailableCache, key, Date.now() + NEGATIVE_CACHE_TTL_MS);
				}
				return null;
			}

			const resolved = parseResolvedFediverseMiniApp(await response.json(), Date.now(), window.location.origin);
			if (resolved == null || resolved.appOrigin !== key) {
				setBounded(unavailableCache, key, Date.now() + NEGATIVE_CACHE_TTL_MS);
				return null;
			}

			const { launchUrl: _launchUrl, ...cacheable } = resolved;
			unavailableCache.delete(key);
			setBounded(resolvedCache, key, cacheable);
			return cacheable;
		}, abortController.signal);
		pending = { promise, abortController, consumers: 0 };
		pendingResolutions.set(key, pending);
		const cleanup = (): void => {
			if (pendingResolutions.get(key) === pending) pendingResolutions.delete(key);
		};
		void promise.then(cleanup, cleanup);
	}

	pending.consumers++;
	try {
		const resolved = await waitForResolution(pending.promise, signal);
		return resolved == null ? null : { ...resolved, launchUrl: launchUrl.href };
	} finally {
		pending.consumers--;
		if (pending.consumers === 0) pending.abortController.abort();
	}
}

async function runWithResolutionSlot<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T | null> {
	if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
	if (activeResolutions >= MAX_CONCURRENT_RESOLUTIONS) {
		if (resolutionQueue.length >= MAX_QUEUED_RESOLUTIONS) return null;
		await waitForResolutionSlot(signal);
	} else {
		activeResolutions++;
	}
	try {
		return await task();
	} finally {
		const next = resolutionQueue.shift();
		if (next == null) {
			activeResolutions--;
		} else {
			// Keep the permit reserved while transferring it to the next waiter.
			next();
		}
	}
}

function waitForResolutionSlot(signal: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const queued = (): void => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		};
		const onAbort = (): void => {
			const index = resolutionQueue.indexOf(queued);
			if (index !== -1) resolutionQueue.splice(index, 1);
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
		};
		resolutionQueue.push(queued);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function setBounded<K, V>(cache: Map<K, V>, key: K, value: V): void {
	cache.delete(key);
	cache.set(key, value);
	if (cache.size <= MAX_CACHE_ENTRIES) return;
	const oldestKey = cache.keys().next().value;
	if (oldestKey !== undefined) cache.delete(oldestKey);
}

function waitForResolution<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (signal == null) return promise;
	if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));

	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => {
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void promise.then(value => {
			signal.removeEventListener('abort', onAbort);
			resolve(value);
		}, error => {
			signal.removeEventListener('abort', onAbort);
			reject(error);
		});
	});
}
