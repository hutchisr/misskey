/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { ArrayContains, MoreThan, type DataSource } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import { MiOAuthClient } from '@/models/OAuthClient.js';
import { MiOAuthGrant } from '@/models/OAuthGrant.js';
import type { MiUser } from '@/models/User.js';

const miniAppManifestPath = '/.well-known/fediverse-miniapp.json';
const restoreCodeKeyPrefix = 'miniapp:sessionRestore:';
const maximumRestoreLifetimeSeconds = 5 * 60;
const restoreCodePattern = /^[A-Za-z0-9_-]{16,512}$/;
const restoreChallengePattern = /^[A-Za-z0-9_-]{43}$/;
const restoreVerifierPattern = /^[A-Za-z0-9_-]{43,512}$/;

type StoredRestore = {
	grantId: MiOAuthGrant['grantId'];
	clientId: MiOAuthGrant['clientId'];
	manifestUrl: string;
	restoreChallenge: string;
};

export type MiniAppSessionRestoreIdentity = {
	issuer: string;
	sub: string;
	acct: string;
};

function restoreCodeKey(restoreCode: string): string {
	const digest = createHash('sha256').update(restoreCode).digest('hex');
	return `${restoreCodeKeyPrefix}${digest}`;
}

function isCanonicalLegacyManifestClient(clientId: string, manifestUrl: string, issuer: string): boolean {
	if (clientId !== manifestUrl || manifestUrl.length > 2048) return false;

	try {
		const url = new URL(manifestUrl);
		return url.href === manifestUrl &&
			url.protocol === 'https:' &&
			url.username === '' &&
			url.password === '' &&
			url.hostname !== '' &&
			url.port === '' &&
			url.pathname === miniAppManifestPath &&
			url.search === '' &&
			url.hash === '' &&
			url.origin !== new URL(issuer).origin;
	} catch {
		return false;
	}
}

function parseStoredRestore(value: string): StoredRestore | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return null;
	const stored = parsed as Partial<StoredRestore>;
	if (
		typeof stored.grantId !== 'string' ||
		stored.grantId.length < 1 ||
		stored.grantId.length > 64 ||
		typeof stored.clientId !== 'string' ||
		stored.clientId.length < 1 ||
		stored.clientId.length > 255 ||
		typeof stored.manifestUrl !== 'string' ||
		stored.manifestUrl.length < 1 ||
		stored.manifestUrl.length > 2048 ||
		typeof stored.restoreChallenge !== 'string' ||
		!restoreChallengePattern.test(stored.restoreChallenge)
	) {
		return null;
	}

	return {
		grantId: stored.grantId,
		clientId: stored.clientId,
		manifestUrl: stored.manifestUrl,
		restoreChallenge: stored.restoreChallenge,
	};
}

@Injectable()
export class MiniAppSessionRestoreService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,
	) {
	}

	public async create(userId: MiUser['id'], clientId: string, manifestUrl: string, restoreChallenge: string): Promise<string | null> {
		if (
			clientId.length < 1 ||
			clientId.length > 255 ||
			manifestUrl.length < 1 ||
			manifestUrl.length > 2048 ||
			!restoreChallengePattern.test(restoreChallenge)
		) {
			return null;
		}

		if (!await this.clientMatchesManifest(clientId, manifestUrl)) return null;

		const now = new Date();
		const grant = await this.db.getRepository(MiOAuthGrant).findOne({
			where: {
				userId,
				clientId,
				clientKind: 'miniapp',
				scope: ArrayContains(['identify']),
				authorizationExpiresAt: MoreThan(now),
			},
			order: {
				authorizationExpiresAt: 'DESC',
			},
			relations: {
				user: true,
			},
		});
		const user = grant?.user;
		if (
			grant == null ||
			grant.userId !== userId ||
			grant.clientId !== clientId ||
			grant.clientKind !== 'miniapp' ||
			!grant.scope.includes('identify') ||
			grant.authorizationExpiresAt.getTime() <= now.getTime() ||
			user == null ||
			user.id !== userId ||
			user.host !== null ||
			user.isSuspended ||
			user.isDeleted
		) {
			return null;
		}

		const lifetimeSeconds = Math.min(
			maximumRestoreLifetimeSeconds,
			Math.floor((grant.authorizationExpiresAt.getTime() - now.getTime()) / 1000),
		);
		if (lifetimeSeconds < 1) return null;

		const value = JSON.stringify({
			grantId: grant.grantId,
			clientId,
			manifestUrl,
			restoreChallenge,
		} satisfies StoredRestore);
		for (let attempt = 0; attempt < 3; attempt++) {
			const restoreCode = randomBytes(32).toString('base64url');
			const stored = await this.redisClient.set(
				restoreCodeKey(restoreCode),
				value,
				'EX',
				lifetimeSeconds,
				'NX',
			);
			if (stored === 'OK') return restoreCode;
		}

		throw new Error('Failed to allocate a unique Mini App session restore code');
	}

	public async consume(restoreCode: string, restoreVerifier: string): Promise<MiniAppSessionRestoreIdentity | null> {
		if (!restoreCodePattern.test(restoreCode)) return null;

		// Burn the one-time proof before validating its verifier. A failed attempt
		// must never leave the proof available for a later replay.
		const storedValue = await this.redisClient.getdel(restoreCodeKey(restoreCode));
		if (storedValue == null) return null;

		const stored = parseStoredRestore(storedValue);
		if (stored == null || !restoreVerifierPattern.test(restoreVerifier)) return null;

		const verifierChallenge = createHash('sha256').update(restoreVerifier).digest('base64url');
		const expected = Buffer.from(stored.restoreChallenge, 'ascii');
		const actual = Buffer.from(verifierChallenge, 'ascii');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

		const grant = await this.db.getRepository(MiOAuthGrant).findOne({
			where: {
				grantId: stored.grantId,
			},
			relations: {
				user: true,
			},
		});
		const user = grant?.user;
		if (
			grant == null ||
			grant.clientId !== stored.clientId ||
			grant.clientKind !== 'miniapp' ||
			!grant.scope.includes('identify') ||
			grant.authorizationExpiresAt.getTime() <= Date.now() ||
			user == null ||
			grant.userId !== user.id ||
			user.host !== null ||
			user.isSuspended ||
			user.isDeleted
		) {
			return null;
		}
		if (!await this.clientMatchesManifest(stored.clientId, stored.manifestUrl)) return null;

		return {
			issuer: this.config.url,
			sub: new URL(`/users/${user.id}`, this.config.url).toString(),
			acct: `${user.username}@${this.config.host}`,
		};
	}

	private async clientMatchesManifest(clientId: string, manifestUrl: string): Promise<boolean> {
		if (isCanonicalLegacyManifestClient(clientId, manifestUrl, this.config.url)) return true;

		const client = await this.db.getRepository(MiOAuthClient).findOneBy({
			id: clientId,
			kind: 'miniapp',
		});
		return client?.metadata.fediverse_miniapp_manifest_uri === manifestUrl;
	}
}
