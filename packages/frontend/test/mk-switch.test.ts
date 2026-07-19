/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineComponent, nextTick, ref } from 'vue';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import './init';
import MkSwitch from '@/components/MkSwitch.vue';

afterEach(() => {
	cleanup();
});

describe('MkSwitch', () => {
	test('exposes the supplied input aria label as the checkbox accessible name', () => {
		const view = render(MkSwitch, {
			props: {
				modelValue: false,
				inputAriaLabel: 'Enable Simple policy',
			},
			global: { directives: { tooltip: {} } },
		});

		expect(view.getByRole('checkbox', { name: 'Enable Simple policy' })).toBeTruthy();
	});

	test('keeps the native checkbox state in sync when the visual toggle is clicked', async () => {
		const SwitchHarness = defineComponent({
			components: { MkSwitch },
			setup() {
				const enabled = ref(false);
				return { enabled };
			},
			template: '<MkSwitch v-model="enabled" input-aria-label="Enable Simple policy"/>',
		});
		const view = render(SwitchHarness, {
			global: { directives: { tooltip: {} } },
		});
		const checkbox = view.getByRole('checkbox', { name: 'Enable Simple policy' }) as HTMLInputElement;
		const visualToggle = view.container.querySelector<HTMLElement>('[data-cy-switch-toggle]');

		expect(visualToggle).not.toBeNull();
		expect(checkbox.checked).toBe(false);
		await fireEvent.click(visualToggle!);
		await nextTick();
		expect(checkbox.checked).toBe(true);
	});
});
