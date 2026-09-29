import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { DEFAULT_USER_ROLE } from "../lib/user-roles.js";
import type { UserRole } from "../lib/user-roles.js";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar", length: 128 })
  walletAddress!: string;

  @Index("IDX_users_email")
  @Column({ type: "varchar", length: 128, nullable: true })
  email?: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  alias?: string;

  @Column({ type: "varchar", length: 32, default: DEFAULT_USER_ROLE })
  role!: UserRole;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}