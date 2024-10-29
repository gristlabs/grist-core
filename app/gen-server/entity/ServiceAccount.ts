import {ApiError} from 'app/common/ApiError';
import {User} from 'app/gen-server/entity/User';
import {
  BaseEntity, BeforeInsert, BeforeUpdate, Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn
} from "typeorm";

@Entity({name: 'service_accounts'})
export class ServiceAccount extends BaseEntity {

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({type: Number, name: 'owner_id'})
  public ownerId: number;

  @ManyToOne(() => User)
  @JoinColumn({name: 'owner_id'})
  public owner: User;

  @Column({type: Number, name: 'service_user_id'})
  public serviceUserId: number;

  @OneToOne(() => User, user => user.serviceAccount)
  @JoinColumn({name: 'service_user_id'})
  public serviceUser: User;

  @Column({type: String, nullable: false, default: ''})
  public label: string;

  @Column({type: String, nullable: false, default: ''})
  public description: string;

  @Column({type: Date, nullable: false, name: 'end_of_life'})
  public endOfLife: Date;

  @BeforeUpdate()
  @BeforeInsert()
  public checkEndOfLife() {
    if (Number.isNaN(this.endOfLife.getTime())) {
      throw new ApiError("Invalid endOfLife", 400);
    }
  }
}
