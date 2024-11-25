import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
//import { UsersManager } from 'app/gen-server/lib/homedb/UsersManager';
import { EntityManager } from 'typeorm';
import { User } from 'app/gen-server/entity/User';
import {v4 as uuidv4} from 'uuid';
//import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';

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
    description?: string,
    endOfLife?: Date,
  ){
    await this._connection.transaction(async manager => {
      //TODO create new service user in order to have its
      //id to insert
      const uuid = uuidv4();
      const email = `${uuid}@serviceaccounts.local`;
      const serviceUser = await this._homeDb.getUserByLogin(email);
      // FIXME use manager.save(entité);
      return await manager.createQueryBuilder()
        .insert()
        .into('service_accounts')
        .values({
          ownerId,
          serviceUserId: serviceUser.id,
          description,
          endOfLife,
        })
        .execute();
    });
  }
}
