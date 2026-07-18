/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import './init';
import { formatOAuthAuthorizationDuration } from '@/utility/oauth-authorization-duration.js';

describe('formatOAuthAuthorizationDuration', () => {
	test.each([
		[63_072_000, '2年'],
		[259_200, '3日'],
		[14_400, '4時間'],
		[300, '5分'],
		[301, '301秒'],
	])('formats %i seconds with a localized unit-specific message', (seconds, expected) => {
		expect(formatOAuthAuthorizationDuration(seconds)).toBe(expected);
	});
});
