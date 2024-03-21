# Disposal and Cleanup

Garbage-collected languages make you think that you don't need to worry about cleanup for your objects. In reality, there are still often cases when you do. This page gives some examples, and describes a library to simplify it.

## What's the problem

In the examples, we care about a situation when you have a JS object that is responsible for certain UI, i.e. DOM, listening to DOM changes to update state elsewhere, and listening to outside changes to update state to the DOM.

### DOM Elements
So this JS object knows how to create the DOM. Removing the DOM, when the component is to be removed, is usually easy: `parentNode.removeNode(child)`. Since it's a manual operation, you may define some method to do this, named perhaps "destroy" or "dispose" or "cleanup". 

If there is logic tied to your DOM either via JQuery events, or KnockoutJS bindings, you'll want to clean up the node specially: for JQuery, use `.remove()` or `.empty()` methods; for KnockoutJS, use `ko.removeNode()` or `ko.cleanNode()`. KnockoutJS's methods automatically call JQuery-related cleanup functions if JQuery is loaded in the page.

### Subscriptions and Computed Observables
But there is more. Consider this knockout code, adapted from their simplest example of a computed observable:

    function FullNameWidget(firstName, lastName) { 
      this.fullName = ko.computed(function() {
          return firstName() + " " + lastName();
      });
      ...
   }

Here we have a constructor for a component which takes two observables as constructor parameters, and creates a new observable which depends on the two inputs. Whenever `firstName` or `lastName` changes, `this.fullName` get recomputed. This makes it easy to create knockout-based bindings, e.g. to have a DOM element reflect the full name when either first or last name changes.

Now, what happens when this component is destroyed? It removes its associated DOM. Now when `firstName` or `lastName` change, there are no visible changes. But the function to recompute `this.fullName` still gets called, and still retains a reference to `this`, preventing the object from being garbage-collected.

The issue is that `this.fullName` is subscribed to `firstName` and `lastName` observables. It needs to be unsubscribed when the component is destroyed.

KnockoutJS recognizes it, and makes it easy: just call `this.firstName.dispose()`. We just have to remember to do it when we destroy the component.

This situation would exist without knockout too: the issue is that the component is listening to external changes to update the DOM that it is responsible for. When the component is gone, it should stop listening.

### Tying life of subscriptions to DOM
Since the situation above is so common in KnockoutJS, it offers some assistance. Specifically, when a computed observable is created using knockout's own binding syntax (by specifying a JS expression in an HTML attribute), knockout will clean it up automatically when the DOM node is removed using `ko.removeNode()` or `ko.cleanNode()`.

