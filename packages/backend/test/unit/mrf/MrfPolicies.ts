/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { defaultMrfPoliciesConfig } from '@/misc/mrf-config.js';
import type { MrfPoliciesConfig } from '@/misc/mrf-config.js';
import type { IActivity, IObject } from '@/core/activitypub/type.js';
import type { MiMeta } from '@/models/Meta.js';

// Minimal mock for MiMeta with mrfPolicies
function createMockMeta(mrfPolicies: MrfPoliciesConfig): MiMeta {
	return { mrfPolicies } as unknown as MiMeta;
}

function createActivity(overrides: Partial<IActivity> = {}): IActivity {
	return {
		type: 'Create',
		id: 'https://remote.example/activities/1',
		actor: 'https://remote.example/users/alice',
		object: {
			type: 'Note',
			id: 'https://remote.example/notes/1',
			content: '<p>Hello world</p>',
			to: ['https://www.w3.org/ns/activitystreams#Public'],
			cc: ['https://remote.example/users/alice/followers'],
			attachment: [{ type: 'Image', url: 'https://remote.example/image.png' }],
		} as IObject,
		...overrides,
	};
}

// === SimplePolicy Tests ===
// We test the service by importing it and constructing with a mock meta.
// Since @Injectable and @Inject are decorators that only matter for DI,
// we can construct the class directly for unit tests.

import { MrfSimplePolicyService } from '@/core/mrf/MrfSimplePolicyService.js';

describe('MrfSimplePolicyService', () => {
	describe('reject', () => {
		it('should reject activities from rejected hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, reject: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('reject');
		});

		it('should reject subdomain of rejected host', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, reject: ['example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('reject');
		});

		it('should accept activities from non-rejected hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, reject: ['blocked.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
		});
	});

	describe('mediaRemoval', () => {
		it('should strip attachments from matching hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, mediaRemoval: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				const obj = result.activity.object as IObject;
				expect(obj.attachment).toEqual([]);
			}
		});
	});

	describe('mediaNsfw', () => {
		it('should force sensitive flag on matching hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, mediaNsfw: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				const obj = result.activity.object as IObject;
				expect(obj.sensitive).toBe(true);
			}
		});
	});

	describe('followersOnly', () => {
		it('should remove public addressing from matching hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, followersOnly: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				const obj = result.activity.object as IObject;
				const to = obj.to as string[];
				expect(to).not.toContain('https://www.w3.org/ns/activitystreams#Public');
			}
		});
	});

	describe('reportRemoval', () => {
		it('should reject Flag activities from matching hosts', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, reportRemoval: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity({
				type: 'Flag',
				id: 'https://remote.example/activities/flag1',
				actor: 'https://remote.example/users/alice',
				object: 'https://local.example/users/bob',
			} as IActivity);
			expect(result.action).toBe('reject');
		});
	});

	describe('chained mutations', () => {
		it('should apply both mediaRemoval and mediaNsfw together', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: {
					...defaultMrfPoliciesConfig.simple,
					mediaRemoval: ['remote.example'],
					mediaNsfw: ['remote.example'],
				},
			});
			const service = new MrfSimplePolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				const obj = result.activity.object as IObject;
				expect(obj.attachment).toEqual([]);
				expect(obj.sensitive).toBe(true);
			}
		});
	});

	describe('passthrough', () => {
		it('should pass through non-Create activities without modification', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				simple: { ...defaultMrfPoliciesConfig.simple, mediaNsfw: ['remote.example'] },
			});
			const service = new MrfSimplePolicyService(meta);
			const followActivity: IActivity = {
				type: 'Follow',
				id: 'https://remote.example/activities/follow1',
				actor: 'https://remote.example/users/alice',
				object: 'https://local.example/users/bob',
			};
			const result = service.filterActivity(followActivity);
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				expect(result.activity).toBe(followActivity);
			}
		});
	});
});

// === KeywordPolicy Tests ===
import { MrfKeywordPolicyService } from '@/core/mrf/MrfKeywordPolicyService.js';

