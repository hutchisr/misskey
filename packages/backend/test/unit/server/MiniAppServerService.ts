/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import vm from 'node:vm';
import Fastify from 'fastify';
import { afterAll, describe, expect, test } from 'vitest';
import { MiniAppServerService, miniAppOAuthRelayScript } from '@/server/MiniAppServerService.js';

const launchId = 'l'.repeat(43);
const state = 's'.repeat(43);

function runRelay(hash: string): { messages: Array<{ channel: string, value: unknown }>, closed: boolean } {
	const messages: Array<{ channel: string, value: unknown }> = [];
	let closed = false;
	class TestBroadcastChannel {
		constructor(private name: string) {}
		public postMessage(value: unknown): void {
			messages.push({ channel: this.name, value });
		}
		public close(): void {}
	}
	const windowObject = {
		location: { hash },
		close: () => { closed = true; },
		setTimeout: (callback: () => void) => {
			callback();
			return 1;
		},
	};
	vm.runInNewContext(miniAppOAuthRelayScript, {
		window: windowObject,
		TextEncoder,
		URLSearchParams,
		Map,
		BroadcastChannel: TestBroadcastChannel,
	});
	return { messages, closed };
}

describe('MiniAppServerService', () => {
	const fastify = Fastify();
	new MiniAppServerService().createServer(fastify, {}, () => undefined);

	afterAll(async () => {
		await fastify.close();
	});

	test('serves a non-cacheable, isolated OAuth relay', async () => {
		const response = await fastify.inject({ method: 'GET', url: '/mini-apps/oauth/relay' });
		expect(response.statusCode).toBe(200);
		expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
		expect(response.headers['content-security-policy']).toContain('default-src \'none\'');
		expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
		expect(response.headers['x-frame-options']).toBe('DENY');
		expect(response.body).toContain('/mini-apps/oauth/relay.js');
	});

	test('relays an exact backend handoff completion', () => {
		const result = runRelay(`#version=1&launch_id=${launchId}&state=${state}&status=success&handoff_code=${'h'.repeat(43)}`);
		expect(result.closed).toBe(true);
		expect(result.messages).toEqual([{
			channel: `fediverse-miniapp-auth:${launchId}:${state}`,
			value: {
				type: 'fediverse-miniapp:auth-completion',
				version: '1',
				launchId,
				state,
				status: 'success',
				handoffCode: 'h'.repeat(43),
			},
		}]);
	});

	test.each([
		`#version=1&launch_id=${launchId}&launch_id=${launchId}&state=${state}&status=cancelled`,
		`#version=1&launch_id=${launchId}&state=${state}&status=cancelled&extra=1`,
		`#version=1&launch_id=short&state=${state}&status=cancelled`,
		`#version=1&launch_id=${launchId}&state=${state}&status=success&handoff_code=short`,
	])('does not broadcast malformed fragments', (hash) => {
		const result = runRelay(hash);
		expect(result.closed).toBe(true);
		expect(result.messages).toEqual([]);
	});
});
