<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkWindow
	ref="windowEl"
	:initialWidth="960"
	:initialHeight="760"
	:canResize="true"
	:closeButton="pendingAuthorization == null"
	:front="true"
	@close="onClosing"
	@closed="onClosed"
>
	<template #header>{{ activeResolved.manifest.name }}</template>

	<div :class="$style.runtime">
		<div
			:class="$style.runtimeContent"
			:inert="pendingAuthorization != null"
			:aria-hidden="pendingAuthorization != null ? 'true' : undefined"
		>
			<iframe
				v-if="launchReady"
				:key="iframeKey"
				ref="iframe"
				:class="$style.iframe"
				:src="activeResolved.launchUrl"
				:title="activeResolved.manifest.name"
				sandbox="allow-forms allow-same-origin allow-scripts"
				referrerpolicy="no-referrer"
				@load="onFrameLoad"
				@error="onFrameError"
			></iframe>

			<div v-if="phase === 'connecting'" :class="$style.status" role="status">
				<MkLoading/>
				<div>{{ i18n.ts._miniApps.connecting }}</div>
			</div>
			<div v-else-if="phase === 'error'" :class="$style.status" role="alert">
				<i class="ti ti-alert-triangle" :class="$style.statusIcon"></i>
				<div>{{ runtimeError }}</div>
				<MkButton small @click="retry">{{ i18n.ts.retry }}</MkButton>
			</div>
			<div v-if="authenticationUnsupported" :class="$style.authWarning" role="alert">
				<i class="ti ti-lock-off"></i>
				<span>{{ i18n.ts._miniApps.authenticationUnsupported }}</span>
			</div>
		</div>
		<div
			v-if="pendingAuthorization"
			ref="authorizationDialog"
			:class="$style.authPrompt"
			role="alertdialog"
			aria-modal="true"
			:aria-label="i18n.tsx._miniApps.authorizationPrompt({ name: activeResolved.manifest.name })"
			tabindex="-1"
			@keydown.tab="trapAuthorizationTab"
			@keydown.esc.stop.prevent="cancelPendingAuthorization"
		>
			<i class="ti ti-lock" :class="$style.statusIcon"></i>
			<div>{{ i18n.tsx._miniApps.authorizationPrompt({ name: activeResolved.manifest.name }) }}</div>
			<div :class="$style.authActions">
				<MkButton primary small :wait="authInProgress" @click="approvePendingAuthorization">
					{{ i18n.ts._miniApps.authorize }}
				</MkButton>
				<MkButton small @click="cancelPendingAuthorization">{{ i18n.ts.cancel }}</MkButton>
			</div>
		</div>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { FediverseMiniAppAuthorizationRequest, FediverseMiniAppBootstrap, ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';
import MkButton from '@/components/MkButton.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import MkWindow from '@/components/MkWindow.vue';
import { i18n } from '@/i18n.js';
import {
	buildFediverseMiniAppBootstrap,
	createFediverseMiniAppLaunchId,
	FEDIVERSE_MINI_APP_READY_TIMEOUT_MS,
	parseFediverseMiniAppPortMessage,
} from '@/utility/fediverse-miniapp.js';
import { authorizeFediverseMiniAppBackend, buildFediverseMiniAppAuthResult, FEDIVERSE_MINI_APP_AUTH_TIMEOUT_MS } from '@/utility/fediverse-miniapp-auth.js';
import { resolveFediverseMiniApp } from '@/utility/resolve-fediverse-miniapp.js';

const props = defineProps<{
	resolved: ResolvedFediverseMiniApp;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

type RuntimePhase = 'idle' | 'connecting' | 'ready' | 'error';
type PendingAuthorization = {
	request: FediverseMiniAppAuthorizationRequest;
	launchId: string;
	sequence: number;
	expiresAt: number;
};

const windowEl = useTemplateRef('windowEl');
const iframe = useTemplateRef('iframe');
const authorizationDialog = useTemplateRef('authorizationDialog');
const opened = ref(true);
const iframeKey = ref(0);
const phase = ref<RuntimePhase>('idle');
const runtimeError = ref('');
const authenticationUnsupported = ref(false);
const authInProgress = ref(false);
const launchReady = ref(false);
const refreshedResolved = shallowRef<ResolvedFediverseMiniApp | null>(null);
const activeResolved = computed(() => refreshedResolved.value ?? props.resolved);
const pendingAuthorization = shallowRef<PendingAuthorization | null>(null);

let port: MessagePort | null = null;
let launchId: string | null = null;
let readyTimer: number | null = null;
let sessionSequence = 0;
let recentMessageTimes: number[] = [];
let launchAbortController: AbortController | null = null;
let authAbortController: AbortController | null = null;
let pendingAuthorizationTimer: number | null = null;
let authorizationReturnFocus: HTMLElement | null = null;
let authorizationFocusChange = 0;

const authorizationFocusableSelector = [
	'button:not([disabled])',
	'a[href]',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
].join(',');

async function start(): Promise<void> {
	stopSession();
	const sequence = sessionSequence;
	refreshedResolved.value = null;
	phase.value = 'connecting';
	runtimeError.value = '';
	authenticationUnsupported.value = false;
	launchReady.value = false;
	await prepareLaunch(sequence);
}

function closeWindow(): void {
	windowEl.value?.close();
}

function onClosing(): void {
	stopSession();
	launchReady.value = false;
}

function onClosed(): void {
	onClosing();
	opened.value = false;
	phase.value = 'idle';
	emit('closed');
}

async function retry(): Promise<void> {
	stopSession();
	const sequence = sessionSequence;
	phase.value = 'connecting';
	runtimeError.value = '';
	authenticationUnsupported.value = false;
	launchReady.value = false;
	iframeKey.value++;
	await prepareLaunch(sequence);
}

async function prepareLaunch(sequence: number): Promise<void> {
	if (activeResolved.value.appOrigin === window.location.origin) {
		failSession(i18n.ts._miniApps.launchFailed);
		return;
	}

	const expiresAt = Date.parse(activeResolved.value.expiresAt);
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
		const controller = new AbortController();
		launchAbortController = controller;
		let refreshed: ResolvedFediverseMiniApp | null = null;
		try {
			refreshed = await resolveFediverseMiniApp(activeResolved.value.launchUrl, controller.signal);
		} catch {
			// The error state below gives the user a retry action.
		}
		if (launchAbortController === controller) launchAbortController = null;
		if (sequence !== sessionSequence || !opened.value) return;
		if (refreshed == null) {
			failSession(i18n.ts._miniApps.launchFailed);
			return;
		}
		refreshedResolved.value = refreshed;
	}

	if (sequence !== sessionSequence || !opened.value) return;
	launchReady.value = true;
}

function stopSession(): void {
	sessionSequence++;
	launchAbortController?.abort();
	launchAbortController = null;
	authAbortController?.abort();
	authAbortController = null;
	clearPendingAuthorizationTimer();
	pendingAuthorization.value = null;
	authInProgress.value = false;
	if (readyTimer != null) {
		window.clearTimeout(readyTimer);
		readyTimer = null;
	}
	if (port != null) {
		port.onmessage = null;
		port.onmessageerror = null;
		port.close();
		port = null;
	}
	launchId = null;
	recentMessageTimes = [];
}

function failSession(message: string): void {
	stopSession();
	launchReady.value = false;
	runtimeError.value = message;
	phase.value = 'error';
}

function onFrameLoad(): void {
	if (!opened.value || iframe.value?.contentWindow == null) return;
	stopSession();
	phase.value = 'connecting';
	authenticationUnsupported.value = false;

	const sequence = sessionSequence;
	let bootstrap: FediverseMiniAppBootstrap;
	try {
		launchId = createFediverseMiniAppLaunchId();
		bootstrap = buildFediverseMiniAppBootstrap(window.location.origin, launchId, []);
	} catch {
		failSession(i18n.ts._miniApps.requiresHttps);
		return;
	}

	let channel: MessageChannel;
	try {
		channel = new MessageChannel();
	} catch {
		failSession(i18n.ts._miniApps.launchFailed);
		return;
	}
	port = channel.port1;
	port.onmessage = event => onPortMessage(event, sequence);
	port.onmessageerror = () => {
		if (sequence === sessionSequence) failSession(i18n.ts._miniApps.launchFailed);
	};
	port.start();

	readyTimer = window.setTimeout(() => {
		if (sequence === sessionSequence) failSession(i18n.ts._miniApps.launchTimedOut);
	}, FEDIVERSE_MINI_APP_READY_TIMEOUT_MS);

	try {
		iframe.value.contentWindow.postMessage(bootstrap, activeResolved.value.appOrigin, [channel.port2]);
	} catch {
		channel.port2.close();
		failSession(i18n.ts._miniApps.launchFailed);
	}
}

function onFrameError(): void {
	if (opened.value) failSession(i18n.ts._miniApps.launchFailed);
}

function onPortMessage(event: MessageEvent, sequence: number): void {
	if (sequence !== sessionSequence || launchId == null || port == null) return;
	const now = Date.now();
	recentMessageTimes = recentMessageTimes.filter(timestamp => timestamp > now - 10_000);
	recentMessageTimes.push(now);
	if (recentMessageTimes.length > 64) {
		failSession(i18n.ts._miniApps.launchFailed);
		return;
	}

	const message = parseFediverseMiniAppPortMessage(event.data, launchId, activeResolved.value);
	if (message.type === 'ready') {
		if (readyTimer != null) {
			window.clearTimeout(readyTimer);
			readyTimer = null;
		}
		phase.value = 'ready';
		return;
	}
	if (message.type === 'close') {
		closeWindow();
		return;
	}
	if (message.type === 'invalidRequestAuth') {
		postAuthResult(message.requestId, 'invalid_request');
		return;
	}
	if (message.type === 'requestAuth') {
		if (phase.value !== 'ready') {
			postAuthResult(message.request.requestId, 'invalid_request');
			return;
		}
		if (message.request.completionMode === 'browser_code') {
			authenticationUnsupported.value = true;
			postAuthResult(message.request.requestId, 'error');
			return;
		}
		if (authAbortController != null || pendingAuthorization.value != null) {
			postAuthResult(message.request.requestId, 'invalid_request');
			return;
		}
		pendingAuthorization.value = {
			request: message.request,
			launchId,
			sequence,
			expiresAt: Date.now() + FEDIVERSE_MINI_APP_AUTH_TIMEOUT_MS,
		};
		const pending = pendingAuthorization.value;
		pendingAuthorizationTimer = window.setTimeout(() => expirePendingAuthorization(pending), FEDIVERSE_MINI_APP_AUTH_TIMEOUT_MS);
	}
}

function approvePendingAuthorization(): void {
	const pending = pendingAuthorization.value;
	if (pending == null || authAbortController != null || pending.sequence !== sessionSequence || pending.launchId !== launchId) return;
	const remainingTimeoutMs = pending.expiresAt - Date.now();
	if (remainingTimeoutMs <= 0) {
		expirePendingAuthorization(pending);
		return;
	}

	clearPendingAuthorizationTimer();
	const controller = new AbortController();
	authAbortController = controller;
	authInProgress.value = true;
	// This call opens the popup synchronously from the host button's user activation.
	void authorizeFediverseMiniAppBackend(window.location.origin, pending.launchId, pending.request, {
		signal: controller.signal,
		timeoutMs: remainingTimeoutMs,
	}).then(result => {
		if (pending.sequence !== sessionSequence || pending.launchId !== launchId || authAbortController !== controller || pendingAuthorization.value !== pending) return;
		authAbortController = null;
		authInProgress.value = false;
		pendingAuthorization.value = null;
		if (result.status === 'aborted') return;
		if (result.status === 'success') {
			postAuthResult(pending.request.requestId, result.status, result.handoffCode);
		} else {
			postAuthResult(pending.request.requestId, result.status);
		}
	});
}

function cancelPendingAuthorization(): void {
	const pending = pendingAuthorization.value;
	if (pending == null) return;
	clearPendingAuthorizationTimer();
	pendingAuthorization.value = null;
	authInProgress.value = false;
	const controller = authAbortController;
	authAbortController = null;
	controller?.abort();
	if (pending.sequence === sessionSequence && pending.launchId === launchId) {
		postAuthResult(pending.request.requestId, 'cancelled');
	}
}

function expirePendingAuthorization(pending: PendingAuthorization): void {
	if (pendingAuthorization.value !== pending || pending.sequence !== sessionSequence || pending.launchId !== launchId) return;
	clearPendingAuthorizationTimer();
	pendingAuthorization.value = null;
	authInProgress.value = false;
	postAuthResult(pending.request.requestId, 'error');
}

function clearPendingAuthorizationTimer(): void {
	if (pendingAuthorizationTimer == null) return;
	window.clearTimeout(pendingAuthorizationTimer);
	pendingAuthorizationTimer = null;
}

function getAuthorizationFocusableElements(): HTMLElement[] {
	if (authorizationDialog.value == null) return [];
	return Array.from(authorizationDialog.value.querySelectorAll<HTMLElement>(authorizationFocusableSelector));
}

function focusFirstAuthorizationControl(): void {
	const firstFocusable = getAuthorizationFocusableElements().at(0);
	(firstFocusable ?? authorizationDialog.value)?.focus({ preventScroll: true });
}

function trapAuthorizationTab(event: KeyboardEvent): void {
	const focusable = getAuthorizationFocusableElements();
	if (focusable.length === 0) {
		event.preventDefault();
		authorizationDialog.value?.focus({ preventScroll: true });
		return;
	}

	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	const active = window.document.activeElement;
	if (event.shiftKey && (active === first || active == null || !authorizationDialog.value?.contains(active))) {
		event.preventDefault();
		last.focus({ preventScroll: true });
	} else if (!event.shiftKey && (active === last || active == null || !authorizationDialog.value?.contains(active))) {
		event.preventDefault();
		first.focus({ preventScroll: true });
	}
}

function keepAuthorizationFocus(event: FocusEvent): void {
	if (pendingAuthorization.value == null || authorizationDialog.value == null) return;
	if (event.target instanceof Node && authorizationDialog.value.contains(event.target)) return;
	focusFirstAuthorizationControl();
}

watch(pendingAuthorization, async (pending, previous) => {
	const focusChange = ++authorizationFocusChange;
	if (pending != null) {
		const active = window.document.activeElement;
		authorizationReturnFocus = active instanceof HTMLElement ? active : null;
		window.document.addEventListener('focusin', keepAuthorizationFocus);
		await nextTick();
		if (focusChange === authorizationFocusChange && pendingAuthorization.value === pending) {
			focusFirstAuthorizationControl();
		}
		return;
	}

	if (previous == null) return;
	window.document.removeEventListener('focusin', keepAuthorizationFocus);
	const returnFocus = authorizationReturnFocus;
	authorizationReturnFocus = null;
	await nextTick();
	if (focusChange !== authorizationFocusChange || pendingAuthorization.value != null || !opened.value || !launchReady.value) return;
	const target = returnFocus?.isConnected === true ? returnFocus : iframe.value;
	target?.focus({ preventScroll: true });
}, { flush: 'post' });

function postAuthResult(requestId: string, status: 'success' | 'cancelled' | 'error' | 'invalid_request', handoffCode?: string): void {
	if (port == null || launchId == null) return;
	try {
		port.postMessage(buildFediverseMiniAppAuthResult(launchId, requestId, status, handoffCode));
	} catch {
		failSession(i18n.ts._miniApps.launchFailed);
	}
}

onMounted(() => {
	void start();
});

onDeactivated(() => {
	if (opened.value) closeWindow();
});

onUnmounted(() => {
	window.document.removeEventListener('focusin', keepAuthorizationFocus);
	authorizationReturnFocus = null;
	stopSession();
});
</script>

<style lang="scss" module>
.runtime {
	position: relative;
	width: 100%;
	height: 100%;
	min-height: 360px;
	background: var(--MI_THEME-bg);
}

.runtimeContent {
	position: absolute;
	inset: 0;
}

.iframe {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	border: 0;
	background: var(--MI_THEME-bg);
}

.status {
	position: absolute;
	inset: 0;
	z-index: 2;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 14px;
	padding: 24px;
	text-align: center;
	background: var(--MI_THEME-bg);
}

.statusIcon {
	font-size: 32px;
	color: var(--MI_THEME-warn);
}

.authWarning {
	position: absolute;
	top: 10px;
	left: 10px;
	right: 10px;
	z-index: 3;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-radius: var(--MI-radius);
	color: var(--MI_THEME-infoWarnFg);
	background: var(--MI_THEME-infoWarnBg);
}

.authPrompt {
	position: absolute;
	inset: 0;
	z-index: 4;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 14px;
	padding: 24px;
	text-align: center;
	background: var(--MI_THEME-panel);
}

.authActions {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 8px;
}
</style>
