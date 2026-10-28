/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import protobuf from 'protobufjs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { OtelTelemetryAdapter } from '@/core/telemetry/adapters/OtelTelemetryAdapter.js';
import { runQueueJob } from '@/queue/queue-job-runner.js';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '@/config.js';

// Decode the actual collector wire format, not a mocked exporter or SDK calls.
// Field numbers: opentelemetry-proto collector/trace/v1 and trace/v1/trace.proto.
const requestType = protobuf.parse(`
syntax = "proto3";
message ExportTraceServiceRequest { repeated ResourceSpans resourceSpans = 1; }
message ResourceSpans { Resource resource = 1; repeated ScopeSpans scopeSpans = 2; }
message Resource { repeated KeyValue attributes = 1; }
message KeyValue { string key = 1; AnyValue value = 2; }
message AnyValue { string stringValue = 1; }
message ScopeSpans { repeated Span spans = 2; }
message Span {
  bytes traceId = 1; bytes spanId = 2; bytes parentSpanId = 4;
  string name = 5; int32 kind = 6;
  fixed64 startTimeUnixNano = 7; fixed64 endTimeUnixNano = 8;
  repeated KeyValue attributes = 9; repeated Event events = 11; Status status = 15;
}
message Event { string name = 2; repeated KeyValue attributes = 3; }
message Status { string message = 2; int32 code = 3; }
`).root.lookupType('ExportTraceServiceRequest');

type ExportedSpan = {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: unknown[];
	events: unknown[];
	status: { message: string; code: number };
};

type ExportedRequest = {
	resourceSpans: {
		resource: { attributes: { key: string; value: { stringValue: string } }[] };
		scopeSpans: { spans: ExportedSpan[] }[];
	}[];
};

