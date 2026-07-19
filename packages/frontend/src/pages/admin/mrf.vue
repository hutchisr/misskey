<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/mrf" :label="i18n.ts._mrf.title" :keywords="['mrf', 'policy', 'federation', 'filter']" icon="ti ti-filter">
			<div class="_gaps_m">
				<div :class="$style.overview">
					<div>
						<div :class="$style.title">{{ i18n.ts._mrf.title }}</div>
						<div :class="$style.activePolicies">{{ activePolicyCount }} {{ i18n.ts.enabled }}</div>
					</div>
					<i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
				</div>

				<SearchMarker v-slot="slotProps" :keywords="['simple', 'reject', 'block', 'instance']">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><SearchIcon><i class="ti ti-ban"></i></SearchIcon></template>
						<template #label><SearchLabel>1 · {{ i18n.ts._mrf.simplePolicy }}</SearchLabel></template>
						<template #caption><SearchText>{{ i18n.ts._mrf.simplePolicyDescription }} · {{ i18n.ts.host }}: {{ simpleConfiguredCount }}</SearchText></template>
						<template #suffix>{{ mrfForm.savedState.simpleEnabled ? i18n.ts.enabled : i18n.ts.disabled }}</template>

						<div class="_gaps_m">
							<MkSwitch v-model="mrfForm.state.simpleEnabled" :inputAriaLabel="`${i18n.ts._mrf.simplePolicy}: ${i18n.ts.enable}`" :disabled="saving">
								<template #label>{{ i18n.ts.enable }}</template>
								<template #caption>{{ i18n.ts._mrf.simplePolicyDescription }}</template>
							</MkSwitch>

							<div :class="$style.fieldGrid">
								<MkTextarea v-model="mrfForm.state.simpleReject" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.simpleReject }}</template>
									<template #caption>{{ i18n.ts._mrf.simpleRejectDescription }}</template>
								</MkTextarea>
								<MkTextarea v-model="mrfForm.state.simpleReportRemoval" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.simpleReportRemoval }}</template>
									<template #caption>{{ i18n.ts._mrf.simpleReportRemovalDescription }}</template>
								</MkTextarea>
								<MkTextarea v-model="mrfForm.state.simpleMediaRemoval" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.simpleMediaRemoval }}</template>
									<template #caption>{{ i18n.ts._mrf.simpleMediaRemovalDescription }}</template>
								</MkTextarea>
								<MkTextarea v-model="mrfForm.state.simpleMediaNsfw" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.simpleMediaNsfw }}</template>
									<template #caption>{{ i18n.ts._mrf.simpleMediaNsfwDescription }}</template>
								</MkTextarea>
								<MkTextarea v-model="mrfForm.state.simpleFollowersOnly" :class="$style.fullWidth" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.simpleFollowersOnly }}</template>
									<template #caption>{{ i18n.ts._mrf.simpleFollowersOnlyDescription }}</template>
								</MkTextarea>
							</div>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps" :keywords="['keyword', 'filter', 'reject', 'replace']">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><SearchIcon><i class="ti ti-vocabulary"></i></SearchIcon></template>
						<template #label><SearchLabel>2 · {{ i18n.ts._mrf.keywordPolicy }}</SearchLabel></template>
						<template #caption><SearchText>{{ i18n.ts._mrf.keywordPolicyDescription }} · {{ i18n.ts._mrf.keywordReject }}: {{ keywordRejectCount }} · {{ i18n.ts._mrf.keywordReplace }}: {{ keywordReplacementCount }}</SearchText></template>
						<template #suffix>{{ mrfForm.savedState.keywordEnabled ? i18n.ts.enabled : i18n.ts.disabled }}</template>

						<div class="_gaps_m">
							<MkSwitch v-model="mrfForm.state.keywordEnabled" :inputAriaLabel="`${i18n.ts._mrf.keywordPolicy}: ${i18n.ts.enable}`" :disabled="saving">
								<template #label>{{ i18n.ts.enable }}</template>
								<template #caption>{{ i18n.ts._mrf.keywordPolicyDescription }}</template>
							</MkSwitch>

							<MkTextarea v-model="mrfForm.state.keywordReject" :disabled="saving">
								<template #label>{{ i18n.ts._mrf.keywordReject }}</template>
								<template #caption>{{ i18n.ts._mrf.keywordRejectDescription }}</template>
							</MkTextarea>

							<div class="_gaps_s">
								<div><b>{{ i18n.ts._mrf.keywordReplace }}</b></div>
								<div :class="$style.description">{{ i18n.ts._mrf.keywordReplaceDescription }}</div>
								<div v-for="(item, index) in mrfForm.state.keywordReplace" :key="item.id" :class="$style.ruleGroup">
									<div :class="$style.ruleRow">
										<MkInput v-model="item.pattern" :disabled="saving">
											<template #label>{{ i18n.ts._mrf.pattern }}</template>
										</MkInput>
										<i class="ti ti-arrow-right" :class="$style.ruleArrow" aria-hidden="true"></i>
										<MkInput v-model="item.replacement" :disabled="saving">
											<template #label>{{ i18n.ts._mrf.replacement }}</template>
										</MkInput>
										<MkButton danger :disabled="saving" @click="removeKeywordReplace(index)">
											<i class="ti ti-trash" aria-hidden="true"></i> {{ i18n.ts.delete }}
										</MkButton>
									</div>
									<div v-if="validation.keywordReplace[index]" :class="$style.error" role="alert">
										{{ i18n.ts.invalidValue }}
									</div>
								</div>
								<MkButton ref="addKeywordReplaceButton" inline :disabled="saving" @click="addKeywordReplace"><i class="ti ti-plus" aria-hidden="true"></i> {{ i18n.ts.add }}</MkButton>
							</div>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps" :keywords="['hellthread', 'recipient', 'threshold']">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #icon><SearchIcon><i class="ti ti-flame"></i></SearchIcon></template>
						<template #label><SearchLabel>3 · {{ i18n.ts._mrf.hellthreadPolicy }}</SearchLabel></template>
						<template #caption><SearchText>{{ i18n.ts._mrf.hellthreadPolicyDescription }} · {{ i18n.ts._mrf.hellthreadRejectThreshold }}: {{ hellthreadRejectSummary }} · {{ i18n.ts._mrf.hellthreadDelistThreshold }}: {{ hellthreadDelistSummary }}</SearchText></template>
						<template #suffix>{{ mrfForm.savedState.hellthreadEnabled ? i18n.ts.enabled : i18n.ts.disabled }}</template>

						<div class="_gaps_m">
							<MkSwitch v-model="mrfForm.state.hellthreadEnabled" :inputAriaLabel="`${i18n.ts._mrf.hellthreadPolicy}: ${i18n.ts.enable}`" :disabled="saving">
								<template #label>{{ i18n.ts.enable }}</template>
								<template #caption>{{ i18n.ts._mrf.hellthreadPolicyDescription }}</template>
							</MkSwitch>

							<div :class="$style.fieldGrid">
								<MkInput v-model="mrfForm.state.hellthreadRejectThreshold" type="number" :min="0" :step="1" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.hellthreadRejectThreshold }}</template>
									<template #caption>
										<span v-if="validation.hellthreadRejectThreshold" :class="$style.error" role="alert">{{ i18n.ts.invalidValue }}</span>
										<span v-else>{{ i18n.ts._mrf.hellthreadRejectThresholdDescription }}</span>
									</template>
								</MkInput>
								<MkInput v-model="mrfForm.state.hellthreadDelistThreshold" type="number" :min="0" :step="1" :disabled="saving">
									<template #label>{{ i18n.ts._mrf.hellthreadDelistThreshold }}</template>
									<template #caption>
										<span v-if="validation.hellthreadDelistThreshold" :class="$style.error" role="alert">{{ i18n.ts.invalidValue }}</span>
										<span v-else>{{ i18n.ts._mrf.hellthreadDelistThresholdDescription }}</span>
									</template>
								</MkInput>
							</div>
						</div>
					</MkFolder>
				</SearchMarker>

				<MkFormFooter v-if="!saving" :form="mrfForm" :canSaving="canSaving"/>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref } from 'vue';
