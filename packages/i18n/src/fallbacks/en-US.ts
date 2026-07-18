/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Locale } from '../autogen/locale.js';
import type { ILocale } from '../types.js';

/**
 * TEMPORARY FORK-ONLY FALLBACK — REMOVE AFTER CROWDIN SYNC.
 *
 * These strings exist only so the fork's new Mini Apps UI does not fall back
 * to Japanese before Crowdin has translated and synchronized the source keys.
 * Do not grow this into a second hand-maintained English locale. Delete this
 * module once locales/en-US.yml contains the corresponding Crowdin entries.
 */
type StringFallback<T> = {
	[K in keyof T]: string;
};

const miniAppPermissions = {
	identify: 'Identify your account',
	write: 'Create public notes',
} satisfies StringFallback<Pick<Locale['_permissions'], 'identify' | 'write'>>;

const miniAppAuthorization = {
	authorizationDuration: 'This authorization is valid for up to {duration} after approval. You can revoke it at any time in Settings.',
	authorizationDurationYears: '{years} yr',
	authorizationDurationDays: '{days} d',
	authorizationDurationHours: '{hours} hr',
	authorizationDurationMinutes: '{minutes} min',
	authorizationDurationSeconds: '{seconds} sec',
} satisfies StringFallback<Pick<Locale['_auth'],
	| 'authorizationDuration'
	| 'authorizationDurationYears'
	| 'authorizationDurationDays'
	| 'authorizationDurationHours'
	| 'authorizationDurationMinutes'
	| 'authorizationDurationSeconds'
>>;

const miniApps = {
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
} satisfies StringFallback<Locale['_miniApps']>;

export const enUsFallback = {
	_permissions: miniAppPermissions,
	_auth: miniAppAuthorization,
	_miniApps: miniApps,
} satisfies ILocale;