describe('native OTLP tracing', () => {
	let server: Server;
	let endpoint: string;
	let requests: { path: string | undefined; headers: IncomingHttpHeaders; body: Buffer }[];
	let adapters: OtelTelemetryAdapter[];
	let stall: boolean;

	beforeEach(async () => {
		requests = [];
		adapters = [];
		stall = false;
		server = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			requests.push({ path: request.url, headers: request.headers, body: Buffer.concat(chunks) });
			if (!stall) {
				response.writeHead(200, { 'content-type': 'application/x-protobuf' });
				response.end();
			}
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`;
	});

	afterEach(async () => {
		await Promise.allSettled(adapters.map(adapter => adapter.shutdown()));
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	});

	function create(options: Partial<NonNullable<Config['otelForBackend']>> = {}) {
		const adapter = new OtelTelemetryAdapter({ endpoint, sampleRate: 1, ...options });
		adapters.push(adapter);
		return adapter;
	}

	function exports(): ExportedRequest[] {
		return requests.filter(request => request.path === '/v1/traces').map(request => {
			expect(request.headers['content-type']).toBe('application/x-protobuf');
			return requestType.toObject(requestType.decode(request.body), {
				bytes: String, longs: String, defaults: true, arrays: true,
			}) as ExportedRequest;
		});
	}

	function spans() {
		return exports().flatMap(request => request.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans)));
	}

	test('exports isolated concurrent parents and preserves values without replacing a global provider or propagating headers', async () => {
		const globalProvider = new BasicTracerProvider();
		trace.setGlobalTracerProvider(globalProvider);
		const registeredProvider = trace.getTracerProvider();
		try {
			const adapter = create({ serviceName: 'misskey-test' });
			const value = { result: true };
			const first = adapter.startSpan('API: meta', async () => {
				const parent = adapter.getActiveTraceContext();
				await delay(20);
				expect(adapter.getActiveTraceContext()).toEqual(parent);
				await fetch(endpoint.replace('/v1/traces', '/probe'));
				return adapter.startSpan('first child', () => value);
			});
			const second = adapter.startSpan('Queue: Inbox', async () => {
				const parent = adapter.getActiveTraceContext();
				await delay(5);
				expect(adapter.getActiveTraceContext()).toEqual(parent);
				return adapter.startSpan('second child', () => 42);
			});
			expect(adapter.getActiveTraceContext()).toBeUndefined();
			expect(await first).toBe(value);
			expect(await second).toBe(42);
			const promise = Promise.resolve(value);
			expect(adapter.startSpan('promise identity', () => promise)).toBe(promise);
			await promise;
			await adapter.shutdown();
			expect(trace.getTracerProvider()).toBe(registeredProvider);

			const exported = spans();
			const firstParent = exported.find(span => span.name === 'API: meta')!;
			const secondParent = exported.find(span => span.name === 'Queue: Inbox')!;
			expect(firstParent.kind).toBe(2); // SERVER
			expect(secondParent.kind).toBe(5); // CONSUMER
			expect(firstParent.parentSpanId).toBe('');
			expect(secondParent.parentSpanId).toBe('');
			expect(firstParent.traceId).not.toBe(secondParent.traceId);
			for (const [name, parent] of [['first child', firstParent], ['second child', secondParent]] as const) {
				const child = exported.find(span => span.name === name)!;
				expect(child.traceId).toBe(parent.traceId);
				expect(child.parentSpanId).toBe(parent.spanId);
				// The SDK samples wall-clock time separately for each span, so
				// sub-millisecond timestamp differences cannot establish end order.
				// BatchSpanProcessor exports spans in the order they actually end.
				expect(exported.indexOf(child)).toBeLessThan(exported.indexOf(parent));
				expect(BigInt(child.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(child.startTimeUnixNano));
				expect(BigInt(parent.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(parent.startTimeUnixNano));
				expect(BigInt(child.startTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(parent.startTimeUnixNano));
			}
			expect(exports()[0].resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'misskey-test' } });
			const probe = requests.find(request => request.path === '/probe')!;
			for (const header of ['traceparent', 'tracestate', 'baggage', 'sentry-trace']) {
				expect(probe.headers[header]).toBeUndefined();
			}
		} finally {
			trace.disable();
			await globalProvider.shutdown();
		}
	});

	test('preserves sync and queue failures and exports only error status, never payloads', async () => {
		const adapter = create();
		const error = new Error('private-error-payload');
		expect(() => adapter.startSpan('sync failure', () => { throw error; })).toThrow(error);
		await expect(runQueueJob(adapter, 'Queue: Inbox', async () => { throw error; }, () => {
			adapter.captureMessage('private-message', { level: 'error', userId: 'private-user', extra: { sql: 'private-sql', error } });
		})).rejects.toBe(error);
		const value = {};
		expect(adapter.startSpan('handled failure', () => {
			adapter.captureMessage('private-handled-error', { level: 'error' });
			return value;
		})).toBe(value);
		adapter.captureMessage('outside span', { level: 'error' });
		await adapter.shutdown();
		const exported = spans();
		expect(exported).toHaveLength(3);
		for (const span of exported) {
			expect(span.status).toEqual({ code: 2, message: '' });
			expect(span.attributes).toEqual([]);
			expect(span.events).toEqual([]);
		}
		expect(exports()[0].resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'misskey' } });
		for (const request of requests) expect(request.body.toString()).not.toContain('private-');
	});

	test('zero sampling suppresses roots and children, including errors', async () => {
		const adapter = create({ sampleRate: 0 });
		await adapter.startSpan('API: meta', async () => {
			expect(adapter.getActiveTraceContext()?.traceFlags).toBe(0);
			await delay(1);
			adapter.startSpan('child', () => adapter.captureMessage('error', { level: 'error' }));
		});
		await adapter.shutdown();
		expect(requests).toEqual([]);
	});

	test('rejects invalid configuration before any export', () => {
		for (const invalid of ['', '/v1/traces', 'file:///v1/traces', 'ftp://collector/v1/traces']) {
			expect(() => create({ endpoint: invalid })).toThrow('otelForBackend.endpoint');
		}
		for (const sampleRate of [-1, 1.1, NaN, Infinity, '0.1', null]) {
			expect(() => create({ sampleRate: sampleRate as number })).toThrow('otelForBackend.sampleRate');
		}
		expect(() => create({ serviceName: ' ' })).toThrow('otelForBackend.serviceName');
		expect(requests).toEqual([]);
	});

	test('shutdown is idempotent and bounded even when the collector never responds', async () => {
		stall = true;
		const adapter = create();
		adapter.startSpan('API: meta', () => undefined);
		const start = performance.now();
		const shutdown = adapter.shutdown();
		expect(adapter.shutdown()).toBe(shutdown);
		await shutdown.catch(() => undefined);
		expect(performance.now() - start).toBeLessThan(5500);
		expect(requests).toHaveLength(1);
		expect(adapter.startSpan('after shutdown', () => 42)).toBe(42);
		expect(adapter.getActiveTraceContext()).toBeUndefined();
	});
});
