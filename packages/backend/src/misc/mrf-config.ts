/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type MrfSimplePolicyConfig = {
	reject: string[];
	mediaRemoval: string[];
	mediaNsfw: string[];
	reportRemoval: string[];
	followersOnly: string[];
};

export type MrfKeywordPolicyConfig = {
	reject: string[];
	replace: Array<{ pattern: string; replacement: string }>;
};

export type MrfHellthreadPolicyConfig = {
	rejectThreshold: number;
	delistThreshold: number;
};

export type MrfPoliciesConfig = {
	enabled: string[];
	simple: MrfSimplePolicyConfig;
	keyword: MrfKeywordPolicyConfig;
	hellthread: MrfHellthreadPolicyConfig;
};

export const defaultMrfPoliciesConfig: MrfPoliciesConfig = {
	enabled: [],
	simple: {
		reject: [],
		mediaRemoval: [],
		mediaNsfw: [],
		reportRemoval: [],
		followersOnly: [],
	},
	keyword: {
		reject: [],
		replace: [],
	},
	hellthread: {
		rejectThreshold: 0,
		delistThreshold: 0,
	},
};
