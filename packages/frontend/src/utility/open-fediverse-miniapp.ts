/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';
import MkMiniAppWindow from '@/components/MkMiniAppWindow.vue';
import * as os from '@/os.js';

export const openedFediverseMiniAppManifests = reactive(new Set<string>());

export function openFediverseMiniApp(resolved: ResolvedFediverseMiniApp, callbacks: {
	onOpened?: () => void;
	onClosed?: () => void;
} = {}): boolean {
	const manifestUrl = resolved.manifestUrl;
	if (openedFediverseMiniAppManifests.has(manifestUrl)) return false;

	openedFediverseMiniAppManifests.add(manifestUrl);
	const { dispose } = os.popup(MkMiniAppWindow, {
		resolved,
	}, {
		closed: () => {
			openedFediverseMiniAppManifests.delete(manifestUrl);
			dispose();
			callbacks.onClosed?.();
		},
	});
	callbacks.onOpened?.();
	return true;
}
