/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

export type MiOAuthClientKind = 'oauth' | 'miniapp';

export type MiOAuthClientMetadata = {
	redirect_uris: string[];
	token_endpoint_auth_method: 'none';
	grant_types: ('authorization_code' | 'refresh_token')[];
	response_types: 'code'[];
	scope: string;
	client_name?: string;
	client_uri?: string;
	logo_uri?: string;
	contacts?: string[];
	tos_uri?: string;
	policy_uri?: string;
	software_id?: string;
	software_version?: string;
	fediverse_miniapp_manifest_uri?: string;
};

@Entity('oauth_client')
export class MiOAuthClient {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('varchar', {
		length: 16,
	})
	public kind: MiOAuthClientKind;

	@Column('jsonb')
	public metadata: MiOAuthClientMetadata;
}
