<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" v-slot="{ type, maxHeight }" :preferType="preferedModalType" :anchor="anchor" :transparentBg="true" :anchorElement="anchorElement" @click="modal?.close()" @closed="emit('closed')" @esc="modal?.close()">
	<div class="szkkfdyq _popup _shadow" :class="{ asDrawer: type === 'drawer' }" :style="{ maxHeight: maxHeight ? maxHeight + 'px' : '' }">
		<div class="main">
			<template v-for="item in items" :key="item.key">
				<button v-if="item.action != null" v-click-anime class="_button item" @click="$event => { item.action!($event); close(); }">
					<img v-if="item.iconUrl != null" class="icon appIcon" :src="item.iconUrl" alt="" loading="lazy" referrerpolicy="no-referrer" @error="markBrokenIcon(item.iconUrl)">
					<i v-else class="icon" :class="item.icon"></i>
					<div class="text">{{ item.text }}</div>
					<span v-if="item.indicate && item.indicateValue" class="_indicateCounter indicatorWithValue">{{ item.indicateValue }}</span>
					<span v-else-if="item.indicate" class="indicator _blink"><i class="_indicatorCircle"></i></span>
				</button>
				<MkA v-else-if="item.to != null" v-click-anime :to="item.to" class="item" @click.passive="close()">
					<i class="icon" :class="item.icon"></i>
					<div class="text">{{ item.text }}</div>
					<span v-if="item.indicate && item.indicateValue" class="_indicateCounter indicatorWithValue">{{ item.indicateValue }}</span>
					<span v-else-if="item.indicate" class="indicator _blink"><i class="_indicatorCircle"></i></span>
				</MkA>
			</template>
		</div>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import { computed, reactive, shallowRef, useTemplateRef } from 'vue';
import type { Endpoints } from 'misskey-js';
import MkModal from '@/components/MkModal.vue';
import { navbarItemDef } from '@/navbar.js';
import { deviceKind } from '@/utility/device-kind.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { resolveFediverseMiniApp } from '@/utility/resolve-fediverse-miniapp.js';
import { openFediverseMiniApp } from '@/utility/open-fediverse-miniapp.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

type UserMiniApp = Endpoints['mini-apps/list']['res'][number];

type LaunchPadItem = {
	key: string;
	text: string;
	icon: string;
	iconUrl?: string;
	to?: string;
	action?: (event: MouseEvent) => void | Promise<void>;
	indicate?: boolean;
	indicateValue?: string | number;
};

const props = withDefaults(defineProps<{
	anchorElement?: HTMLElement | null;
	anchor?: { x: string; y: string; };
}>(), {
	anchorElement: null,
	anchor: () => ({ x: 'right', y: 'center' }),
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const preferedModalType = (deviceKind === 'desktop' && props.anchorElement != null) ? 'popup' :
	deviceKind === 'smartphone' ? 'drawer' :
	'dialog';

const modal = useTemplateRef('modal');

const menu = prefer.s.menu;
const miniApps = shallowRef<UserMiniApp[]>([]);
const brokenIconUrls = reactive(new Set<string>());

const navbarItems = Object.keys(navbarItemDef).filter(k => !menu.includes(k)).map(k => ({
	key: `navbar:${k}`,
	def: navbarItemDef[k],
})).filter(({ def }) => def.show == null ? true : def.show).map(({ key, def }) => ({
	key,
	type: def.to ? 'link' : 'button',
	text: def.title,
	icon: def.icon,
	to: def.to,
	action: def.action,
	indicate: def.indicated,
	indicateValue: def.indicateValue,
})) as LaunchPadItem[];

const items = computed<LaunchPadItem[]>(() => [
	...navbarItems,
	...miniApps.value.map(miniApp => ({
		key: `mini-app:${miniApp.manifestUrl}`,
		text: miniApp.name,
		icon: 'ti ti-device-gamepad-2',
		iconUrl: miniApp.iconUrl == null || brokenIconUrls.has(miniApp.iconUrl) ? undefined : miniApp.iconUrl,
		action: () => launchMiniApp(miniApp),
	})),
]);

if ($i != null) {
	void misskeyApi('mini-apps/list', { limit: 12 }).then(result => {
		miniApps.value = result;
	}).catch(() => {
		// Keep the normal More! menu available when the optional Mini App list fails.
	});
}

async function launchMiniApp(miniApp: UserMiniApp): Promise<void> {
	try {
		const resolved = await os.promiseDialog(
			resolveFediverseMiniApp(miniApp.launchUrl),
			() => {},
			() => {},
		);
		if (resolved == null) {
			await os.alert({ type: 'error', text: i18n.ts._miniApps.launchFailed });
			return;
		}

		openFediverseMiniApp({
			...resolved,
			launchUrl: resolved.manifest.homeUrl,
		});
	} catch {
		await os.alert({ type: 'error', text: i18n.ts._miniApps.launchFailed });
	}
}

function markBrokenIcon(iconUrl: string): void {
	brokenIconUrls.add(iconUrl);
}

function close() {
	modal.value?.close();
}
</script>

<style lang="scss" scoped>
.szkkfdyq {
	max-height: 100%;
	width: min(460px, 100vw);
	margin: auto;
	padding: 24px;
	box-sizing: border-box;
	overflow: auto;
	overscroll-behavior: contain;
	text-align: left;
	border-radius: 16px;

	&.asDrawer {
		width: 100%;
		padding: 16px 16px max(env(safe-area-inset-bottom, 0px), 16px) 16px;
		border-radius: 24px;
		border-bottom-right-radius: 0;
		border-bottom-left-radius: 0;
		text-align: center;
	}

	> .main {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));

		> .item {
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			vertical-align: bottom;
			height: 100px;
			border-radius: 10px;
			padding: 10px;
			box-sizing: border-box;

			&:hover {
				color: var(--MI_THEME-accent);
				background: var(--MI_THEME-accentedBg);
				text-decoration: none;
			}

			> .icon {
				font-size: 24px;
				height: 24px;
			}

			> .appIcon {
				width: 24px;
				border-radius: 6px;
				object-fit: cover;
			}

			> .text {
				margin-top: 12px;
				font-size: 0.8em;
				line-height: 1.5em;
				text-align: center;
			}

			> .indicatorWithValue {
				position: absolute;
				top: 32px;
				left: 16px;

				@media (max-width: 500px) {
					top: 16px;
					left: 8px;
				}
			}

			> .indicator {
				position: absolute;
				top: 32px;
				left: 32px;
				color: var(--MI_THEME-indicator);
				font-size: 8px;

				@media (max-width: 500px) {
					top: 16px;
					left: 16px;
				}
			}
		}
	}
}
</style>
