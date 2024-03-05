Document URLs
-----------------

Status: WIP

Options
 * An id (e.g. google)
 * Several ids (e.g. airtable)
 * A text name
 * Several text names (e.g. github)
 * An id and friendly name (e.g. dropbox)

Leaning towards an id and friendly name.  Only id is interpreted by router.  Name is checked only to make sure it matches current name of document.  If not, we redirect to revised url before proceeding.

Length of ids depends on whether we'll be using them for obscurity to enable anyone-who-has-link-can-view style security.

Possible URLs
---------------

 * docs.getgrist.com/viwpHfmtMHmKBUSyh/Document+Name
 * orgname.getgrist.com/viwpHfmtMHmKBUSyh/Document+Name
 * getgrist.com/d/viwpHfmtMHmKBUSyh/Document+Name
 * getgrist.com/d/tblWVZDtvlsIFsuOR/viwpHfmtMHmKBUSyh/Document+Name
 * getgrist.com/d/dd5bf494e709246c7601e27722e3aee656b900082c3f5f1598ae1475c35c2c4b/Document+Name
 * getgrist.com/doc/fTSIMrZT3fDTvW7XDBq1b7nhWa24Zl55EVpsaO3TBBE/Document%20Name

Organization subdomains
------------------------------
Organizations get to choose a subdomain, and will access their workspaces and documents at `orgname.getgrist.com`. In addition, personal workspaces need to be uniquely determined by a URL, using `docs-` followed by the numeric id of the "personal organization":

* docs-1234.getgrist.com/
* docs.getgrist.com/o/docs-1234/

Since subdomains need to play along with all the other subdomains we use for getgrist.com, the following is a list of names that may NOT be used by any organization:

* `docs-\d+` to identify personal workspaces
* Anything that starts with underscore (`_`) (this includes special subdomains like `_domainkey`)
* Subdomains used by us for various purposes. As of 2018-10-09, these include:
  * aws
  * gristlogin
  * issues 
  * metrics
  * phab
  * releases
  * test
  * vpn
  * www

Some more reserved subdomains:
 * doc-worker-NN
 * v1-* (this could be released eventually, but currently in our code and/or routing "v1-mock", "v1-docs", "v1-static", and any other "v1-*" are special
 * docs
 * api