import {
	countConfiguredSimpleHosts,
	countEnabledMrfPolicies,
	countKeywordRejectPatterns,
	countKeywordReplacementRules,
	createMrfFormState,
	formatMrfHellthreadThresholdSummary,
	serializeMrfPolicies,
	validateMrfFormState,
} from './mrf.impl.js';
import type { MrfPolicies } from './mrf.impl.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkFormFooter from '@/components/MkFormFooter.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { useForm } from '@/composables/use-form.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const meta = await misskeyApi('admin/meta');
// admin/meta currently exposes this field as Record<string, never>; the trusted
// runtime shape is the same complete object accepted by admin/update-meta.
const initialMrfPolicies = meta.mrfPolicies as unknown as MrfPolicies;

const saving = ref(false);
const mrfForm = useForm(createMrfFormState(initialMrfPolicies), async state => {
	const mrfPolicies = serializeMrfPolicies(state);
	saving.value = true;
	try {
		await os.apiWithDialog('admin/update-meta', { mrfPolicies });
		fetchInstance(true);
	} finally {
		saving.value = false;
	}
});

const validation = computed(() => validateMrfFormState(mrfForm.state));
const canSaving = computed(() => validation.value.valid && !saving.value);
const activePolicyCount = computed(() => countEnabledMrfPolicies(mrfForm.savedState));
const simpleConfiguredCount = computed(() => countConfiguredSimpleHosts(mrfForm.state));
const keywordRejectCount = computed(() => countKeywordRejectPatterns(mrfForm.state));
const keywordReplacementCount = computed(() => countKeywordReplacementRules(mrfForm.state));
const hellthreadRejectSummary = computed(() => formatMrfHellthreadThresholdSummary(mrfForm.state.hellthreadRejectThreshold, i18n.ts.disabled));
const hellthreadDelistSummary = computed(() => formatMrfHellthreadThresholdSummary(mrfForm.state.hellthreadDelistThreshold, i18n.ts.disabled));

