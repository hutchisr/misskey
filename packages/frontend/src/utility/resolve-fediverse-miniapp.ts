/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';
import { $i } from '@/i.js';
import { parseResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';
import type { ResolvedFediverseMiniApp } from '@/utility/fediverse-miniapp.js';

export async function resolveFediverseMiniApp(url: string, signal?: AbortSignal): Promise<ResolvedFediverseMiniApp | null> {
	const response = await window.fetch(`${apiUrl}/mini-apps/resolve`, {
		method: 'POST',
		body: JSON.stringify({
			url,
			...($i == null ? {} : { i: $i.token }),
		}),
		credentials: 'omit',
		cache: 'no-cache',
		headers: {
			'Content-Type': 'application/json',
		},
		signal,
	});

	if (!response.ok) return null;
	return parseResolvedFediverseMiniApp(await response.json(), Date.now(), window.location.origin);
}
