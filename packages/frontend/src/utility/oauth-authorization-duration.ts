/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

export function formatOAuthAuthorizationDuration(seconds: number): string {
	if (seconds % 31_536_000 === 0) {
		return i18n.tsx._auth.authorizationDurationYears({ years: (seconds / 31_536_000).toString() });
	}
	if (seconds % 86_400 === 0) {
		return i18n.tsx._auth.authorizationDurationDays({ days: (seconds / 86_400).toString() });
	}
	if (seconds % 3600 === 0) {
		return i18n.tsx._auth.authorizationDurationHours({ hours: (seconds / 3600).toString() });
	}
	if (seconds % 60 === 0) {
		return i18n.tsx._auth.authorizationDurationMinutes({ minutes: (seconds / 60).toString() });
	}
	return i18n.tsx._auth.authorizationDurationSeconds({ seconds: seconds.toString() });
}
