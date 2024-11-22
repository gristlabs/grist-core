import { ConfigsAPI } from "app/client/ui/ConfigsAPI";
import {
  AuditLogStreamingDestination,
  AuditLogStreamingDestinations,
} from "app/common/Config";
import { Disposable, Observable } from "grainjs";
import omit from "lodash/omit";
import { v4 as uuidv4 } from "uuid";

export interface AuditLogsModel {
  readonly streamingDestinations: Observable<AuditLogStreamingDestinations | null>;
  fetchStreamingDestinations(): Promise<void>;
  createStreamingDestination(
    properties: Omit<AuditLogStreamingDestination, "id">
  ): Promise<void>;
  updateStreamingDestination(
    id: AuditLogStreamingDestination["id"],
    properties: Partial<Omit<AuditLogStreamingDestination, "id">>
  ): Promise<void>;
  deleteStreamingDestination(
    id: AuditLogStreamingDestination["id"]
  ): Promise<void>;
}

export interface AuditLogsModelOptions {
  configsAPI: ConfigsAPI;
}

export class AuditLogsModel extends Disposable implements AuditLogsModel {
  public readonly streamingDestinations: Observable<AuditLogStreamingDestinations | null> =
    Observable.create(this, null);
  private readonly _configsAPI = this._options.configsAPI;

  constructor(private _options: AuditLogsModelOptions) {
    super();
  }

  public async fetchStreamingDestinations(): Promise<void> {
    this.streamingDestinations.set(null);
    try {
      const { value } = await this._configsAPI.getConfig(
        "audit_log_streaming_destinations"
      );
      if (this.isDisposed()) {
        return;
      }

      this.streamingDestinations.set(value);
    } catch (e) {
      if (e.status === 404) {
        this.streamingDestinations.set([]);
      } else {
        throw e;
      }
    }
  }

  public async createStreamingDestination(
    properties: Omit<AuditLogStreamingDestination, "id">
  ): Promise<void> {
    const destinations = this.streamingDestinations.get() ?? [];
    const newDestinations = [
      ...destinations,
      {
        ...properties,
        id: uuidv4(),
      },
    ];
    await this._updateStreamingDestinations(newDestinations);
  }

  public async updateStreamingDestination(
    id: AuditLogStreamingDestination["id"],
    properties: Partial<Omit<AuditLogStreamingDestination, "id">>
  ): Promise<void> {
    const destinations = this.streamingDestinations.get() ?? [];
    const index = destinations.findIndex((d) => d.id === id);
    if (index === -1) {
      throw new Error("streaming destination not found");
    }

    const newDestinations = [
      ...destinations.slice(0, index),
      {
        ...destinations[index],
        ...omit(properties, "id"),
      },
      ...destinations.slice(index + 1),
    ];
    await this._updateStreamingDestinations(newDestinations);
  }

  public async deleteStreamingDestination(
    id: AuditLogStreamingDestination["id"]
  ): Promise<void> {
    const destinations = this.streamingDestinations.get() ?? [];
    const newDestinations = destinations.filter((d) => d.id !== id);
    await this._updateStreamingDestinations(newDestinations);
  }

  private async _updateStreamingDestinations(
    destinations: AuditLogStreamingDestinations
  ): Promise<void> {
    const { value } = await this._configsAPI.updateConfig(
      "audit_log_streaming_destinations",
      destinations
    );
    if (this.isDisposed()) {
      return;
    }

    this.streamingDestinations.set(value);
  }
}
