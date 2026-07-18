/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('mini_app_oauth_refresh_token')
export class MiMiniAppOAuthRefreshToken {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
	})
	public tokenHash: string;

	@Index({ unique: true })
	@Column(id())
	public grantId: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 512,
	})
	public clientId: string;

	@Column('varchar', {
		length: 128,
	})
	public clientName: string;

	@Column('varchar', {
		length: 64, array: true,
	})
	public scope: string[];

	@Column('timestamp with time zone')
	public authorizationExpiresAt: Date;

	@Column('integer', {
		default: 0,
	})
	public refreshSequence: number;
}
