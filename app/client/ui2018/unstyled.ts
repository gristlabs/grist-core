/**
 * Helpers to create unstyled variants of various HTML elements that have default styles.
 *
 * Useful to easily build semantic content without having to deal with removing styles all the time.
 */
import {styled} from "grainjs";

export const unstyledButton = styled('button', `
  margin: 0;
  padding: 0;
  border: 0 solid;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  border-radius: 0;
  background-color: transparent;
  opacity: 1;
  appearance: button;
`);
