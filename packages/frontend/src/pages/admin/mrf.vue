<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/mrf" :label="i18n.ts._mrf.title" :keywords="['mrf', 'policy', 'federation', 'filter']" icon="ti ti-filter">
			<div class="_gaps_m">
				<SearchMarker :keywords="['enabled', 'policies']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-list-check"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts._mrf.enabledPolicies }}</SearchLabel></template>

						<div class="_gaps">
							<MkSwitch v-model="simpleEnabled">
								<template #label>{{ i18n.ts._mrf.simplePolicy }}</template>
								<template #caption>{{ i18n.ts._mrf.simplePolicyDescription }}</template>
							</MkSwitch>
							<MkSwitch v-model="keywordEnabled">
								<template #label>{{ i18n.ts._mrf.keywordPolicy }}</template>
								<template #caption>{{ i18n.ts._mrf.keywordPolicyDescription }}</template>
							</MkSwitch>
							<MkSwitch v-model="hellthreadEnabled">
								<template #label>{{ i18n.ts._mrf.hellthreadPolicy }}</template>
								<template #caption>{{ i18n.ts._mrf.hellthreadPolicyDescription }}</template>
							</MkSwitch>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['simple', 'reject', 'block', 'instance']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-ban"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts._mrf.simplePolicy }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="simpleReject">
								<template #label>{{ i18n.ts._mrf.simpleReject }}</template>
								<template #caption>{{ i18n.ts._mrf.simpleRejectDescription }}</template>
							</MkTextarea>
							<MkTextarea v-model="simpleMediaRemoval">
								<template #label>{{ i18n.ts._mrf.simpleMediaRemoval }}</template>
								<template #caption>{{ i18n.ts._mrf.simpleMediaRemovalDescription }}</template>
							</MkTextarea>
							<MkTextarea v-model="simpleMediaNsfw">
								<template #label>{{ i18n.ts._mrf.simpleMediaNsfw }}</template>
								<template #caption>{{ i18n.ts._mrf.simpleMediaNsfwDescription }}</template>
							</MkTextarea>
							<MkTextarea v-model="simpleReportRemoval">
								<template #label>{{ i18n.ts._mrf.simpleReportRemoval }}</template>
								<template #caption>{{ i18n.ts._mrf.simpleReportRemovalDescription }}</template>
							</MkTextarea>
							<MkTextarea v-model="simpleFollowersOnly">
								<template #label>{{ i18n.ts._mrf.simpleFollowersOnly }}</template>
								<template #caption>{{ i18n.ts._mrf.simpleFollowersOnlyDescription }}</template>
							</MkTextarea>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['keyword', 'filter', 'reject', 'replace']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-vocabulary"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts._mrf.keywordPolicy }}</SearchLabel></template>

						<div class="_gaps">
							<MkTextarea v-model="keywordReject">
								<template #label>{{ i18n.ts._mrf.keywordReject }}</template>
								<template #caption>{{ i18n.ts._mrf.keywordRejectDescription }}</template>
							</MkTextarea>

							<div class="_gaps_s">
								<div><b>{{ i18n.ts._mrf.keywordReplace }}</b></div>
								<div style="font-size: 0.85em; opacity: 0.7;">{{ i18n.ts._mrf.keywordReplaceDescription }}</div>
								<div v-for="(item, index) in keywordReplace" :key="index" style="display: flex; gap: 8px; align-items: center;">
									<MkInput v-model="item.pattern" style="flex: 1;" :placeholder="i18n.ts._mrf.pattern"/>
									<i class="ti ti-arrow-right" style="flex-shrink: 0; opacity: 0.5;"></i>
									<MkInput v-model="item.replacement" style="flex: 1;" :placeholder="i18n.ts._mrf.replacement"/>
									<MkButton inline danger @click="removeKeywordReplace(index)"><i class="ti ti-x"></i></MkButton>
								</div>
								<MkButton inline @click="addKeywordReplace"><i class="ti ti-plus"></i> {{ i18n.ts.add }}</MkButton>
							</div>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker :keywords="['hellthread', 'recipient', 'threshold']">
					<MkFolder>
						<template #icon><SearchIcon><i class="ti ti-flame"></i></SearchIcon></template>
						<template #label><SearchLabel>{{ i18n.ts._mrf.hellthreadPolicy }}</SearchLabel></template>

						<div class="_gaps">
							<MkInput v-model="hellthreadRejectThreshold" type="number">
								<template #label>{{ i18n.ts._mrf.hellthreadRejectThreshold }}</template>
								<template #caption>{{ i18n.ts._mrf.hellthreadRejectThresholdDescription }}</template>
							</MkInput>
							<MkInput v-model="hellthreadDelistThreshold" type="number">
								<template #label>{{ i18n.ts._mrf.hellthreadDelistThreshold }}</template>
								<template #caption>{{ i18n.ts._mrf.hellthreadDelistThresholdDescription }}</template>
							</MkInput>
						</div>
					</MkFolder>
				</SearchMarker>

				<MkButton primary @click="save">{{ i18n.ts.save }}</MkButton>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const meta = await misskeyApi('admin/meta');
