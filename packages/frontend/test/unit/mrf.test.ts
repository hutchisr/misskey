/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { assert, describe, test } from 'vitest';
import {
	countConfiguredSimpleHosts,
	countEnabledMrfPolicies,
	countKeywordRejectPatterns,
	countKeywordReplacementRules,
	createMrfFormState,
	formatMrfHellthreadThresholdSummary,
	serializeMrfPolicies,
	validateMrfFormState,
	type MrfPolicies,
} from '@/pages/admin/mrf.impl.js';

const policies: MrfPolicies = {
	enabled: ['simple', 'hellthread'],
	simple: {
		reject: ['reject.example'],
		mediaRemoval: ['media.example'],
		mediaNsfw: [],
		reportRemoval: [],
		followersOnly: ['followers.example'],
	},
	keyword: {
		reject: ['spam', '/scam/i'],
		replace: [{ pattern: 'bad', replacement: 'good' }],
	},
	hellthread: {
		rejectThreshold: 20,
		delistThreshold: 10,
	},
};

describe('MRF form model', () => {
	test('creates editable textarea and enablement state from API policies', () => {
		const state = createMrfFormState(policies);

		assert.deepStrictEqual(state, {
			simpleEnabled: true,
			keywordEnabled: false,
			hellthreadEnabled: true,
			simpleReject: 'reject.example',
			simpleMediaRemoval: 'media.example',
			simpleMediaNsfw: '',
			simpleReportRemoval: '',
			simpleFollowersOnly: 'followers.example',
			keywordReject: 'spam\n/scam/i',
			keywordReplace: [{ id: 'saved-0', pattern: 'bad', replacement: 'good' }],
			hellthreadRejectThreshold: 20,
			hellthreadDelistThreshold: 10,
		});
	});

	test('normalizes persisted negative Hellthread thresholds to disabled while retaining non-negative values', () => {
		const state = createMrfFormState({
			...policies,
			hellthread: {
				rejectThreshold: -1,
				delistThreshold: -10,
			},
		});
		const nonNegativeState = createMrfFormState({
			...policies,
			hellthread: {
				rejectThreshold: 0,
				delistThreshold: 5,
			},
		});

		assert.strictEqual(state.hellthreadRejectThreshold, 0);
		assert.strictEqual(state.hellthreadDelistThreshold, 0);
		assert.strictEqual(nonNegativeState.hellthreadRejectThreshold, 0);
		assert.strictEqual(nonNegativeState.hellthreadDelistThreshold, 5);
	});

	test('serializes the complete policy object in fixed order and normalizes line lists', () => {
		const state = createMrfFormState(policies);
		state.keywordEnabled = true;
		state.simpleReject = ' reject.example \n\nreject.example\n second.example ';
		state.keywordReplace.push(
			{ id: 'new-0', pattern: '', replacement: '' },
			{ id: 'new-1', pattern: 'remove-me', replacement: '' },
		);

		const serialized = serializeMrfPolicies(state);

		assert.deepStrictEqual(serialized.enabled, ['simple', 'keyword', 'hellthread']);
		assert.deepStrictEqual(serialized.simple.reject, ['reject.example', 'reject.example', 'second.example']);
		assert.deepStrictEqual(serialized.keyword.replace, [
			{ pattern: 'bad', replacement: 'good' },
			{ pattern: 'remove-me', replacement: '' },
		]);
		assert.deepStrictEqual(serialized.hellthread, {
			rejectThreshold: 20,
			delistThreshold: 10,
		});
	});

	test('rejects incomplete replacement rows and invalid thresholds', () => {
		const state = createMrfFormState(policies);
		state.keywordReplace.push({ id: 'new-0', pattern: '', replacement: 'replacement' });
		state.hellthreadRejectThreshold = -1;
		state.hellthreadDelistThreshold = 1.5;

		const validation = validateMrfFormState(state);

		assert.isFalse(validation.valid);
		assert.deepStrictEqual(validation.keywordReplace, [false, true]);
		assert.isTrue(validation.hellthreadRejectThreshold);
		assert.isTrue(validation.hellthreadDelistThreshold);
		assert.throws(() => serializeMrfPolicies(state), TypeError);
	});

	test('counts configured values for collapsed card summaries', () => {
		const state = createMrfFormState(policies);
		state.simpleReject += '\n second.example ';

		assert.strictEqual(countConfiguredSimpleHosts(state), 4);
		assert.strictEqual(countKeywordRejectPatterns(state), 2);
		assert.strictEqual(countKeywordReplacementRules(state), 1);
	});

	test('keeps saved policy count separate from pending enablement edits', () => {
		const savedState = createMrfFormState(policies);
		const pendingState = createMrfFormState(policies);
		pendingState.simpleEnabled = false;
		pendingState.keywordEnabled = true;
		pendingState.hellthreadEnabled = false;

		assert.strictEqual(countEnabledMrfPolicies(savedState), 2);
		assert.strictEqual(countEnabledMrfPolicies(pendingState), 1);
	});

	test('keeps cleared hellthread thresholds invalid until explicitly set to zero', () => {
		const state = createMrfFormState(policies);
		state.hellthreadRejectThreshold = null;
		state.hellthreadDelistThreshold = null;

		const validation = validateMrfFormState(state);

		assert.isFalse(validation.valid);
		assert.isTrue(validation.hellthreadRejectThreshold);
		assert.isTrue(validation.hellthreadDelistThreshold);

		state.hellthreadRejectThreshold = 0;
		state.hellthreadDelistThreshold = 0;

		assert.isTrue(validateMrfFormState(state).valid);
	});

	test('formats cleared Hellthread thresholds without exposing NaN', () => {
		assert.strictEqual(formatMrfHellthreadThresholdSummary(0, 'Disabled'), 'Disabled');
		assert.strictEqual(formatMrfHellthreadThresholdSummary(42, 'Disabled'), '42');
		assert.strictEqual(formatMrfHellthreadThresholdSummary(null, 'Disabled'), '');
		assert.strictEqual(formatMrfHellthreadThresholdSummary(Number.NaN, 'Disabled'), '');
	});

	test('preserves untouched policy sections when one card changes', () => {
		const state = createMrfFormState(policies);
		state.simpleMediaNsfw = 'sensitive.example';

		const serialized = serializeMrfPolicies(state);

		assert.deepStrictEqual(serialized.keyword, policies.keyword);
		assert.deepStrictEqual(serialized.hellthread, policies.hellthread);
		assert.deepStrictEqual(serialized.simple.mediaNsfw, ['sensitive.example']);
	});
});
