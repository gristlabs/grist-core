import {
  BadgeVariant,
  buildCardList,
  buildHeroCard,
  HeroVariant,
  ItemBorderVariant,
  buildItemCard,
} from "app/client/ui/SetupCard";

import { basicButton, textButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";

import { action } from "@storybook/addon-actions";
import { dom, Observable, styled } from "grainjs";

export default {
  title: "Setup / SetupCard",
};

// ---------------------------------------------------------------------------
// HeroCard
// ---------------------------------------------------------------------------

export const HeroCardStory = {
  args: {
    indicator: "success",
    header: "OIDC",
    tag: "",
    badgeLabel: "Active",
    badgeVariant: "primary",
    text: "Your server is configured to authenticate users via OpenID Connect.",
    error: "",
    showCheckbox: false,
    checkboxLabel: "I understand this server has no authentication",
    showButtons: true,
    button1Label: "Reconfigure",
    button2Label: "Deactivate",
    footerText: "Installation admin: ",
    footerBoldText: "admin@example.com",
    footerActionLabel: "Change installation admin",
  },
  argTypes: {
    indicator: {
      control: "select",
      options: ["success", "pending", "warning", "error"],
    },
    badgeVariant: {
      control: "select",
      options: ["primary", "warning", "error", "accent"],
    },
  },
  render: (args: any) => {
    const checked = Observable.create(null, false);
    return buildHeroCard( {
      indicator: args.indicator as HeroVariant,
      header: args.header,
      tags: args.tag ? [{ label: args.tag }] : [],
      badges: args.badgeLabel
        ? [{ label: args.badgeLabel, variant: args.badgeVariant as BadgeVariant }]
        : [],
      text: args.text || undefined,
      error: args.error || undefined,
      checkbox: args.showCheckbox
        ? labeledSquareCheckbox(checked, args.checkboxLabel)
        : undefined,
      buttons: args.showButtons
        ? [
            basicButton(args.button1Label, dom.on("click", action("Button 1"))),
            ...(args.button2Label ? [basicButton(args.button2Label, dom.on("click", action("Button 2")))] : []),
          ]
        : undefined,
      footer: args.footerText ? [
        dom("span", args.footerText,
          args.footerBoldText ? dom("strong", args.footerBoldText) : null,
        ),
        ...(args.footerActionLabel
          ? [textButton(args.footerActionLabel, dom.on("click", action("Footer action")))]
          : []),
      ] : undefined,
    });
  },
};

// ---------------------------------------------------------------------------
// ItemCard
// ---------------------------------------------------------------------------

export const ItemCardStory = {
  args: {
    indicator: "",
    header: "OIDC",
    tag: "",
    badgeLabel: "",
    badgeVariant: "primary",
    text: "Works with most identity providers (Google, Azure AD, Keycloak, etc.).",
    errorHeader: "",
    errorMessage: "",
    info: "",
    button1Label: "Configure",
    button1Disabled: false,
    button2Label: "",
  },
  argTypes: {
    indicator: {
      control: "select",
      options: ["", "active", "configured", "error"],
    },
    badgeVariant: {
      control: "select",
      options: ["primary", "warning", "error", "accent"],
    },
  },
  render: (args: any) => buildItemCard({
    indicator: (args.indicator || undefined) as ItemBorderVariant | undefined,
    header: args.header,
    tags: args.tag ? [{ label: args.tag }] : [],
    badges: args.badgeLabel
      ? [{ label: args.badgeLabel, variant: args.badgeVariant as BadgeVariant }]
      : [],
    text: args.text || undefined,
    error: args.errorMessage || undefined,
    info: args.info || undefined,
    buttons: [
      {
        label: args.button1Label,
        disabled: args.button1Disabled,
        action: args.button1Disabled ? undefined : action(args.button1Label),
      },
      ...(args.button2Label
        ? [{ label: args.button2Label, action: action(args.button2Label) }]
        : []),
    ],
  }),
};

// ---------------------------------------------------------------------------
// Presets — HeroCard
// ---------------------------------------------------------------------------

export const HeroSuccess = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "success",
    badgeLabel: "Active",
    badgeVariant: "primary",
  },
};

export const HeroPending = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "pending",
    header: "OIDC",
    badgeLabel: "Active on restart",
    badgeVariant: "warning",
    text: "Authentication has been configured and will become active when Grist is restarted.",
    showButtons: false,
  },
};

export const HeroError = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "error",
    badgeLabel: "Error",
    badgeVariant: "error",
    text: "Authentication is misconfigured or unreachable.",
    error: "Failed to fetch OIDC discovery document",
  },
};

export const HeroWithTag = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "success",
    header: "gVisor",
    tag: "Recommended",
    badgeLabel: "Ready",
    badgeVariant: "primary",
    text: "Your system supports gVisor — the fastest and most battle-tested sandbox.",
    showButtons: false,
  },
};

export const HeroNoAuth = {
  ...HeroCardStory,
  args: {
    ...HeroCardStory.args,
    indicator: "warning",
    header: "No authentication",
    badgeLabel: "Not recommended",
    badgeVariant: "warning",
    text: "Anyone who can reach this server can access all data without signing in.",
    showButtons: false,
    showCheckbox: true,
  },
};

// ---------------------------------------------------------------------------
// Presets — ItemCard
// ---------------------------------------------------------------------------

export const ItemUnconfigured = {
  ...ItemCardStory,
  args: { ...ItemCardStory.args },
};

export const ItemConfigured = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "configured",
    badgeLabel: "Active on restart",
    badgeVariant: "warning",
    button2Label: "Set as active method",
  },
};

