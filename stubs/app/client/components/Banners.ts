/* Functions that build UI banners for displaying at the top of various pages. These
 * currently include activation, site usage, and document usage banners.
 *
 * The current approach assumes that at most 1 banner will be shown on a given page;
 * banners that have higher priority appear earlier in the chain. This works today, as
 * there are only a small set of banners to show (without much overlap), but won't scale
 * well as more banners and banner types are added.
 *
 * A better approach might be to do something similar to notifications, where there's a
 * global instance of a class that's responsible for managing all banner messages. The
 * UI can then call a method for showing a particular banner with a given set of options.
 * Unlike notifications, banners typically aren't transient, so we'd need to decide how to
 * handle showing 2 (or more) banner messages at a time.
 *
 * With current implementation, both view-as and doc-usage banners can show at the same time.
 */

export { buildHomeBanners, buildDocumentBanners } from "app/client/components/CoreBanners";