const addKeywordReplaceButton = ref<InstanceType<typeof MkButton> | null>(null);
let keywordReplaceId = mrfForm.state.keywordReplace.length;

function addKeywordReplace() {
	mrfForm.state.keywordReplace.push({ id: `new-${keywordReplaceId++}`, pattern: '', replacement: '' });
}

async function removeKeywordReplace(index: number) {
	mrfForm.state.keywordReplace.splice(index, 1);
	await nextTick();
	(addKeywordReplaceButton.value?.$el as HTMLElement | undefined)?.focus();
}

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._mrf.title,
	icon: 'ti ti-filter',
}));
</script>

<style lang="scss" module>
.overview {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 16px;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}

.title {
	font-size: 1.2em;
	font-weight: 700;
}

.activePolicies,
.description {
	margin-top: 4px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
	font-size: 0.9em;
}

.fieldGrid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20px;
}

.fullWidth {
	grid-column: 1 / -1;
}

.ruleGroup {
	display: grid;
	gap: 8px;
}

.ruleRow {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
	align-items: end;
	gap: 8px;
}

.ruleArrow {
	align-self: center;
	opacity: 0.6;
}

.error {
	color: var(--MI_THEME-error);
	font-size: 0.85em;
}

@container (max-width: 500px) {
	.fieldGrid,
	.ruleRow {
		grid-template-columns: minmax(0, 1fr);
	}

	.fullWidth {
		grid-column: auto;
	}

	.ruleArrow {
		display: none;
	}
}
</style>
