/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { DI } from '@/di-symbols.js';
import type { ResolvedMiniAppManifest } from '@/core/MiniAppManifestService.js';
import type { MiUser } from '@/models/User.js';
import type { MiUserMiniApp, UserMiniAppsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';

@Injectable()
export class UserMiniAppService {
	constructor(
		@Inject(DI.userMiniAppsRepository)
		private userMiniAppsRepository: UserMiniAppsRepository,

		private idService: IdService,
	) {
	}

	@bindThis
	public async recordResolved(userId: MiUser['id'], resolved: ResolvedMiniAppManifest): Promise<void> {
		await this.record({
			userId,
			manifestUrl: resolved.manifestUrl,
			launchUrl: resolved.manifest.homeUrl,
			name: resolved.manifest.name,
			iconUrl: resolved.manifest.iconUrl,
		});
	}

	@bindThis
	public async record(params: {
		userId: MiUser['id'];
		manifestUrl: string;
		launchUrl: string;
		name: string;
		iconUrl: string | null;
	}): Promise<void> {
		const now = new Date();
		await this.userMiniAppsRepository.createQueryBuilder()
			.insert()
			.values({
				id: this.idService.gen(now.getTime()),
				...params,
				createdAt: now,
				lastDiscoveredAt: now,
			})
			.orUpdate(['launchUrl', 'name', 'iconUrl', 'lastDiscoveredAt'], ['userId', 'manifestUrl'])
			.execute();
	}

	@bindThis
	public async list(userId: MiUser['id'], limit: number): Promise<MiUserMiniApp[]> {
		return await this.userMiniAppsRepository.find({
			where: { userId },
			order: { lastDiscoveredAt: 'DESC' },
			take: limit,
		});
	}
}
