/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MiniAppSessionRestoreService, type MiniAppSessionRestoreIdentity } from '@/core/MiniAppSessionRestoreService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	stability: 'experimental',
	tags: ['app', 'account'],
	description: 'Consume a short-lived, one-time Mini App session restore proof.',
	requireCredential: false,
	limit: {
		duration: 60 * 1000,
		max: 600,
	},
	errors: {
		invalidSessionRestore: {
			message: 'The Mini App session restore proof is invalid.',
			code: 'INVALID_MINI_APP_SESSION_RESTORE',
			id: '9e0bba2c-4a28-4c20-9e0b-2604f292e751',
		},
	},
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			issuer: {
				type: 'string',
				format: 'uri',
				optional: false, nullable: false,
			},
			sub: {
				type: 'string',
				format: 'uri',
				optional: false, nullable: false,
			},
			acct: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
		required: ['issuer', 'sub', 'acct'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		// Semantic validation happens only after the one-time code is burned.
		restoreCode: { type: 'string', maxLength: 512 },
		restoreVerifier: { type: 'string' },
	},
	required: ['restoreCode', 'restoreVerifier'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private miniAppSessionRestoreService: MiniAppSessionRestoreService,
	) {
		super(meta, paramDef, async (ps, _me, _token, _file, _cleanup, _ip, headers) => {
			// This proof exchange is backend-to-backend. The API plugin otherwise
			// enables wildcard CORS, which would expose the identity to browser code.
			if (headers?.origin != null) throw new ApiError(meta.errors.invalidSessionRestore);

			let identity: MiniAppSessionRestoreIdentity | null;
			try {
				identity = await this.miniAppSessionRestoreService.consume(ps.restoreCode, ps.restoreVerifier);
			} catch {
				// ApiCallService logs request parameters for unexpected errors. Map
				// failures here so the restore code and verifier are never logged.
				throw new ApiError(meta.errors.invalidSessionRestore);
			}
			if (identity == null) throw new ApiError(meta.errors.invalidSessionRestore);

			return identity;
		});
	}
}
