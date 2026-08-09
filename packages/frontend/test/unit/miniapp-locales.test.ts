/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import locales from 'i18n';

describe('Fediverse Mini Apps English fallback', () => {
	const english = locales['en-US'];

	test('provides English permission and authorization copy', () => {
		expect(english._permissions.identify).toBe('Identify your account');
		expect(english._permissions.write).toBe('Create public notes');
		expect(english._auth.authorizationDuration).toContain('valid for up to {duration}');
		expect(english._auth.authorizationDurationYears).toBe('{years} yr');
	});

	test('provides every Mini Apps launcher string in English', () => {
		expect(english._miniApps).toEqual({
			check: 'Check for mini app',
			open: 'Open mini app',
			publishedBy: 'Published by {name}',
			externalNotice: 'This app is hosted externally. Opening it will connect to the app provider.',
			connecting: 'Connecting to the mini app',
			launchFailed: 'Could not launch the mini app.',
			launchTimedOut: 'The mini app did not respond.',
			requiresHttps: 'An HTTPS connection is required to launch mini apps.',
			authenticationUnsupported: 'The sign-in method requested by this mini app is not supported.',
			authorizationPrompt: 'Continue signing in to {name}?',
			authorize: 'Continue signing in',
		});
	});
});
