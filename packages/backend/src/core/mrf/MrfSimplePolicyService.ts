/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URL } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { bindThis } from '@/decorators.js';
import { getApType } from '@/core/activitypub/type.js';
import type { IActivity, IObject } from '@/core/activitypub/type.js';
import type { MrfPolicy, MrfResult, MrfSimplePolicyConfig } from './types.js';

@Injectable()
export class MrfSimplePolicyService implements MrfPolicy {
	public readonly name = 'simple';

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,
	) {
	}

	private get config(): MrfSimplePolicyConfig {
		return this.meta.mrfPolicies.simple;
	}

	private extractActorHost(activity: IActivity): string | null {
		try {
			const actor = typeof activity.actor === 'string' ? activity.actor : null;
			if (actor) return new URL(actor).hostname.toLowerCase();
		} catch { /* empty */ }

		try {
			if (activity.id) return new URL(activity.id).hostname.toLowerCase();
		} catch { /* empty */ }

		return null;
	}

	private matchesHost(host: string, patterns: string[]): boolean {
		return patterns.some(p => `.${host}`.endsWith(`.${p.toLowerCase()}`));
	}

	@bindThis
	public filterActivity(activity: IActivity): MrfResult {
		const host = this.extractActorHost(activity);
		if (!host) return { action: 'accept', activity };

		const config = this.config;

		// Reject entire instance
		if (config.reject.length > 0 && this.matchesHost(host, config.reject)) {
			return { action: 'reject', reason: `MRF SimplePolicy: host ${host} is rejected` };
		}

		const type = getApType(activity);

		// Report removal (Flag activities)
		if (type === 'Flag' && config.reportRemoval.length > 0 && this.matchesHost(host, config.reportRemoval)) {
			return { action: 'reject', reason: `MRF SimplePolicy: reports from ${host} are rejected` };
		}

		// Process Create activities for media/visibility policies
		if (type === 'Create' && typeof activity.object === 'object' && activity.object !== null) {
			let object = activity.object as IObject;

			// Media removal: strip attachments
			if (config.mediaRemoval.length > 0 && this.matchesHost(host, config.mediaRemoval)) {
				object = { ...object, attachment: [] };
			}

			// Media NSFW: force sensitive flag
			if (config.mediaNsfw.length > 0 && this.matchesHost(host, config.mediaNsfw)) {
				object = { ...object, sensitive: true };
			}

			// Followers only: remove public addressing
			if (config.followersOnly.length > 0 && this.matchesHost(host, config.followersOnly)) {
				const publicUri = 'https://www.w3.org/ns/activitystreams#Public';

				const removePublic = (arr: any): any => {
					if (!arr) return arr;
					if (Array.isArray(arr)) return arr.filter((x: any) => typeof x === 'string' ? x !== publicUri : true);
					if (typeof arr === 'string' && arr === publicUri) return [];
					return arr;
				};

				object = {
					...object,
					to: removePublic(object.to),
					cc: removePublic(object.cc),
				};
			}

			if (object !== activity.object) {
				activity = { ...activity, object };
			}
		}

		return { action: 'accept', activity };
	}
}
