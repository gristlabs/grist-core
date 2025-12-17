import { Organization } from "app/gen-server/entity/Organization";
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
 * An OAuth client, e.g. a self-hosted instance using "Sign in with getgrist.com".
 *
 * Clients are currently owned by personal orgs. In the future, we will want to expand
 * this to include other orgs, to support management of clients within a team.
 */
@Entity({ name: "oauth_clients" })
export class OAuthClient extends BaseEntity {
  /**
   * The client ID.
   */
  @PrimaryColumn({ type: String })
  public id: string;

  /**
   * The client properties.
   *
   * Note: jsonb is used instead of json to allow indexing specific properties and updating
   * fields more efficiently, if the need arises. We don't need to preserve exact formatting
   * as is the case with json columns, and don't expect high write volumes that would make
   * jsonb's additional overhead a problem.
   *
   * Reference: https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js#L93-L94.
   */
  @Column({ type: nativeValues.jsonbEntityType })
  public payload: Record<string, unknown>;

  /**
   * The ID of the org that owns the client.
   *
   * Note: Currently, clients are only owned by personal orgs.
   */
  @Column({ name: "org_id", type: Number })
  public orgId: number;

  /**
   * The org that owns the client.
   *
   * Clients are deleted when their associated org is deleted. This means that
   * if a user registered a client using their personal org and later deleted
   * their Grist account, any self-managed Grist server that was still using
   * the credentials of the deleted client will stop authenticating and report
   * a "client not found" error on new authentication attempts.
   *
   * Recovery in such cases is still possible if an admin of the Grist
   * server registers a new OAuth client on getgrist.com, and updates their
   * server to use the new client's credentials. This can be mitigated further
   * with support for organization-wide sharing of clients, and self-service
   * transfer of client ownership (see note below about current restrictions).
   *
   * Note: Currently, clients are only owned by personal orgs.
   */
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  public org: Organization;

  /**
   * The client created at timestamp.
   */
  @CreateDateColumn({ name: "created_at" })
  public createdAt: Date;

  /**
   * The client updated at timestamp.
   */
  @UpdateDateColumn({ name: "updated_at" })
  public updatedAt: Date;
}
