export type ProductFlavor = string;

// TODO: move CustomTheme type outside of stub code
export interface CustomTheme {
  bodyClassName?: string;
  wideLogo?: boolean;
}

export function getTheme(flavor: string): CustomTheme {
  return {
  };
}
