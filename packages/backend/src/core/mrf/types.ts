/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { IActivity } from '@/core/activitypub/type.js';

export type { MrfSimplePolicyConfig, MrfKeywordPolicyConfig, MrfHellthreadPolicyConfig, MrfPoliciesConfig } from '@/misc/mrf-config.js';
export { defaultMrfPoliciesConfig } from '@/misc/mrf-config.js';

export type MrfResult =
	| { action: 'accept'; activity: IActivity }
	| { action: 'reject'; reason: string };

export interface MrfPolicy {
	name: string;
	filterActivity(activity: IActivity): MrfResult | Promise<MrfResult>;
}
