/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { bindThis } from '@/decorators.js';
import { getApType } from '@/core/activitypub/type.js';
import type { IActivity, IObject } from '@/core/activitypub/type.js';
import type { MrfPolicy, MrfResult, MrfHellthreadPolicyConfig } from './types.js';

@Injectable()
export class MrfHellthreadPolicyService implements MrfPolicy {
	public readonly name = 'hellthread';

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,
	) {
	}

	private get config(): MrfHellthreadPolicyConfig {
		return this.meta.mrfPolicies.hellthread;
	}

	private countRecipients(activity: IActivity): number {
		const object = activity.object;
		if (typeof object !== 'object' || object === null) return 0;

		const obj = object as IObject;
		const toArray = Array.isArray(obj.to) ? obj.to : (obj.to ? [obj.to] : []);
		const ccArray = Array.isArray(obj.cc) ? obj.cc : (obj.cc ? [obj.cc] : []);

		return toArray.length + ccArray.length;
	}

	@bindThis
	public filterActivity(activity: IActivity): MrfResult {
		const type = getApType(activity);
		if (type !== 'Create') return { action: 'accept', activity };

		const config = this.config;
		const recipientCount = this.countRecipients(activity);

		// Reject if above reject threshold (0 means disabled)
		if (config.rejectThreshold > 0 && recipientCount > config.rejectThreshold) {
			return { action: 'reject', reason: `MRF HellthreadPolicy: ${recipientCount} recipients exceeds reject threshold of ${config.rejectThreshold}` };
		}

		// Delist if above delist threshold (remove public addressing)
		if (config.delistThreshold > 0 && recipientCount > config.delistThreshold) {
			const object = activity.object as IObject;
			const publicUri = 'https://www.w3.org/ns/activitystreams#Public';

			const removePublic = (arr: any): any => {
				if (!arr) return arr;
				if (Array.isArray(arr)) return arr.filter((x: any) => typeof x === 'string' ? x !== publicUri : true);
				if (typeof arr === 'string' && arr === publicUri) return [];
				return arr;
			};

			activity = {
				...activity,
				object: {
					...object,
					to: removePublic(object.to),
					cc: removePublic(object.cc),
				},
			};
		}

		return { action: 'accept', activity };
	}
}
