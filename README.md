# Grist

Grist is a modern relational spreadsheet. It combines the flexibility of a spreadsheet with the
robustness of a database to organize your data and make you more productive.

https://user-images.githubusercontent.com/118367/151245587-892e50a6-41f5-4b74-9786-fe3566f6b1fb.mp4

## Features

(By popular request: we have a specific write-up of [Grist vs Airtable](https://www.getgrist.com/blog/grist-v-airtable/) that may be helpful).
Grist is a hybrid database/spreadsheet, meaning that:

  - Columns work like they do in databases. They are named, and hold one kind of data.
  - Columns can be filled by formula, spreadsheet-style, with automatic updates when referenced cells change.

Here are some specific feature highlights of Grist:

  * Python formulas.
    - Full [Python syntax is supported](https://support.getgrist.com/formulas/#python), and the standard library.
    - Many [Excel functions](https://support.getgrist.com/functions/) also available.
  * A portable, self-contained format.
    - Based on SQLite, the most widely deployed database engine.
    - Any tool that can read SQLite can read numeric and text data from a Grist file.
    - Great format for [backups](https://support.getgrist.com/exports/#backing-up-an-entire-document) that you can be confident you can restore in full.
    - Great format for moving between different hosts.
  * Convenient editing and formatting features.
    - Choices and [choice lists](https://support.getgrist.com/col-types/#choice-list-columns), for adding colorful tags to records without fuss.
    - [References](https://support.getgrist.com/col-refs/#creating-a-new-reference-list-column) and reference lists, for cross-referencing records in other tables.
    - [Attachments](https://support.getgrist.com/col-types/#attachment-columns), to include media or document files in records.
    - Dates and times, toggles, and special numerics such as currency all have specialized editors and formatting options.
  * Great for dashboards, visualizations, and data entry.
    - [Charts](https://support.getgrist.com/widget-chart/) for visualization.
    - [Summary tables](https://support.getgrist.com/summary-tables/) for summing and counting across groups.
    - [Widget linking](https://support.getgrist.com/linking-widgets/) streamlines filtering and editing data.
    Grist has a unique approach to visualization, where you can lay out and link distinct widgets to show together,
    without cramming mixed material into a table.
    - The [Filter bar](https://support.getgrist.com/search-sort-filter/#filter-buttons) is great for quick slicing and dicing.
  * [Incremental imports](https://support.getgrist.com/imports/#updating-existing-records).
    - So you can import a CSV of the last three months activity from your bank...
    - ... and import new activity a month later without fuss or duplicates.
  * Integrations.
    - A [REST API](https://support.getgrist.com/api/), [Zapier actions/triggers](https://support.getgrist.com/integrators/#integrations-via-zapier), and support from similar [integrators](https://support.getgrist.com/integrators/).
    - Import/export to Google drive, Excel format, CSV.
    - Can link data with custom widgets hosted externally.
  * [Many templates](https://templates.getgrist.com/) to get you started, from investment research to organizing treasure hunts.
  * Access control options.
    - (You'll need SSO logins set up to make use of these options)
    - Share [individual documents](https://support.getgrist.com/sharing/), or workspaces, or [team sites](https://support.getgrist.com/team-sharing/).
    - Control access to [individual rows, columns, and tables](https://support.getgrist.com/access-rules/).
    - Control access based on cell values and user attributes.
  * Can be self-maintained.
    - Useful for intranet operation and specific compliance requirements.

If you are curious about where Grist is going heading,
see [our roadmap](https://github.com/gristlabs/grist-core/projects/1), drop a
question in [our forum](https://community.getgrist.com),
or browse [our extensive documentation](https://support.getgrist.com).

## Using Grist

There are docker images set up for individual use, or (with some
configuration) for self-hosting. Grist Labs offers a hosted service
at [https://docs.getgrist.com](docs.getgrist.com).

To run Grist running on your computer with [Docker](https://www.docker.com/get-started), do:

```sh
docker pull gristlabs/grist
docker run -p 8484:8484 -it gristlabs/grist
```

Then visit `http://localhost:8484` in your browser. You'll be able to create, edit, import,
and export documents. To preserve your work across docker runs, share a directory as `/persist`:

```sh
docker run -p 8484:8484 -v $PWD/persist:/persist -it gristlabs/grist
```

Get templates at https://templates.getgrist.com/ for payroll,
inventory management, invoicing, D&D encounter tracking, and a lot
more, or use any document you've created on
[https://docs.getgrist.com](docs.getgrist.com).

If you need to change the port Grist runs on, set a `PORT` variable, don't just change the
port mapping:

```
docker run --env PORT=9999 -p 9999:9999 -v $PWD/persist:/persist -it gristlabs/grist
```

## Building from source

To build Grist from source, follow these steps:

    yarn install
    yarn run build:prod
    yarn run install:python
    yarn start
    # Grist will be available at http://localhost:8484/

## Logins

Like git, Grist has features to track document revision history. So for full operation,
Grist expects to know who the user modifying a document is. Until it does, it operates
in a limited anonymous mode. To get you going, the docker image is configured so that
when you click on the "sign in" button Grist will attribute your work to `you@example.com`.
Change this by setting `GRIST_DEFAULT_EMAIL`:

```
docker run --env GRIST_DEFAULT_EMAIL=my@email -p 8484:8484 -v $PWD/persist:/persist -it gristlabs/grist
```

You can change your name in `Profile Settings` in
the [User Menu](https://support.getgrist.com/glossary/#user-menu).
For multi-user operation, and/or if you wish to access Grist across the
public internet, you'll want to connect it to your own single sign-in service
[SAML](https://github.com/gristlabs/grist-core/blob/main/app/server/lib/SamlConfig.ts).
Grist has been tested with [Authentik](https://goauthentik.io/) and [Auth0](https://auth0.com/).

## Why free and open source software

This repository, [grist-core](https://github.com/gristlabs/grist-core), is maintained by Grist
Labs. Our flagship product available at [getgrist.com](https://www.getgrist.com) is built from the code you see
here, combined with business-specific software designed to scale it to many users, handle billing,
etc.

Grist Labs is an open-core company. We offer Grist hosting as a
service, with free and paid plans. We intend to also develop and sell
features related to Grist using a proprietary license, targeted at the
needs of enterprises with large self-managed installations. We see
data portability and autonomy as a key value Grist can bring to our
users, and `grist-core` as an essential means to deliver that. We are
committed to maintaining and improving the `grist-core` codebase, and
to be thoughtful about how proprietary offerings impact data portability
and autonomy.

By opening its source code and offering an [OSI](https://opensource.org/)-approved free license,
Grist benefits its users:

- **Developer community.** The freedom to examine source code, make bug fixes, and develop
  new features is a big deal for a general-purpose spreadsheet-like product, where there is a
  very long tail of features vital to someone somewhere.
- **Increased trust.** Because anyone can examine the source code, &ldquo;security by obscurity&rdquo; is not
  an option. Vulnerabilities in the code can be found by others and reported before they cause
  damage.
- **Independence.** Grist is available to you regardless of the fortunes of the Grist Labs business,
  since it is open source and can be self-hosted. Using our hosted solution is convenient, but you
  are not locked in.
- **Price flexibility.** If you are low on funds but have time to invest, self-hosting is a great
  option to have. And DIY users may have the technical savvy and motivation to delve in and make improvements,
  which can benefit all users of Grist.
- **Extensibility.** For developers, having the source open makes it easier to build extensions (such as the
  experimental [Custom Widget](https://support.getgrist.com/widget-custom/)). You can more easily
  include Grist in your pipeline. And if a feature is missing, you can just take the source code and
  build on top of it.

## Reviews

 * [Grist on ProductHunt](https://www.producthunt.com/posts/grist-2)
 * [Grist on AppSumo](https://appsumo.com/products/grist/) (life-time deal is sold out)
 * [Capterra](https://www.capterra.com/p/232821/Grist/#reviews), [G2](https://www.g2.com/products/grist/reviews), [TrustRadius](https://www.trustradius.com/products/grist/reviews)

## License

This repository, `grist-core`, is released under the [Apache License, Version
2.0](http://www.apache.org/licenses/LICENSE-2.0), which is an
[OSI](https://opensource.org/)-approved free software license. See LICENSE.txt and NOTICE.txt for
more information.
