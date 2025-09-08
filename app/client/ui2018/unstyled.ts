/**
 * Helpers to create unstyled variants of various HTML elements that have default styles.
 *
 * Useful to easily build semantic content without having to deal with removing styles all the time.
 */
import {styled} from "grainjs";

const base = `
  margin: 0;
  padding: 0;
  border: 0 solid;
`;

export const unstyledButton = styled('button', `
  ${base}
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  border-radius: 0;
  background-color: transparent;
  opacity: 1;
  appearance: button;
`);

export const unstyledLink = styled('a', `
  ${base}
  color: inherit;
  -webkit-text-decoration: inherit;
  text-decoration: inherit;

  &:hover, &:focus {
    color: inherit;
    -webkit-text-decoration: inherit;
    text-decoration: inherit;
  }
`);

export const unstyledUl = styled('ul', `
  ${base}
  list-style: none;
`);

const unstyledHeadings = `
  ${base}
  font-size: inherit;
  font-weight: inherit;
`;

export const unstyledH2 = styled('h2', unstyledHeadings);
