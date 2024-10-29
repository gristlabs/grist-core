import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ApiError } from 'app/common/ApiError';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { RunInTransaction } from 'app/gen-server/lib/homedb/Interfaces';
import { normalizeEmail } from 'app/common/emails';

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
  public async deleteAllServiceAccounts(optManager?: EntityManager) {
    const manager = optManager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .delete()
      .from(ServiceAccount, 'service_accounts');
    return await queryBuilder.execute();
  }

  public async createServiceAccount(
    ownerId: number,
    label?: string,
    description?: string,
    endOfLife?: Date,
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
        label,
        description,
        endOfLife
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

  public async readAllServiceAccounts(
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
      if (!serviceAccount) {
        return serviceAccount;
      }
      if (expectedOwnerId !== undefined && expectedOwnerId !== serviceAccount.ownerId) {
        throw new ApiError("Cannot update non-owned service account: " + serviceAccountLogin, 403);
      }
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
      if (serviceAccount === null) {
        throw new ApiError(`This Service Account does not exist`, 404);
      }
      if (options.expectedOwnerId !== undefined && serviceAccount.ownerId !== options.expectedOwnerId) {
        throw new ApiError("Cannot delete non-owned service account: " + serviceAccountLogin, 403);
      }
      const { serviceUser } = serviceAccount;
      // We perform a soft delete
      // as we don't want a service user's apiKey to still work
      serviceUser.apiKey = null;
      serviceUser.deletedAt = new Date();
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
      if (serviceAccount === null) {
        throw new ApiError(`This Service Account does not exist`, 404);
      }
      if (options.expectedOwnerId !== undefined && serviceAccount.ownerId !== options.expectedOwnerId) {
        throw new ApiError("Cannot regenerate api key non-owned service account: " + serviceAccountLogin, 403);
      }
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
      if (serviceAccount === null) {
        throw new ApiError(`This Service Account does not exist`, 404);
      }
      if (options.expectedOwnerId !== undefined && serviceAccount.ownerId !== options.expectedOwnerId) {
        throw new ApiError("Cannot revoke api key non-owned service account: " + serviceAccountLogin, 403);
      }
      serviceAccount.serviceUser = await this._homeDb.deleteApiKey(serviceAccount.serviceUser.id, manager);
      return serviceAccount;
    });
  }

  public async isAliveServiceAccount(serviceAccountLogin: string) {
    return await this._connection.transaction(async manager => {
      const serviceAccount = await this.getServiceAccount(serviceAccountLogin, manager);
      if (serviceAccount === null) {
        throw new ApiError(`This Service Account does not exist`, 404);
      }
      const endOfLife = new Date(serviceAccount.endOfLife);
      const currentDate = new Date();
      return endOfLife > currentDate;
    });
  }
}
