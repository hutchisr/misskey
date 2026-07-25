/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { miniAppPermissions, permissions } from 'misskey-js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { MiniAppManifestService } from '@/core/MiniAppManifestService.js';
import type { MiOAuthClient, OAuthClientsRepository } from '@/models/_.js';
import type { MiOAuthClientMetadata } from '@/models/OAuthClient.js';
import { OAuthProviderError } from './errors.js';

export type OAuthClientRegistrationResponse = MiOAuthClientMetadata & {
	client_id: string;
	client_id_issued_at: number;
};

type RegistrationErrorCode = 'invalid_redirect_uri' | 'invalid_client_metadata';

function registrationError(error: RegistrationErrorCode, description: string): OAuthProviderError {
	const result = new OAuthProviderError(error, description);
	result.allow_redirect = false;
	return result;
}

function object(value: unknown): Record<string, unknown> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		throw registrationError('invalid_client_metadata', 'registration request must be a JSON object');
	}

	return value as Record<string, unknown>;
}

function optionalString(value: unknown, name: string, maximumLength: number): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) {
		throw registrationError('invalid_client_metadata', `\`${name}\` is invalid`);
	}

	return value;
}

function optionalStringArray(value: unknown, name: string, maximumItems: number, maximumItemLength: number): string[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
		throw registrationError('invalid_client_metadata', `\`${name}\` is invalid`);
	}

	const result = value.map(item => optionalString(item, name, maximumItemLength));
	if (result.some(item => item == null) || new Set(result).size !== result.length) {
		throw registrationError('invalid_client_metadata', `\`${name}\` is invalid`);
	}

	return result as string[];
}

function webUrl(value: unknown, name: string): string | undefined {
	const raw = optionalString(value, name, 2048);
	if (raw == null) return undefined;

	try {
		const url = new URL(raw);
		const allowedProtocols = process.env.NODE_ENV === 'test' ? ['http:', 'https:'] : ['https:'];
		if (!allowedProtocols.includes(url.protocol) || url.username || url.password) {
			throw new Error('invalid URL');
		}
		return url.href;
	} catch {
		throw registrationError('invalid_client_metadata', `\`${name}\` must be an HTTPS URL`);
	}
}

function redirectUri(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
		throw registrationError('invalid_redirect_uri', '`redirect_uris` contains an invalid URI');
	}

	try {
		const url = new URL(value);
		if (url.hash || url.username || url.password) {
			throw new Error('invalid redirect URI');
		}

		if (url.protocol === 'https:') return url.href;
		if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href;

		const privateUseScheme = url.protocol.slice(0, -1);
		if (/^[a-z][a-z0-9+-]*(?:\.[a-z0-9][a-z0-9+-]*)+$/.test(privateUseScheme) && privateUseScheme.length <= 253) return url.href;

		throw new Error('invalid redirect URI');
	} catch {
		throw registrationError('invalid_redirect_uri', '`redirect_uris` contains an invalid URI');
	}
}

function redirectUris(value: unknown): string[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
		throw registrationError('invalid_redirect_uri', '`redirect_uris` must contain between 1 and 16 URIs');
	}

	const result = value.map(redirectUri);
	if (new Set(result).size !== result.length) {
		throw registrationError('invalid_redirect_uri', '`redirect_uris` must not contain duplicates');
	}

	return result;
}

function exactStringSet(value: unknown, defaults: string[], expected: string[], name: string): string[] {
	const result = value == null ? defaults : optionalStringArray(value, name, 8, 128);
	if (result == null || result.length !== expected.length || expected.some(item => !result.includes(item))) {
		throw registrationError('invalid_client_metadata', `\`${name}\` is not supported`);
	}

	return [...expected];
}

function scopes(value: unknown, allowed: readonly string[], defaults: readonly string[]): string[] {
	if (value == null) return [...defaults];
	if (typeof value !== 'string' || value.length > 4096) {
		throw registrationError('invalid_client_metadata', '`scope` is invalid');
	}

	const result = value.split(' ').filter(Boolean);
	if (
		result.length < 1 ||
		new Set(result).size !== result.length ||
		result.some(scope => !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope) || !allowed.includes(scope))
	) {
		throw registrationError('invalid_client_metadata', '`scope` contains an unsupported scope');
	}

	return result;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every(value => right.includes(value));
}

@Injectable()
export class OAuthClientRegistrationService {
	constructor(
		@Inject(DI.oauthClientsRepository)
		private oauthClientsRepository: OAuthClientsRepository,
		private idService: IdService,
		private miniAppManifestService: MiniAppManifestService,
	) {
	}