const mrf = meta.mrfPolicies;

// Enabled policies
const simpleEnabled = ref(mrf.enabled.includes('simple'));
const keywordEnabled = ref(mrf.enabled.includes('keyword'));
const hellthreadEnabled = ref(mrf.enabled.includes('hellthread'));

// Simple policy
const simpleReject = ref(mrf.simple.reject.join('\n'));
const simpleMediaRemoval = ref(mrf.simple.mediaRemoval.join('\n'));
const simpleMediaNsfw = ref(mrf.simple.mediaNsfw.join('\n'));
const simpleReportRemoval = ref(mrf.simple.reportRemoval.join('\n'));
const simpleFollowersOnly = ref(mrf.simple.followersOnly.join('\n'));

// Keyword policy
const keywordReject = ref(mrf.keyword.reject.join('\n'));
const keywordReplace = ref<Array<{ pattern: string; replacement: string }>>(
	mrf.keyword.replace.map(r => ({ ...r })),
);

// Hellthread policy
const hellthreadRejectThreshold = ref(mrf.hellthread.rejectThreshold);
const hellthreadDelistThreshold = ref(mrf.hellthread.delistThreshold);

function splitLines(text: string): string[] {
	return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

function save() {
	const enabled: string[] = [];
	if (simpleEnabled.value) enabled.push('simple');
	if (keywordEnabled.value) enabled.push('keyword');
	if (hellthreadEnabled.value) enabled.push('hellthread');

	const mrfPolicies = {
		enabled,
		simple: {
			reject: splitLines(simpleReject.value),
			mediaRemoval: splitLines(simpleMediaRemoval.value),
			mediaNsfw: splitLines(simpleMediaNsfw.value),
			reportRemoval: splitLines(simpleReportRemoval.value),
			followersOnly: splitLines(simpleFollowersOnly.value),
		},
		keyword: {
			reject: splitLines(keywordReject.value),
			replace: keywordReplace.value.filter(r => r.pattern.length > 0),
		},
		hellthread: {
			rejectThreshold: Number(hellthreadRejectThreshold.value),
			delistThreshold: Number(hellthreadDelistThreshold.value),
		},
	};

	os.apiWithDialog('admin/update-meta', { mrfPolicies }).then(() => {
		Object.assign(mrf, mrfPolicies);
		fetchInstance(true);
	});
}

function addKeywordReplace() {
	keywordReplace.value.push({ pattern: '', replacement: '' });
}

function removeKeywordReplace(index: number) {
	keywordReplace.value.splice(index, 1);
}

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._mrf.title,
	icon: 'ti ti-filter',
}));
</script>
