import { ApiError } from 'app/common/ApiError';
import { normalizeEmail } from 'app/common/emails';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { RunInTransaction, ServiceAccountProperties } from 'app/gen-server/lib/homedb/Interfaces';

import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export class ServiceAccountsManager {

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    private _runInTransaction: RunInTransaction
  ) {}

  // This method is implemented for test purpose only
  // Using it outside of tests context will lead to partial db
  // destruction
  public async testDeleteAllServiceAccounts(optManager?: EntityManager) {
    const manager = optManager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .delete()
      .from(ServiceAccount, 'service_accounts');
    return await queryBuilder.execute();
  }

  /**
   * Creates a service account.
   *
   * @param ownerId The user ID of the owner
   * @param props Optional properties to set to this service account.
   */
  public async createServiceAccount(
    ownerId: number,
    props?: ServiceAccountProperties,
  ): Promise<ServiceAccount> {
    return await this._connection.transaction(async manager => {
      const owner = await this._homeDb.getUser(ownerId);
      if (!owner) {
        throw new ApiError("owner not found", 404);
      }
      if (owner.type !== 'login') {
        throw new ApiError('Only regular users (of type "login") are allowed to create service accounts', 403);
      }
      const uuid = uuidv4();
      // We use .invalid as tld following RFC 2606
      // as we don't ever want service user to be able to receive any email
      // and then be able to connect via link in email
      const login = `${uuid}@serviceaccounts.invalid`;
      // Using getUserByLogin will create the user... Yeah, please don't blame us.
      const serviceUser = await this._homeDb.getUserByLogin(login, {manager}, 'service');

      await this._homeDb.createApiKey(serviceUser.id, false, manager);

      const newServiceAccount = ServiceAccount.create({
        owner,
        serviceUserId: serviceUser.id,
        label: props?.label,
        description: props?.description,
        expiresAt: props?.expiresAt
      });
      await manager.save(newServiceAccount);
      return (await this.getServiceAccount(login, manager))!;
    });
  }

  /**
   * Returns information of the service account, including:
   *  - the information from the users table
   *  - the login information
   *
   * @param serviceAccountLogin The service account email
   */
  public async getServiceAccount(
    serviceAccountLogin: string,
    transaction?: EntityManager
  ): Promise<ServiceAccount|null> {
    return await this._runInTransaction(transaction, async manager => {
      return await this._buildServiceAccountQuery(manager, serviceAccountLogin)
        .getOne();
    });
  }

  /**
   * Like getServiceAccount but also returns informations of the owner.
   */
  public async getServiceAccountWithOwner(
    serviceAccountLogin: string,
    transaction?: EntityManager
  ): Promise<ServiceAccount|null> {
    return await this._runInTransaction(transaction, async manager => {
      return await this._buildServiceAccountQuery(manager, serviceAccountLogin)
        .innerJoinAndSelect("serviceAccount.owner", "owner")
        .getOne();
    });
  }

  /**
   * Ensures that the service account exists and is owned by the specified owner.
   *
   * @param serviceAccount The service account to check for existence and the ownership
   * @param expectedOwnerId The user ID we expect the service account is owned (must be passed)
   */
  public assertServiceAccountExistingAndOwned(
    serviceAccount: ServiceAccount | null,
    expectedOwnerId: number
  ): asserts serviceAccount is ServiceAccount {
    return this._assertExistingAndOwned(serviceAccount, expectedOwnerId);
  }

  public async getOwnedServiceAccounts(
    ownerId: number,
    transaction?: EntityManager
  ): Promise<ServiceAccount[]> {
    return await this._runInTransaction(transaction, async manager => {
      return await manager.find(
        ServiceAccount,
        {where: {ownerId}}
      );
    });
  }

  /**
   * Update a service account
   *
   * @param serviceAccountLogin The service account email
   * @param props Properties to change to the service account.
   * @param options
   * @param options.expectedOwnerId If passed, check the ownership of the service account before any change
   * @param options.transaction If passed, reuse this typeorm transaction
   */
  public async updateServiceAccount(
    serviceAccountLogin: string,
    props: ServiceAccountProperties,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ): Promise<ServiceAccount> {
    const { expectedOwnerId } = options;
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, expectedOwnerId);
      ServiceAccount.merge(serviceAccount, props as Partial<ServiceAccount>);
      return await manager.save(serviceAccount);
    });
  }

  /**
   * Delete a service account
   *
   * @param serviceAccountLogin The service account email
   * @param options
   * @param options.expectedOwnerId If passed, check the ownership of the service account before any change
   * @param options.transaction If passed, reuse this typeorm transaction
   */
  public async deleteServiceAccount(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ): Promise<ServiceAccount> {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      const { serviceUser } = serviceAccount;
      // We perform a soft delete as we don't want a service user's apiKey to still work
      // Still keep the user's information to keep the trace of what the service account may have done.
      serviceUser.apiKey = null;
      serviceUser.disabledAt = new Date();
      await manager.save(serviceUser);
      await manager.remove(serviceAccount);
      return serviceAccount;
    });
  }

  /**
   * Creates the service account API key.
   *
   * @param serviceAccountLogin The service account email
   * @param options
   * @param options.expectedOwnerId If passed, check the ownership of the service account before any change
   * @param options.transaction If passed, reuse this typeorm transaction
   */
  public async createServiceAccountApiKey(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ): Promise<ServiceAccount> {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      serviceAccount.serviceUser = await this._homeDb.createApiKey(serviceAccount.serviceUser.id, true, manager);
      return serviceAccount;
    });
  }

  /**
   * Revokes the API key of the service account
   *
   * @param serviceAccountLogin The service account email
   * @param options
   * @param options.expectedOwnerId If passed, check the ownership of the service account before any change
   * @param options.transaction If passed, reuse this typeorm transaction
   */
  public async revokeServiceAccountApiKey(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ): Promise<ServiceAccount> {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      serviceAccount.serviceUser = await this._homeDb.deleteApiKey(serviceAccount.serviceUser.id, manager);
      return serviceAccount;
    });
  }

  /**
   * Check that the serviceAccount exists and *if* an expectedOwnerId is passed, check
   * its ownership.
   */
  private _assertExistingAndOwned(
    serviceAccount: ServiceAccount|null, expectedOwnerId: number|undefined
  ): asserts serviceAccount is ServiceAccount {
    this._assertExisting(serviceAccount);
    if (expectedOwnerId !== undefined && serviceAccount.ownerId !== expectedOwnerId) {
      throw new ApiError("Cannot access non-owned service account", 403);
    }
  }

  private _assertExisting(serviceAccount: ServiceAccount|null): asserts serviceAccount is ServiceAccount {
    if (serviceAccount === null) {
      throw new ApiError("This Service Account does not exist", 404);
    }
  }

  private _buildServiceAccountQuery(manager: EntityManager, serviceAccountLogin: string) {
    return manager.createQueryBuilder()
      .select("serviceAccount")
      .from(ServiceAccount, "serviceAccount")
      .innerJoinAndSelect("serviceAccount.serviceUser", "serviceUser")
      .innerJoinAndSelect("serviceUser.logins", "logins")
      .where("logins.email = :email", {email: normalizeEmail(serviceAccountLogin)});
  }
}
