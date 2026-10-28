/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { isPromise } from 'node:util/types';
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import type { Context, Tracer } from '@opentelemetry/api';
import type { Config } from '@/config.js';
import type { LogTraceContext } from '@/logging/types.js';
import type { TelemetryAdapter, TelemetryCaptureMessageOptions } from './TelemetryAdapter.js';

const EXPORT_TIMEOUT = 4000;
const SHUTDOWN_TIMEOUT = 5000;

export class OtelTelemetryAdapter implements TelemetryAdapter {
	private readonly contexts = new AsyncLocalStorage<Context>();
	private readonly provider: BasicTracerProvider;
	private readonly tracer: Tracer;
	private shutdownPromise?: Promise<void>;

	public constructor(config: NonNullable<Config['otelForBackend']>) {
		const endpoint = URL.canParse(config.endpoint) ? new URL(config.endpoint) : undefined;
		if (!endpoint || !['http:', 'https:'].includes(endpoint.protocol)) {
			throw new Error('otelForBackend.endpoint must be an absolute HTTP(S) trace endpoint.');
		}
		const sampleRate = config.sampleRate === undefined ? 0.1 : config.sampleRate;
		if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
			throw new Error('otelForBackend.sampleRate must be a finite number between 0 and 1.');
		}
		const serviceName = config.serviceName === undefined ? 'misskey' : config.serviceName;
		if (typeof serviceName !== 'string' || serviceName.trim().length === 0) {
			throw new Error('otelForBackend.serviceName must be a non-empty string.');
		}

		// Never register globally: Sentry owns its own provider/context and propagation.
		this.provider = new BasicTracerProvider({
			resource: resourceFromAttributes({ 'service.name': serviceName }),
			sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) }),
			spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({
				url: endpoint.href,
				timeoutMillis: EXPORT_TIMEOUT,
			}), { exportTimeoutMillis: EXPORT_TIMEOUT })],
		});
		this.tracer = this.provider.getTracer('misskey');
	}

	public captureMessage(_message: string, opts: TelemetryCaptureMessageOptions): void {
		// Error payloads, user IDs and extra data belong only to the Sentry adapter.
		if (opts.level === 'error') {
			const context = this.contexts.getStore();
			if (context) trace.getSpan(context)?.setStatus({ code: SpanStatusCode.ERROR });
		}
	}

	public getActiveTraceContext(): LogTraceContext | undefined {
		const context = this.contexts.getStore();
		const span = context && trace.getSpan(context);
		if (!span) return undefined;
		const { traceId, spanId, traceFlags } = span.spanContext();
		return { traceId, spanId, traceFlags };
	}

	public startSpan<T>(name: string, fn: () => T): T {
		if (this.shutdownPromise) return fn();
		const parent = this.contexts.getStore() ?? ROOT_CONTEXT;
		const kind = name.startsWith('API: ') ? SpanKind.SERVER : name.startsWith('Queue: ') ? SpanKind.CONSUMER : SpanKind.INTERNAL;
		const span = this.tracer.startSpan(name, { kind }, parent);
		return this.contexts.run(trace.setSpan(parent, span), () => {
			try {
				const result = fn();
				if (isPromise(result)) {
					void result.then(() => span.end(), () => {
						span.setStatus({ code: SpanStatusCode.ERROR });
						span.end();
					});
				} else {
					span.end();
				}
				return result;
			} catch (error) {
				span.setStatus({ code: SpanStatusCode.ERROR });
				span.end();
				throw error;
			}
		});
	}

	public shutdown(): Promise<void> {
		if (!this.shutdownPromise) {
			let timer: NodeJS.Timeout;
			this.shutdownPromise = Promise.race([
				this.provider.shutdown(),
				new Promise<void>(resolve => { timer = setTimeout(resolve, SHUTDOWN_TIMEOUT); }),
			]).finally(() => {
				clearTimeout(timer);
				this.contexts.disable();
			});
		}
		return this.shutdownPromise;
	}
}
