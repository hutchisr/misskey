/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

@Entity('user_mini_app')
@Index(['userId', 'manifestUrl'], { unique: true })
@Index(['userId', 'lastDiscoveredAt'])
export class MiUserMiniApp {
	@PrimaryColumn(id())
	public id: string;

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
	public manifestUrl: string;

	@Column('varchar', {
		length: 2048,
	})
	public launchUrl: string;

	@Column('varchar', {
		length: 128,
	})
	public name: string;

	@Column('varchar', {
		length: 2048,
		nullable: true,
	})
	public iconUrl: string | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public lastDiscoveredAt: Date;
}
