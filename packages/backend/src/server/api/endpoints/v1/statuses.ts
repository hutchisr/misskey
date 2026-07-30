/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { DI } from '@/di-symbols.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['notes'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write',
	allowMiniAppCredential: true,
	limit: {
		key: 'notes/create',
		duration: ms('1hour'),
		max: 300,
	},
	errors: {
		miniAppCredentialRequired: {
			message: 'A mini app OAuth credential is required.',
			code: 'MINI_APP_CREDENTIAL_REQUIRED',
			id: '02e38f42-5e52-485e-a159-3f017d565180',
			httpStatusCode: 403,
		},
		containsProhibitedWords: {
			message: 'Cannot post because it contains prohibited words.',
			code: 'CONTAINS_PROHIBITED_WORDS',
			id: '856668d6-90a4-4f15-8a54-15a8fe70bebf',
			httpStatusCode: 400,
		},
		containsTooManyMentions: {
			message: 'Cannot post because it exceeds the allowed number of mentions.',
			code: 'CONTAINS_TOO_MANY_MENTIONS',
			id: '0ba216a9-0bab-405b-b7a9-d569b5d06766',
			httpStatusCode: 400,
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: { type: 'string', optional: false, nullable: false },
			url: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		status: {
			type: 'string',
			minLength: 1,
			maxLength: MAX_NOTE_TEXT_LENGTH,
			pattern: '[^\\s]+',
		},
		visibility: { type: 'string', enum: ['public'], default: 'public' },
	},
	required: ['status'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.config)
		private config: Config,

		private noteCreateService: NoteCreateService,
	) {
		super(meta, paramDef, async (ps, me, token) => {
			if (token?.oauthGrantId == null || token.oauthClientKind !== 'miniapp') {
				throw new ApiError(meta.errors.miniAppCredentialRequired);
			}

			let note: Awaited<ReturnType<NoteCreateService['create']>>;
			try {
				note = await this.noteCreateService.create(me, {
					text: ps.status,
					visibility: ps.visibility,
					localOnly: false,
				});
			} catch (error) {
				if (error instanceof IdentifiableError) {
					if (error.id === '689ee33f-f97c-479a-ac49-1b9f8140af99') {
						throw new ApiError(meta.errors.containsProhibitedWords);
					}
					if (error.id === '9f466dab-c856-48cd-9e65-ff90ff750580') {
						throw new ApiError(meta.errors.containsTooManyMentions);
					}
				}
				throw error;
			}

			return {
				id: note.id,
				url: new URL(`/notes/${note.id}`, this.config.url).toString(),
			};
		});
	}
}
