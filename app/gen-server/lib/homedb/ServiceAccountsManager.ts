import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
//import { UsersManager } from 'app/gen-server/lib/homedb/UsersManager';
import { EntityManager } from 'typeorm';
import { User } from 'app/gen-server/entity/User';
import {v4 as uuidv4} from 'uuid';
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';

export class ServiceAccountsManager {

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    //private _runInTransaction: RunInTransaction
  ) {}

  // This method is implemented for test purpose only
  // Using it outside of tests context will lead to partial db
  // destruction
  public async deleteAllServiceAccounts(optManager?: EntityManager){
    const manager = optManager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .delete()
      .from(User, 'users')
      .where('users.type ="service"');
    return await queryBuilder.execute();
  }

  public async createServiceAccount(
    ownerId: number,
    label?: string,
    description?: string,
    endOfLife?: Date,
  ){
    return await this._connection.transaction(async manager => {
      //TODO create new service user in order to have its
      //id to insert
      const uuid = uuidv4();
      const email = `${uuid}@serviceaccounts.local`;
      const serviceUser = await this._homeDb.getUserByLogin(email, {manager}, 'service');
      // TODO ideally create api key must be in the same transaction as getUserByLogin
      // Cause we wan't a full revert of both creation if on fails
      const apiKey = (await this._homeDb.createApiKey(serviceUser.id, false, manager)).apiKey;
      const securelabel: string = label ? label : "";
      const securedescription: string = description ? description : "";
      // End of life is set to now leading to a non functionning service service_account_id
      // if not provided;
      const endOfLifeString = endOfLife ?
        endOfLife.toISOString().split('T')[0] :
        new Date().toISOString().split('T')[0];
      // FIXME use manager.save(entité);
      await manager.createQueryBuilder()
        .insert()
        .into(ServiceAccount)
        .values({
          owner_id: ownerId,
          service_user_id: serviceUser.id,
          label: securelabel,
          description: securedescription,
          endOfLife: endOfLifeString,
        })
        .execute();
      return apiKey;
    });
  }

  public async readServiceAccount(
    serviceAccountId: number,
    ownerId: number,
  ){
    await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .andWhere("service_account_id = :serviceAccountId", {serviceAccountId})
        .execute();
    });
  }

  public async readAllServiceAccounts(
    ownerId: number,
  ){
    await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .select("*")
        .from(ServiceAccount, "service_accounts")
        .where("owner_id = :ownerId", {ownerId})
        .execute();
    });
  }

  public async updateServiceAccount(
    serviceAccountId: number,
    ownerId: number,
    partial?: any,
  ){
    // FIXME Verify partial content
    // only label, description, endOfLife can be updated
    await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .update(ServiceAccount)
        .set(partial)
        .where(
          "owner_id = :ownerId AND service_account_id = :serviceAccountId",
          {
            ownerId,
            serviceAccountId
          }
        )
        .execute();
    });
  }

  public async deleteServiceAccount(
    serviceAccountId: number,
    ownerId: number,
  ){
    await this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .delete()
        .from(ServiceAccount)
        .where(
          "owner_id = :ownerId AND service_account_id = :serviceAccountId",
          {
            ownerId,
            serviceAccountId
          }
        )
        .execute();
    });
  }

}
