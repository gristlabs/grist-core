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
 * Lifetime of an OAuth refresh token, in seconds. Single source of truth: the OIDC server issues
 * refresh tokens with this TTL, and the Housekeeper stale-client sweep uses it as the safety window
 * — a dynamic client is never deleted while its refresh tokens could still be live.
 */
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;  // 60 days

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
   * The type this stores is Grant (from `oidc-provider` module); but it's not
   * named here to avoid bringing in `oidc-provider` as a grist-core dependency.
   *
   * Reference: https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js#L96-L116.
   */
  @Column({ type: nativeValues.jsonbEntityType })
  public payload: Record<string, unknown>;

  /**
   * Grist-owned per-grant configuration. Type is `OAuthGrantSettings` from ext/app/common, but
   * not named here to avoid the need to bring it into grist-core just for this.
   *
   * Separate from payload, because oidc-provider restricts its payload to only recognized fields.
   */
  @Column({ type: nativeValues.jsonbEntityType, nullable: true })
  public settings: Record<string, unknown> | null;

  /**
   * The ID of the client associated with the grant.
   *
   * `null` for CIMD (Client ID Metadata Document) clients, which have no
   * Grist-side record. Their identity is the URL of the metadata document
   * itself, controlled by the client. Pre-registered clients always have a
   * non-null id pointing at an `oauth_clients` row.
   */
  @Column({ name: "oauth_client_id", type: String, nullable: true })
  public clientId: string | null;

  /**
   * The client associated with the grant. `null` for CIMD clients - see
   * {@link clientId}.
   */
  @ManyToOne(() => OAuthClient, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "oauth_client_id" })
  public client: OAuthClient | null;

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

  /**
   * Timestamp at which an access token was last issued for this grant, or `null` if none has been
   * issued. A proxy for "app is active", since access tokens have a relatively short lifetime.
   */
  @Column({ name: "last_used_at", type: nativeValues.dateTimeType, nullable: true })
  public lastUsedAt: Date | null;
}
