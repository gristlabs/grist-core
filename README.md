# Grist

Grist is a modern relational spreadsheet. It combine the flexibility of a spreadsheet with the
robustness of a database to organize your data and make you more productive.

> :warning: This repository is in a pre-release state. Its release will be announced when it has
all the planned components, and a solid independent build and test set-up. Currently, stand-alone
server functionality is present. Release of our web client is planned, along with an extensive
test suite.

This repository, [grist-core](https://github.com/gristlabs/grist-core), is maintained by Grist
Labs. Our flagship product, available at https://www.getgrist.com, is built from the code you see
here, combined with business-specific software designed to scale it to many users, handle billing,
etc.

## Why Open Source?

By opening its source code and offering an [OSI](https://opensource.org/)-approved free license,
Grist benefits its users:

- **Open Source Community.** An active community is the main draw of open-source projects. Anyone
  can examine source code, and contribute bug fixes or even new features. This is a big deal for a
  general-purpose spreadsheet-like product, where there is a long tail of features vital to
  someone somewhere.
- **Increased Trust.** Because anyone can examine the source code, “security by obscurity” is not
  an option. Vulnerabilities in the code can be found by others and reported before they can cause
  damage.
- **Independence.** The published source code—and the product built from it—are available to you
  regardless of the fortunes of the Grist Labs business. Whatever happens to us, this repo or its
  forks can live on, so that you can continue to work on your data in Grist.
- **Price Flexibility.** You can build Grist from source and use it for yourself all you want
  without paying us a cent. While you can’t go wrong with our fully set-up and supported online
  service, some organizations may choose the do-it-yourself route and pay for their own server and
  maintenance, rather than a per-user price. DIY users are often the ones to develop new features,
  and can contribute them back to benefit all users of Grist.
- **Extensibility.** For developers, having the source open makes it easier to build extensions (such as the
  experimental [Custom Widget](https://support.getgrist.com/widget-custom/)). You can more easily
  include Grist in your pipeline. And if a feature is missing, you can just take the source code and
  build on top of it!

## How do I start?

For building from source, you can start with this:

    npm install
    npm run build:prod
    npm run install:python
    GRIST_DEFAULT_EMAIL=you@example.com npm start
    # unauthenticated grist api available at http://localhost:8484/api/

Stay tuned for more instructions to come at release.

For using pre-built Grist, just head on over to <https://www.getgrist.com>.
