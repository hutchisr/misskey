<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_panel" :class="[$style.root, { [$style.compact]: compact }]">
	<div :class="$style.appIcon" aria-hidden="true">
		<i class="ti ti-device-gamepad-2"></i>
	</div>
	<div :class="$style.appInfo">
		<div :class="$style.appName">{{ resolved.manifest.name }}</div>
		<div :class="$style.publisher">{{ i18n.tsx._miniApps.publishedBy({ name: resolved.manifest.publisher.name }) }}</div>
		<div :class="$style.origin">{{ appHostname }}</div>
		<div v-if="!compact" :class="$style.notice">{{ i18n.ts._miniApps.externalNotice }}</div>
	</div>
	<MkButton :class="$style.openButton" primary small inline :disabled="windowOpened" @click="openWindow">
		<i class="ti ti-player-play"></i>
		{{ i18n.ts._miniApps.open }}
	</MkButton>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { openFediverseMiniApp, openedFediverseMiniAppManifests } from '@/utility/open-fediverse-miniapp.js';

const props = withDefaults(defineProps<{
	resolved: ResolvedFediverseMiniApp;
	compact?: boolean;
}>(), {
	compact: false,
});

const emit = defineEmits<{
	(ev: 'open'): void;
	(ev: 'closed'): void;
}>();

const windowOpened = computed(() => openedFediverseMiniAppManifests.has(props.resolved.manifestUrl));
const appHostname = computed(() => new URL(props.resolved.appOrigin).hostname);

function openWindow(): void {
	openFediverseMiniApp(props.resolved, {
		onOpened: () => emit('open'),
		onClosed: () => emit('closed'),
	});
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: 14px;
	padding: 14px;
	text-align: left;
}

.compact {
	padding: 10px;
	gap: 10px;

	.appIcon {
		width: 36px;
		height: 36px;
		font-size: 20px;
	}
}

.appIcon {
	display: grid;
	place-items: center;
	width: 48px;
	height: 48px;
	border-radius: var(--MI-radius);
	font-size: 26px;
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
}

.appInfo {
	min-width: 0;
}

.appName {
	font-weight: bold;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.publisher,
.origin,
.notice {
	margin-top: 2px;
	font-size: 0.8em;
	color: color-mix(in srgb, var(--MI_THEME-fg) 65%, transparent);
}

.origin {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.notice {
	margin-top: 6px;
}

.openButton {
	justify-self: end;
}

@container (max-width: 500px) {
	.root {
		grid-template-columns: auto minmax(0, 1fr);
	}

	.openButton {
		grid-column: 1 / -1;
		justify-self: stretch;
	}
}
</style>
