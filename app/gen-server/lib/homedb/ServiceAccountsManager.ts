import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ApiError } from 'app/common/ApiError';
import { normalizeEmail } from 'app/common/emails';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { RunInTransaction } from 'app/gen-server/lib/homedb/Interfaces';

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

  public async createServiceAccount(
    ownerId: number,
    options?: {
      label?: string,
      description?: string,
      expiresAt?: Date,
    }
  ) {
    return await this._connection.transaction(async manager => {
      const uuid = uuidv4();
      // We use .invalid as tld following RFC 2606
      // as we don't ever want service user to be able to recieve any email
      // and then be able to connect via link in email
      const login = `${uuid}@serviceaccounts.invalid`;
      // Using getUserByLogin will create the user... Yeah, please don't blame us.
      const serviceUser = await this._homeDb.getUserByLogin(login, {manager}, 'service');

      await this._homeDb.createApiKey(serviceUser.id, false, manager);

      const newServiceAccount = ServiceAccount.create({
        ownerId,
        serviceUserId: serviceUser.id,
        label: options?.label,
        description: options?.description,
        expiresAt: options?.expiresAt
      });
      await manager.save(newServiceAccount);
      return (await this.getServiceAccount(login, manager))!;
    });
  }

  public async getServiceAccount(
    serviceAccountLogin: string,
    transaction?: EntityManager
  ) {
    return await this._runInTransaction(transaction, async manager => {
      return await manager.createQueryBuilder()
        .select("serviceAccount")
        .from(ServiceAccount, "serviceAccount")
        .innerJoinAndSelect("serviceAccount.serviceUser", "serviceUser")
        .innerJoinAndSelect("serviceUser.logins", "logins")
        .where("logins.email = :email", {email: normalizeEmail(serviceAccountLogin)})
        .getOne();
    });
  }

  public async getAllServiceAccounts(
    ownerId: number,
    transaction?: EntityManager
  ) {
    return await this._runInTransaction(transaction, async manager => {
      return await manager.find(
        ServiceAccount,
        {where: {ownerId}}
      );
    });
  }

  public async updateServiceAccount(
    serviceAccountLogin: string,
    partial: Partial<ServiceAccount>,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ) {
    const { expectedOwnerId } = options;
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, expectedOwnerId);
      ServiceAccount.merge(serviceAccount, partial);
      return await manager.save(serviceAccount);
    });
  }

  public async deleteServiceAccount(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ) {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      const { serviceUser } = serviceAccount;
      // We perform a soft delete
      // as we don't want a service user's apiKey to still work
      serviceUser.apiKey = null;
      serviceUser.removedAt = new Date();
      await manager.save(serviceUser);
      await manager.remove(serviceAccount);
      return serviceAccount;
    });
  }

  public async regenerateServiceAccountApiKey(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ) {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      serviceAccount.serviceUser = await this._homeDb.createApiKey(serviceAccount.serviceUser.id, true, manager);
      return serviceAccount;
    });
  }

  public async revokeServiceAccountApiKey(
    serviceAccountLogin: string,
    options: {expectedOwnerId?: number, transaction?: EntityManager} = {},
  ) {
    return await this._runInTransaction(options.transaction, async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExistingAndOwned(serviceAccount, options.expectedOwnerId);
      serviceAccount.serviceUser = await this._homeDb.deleteApiKey(serviceAccount.serviceUser.id, manager);
      return serviceAccount;
    });
  }

  public async isServiceAccountAlive(serviceAccountLogin: string) {
    return await this._connection.transaction(async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      this._assertExisting(serviceAccount);
      const expiresAt = new Date(serviceAccount.expiresAt);
      const currentDate = new Date();
      return expiresAt > currentDate;
    });
  }

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
}
