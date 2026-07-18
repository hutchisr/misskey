/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/vue';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkWaitingDialog from '@/components/MkWaitingDialog.vue';

describe('MkWaitingDialog', () => {
	afterEach(() => {
		cleanup();
	});

	test('closes when the operation completed before the dialog mounted', async () => {
		const view = render(MkWaitingDialog, {
			props: {
				success: false,
				showing: false,
			},
			global: { components, directives },
		});

		await waitFor(() => {
			expect(view.emitted('done')).toHaveLength(1);
			expect((view.container.querySelector('[data-cy-bg]')?.parentElement as HTMLElement | undefined)?.style.display).toBe('none');
		});
	});
});
