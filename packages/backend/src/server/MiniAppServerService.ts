/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';

const relayHtml = '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Authorization complete</title><script src="/mini-apps/oauth/relay.js" defer></script></head><body></body></html>';

export const miniAppOAuthRelayScript = `(() => {
\t'use strict';
\tconst finish = (channel) => window.setTimeout(() => {
\t\tchannel?.close();
\t\twindow.close();
\t}, 100);
\tconst encoded = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
\tif (encoded.length === 0 || new TextEncoder().encode(encoded).byteLength > 1024) {
\t\tfinish();
\t\treturn;
\t}
\tconst entries = [...new URLSearchParams(encoded).entries()];
\tconst params = new Map();
\tfor (const [key, value] of entries) {
\t\tif (params.has(key)) {
\t\t\tfinish();
\t\t\treturn;
\t\t}
\t\tparams.set(key, value);
\t}
\tconst version = params.get('version');
\tconst launchId = params.get('launch_id');
\tconst state = params.get('state');
\tconst status = params.get('status');
\tconst handoffCode = params.get('handoff_code');
\tconst baseKeys = ['version', 'launch_id', 'state', 'status'];
\tconst expectedKeys = status === 'success' ? [...baseKeys, 'handoff_code'] : baseKeys;
\tif (
\t\tparams.size !== expectedKeys.length ||
\t\t!expectedKeys.every(key => params.has(key)) ||
\t\tversion !== '1' ||
\t\t!/^[A-Za-z0-9_-]{43}$/.test(launchId ?? '') ||
\t\t!/^[A-Za-z0-9_-]{43,256}$/.test(state ?? '') ||
\t\t!['success', 'cancelled', 'error'].includes(status ?? '') ||
\t\t(status === 'success' && !/^[A-Za-z0-9_-]{16,512}$/.test(handoffCode ?? ''))
\t) {
\t\tfinish();
\t\treturn;
\t}
\tconst channel = new BroadcastChannel(\`fediverse-miniapp-auth:\${launchId}:\${state}\`);
\tchannel.postMessage({
\t\ttype: 'fediverse-miniapp:auth-completion',
\t\tversion: '1',
\t\tlaunchId,
\t\tstate,
\t\tstatus,
\t\t...(status === 'success' ? { handoffCode } : {}),
\t});
\tfinish(channel);
})();`;

function applyRelayHeaders(reply: FastifyReply): void {
	reply.header('Cache-Control', 'private, no-store, max-age=0');
	reply.header('Pragma', 'no-cache');
	reply.header('Cross-Origin-Opener-Policy', 'same-origin');
	reply.header('Cross-Origin-Resource-Policy', 'same-origin');
	reply.header('Referrer-Policy', 'no-referrer');
	reply.header('X-Content-Type-Options', 'nosniff');
	reply.header('X-Frame-Options', 'DENY');
}

@Injectable()
export class MiniAppServerService {
	@bindThis
	public createServer(fastify: FastifyInstance, _options: FastifyPluginOptions, done: (err?: Error) => void): void {
		fastify.get('/mini-apps/oauth/relay', async (_request, reply) => {
			applyRelayHeaders(reply);
			reply.header('Content-Security-Policy', 'default-src \'none\'; script-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'; connect-src \'none\'; img-src \'none\'; style-src \'none\'');
			reply.type('text/html; charset=utf-8');
			return relayHtml;
		});

		fastify.get('/mini-apps/oauth/relay.js', async (_request, reply) => {
			applyRelayHeaders(reply);
			reply.type('text/javascript; charset=utf-8');
			return miniAppOAuthRelayScript;
		});

		done();
	}
}
