/**
 * A base class which combines grainjs Disposable with mixed-in backbone Events. It includes the
 * backbone Events methods, and when disposed, stops backbone listeners started with listenTo().
 */
import {Events as BackboneEvents, EventsHash} from 'backbone';
import {Disposable} from 'grainjs';

// In Typescript, mixins are awkward. This follows the recommendation here
// https://www.typescriptlang.org/docs/handbook/mixins.html
export class DisposableWithEvents extends Disposable implements BackboneEvents {
  public on: (eventName: string|EventsHash, callback?: (...args: any[]) => void, context?: any) => any;
  public off: (eventName?: string, callback?: (...args: any[]) => void, context?: any) => any;
  public trigger: (eventName: string, ...args: any[]) => any;
  public bind: (eventName: string, callback: (...args: any[]) => void, context?: any) => any;
  public unbind: (eventName?: string, callback?: (...args: any[]) => void, context?: any) => any;

  public once: (events: string, callback: (...args: any[]) => void, context?: any) => any;
  public listenTo: (object: any, events: string, callback: (...args: any[]) => void) => any;
  public listenToOnce: (object: any, events: string, callback: (...args: any[]) => void) => any;
  public stopListening: (object?: any, events?: string, callback?: (...args: any[]) => void) => any;

  // DisposableWithEvents knows also how to stop any backbone listeners started with listenTo().
  constructor() {
    super();
    this.onDispose(this.stopListening, this);
  }
}
Object.assign(DisposableWithEvents.prototype, BackboneEvents);
