import {ShareInfo} from 'app/common/ActiveDocAPI';
import {Share} from "app/gen-server/entity/Share";
import {makeId} from 'app/server/lib/idUtils';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';

export class SharesManager {

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
  ) {}

  public async syncShares(docId: string, shares: ShareInfo[]) {
    return this._connection.transaction(async manager => {
      for (const share of shares) {
        const key = makeId();
        await manager.createQueryBuilder()
          .insert()
        // if urlId has been used before, update it
          .onConflict(`(doc_id, link_id) DO UPDATE SET options = :options`)
          .setParameter('options', share.options)
          .into(Share)
          .values({
            linkId: share.linkId,
            docId,
            options: JSON.parse(share.options),
            key,
          })
          .execute();
      }
      const dbShares = await manager.createQueryBuilder()
        .select('shares')
        .from(Share, 'shares')
        .where('doc_id = :docId', {docId})
        .getMany();
      const activeLinkIds = new Set(shares.map(share => share.linkId));
      const oldShares = dbShares.filter(share => !activeLinkIds.has(share.linkId));
      if (oldShares.length > 0) {
        await manager.createQueryBuilder()
          .delete()
          .from('shares')
          .whereInIds(oldShares.map(share => share.id))
          .execute();
      }
    });
  }

  public async getShareByKey(key: string) {
    return this._connection.createQueryBuilder()
      .select('shares')
      .from(Share, 'shares')
      .where('shares.key = :key', {key})
      .getOne();
  }

  public async getShareByLinkId(docId: string, linkId: string) {
    return this._connection.createQueryBuilder()
      .select('shares')
      .from(Share, 'shares')
      .where('shares.doc_id = :docId', {docId})
      .andWhere('shares.link_id = :linkId', {linkId})
      .getOne();
  }

  public getDocApiKeyByLinkId(docId: string, linkId: string): Promise<Share | null> {
    return this.getShareByLinkId(docId, linkId);
  }

  public getDocApiKeyByKey(key: string): Promise<Share | null> {
    return this.getShareByKey(key);
  }

  public async createDocApiKey(docId: string, share: ShareInfo) {
    const key = makeId();
    const query = await this._connection.createQueryBuilder()
      .insert()
      .setParameter('options', share.options)
      .into(Share)
      .values({
        linkId: share.linkId,
        docId: docId,
        options: JSON.parse(share.options),
        key,
      })
      .execute() || undefined;
    return query ? key : query;
  }

  public async updateDocApiKeyByLinkId(docId: string, linkId: string, share: ShareInfo) {
    return await this._connection.createQueryBuilder()
      .update(Share)
      .set(share)
      .where('doc_id = :docId and link_id = :linkId', {docId, linkId})
      .execute() || undefined;
  }

  public async updateDocApiKeyByKey(docId: string, apiKey: string, share: ShareInfo) {
    return await this._connection.createQueryBuilder()
      .update(Share)
      .set(share)
      .where('doc_id = :docId and key = :apiKey', {docId, apiKey})
      .execute() || undefined;
  }

  public async deleteDocApiKeyByKey(docId: string, apiKey: string) {
    return await this._connection.createQueryBuilder()
      .delete()
      .from('shares')
      .where('doc_id = :docId and key = :apiKey', {docId, apiKey})
      .execute() || undefined;
  }

  public async getDocApiKeys(docId: string): Promise<Share[] | undefined> {
    return await this._connection.createQueryBuilder()
      .select('shares')
      .from(Share, 'shares')
      .where('doc_id = :docId', {docId})
      .getMany() || undefined;
  }

  public async deleteDocApiKeyByLinkId(docId: string, linkId: string) {
    return await this._connection.createQueryBuilder()
      .delete()
      .from('shares')
      .where('doc_id = :docId and link_id = :linkId', {docId, linkId})
      .execute() || undefined;
  }

  public async deleteDocApiKeys(docId: string) {
    return await this._connection.createQueryBuilder()
      .delete()
      .from('shares')
      .where('doc_id = :docId', {docId})
      .execute() || undefined;
  }
}
