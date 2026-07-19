/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Endpoints } from 'misskey-js';

export type MrfPolicyName = 'simple' | 'keyword' | 'hellthread';

export type MrfPolicies = {
	enabled: MrfPolicyName[];
	simple: {
		reject: string[];
		mediaRemoval: string[];
		mediaNsfw: string[];
		reportRemoval: string[];
		followersOnly: string[];
	};
	keyword: {
		reject: string[];
		replace: Array<{
			pattern: string;
			replacement: string;
		}>;
	};
	hellthread: {
		rejectThreshold: number;
		delistThreshold: number;
	};
};

export type MrfFormState = {
	simpleEnabled: boolean;
	keywordEnabled: boolean;
	hellthreadEnabled: boolean;
	simpleReject: string;
	simpleMediaRemoval: string;
	simpleMediaNsfw: string;
	simpleReportRemoval: string;
	simpleFollowersOnly: string;
	keywordReject: string;
	keywordReplace: Array<{
		id: string;
		pattern: string;
		replacement: string;
	}>;
	hellthreadRejectThreshold: number | null;
	hellthreadDelistThreshold: number | null;
};

export type MrfFormValidation = {
	valid: boolean;
	keywordReplace: boolean[];
	hellthreadRejectThreshold: boolean;
	hellthreadDelistThreshold: boolean;
};

type UpdateMrfPolicies = NonNullable<Endpoints['admin/update-meta']['req']['mrfPolicies']>;

function splitLines(text: string): string[] {
	return text.split('\n').map(value => value.trim()).filter(value => value.length > 0);
}

function isNonNegativeInteger(value: number | null): value is number {
	return value != null && Number.isInteger(value) && value >= 0;
}

export function formatMrfHellthreadThresholdSummary(value: number | null, disabledLabel: string): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '';
	return value === 0 ? disabledLabel : String(value);
}

export function createMrfFormState(policies: MrfPolicies): MrfFormState {
	return {
		simpleEnabled: policies.enabled.includes('simple'),
		keywordEnabled: policies.enabled.includes('keyword'),
		hellthreadEnabled: policies.enabled.includes('hellthread'),
		simpleReject: policies.simple.reject.join('\n'),
		simpleMediaRemoval: policies.simple.mediaRemoval.join('\n'),
		simpleMediaNsfw: policies.simple.mediaNsfw.join('\n'),
		simpleReportRemoval: policies.simple.reportRemoval.join('\n'),
		simpleFollowersOnly: policies.simple.followersOnly.join('\n'),
		keywordReject: policies.keyword.reject.join('\n'),
		keywordReplace: policies.keyword.replace.map((rule, index) => ({ id: `saved-${index}`, ...rule })),
		hellthreadRejectThreshold: Math.max(0, policies.hellthread.rejectThreshold),
		hellthreadDelistThreshold: Math.max(0, policies.hellthread.delistThreshold),
	};
}

export function validateMrfFormState(state: MrfFormState): MrfFormValidation {
	const keywordReplace = state.keywordReplace.map(rule => rule.pattern.length === 0 && rule.replacement.length > 0);
	const hellthreadRejectThreshold = !isNonNegativeInteger(state.hellthreadRejectThreshold);
	const hellthreadDelistThreshold = !isNonNegativeInteger(state.hellthreadDelistThreshold);

	return {
		valid: !keywordReplace.some(Boolean) && !hellthreadRejectThreshold && !hellthreadDelistThreshold,
		keywordReplace,
		hellthreadRejectThreshold,
		hellthreadDelistThreshold,
	};
}

export function serializeMrfPolicies(state: MrfFormState): MrfPolicies {
	const validation = validateMrfFormState(state);
	if (!validation.valid) {
		throw new TypeError('Cannot serialize invalid MRF policy form state');
	}

	const enabled: MrfPolicyName[] = [];
	if (state.simpleEnabled) enabled.push('simple');
	if (state.keywordEnabled) enabled.push('keyword');
	if (state.hellthreadEnabled) enabled.push('hellthread');

	return {
		enabled,
		simple: {
			reject: splitLines(state.simpleReject),
			mediaRemoval: splitLines(state.simpleMediaRemoval),
			mediaNsfw: splitLines(state.simpleMediaNsfw),
			reportRemoval: splitLines(state.simpleReportRemoval),
			followersOnly: splitLines(state.simpleFollowersOnly),
		},
		keyword: {
			reject: splitLines(state.keywordReject),
			replace: state.keywordReplace
				.filter(rule => rule.pattern.length > 0)
				.map(rule => ({ pattern: rule.pattern, replacement: rule.replacement })),
		},
		hellthread: {
			rejectThreshold: state.hellthreadRejectThreshold as number,
			delistThreshold: state.hellthreadDelistThreshold as number,
		},
	} satisfies MrfPolicies & UpdateMrfPolicies;
}

export function countConfiguredSimpleHosts(state: MrfFormState): number {
	return [
		state.simpleReject,
		state.simpleMediaRemoval,
		state.simpleMediaNsfw,
		state.simpleReportRemoval,
		state.simpleFollowersOnly,
	].reduce((count, value) => count + splitLines(value).length, 0);
}

export function countEnabledMrfPolicies(state: MrfFormState): number {
	return [state.simpleEnabled, state.keywordEnabled, state.hellthreadEnabled].filter(Boolean).length;
}

export function countKeywordRejectPatterns(state: MrfFormState): number {
	return splitLines(state.keywordReject).length;
}

export function countKeywordReplacementRules(state: MrfFormState): number {
	return state.keywordReplace.filter(rule => rule.pattern.length > 0).length;
}
