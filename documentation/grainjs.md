# GrainJS & Grist Front-End Libraries

In the beginning of working on Grist, we chose to build DOM using pure Javascript, and used Knockout.js to tie DOM elements and properties to variables, called “observables”. This allowed us to describe the DOM structure in one place, using JS, and to keep the dynamic aspects of it separated into observables. These observables served as the model of the UI; other code could update these observables to cause UI to update, without knowing the details of the DOM construction.

Over time, we used the lessons we learned to make a new library implementing these same ideas, which we called GrainJS. It is open-source, written in TypeScript, and available at https://github.com/gristlabs/grainjs.

## [GrainJS documentation](https://github.com/gristlabs/grainjs#documentation)

GrainJS documentation is available at https://github.com/gristlabs/grainjs#documentation. It’s the best place to start, since most Grist code is now based on GrainJS, and new code should be written using it too.

## Older Grist Code

Before GrainJS, Grist code was based on a combination of Knockout and custom dom-building building functions.

### Knockout Observables

You can find full documentation of knockout at https://knockoutjs.com/documentation/introduction.html, but you shouldn’t need it. If you’ve read GrainJS documentation, here are the main differences.

Creating and using observables:

```
import * as ko from 'knockout';

const kObs = ko.observable(17);
kObs();      // Returns 17
kObs(8);
kObs();      // Returns 8
kObs.peek(); // Returns 8
```

```
import {Computed, Observable} from 'grainjs';

const gObs = Observable.create(null, 17)
gObs.get();     // Returns 17
gObs.set(8);

gObs.get();     // Returns 8
```

Creating and using computed observables

```
ko.computed(() => kObs() * 10);
```

```
Computed.create(null, use => use(gObs) * 10);
```

Note that in Knockout, the dependency on `kObs()` is created implicitly — because `kObs()` was called in the context of the computed's callback. In case of GrainJS, the dependency is created because the `gObs` observable was examined using the callback's `use()` function.

In Knockout, the `.peek()` method allows looking at an observable’s value quickly without any potential dependency-creation. So technically, `kObs.peek()` is what’s equivalent to `gObs.get()`.

### Building DOM

Older Grist code builds DOM using the `dom()` function defined in `app/client/lib/dom.js`. It is entirely analogous to [dom() in GrainJS](https://github.com/gristlabs/grainjs/blob/master/docs/basics.md#dom-construction).

The method `dom.on('click', (ev) => { ... })` allows attaching an event listener during DOM construction. It is similar to the same-named method in GrainJS ([dom.on](https://github.com/gristlabs/grainjs/blob/master/docs/basics.md#dom-events)), but is implemented actually using JQuery.

Methods `dom.onDispose`, and `dom.autoDispose` are analogous to GrainJS, but rely on Knockout’s cleanup.

For DOM bindings, which allow tying DOM properties to observable values, there is a `app/client/lib/koDom.js` module. For example:

```
import * as dom from 'app/client/lib/dom';
import * as kd from 'app/client/lib/koDom';

dom(
  'div',
  kd.toggleClass('active', isActiveObs),
  kd.text(() => vm.nameObs().toUpperCase()),
)
```

Note that `koDom` methods work only with Knockout observables. Most dom-methods are very similar to GrainJS, but there are a few differences.

In place of GrainJS’s `dom.cls`, older code uses `kd.toggleClass` to toggle a constant class name, and `kd.cssClass` to set a class named by an observable value.

What GrainJS calls `dom.domComputed`, is called `kd.scope` in older code; and `dom.forEach` is called `kd.foreach` (all lowercase).

Observable arrays, primarily needed for `kd.foreach`, are implemented in `app/client/lib/koArray.js`. There is an assortment of tools around them, not particularly well organized.

### Old Disposables

We had to dispose resources before GrainJS, and the tools to simplify that live in `app/client/lib/dispose.js`. In particular, it provides a `Disposable` class, with a similar `this.autoDispose()` method to that of GrainJS.

What GrainJS calls `this.onDispose()`, is called `this.autoDisposeCallback()` in older code.

The older `Disposable` class also provides a static `create()` method, but that one does NOT take an `owner` callback as the first argument, as it pre-dates that idea. This makes it quite annoying to use side-by-side classes that extend older or newer `Disposable`.

### Saving Observables

The module `app/client/models/modelUtil.js` provides some very Grist-specific tools that doesn’t exist in GrainJS at all. In particular, it allows extending observables (regular or computed) with something it calls a “save interface”: `addSaveInterface(observable, saveFunc)` adds to an observable methods:

* `.saveOnly(value)` — calls `saveFunc(value)`.
* `.save()` — calls `saveFunc(obs.peek())`.
* `.setAndSave(value)` — calls `obs(value); saveFunc(value)`.

These are used in practice for observables created that represent pieces of data in a Grist document, such as metadata values or cells in user tables, and in these cases `saveFunc` is arranged to send a UserAction to Grist to update the stored value in the document.

This should help you understand what you see, and you may use it in new code if it uses existing old-style “saveable” observables. But in new code, there is no reason to package up this functionality with an observable. For example, if some UI component allows changing a value, have it accept a callback to call with the new value. Depending on what you need, this callback could set an observable, or it could send an action to the server.

### DocModel

The metadata of a Grist document, which drives the UI of the Grist application, is organized into a `DocModel`, which contains tables, each table with rows, and each row with a set of observables for each field:

* `DocModel` — in `app/client/models/DocModel`
* `MetaTableModel` — in `app/client/models/MetaTableModel` (for metadata tables, which Grist frontend understands and uses)
    * `MetaRowModel` — in `app/client/models/MetaRowModel`. These have particular typed fields, and are enhanced with helpful computeds, according to the table to which they belong to, using classes in `app/client/models/entities`.
* `DataTableModel` — in `app/client/models/DataTableModel` (for user-data tables, which Grist can only treat generically)
    * `DataRowModel` — in `app/client/models/DataRowModel`.
* `BaseRowModel` — base class for `MetaRowModel` and `DataRowModel`.

A RowModel contains an observable for each field. While there is old-style code that uses these observables, they all remain knockout observables.

Note that new code can use these knockout observables fairly seemlessly. For instance, a knockout observable can be used with GrainJS dom-methods, or as a dependency of a GrainJS computed.

Eventually, it would be nice to convert old-style code to use the newer libraries (and convert to TypeScript in the process), and to drop the need for old-style code entirely.