export const ItemActive = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "active",
    badgeLabel: "Active",
    badgeVariant: "primary",
    button1Disabled: true,
  },
};

export const ItemError = {
  ...ItemCardStory,
  args: {
    ...ItemCardStory.args,
    indicator: "error",
    badgeLabel: "Error",
    badgeVariant: "error",
    errorHeader: "Error details",
    errorMessage: "Missing required GRIST_OIDC_IDP_CLIENT_ID",
  },
};

// ---------------------------------------------------------------------------
// HeroCard with radio selection
// ---------------------------------------------------------------------------

export const HeroCardRadioSelection = () => {
  const selected = Observable.create(null, "oidc");
  const makeRadio = (key: string) => ({
    checked: (use: any) => use(selected) === key,
    onSelect: () => { action(`Select ${key}`)(); selected.set(key); },
    name: "plan",
  });
  return cssGrid(
    cssColumn(
      buildHeroCard( {
        indicator: "success",
        radio: makeRadio("oidc"),
        header: "OIDC",
        badges: [{ label: "Active", variant: "primary" }],
        text: "Your server authenticates users via OpenID Connect.",
        footer: dom("span", "Installation admin: ", dom("strong", "admin@example.com")),
      }),
      buildHeroCard( {
        indicator: "pending",
        radio: makeRadio("saml"),
        header: "SAML",
        badges: [{ label: "Available", variant: "warning" }],
        text: "For enterprise identity providers.",
      }),
    ),
  );
};

// ---------------------------------------------------------------------------
// ItemCard with radio selection
// ---------------------------------------------------------------------------

export const ItemCardRadioSelection = () => {
  const selected = Observable.create(null, "oidc");
  const makeRadio = (key: string) => ({
    checked: (use: any) => use(selected) === key,
    onSelect: () => { action(`Select ${key}`)(); selected.set(key); },
    name: "provider",
  });
  return cssColumn(
    buildCardList( {
      header: "Choose a provider",
      items: [
        buildItemCard({
          radio: makeRadio("oidc"),
          indicator: "configured",
          header: "OIDC",
          text: "Works with most identity providers (Google, Azure AD, Keycloak, etc.).",
        }),
        buildItemCard({
          radio: makeRadio("saml"),
          header: "SAML",
          text: "For enterprise identity providers (Okta, OneLogin, etc.).",
        }),
        buildItemCard({
          radio: makeRadio("forward"),
          header: "Forwarded headers",
          text: "For reverse proxy setups (Traefik, Authelia, etc.).",
        }),
      ],
    }),
  );
};

// ---------------------------------------------------------------------------
// CardList
// ---------------------------------------------------------------------------

export const CardListStory = {
  args: {
    header: "Available methods",
    collapsible: false,
    initiallyCollapsed: false,
  },
  render: (args: any) => buildCardList( {
    header: args.header,
    collapsible: args.collapsible,
    initiallyCollapsed: args.initiallyCollapsed,
    items: [
      buildItemCard({
        header: "OIDC",
        text: "Works with most identity providers.",
        buttons: [{ label: "Configure", action: action("Configure OIDC") }],
      }),
      buildItemCard({
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
      buildItemCard({
        header: "Forwarded headers",
        text: "For reverse proxy setups.",
        buttons: [{ label: "Configure", action: action("Configure Forwarded headers") }],
      }),
    ],
  }),
};

// ---------------------------------------------------------------------------
// Full section composition
// ---------------------------------------------------------------------------

export const FullSectionActive = () => cssColumn(
  buildHeroCard( {
    indicator: "success",
    header: "OIDC",
    badges: [{ label: "Active", variant: "primary" }],
    text: "Your server is configured to authenticate users via OpenID Connect.",
    buttons: [
      basicButton("Reconfigure", dom.on("click", action("Reconfigure"))),
      basicButton("Deactivate", dom.on("click", action("Deactivate"))),
    ],
    footer: [
      dom("span", "Installation admin: ", dom("strong", "admin@example.com")),
      textButton("Change installation admin", dom.on("click", action("Change admin"))),
    ],
  }),
  buildCardList( {
    header: "Other authentication methods",
    collapsible: true,
    initiallyCollapsed: true,
    items: [
      buildItemCard({
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
      buildItemCard({
        indicator: "configured",
        header: "Forwarded headers",
        badges: [{ label: "Active on restart", variant: "warning" }],
        text: "For reverse proxy setups.",
        buttons: [
          { label: "Set as active method", action: action("Set active") },
          { label: "Configure", action: action("Configure Forwarded headers") },
        ],
      }),
    ],
  }),
);

export const FullSectionNoAuth = () => cssColumn(
  buildHeroCard( {
    indicator: "error",
    header: "No authentication",
    badges: [{ label: "Not recommended", variant: "warning" }],
    text: "Anyone who can reach this server can access all data without signing in.",
    checkbox: labeledSquareCheckbox(Observable.create(null, false), "I understand this server has no authentication"),
    footer: [
      dom("span", "Installation admin: ", dom("strong", "admin@example.com")),
      textButton("Change installation admin", dom.on("click", action("Change admin"))),
    ],
  }),
  buildCardList( {
    header: "Available methods",
    items: [
      buildItemCard({
        header: "OIDC",
        text: "Works with most identity providers.",
        buttons: [{ label: "Configure", action: action("Configure OIDC") }],
      }),
      buildItemCard({
        header: "SAML",
        text: "For enterprise identity providers.",
        buttons: [{ label: "Configure", action: action("Configure SAML") }],
      }),
    ],
  }),
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cssGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 32px;
  padding: 16px;
`);

const cssColumn = styled("div", `
  max-width: 520px;
`);