Knockout also allows to tie other cleanup to DOM node removal, documented at  [Custom disposal logic](http://knockoutjs.com/documentation/custom-bindings-disposal.html) page.

In the example above, you could use `ko.utils.domNodeDisposal.addDisposeCallback(node, function() { self.fullName.dispose(); })`, and when you destroy the component and remove the `node` via `ko.removeNode()` or `ko.cleanNode()`, the `fullName` observable will be properly disposed.

### Other knockout subscriptions
There are other situations with subscriptions. For example, we may want to subscribe to a `viewId` observable, and when it changes, replace the currently-rendered View component. This might look like so

     function GristDoc() {
        this.viewId = ko.observable();
        this.viewId.subscribe(function(viewId) {
           this.loadView(viewId);
        }, this);
    }

Once GristDoc is destroyed, the subscription to `this.viewId` still exists, so `this.viewId` retains a reference to `this` (for calling the callback). Technically, there is no problem: as long as there are no references to `this.viewId` from outside this object, the whole cycle should be garbage-collected.

But it's very risky: if anything else has a reference to `this.viewId` (e.g. if `this.viewId` is itself subscribed to, say, `window.history` changes), then the entire `GristDoc` is unavailable to garbage-collection, including all the DOM to which it probably retains references even after that DOM is detached from the page.

Beside the memory leak, it means that when `this.viewId` changes, it will continue calling `this.loadView()`, continuing to update DOM that no one will ever see. Over time, that would of course slow down the browser, but would be hard to detect and debug.

Again, KnockoutJS offers a way to unsubscribe: `.subscribe()` returns a `ko.subscription` object, which in turn has a `dispose()` method. We just need to call it, and the callback will be unsubscribed.

### Backbone Events

To be clear, the problem isn't with Knockout, it's with the idea of subscribing to outside events. Backbone allows listening to events, which creates the same problem, and Backbone offers a similar solution.

For example, let's say you have a component that listens to an outside event and does stuff. With a made-up example, you might have a constructor like:

    function Game(basket) {
       basket.on('points:scored', function(team, points) {
           // Update UI to show updated points for the team.
       });
    }

Let's say that a `Game` object is destroyed, and a new one created, but the `basket` persists across Games. As the user continues to score points on the basket, the old (supposedly destroyed) Game object continues to have that inline callback called. It may not be showing anything, but only because the DOM it's updating is no longer attached to the page. It's still taking resources, and may even continue to send stuff to the server.

We need to clean up when we destroy the Game object. In this example, it's pretty annoying. We'd have to save the `basket` object and callback in member variables (like `this.basket`, `this.callback`), so that in the cleanup method, we could call `this.basket.off('points:scored', this.callback)`.

Many people have gotten bitten with that in Backbone (see this [stackoverflow post](http://stackoverflow.com/questions/14041042/backbone-0-9-9-difference-between-listento-and-on)) with a bunch of links to blog posts about it).

Backbone's solution is `listenTo()` method. You'd use it like so:

    function Game(basket) {
       this.listenTo(basket, 'points:scored', function(team, points) {
           // Update UI to show updated points for the team.
       });
    }

Then when you destroy the Game object, you only have to call `this.stopListening()`. It keeps track of what you listened to, and unsubscribes. You just have to remember to call it. (Certain objects in Backbone will call `stopListening()` automatically when they are being cleaned up.)

### Internal events

If a component listens to an event on a DOM element it itself owns, and if it's using JQuery, then we don't need to do anything special. If on destruction of the component, we clean up the DOM element using `ko.removeNode()`, the JQuery event bindings should automatically be removed. (This hasn't been rigorously verified, but if correct, is a reason to use JQuery for browser events rather than native `addEventListener`.)


## How to do cleanup uniformly

Since we need to destroy the components' DOM explicitly, the components should provide a method to call for that. By analogy with KnockoutJS, let's call it `dispose()`.

- We know that it needs to remove the DOM that the component is responsible for, probably using `ko.removeNode`.
- If the component used Backbone's `listenTo()`, it should call `stopListening()` to unsubscribe from Backbone events.
- If the component maintains any knockout subscriptions or computed observables, it should call `.dispose()` on them.
- If the component owns other components, then those should be cleaned up recursively, by calling `.dispose()` on those.

The trick is how to make it easy to remember to do all necessary cleanup. I propose keeping track when the object to clean up first enters the picture. 

## 'Disposable' class

The idea is to have a class that can be mixed into (or inherited by) any object, and whose purpose is to keep track of things this object "owns", that it should be responsible for cleaning up. To combine the examples above:

   function Component(firstName, lastName, basket) {
      this.fullName = this.autoDispose(ko.computed(function() {
          return firstName() + " " + lastName();
      }));

      this.viewId = ko.observable();
      this.autoDispose(this.viewId.subscribe(function(viewId) {
         this.loadView(viewId);
      }, this));

      this.ourDom = this.autoDispose(somewhere.appendChild(some_dom_we_create));

      this.listenTo(basket, 'points:scored', function(team, points) {
         // Update UI to show updated points for the team.
      });
   }

Note the `this.autoDispose()` calls. They mark the argument as being owned by `this`. When `this.dispose()` is called, those values get disposed of as well.

The disposal itself is fairly straightforward: if the object has a `dispose` method, we'll call that. If it's a DOM node, we'll call `ko.removeNode` on it. The `dispose()` method of Disposable objects will always call `this.stopListening()` if such a method exists, so that subscriptions using Backbone's `listenTo` are cleaned up automatically.

To do additional cleanup when `dispose()` is called, the derived class can override `dispose()`, do its other cleanup, then call `Disposable.prototype.dispose.call(this)`.

For convenience, Disposable class provides a few other methods:

- `disposeRelease(part)`: releases an owned object, so that it doesn't get auto-disposed.
- `disposeDiscard(part)`: disposes of an owned object early (rather than wait for `this.dispose`).
- `isDisposed()`: returns whether `this.dispose()` has already been called.

### Destroying destroyed objects

There is one more  thing that Disposable class's `dispose()` method will do: destroy the object, as in ruin, wreck, wipe out. Specifically, it will go through all properties of `this`, and set each to a junk value. This achieves two goals:

1. In any of the examples above, if you forgot to mark anything with `this.autoDispose()`, and some callback continues to be called after the object has been destroyed, you'll get errors. Not just silent waste of resources that slow down the site and are hard to detect.

2. It removes references, potentially breaking references. Imagine that something wrongly retains a reference to a destroyed object (which logically nothing should, but something might by mistake). If it tries to use the object, it will fail (see point 1). But even if it doesn't access the object, it's preventing the garbage collector from cleaning any of the object. If we break references, then in this situation the GC can still collect all the properties of the destroyed object.

## Conclusion

All JS client-side components that need cleanup (e.g. maintain DOM, observables, listen to events, or subscribe to anything), should inherit from `Disposable`. To destroy them, call their `.dispose()` method. Whenever they take responsibility for any piece that requires cleanup, they should wrap that piece in `this.autoDispose()`.

This should go a long way towards avoiding leaks and slowdowns.
