/**
 * Returns the Google Tag Manager snippet to insert into <head> of the page, if
 * `tagId` is set to a non-empty value. Otherwise returns an empty string.
 */
export function getTagManagerSnippet(tagId?: string) {
  // Note also that we only insert the snippet for the <head>. The second recommended part (for
  // <body>) is for <noscript> scenario, which doesn't apply to the Grist app (such visits, if
  // any, wouldn't work and shouldn't be counted for any metrics we care about).
  if (!tagId) { return ""; }

  return `
<!-- Google Tag Manager -->
<script>${getTagManagerScript(tagId)}</script>
<!-- End Google Tag Manager -->
`;
}

/**
 * Returns the body of the Google Tag Manager script. This is suitable for use by the client,
 * since it must dynamically load it by calling `document.createElement('script')` and setting
 * its `innerHTML`.
 */
export function getTagManagerScript(tagId: string) {
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${tagId}');`;
}
