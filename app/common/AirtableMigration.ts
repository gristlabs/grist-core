import {AirtableAPI} from 'app/common/AirtableAPI';

export class AirtableMigration {
  public static async run(api: AirtableAPI, base: string) {
    console.log(JSON.stringify(await api.getBaseSchema(base), null, 2));
  }
}

// Map fields onto Grist field types - map dependencies.
// Use dependencies to setup field order
// Map fields onto new user actions.
