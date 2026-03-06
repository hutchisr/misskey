/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import type Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type { IActivity } from '@/core/activitypub/type.js';
import type { MrfPolicy, MrfResult } from './types.js';
import { MrfSimplePolicyService } from './MrfSimplePolicyService.js';
import { MrfKeywordPolicyService } from './MrfKeywordPolicyService.js';
import { MrfHellthreadPolicyService } from './MrfHellthreadPolicyService.js';

@Injectable()
export class MrfService {
	private logger: Logger;
	private policyMap: Map<string, MrfPolicy>;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private loggerService: LoggerService,
		private mrfSimplePolicyService: MrfSimplePolicyService,
		private mrfKeywordPolicyService: MrfKeywordPolicyService,
		private mrfHellthreadPolicyService: MrfHellthreadPolicyService,
	) {
		this.logger = this.loggerService.getLogger('mrf');
		this.policyMap = new Map<string, MrfPolicy>([
			['simple', this.mrfSimplePolicyService],
			['keyword', this.mrfKeywordPolicyService],
			['hellthread', this.mrfHellthreadPolicyService],
		]);
	}

	private get enabledPolicies(): string[] {
		return this.meta.mrfPolicies.enabled;
	}

	@bindThis
	public async filterActivity(activity: IActivity): Promise<MrfResult> {
		const enabledPolicies = this.enabledPolicies;
		if (enabledPolicies.length === 0) {
			return { action: 'accept', activity };
		}

		let current = activity;

		for (const policyName of enabledPolicies) {
			const policy = this.policyMap.get(policyName);
			if (!policy) {
				this.logger.warn(`MRF policy "${policyName}" not found, skipping`);
				continue;
			}

			const result = await policy.filterActivity(current);

			if (result.action === 'reject') {
				this.logger.info(`Activity rejected by MRF policy "${policyName}": ${result.reason}`);
				return result;
			}

			current = result.activity;
		}

		return { action: 'accept', activity: current };
	}

	@bindThis
	public getAvailablePolicies(): string[] {
		return Array.from(this.policyMap.keys());
	}
}