	public async register(value: unknown): Promise<OAuthClientRegistrationResponse> {
		const input = object(value);
		const profileManifestUri = optionalString(input.fediverse_miniapp_manifest_uri, 'fediverse_miniapp_manifest_uri', 2048);
		const manifestUrl = optionalString(input.manifest_url, 'manifest_url', 2048);
		if (profileManifestUri != null && manifestUrl != null && profileManifestUri !== manifestUrl) {
			throw registrationError('invalid_client_metadata', '`fediverse_miniapp_manifest_uri` and `manifest_url` must match');
		}
		const manifestUri = profileManifestUri ?? manifestUrl;
		const manifestParameterName = profileManifestUri == null ? 'manifest_url' : 'fediverse_miniapp_manifest_uri';
		const resolvedManifest = manifestUri == null
			? null
			: await this.miniAppManifestService.resolveManifestUrl(manifestUri).catch(() => {
				throw registrationError('invalid_client_metadata', `unable to resolve \`${manifestParameterName}\``);
			});

		if (resolvedManifest != null && resolvedManifest.manifestUrl !== manifestUri) {
			throw registrationError('invalid_client_metadata', `\`${manifestParameterName}\` must be canonical`);
		}

		const registeredRedirectUris = redirectUris(input.redirect_uris);
		if (resolvedManifest != null && !sameStringSet(registeredRedirectUris, resolvedManifest.manifest.oauth.redirectUris)) {
			throw registrationError('invalid_redirect_uri', '`redirect_uris` must match the Mini App manifest');
		}

		if (input.token_endpoint_auth_method !== 'none') {
			throw registrationError('invalid_client_metadata', '`token_endpoint_auth_method` must be `none`');
		}

		const isMiniApp = resolvedManifest != null;
		const grantTypes = exactStringSet(
			input.grant_types,
			isMiniApp ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
			isMiniApp ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
			'grant_types',
		) as MiOAuthClientMetadata['grant_types'];
		const responseTypes = exactStringSet(input.response_types, ['code'], ['code'], 'response_types') as MiOAuthClientMetadata['response_types'];
		const registeredScopes = scopes(
			input.scope,
			isMiniApp ? miniAppPermissions : permissions,
			isMiniApp ? resolvedManifest.manifest.oauth.scopes : permissions,
		);
		if (resolvedManifest != null && !sameStringSet(registeredScopes, resolvedManifest.manifest.oauth.scopes)) {
			throw registrationError('invalid_client_metadata', '`scope` must match the Mini App manifest');
		}

		const requestedClientName = optionalString(input.client_name, 'client_name', 128);
		const requestedClientUri = webUrl(input.client_uri, 'client_uri');
		const requestedLogoUri = webUrl(input.logo_uri, 'logo_uri');
		const contacts = optionalStringArray(input.contacts, 'contacts', 10, 320);
		const tosUri = webUrl(input.tos_uri, 'tos_uri');
		const policyUri = webUrl(input.policy_uri, 'policy_uri');
		const softwareId = optionalString(input.software_id, 'software_id', 255);
		const softwareVersion = optionalString(input.software_version, 'software_version', 255);
		const metadata: MiOAuthClientMetadata = {
			redirect_uris: registeredRedirectUris,
			token_endpoint_auth_method: 'none',
			grant_types: grantTypes,
			response_types: responseTypes,
			scope: registeredScopes.join(' '),
			...(resolvedManifest != null
				? {
					client_name: resolvedManifest.manifest.name,
					client_uri: resolvedManifest.manifest.homeUrl,
					logo_uri: resolvedManifest.manifest.iconUrl,
					fediverse_miniapp_manifest_uri: resolvedManifest.manifestUrl,
				}
				: {
					...(requestedClientName == null ? {} : { client_name: requestedClientName }),
					...(requestedClientUri == null ? {} : { client_uri: requestedClientUri }),
					...(requestedLogoUri == null ? {} : { logo_uri: requestedLogoUri }),
				}),
			...(contacts == null ? {} : { contacts }),
			...(tosUri == null ? {} : { tos_uri: tosUri }),
			...(policyUri == null ? {} : { policy_uri: policyUri }),
			...(softwareId == null ? {} : { software_id: softwareId }),
			...(softwareVersion == null ? {} : { software_version: softwareVersion }),
		};

		const createdAt = new Date();
		const clientId = this.idService.gen(createdAt.getTime());
		await this.oauthClientsRepository.insert({
			id: clientId,
			createdAt,
			kind: isMiniApp ? 'miniapp' : 'oauth',
			metadata,
		});

		return {
			client_id: clientId,
			client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
			...metadata,
		};
	}

	public async findById(clientId: string): Promise<MiOAuthClient | null> {
		return await this.oauthClientsRepository.findOneBy({ id: clientId });
	}
}
