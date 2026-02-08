import { OAuthClient } from "app/gen-server/entity/OAuthClient";
import { User } from "app/gen-server/entity/User";
import { nativeValues } from "app/gen-server/lib/values";

import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * An OAuth grant, which records a user's consent for which scopes/claims we can send to a particular
 * {@link OAuthClient}.
 *
 * A particular client may only have one grant per user, which encompasses all scopes granted to the
 * client on behalf of the user.
 */
@Entity({ name: "oauth_grants" })
export class OAuthGrant extends BaseEntity {
  /**
   * The grant ID.
   */
  @PrimaryColumn({ type: String })
  public id: string;

  /**
   * The grant properties.
   *
   * Note: See {@link OAuthClient.payload} for explanation of why jsonb is used instead of json.
   *
   * Reference: https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js#L96-L116.
   */
  @Column({ type: nativeValues.jsonbEntityType })
  public payload: Record<string, unknown>;

  /**
   * The ID of the client associated with the grant.
   */
  @Column({ name: "oauth_client_id", type: String })
  public clientId: string;

  /**
   * The client associated with the grant.
   */
  @ManyToOne(() => OAuthClient, { onDelete: "CASCADE" })
  @JoinColumn({ name: "oauth_client_id" })
  public client: OAuthClient;

  /**
   * The ID of the user the grant was issued to.
   */
  @Column({ name: "issued_to_user_id", type: Number })
  public issuedToUserId: number;

  /**
   * The user the grant was issued to.
   */
  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "issued_to_user_id" })
  public issuedToUser: User;

  /**
   * The grant created at timestamp.
   */
  @CreateDateColumn({ name: "created_at" })
  public createdAt: Date;

  /**
   * The grant updated at timestamp.
   */
  @UpdateDateColumn({ name: "updated_at" })
  public updatedAt: Date;
}
