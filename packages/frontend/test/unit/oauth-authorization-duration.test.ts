/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { formatOAuthAuthorizationDuration } from '@/utility/oauth-authorization-duration.js';

describe('formatOAuthAuthorizationDuration', () => {
	test.each([
		[31_536_000, '1 yr'],
		[63_072_000, '2 yr'],
		[259_200, '3 d'],
		[14_400, '4 hr'],
		[300, '5 min'],
		[301, '301 sec'],
	])('formats %i seconds with a localized unit-specific message', (seconds, expected) => {
		expect(formatOAuthAuthorizationDuration(seconds)).toBe(expected);
	});
});
