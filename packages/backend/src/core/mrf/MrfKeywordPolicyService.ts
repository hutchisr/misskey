/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import RE2 from 're2';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { bindThis } from '@/decorators.js';
import { getApType } from '@/core/activitypub/type.js';
import type { IActivity, IObject } from '@/core/activitypub/type.js';
import type { MrfPolicy, MrfResult, MrfKeywordPolicyConfig } from './types.js';

@Injectable()
export class MrfKeywordPolicyService implements MrfPolicy {
	public readonly name = 'keyword';

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,
	) {
	}

	private get config(): MrfKeywordPolicyConfig {
		return this.meta.mrfPolicies.keyword;
	}

	private extractContent(activity: IActivity): string | null {
		const type = getApType(activity);
		if (type !== 'Create') return null;

		const object = activity.object;
		if (typeof object !== 'object' || object === null) return null;

		return (object as IObject).content ?? (object as IObject).summary ?? null;
	}

	private testPattern(text: string, pattern: string): boolean {
		const regexpMatch = pattern.match(/^\/(.+)\/(.*)$/);
		if (regexpMatch) {
			try {
				return new RE2(regexpMatch[1], regexpMatch[2]).test(text);
			} catch {
				return false;
			}
		}
		return text.toLowerCase().includes(pattern.toLowerCase());
	}

	private replacePattern(text: string, pattern: string, replacement: string): string {
		const regexpMatch = pattern.match(/^\/(.+)\/(.*)$/);
		if (regexpMatch) {
			try {
				const re = new RE2(regexpMatch[1], regexpMatch[2].includes('g') ? regexpMatch[2] : regexpMatch[2] + 'g');
				return text.replace(re, replacement);
			} catch {
				return text;
			}
		}
		return text.split(pattern).join(replacement);
	}

	@bindThis
	public filterActivity(activity: IActivity): MrfResult {
		const config = this.config;
		const content = this.extractContent(activity);

		if (content == null) return { action: 'accept', activity };

		// Check reject patterns
		for (const pattern of config.reject) {
			if (this.testPattern(content, pattern)) {
				return { action: 'reject', reason: `MRF KeywordPolicy: content matches reject pattern` };
			}
		}

		// Apply replacements
		if (config.replace.length > 0) {
			const object = activity.object as IObject;
			let newContent = object.content ?? '';
			for (const { pattern, replacement } of config.replace) {
				newContent = this.replacePattern(newContent, pattern, replacement);
			}
			if (newContent !== object.content) {
				activity = {
					...activity,
					object: { ...object, content: newContent },
				};
			}
		}

		return { action: 'accept', activity };
	}
}
