import { ConfigKey, ConfigValue } from "app/common/Config";
import { Organization } from "app/gen-server/entity/Organization";
import { nativeValues } from "app/gen-server/lib/values";
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "configs" })
export class Config extends BaseEntity {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: "org_id" })
  public org: Organization | null;

  @Column({ type: String })
  public key: ConfigKey;

  @Column({ type: nativeValues.jsonEntityType })
  public value: ConfigValue;

  @CreateDateColumn({
    name: "created_at",
    type: Date,
    default: () => "CURRENT_TIMESTAMP",
  })
  public createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: Date,
    default: () => "CURRENT_TIMESTAMP",
  })
  public updatedAt: Date;
}