describe('MrfKeywordPolicyService', () => {
	describe('reject', () => {
		it('should reject activities with matching keyword', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: { ...defaultMrfPoliciesConfig.keyword, reject: ['badword'] },
			});
			const service = new MrfKeywordPolicyService(meta);
			const activity = createActivity();
			(activity.object as IObject).content = '<p>This contains badword in it</p>';
			const result = service.filterActivity(activity);
			expect(result.action).toBe('reject');
		});

		it('should reject activities with matching regex', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: { ...defaultMrfPoliciesConfig.keyword, reject: ['/bad\\w+/i'] },
			});
			const service = new MrfKeywordPolicyService(meta);
			const activity = createActivity();
			(activity.object as IObject).content = '<p>This contains BADWORD in it</p>';
			const result = service.filterActivity(activity);
			expect(result.action).toBe('reject');
		});

		it('should accept activities without matching keyword', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: { ...defaultMrfPoliciesConfig.keyword, reject: ['badword'] },
			});
			const service = new MrfKeywordPolicyService(meta);
			const result = service.filterActivity(createActivity());
			expect(result.action).toBe('accept');
		});
	});

	describe('replace', () => {
		it('should replace matching text', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: {
					...defaultMrfPoliciesConfig.keyword,
					replace: [{ pattern: 'naughty', replacement: 'nice' }],
				},
			});
			const service = new MrfKeywordPolicyService(meta);
			const activity = createActivity();
			(activity.object as IObject).content = 'You are naughty';
			const result = service.filterActivity(activity);
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				expect((result.activity.object as IObject).content).toBe('You are nice');
			}
		});

		it('should replace matching regex', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: {
					...defaultMrfPoliciesConfig.keyword,
					replace: [{ pattern: '/b[a4]d/gi', replacement: 'good' }],
				},
			});
			const service = new MrfKeywordPolicyService(meta);
			const activity = createActivity();
			(activity.object as IObject).content = 'BAD and b4d';
			const result = service.filterActivity(activity);
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				expect((result.activity.object as IObject).content).toBe('good and good');
			}
		});
	});

	describe('passthrough', () => {
		it('should pass through non-Create activities', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				keyword: { ...defaultMrfPoliciesConfig.keyword, reject: ['anything'] },
			});
			const service = new MrfKeywordPolicyService(meta);
			const activity: IActivity = {
				type: 'Follow',
				id: 'https://remote.example/activities/follow1',
				actor: 'https://remote.example/users/alice',
				object: 'https://local.example/users/bob',
			};
			const result = service.filterActivity(activity);
			expect(result.action).toBe('accept');
		});
	});
});

// === HellthreadPolicy Tests ===
import { MrfHellthreadPolicyService } from '@/core/mrf/MrfHellthreadPolicyService.js';

describe('MrfHellthreadPolicyService', () => {
	function createHellthread(recipientCount: number): IActivity {
		const recipients = Array.from({ length: recipientCount }, (_, i) => `https://example.com/users/${i}`);
		return createActivity({
			object: {
				type: 'Note',
				id: 'https://remote.example/notes/1',
				content: '<p>Hello</p>',
				to: recipients.slice(0, Math.ceil(recipientCount / 2)),
				cc: recipients.slice(Math.ceil(recipientCount / 2)),
			} as IObject,
		});
	}

	describe('rejectThreshold', () => {
		it('should reject activities exceeding reject threshold', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				hellthread: { rejectThreshold: 10, delistThreshold: 0 },
			});
			const service = new MrfHellthreadPolicyService(meta);
			const result = service.filterActivity(createHellthread(15));
			expect(result.action).toBe('reject');
		});

		it('should accept activities under reject threshold', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				hellthread: { rejectThreshold: 10, delistThreshold: 0 },
			});
			const service = new MrfHellthreadPolicyService(meta);
			const result = service.filterActivity(createHellthread(5));
			expect(result.action).toBe('accept');
		});

		it('should not reject when threshold is 0 (disabled)', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				hellthread: { rejectThreshold: 0, delistThreshold: 0 },
			});
			const service = new MrfHellthreadPolicyService(meta);
			const result = service.filterActivity(createHellthread(100));
			expect(result.action).toBe('accept');
		});
	});

	describe('delistThreshold', () => {
		it('should remove public addressing when exceeding delist threshold', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				hellthread: { rejectThreshold: 0, delistThreshold: 5 },
			});
			const service = new MrfHellthreadPolicyService(meta);
			const activity = createActivity({
				object: {
					type: 'Note',
					id: 'https://remote.example/notes/1',
					content: '<p>Hello</p>',
					to: ['https://www.w3.org/ns/activitystreams#Public', ...Array.from({ length: 5 }, (_, i) => `https://example.com/users/${i}`)],
					cc: ['https://remote.example/users/alice/followers'],
				} as IObject,
			});
			const result = service.filterActivity(activity);
			expect(result.action).toBe('accept');
			if (result.action === 'accept') {
				const obj = result.activity.object as IObject;
				const to = obj.to as string[];
				expect(to).not.toContain('https://www.w3.org/ns/activitystreams#Public');
			}
		});
	});

	describe('passthrough', () => {
		it('should pass through non-Create activities', () => {
			const meta = createMockMeta({
				...defaultMrfPoliciesConfig,
				hellthread: { rejectThreshold: 1, delistThreshold: 1 },
			});
			const service = new MrfHellthreadPolicyService(meta);
			const activity: IActivity = {
				type: 'Follow',
				id: 'https://remote.example/activities/follow1',
				actor: 'https://remote.example/users/alice',
				object: 'https://local.example/users/bob',
			};
			const result = service.filterActivity(activity);
			expect(result.action).toBe('accept');
		});
	});
});
