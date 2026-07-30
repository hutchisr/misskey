/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, MoreThan, type DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiAccessToken } from '@/models/AccessToken.js';
import { MiOAuthGrant } from '@/models/OAuthGrant.js';
import { MiOAuthClient } from '@/models/OAuthClient.js';
import type { MiUser } from '@/models/User.js';

export type UserMiniApp = {
	id: MiOAuthClient['id'];
	manifestUrl: string;
	launchUrl: string;
	name: string;
	iconUrl: string | null;
	createdAt: Date;
	lastDiscoveredAt: Date;
};

@Injectable()
export class UserMiniAppService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,
	) {
	}

	public async list(userId: MiUser['id'], limit: number): Promise<UserMiniApp[]> {
		const grants = await this.db.getRepository(MiOAuthGrant).find({
			where: {
				userId,
				clientKind: 'miniapp',
				authorizationExpiresAt: MoreThan(new Date()),
			},
		});
		if (grants.length === 0) return [];

		const oauthClients = await this.db.getRepository(MiOAuthClient).find({
			where: {
				id: In([...new Set(grants.map(grant => grant.clientId))]),
				kind: 'miniapp',
			},
		});
		if (oauthClients.length === 0) return [];

		const clientById = new Map(oauthClients.map(client => [client.id, client]));
		const accessTokens = await this.db.getRepository(MiAccessToken).find({
			where: {
				userId,
				oauthGrantId: In(grants.map(grant => grant.grantId)),
			},
		});
		const lastUsedAtByGrantId = new Map(accessTokens.flatMap(token => (
			token.oauthGrantId == null || token.lastUsedAt == null
				? []
				: [[token.oauthGrantId, token.lastUsedAt] as const]
		)));
		const miniAppByManifestUrl = new Map<string, UserMiniApp>();

		for (const grant of grants) {
			const client = clientById.get(grant.clientId);
			const manifestUrl = client?.metadata.fediverse_miniapp_manifest_uri;
			const launchUrl = client?.metadata.client_uri;
			const name = client?.metadata.client_name;
			if (client == null || manifestUrl == null || launchUrl == null || name == null) continue;

			const lastDiscoveredAt = lastUsedAtByGrantId.get(grant.grantId) ?? client.createdAt;
			const existing = miniAppByManifestUrl.get(manifestUrl);
			if (existing != null && existing.lastDiscoveredAt >= lastDiscoveredAt) continue;

			miniAppByManifestUrl.set(manifestUrl, {
				id: client.id,
				manifestUrl,
				launchUrl,
				name,
				iconUrl: client.metadata.logo_uri ?? null,
				createdAt: client.createdAt,
				lastDiscoveredAt,
			});
		}

		return [...miniAppByManifestUrl.values()]
			.sort((a, b) => b.lastDiscoveredAt.getTime() - a.lastDiscoveredAt.getTime())
			.slice(0, limit);
	}
}
