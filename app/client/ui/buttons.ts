import {styled} from 'grainjs';

/**
 * Plain clickable button, light grey with dark text, slightly raised.
 */
export const button1 = styled('button', `
  background: linear-gradient(to bottom, #fafafa 0%,#eaeaea 100%);
  border-radius: 0.5em;
  border: 1px solid #c9c9c9;
  box-shadow: 0px 2px 2px -2px rgba(0,0,0,0.2);
  color: #444;
  font-weight: 500;
  overflow: hidden;
  padding: 0.4em 1em;
  margin: 0.5em;

  &:disabled {
    color: #A0A0A0;
  }
  &:active:not(:disabled) {
    background: linear-gradient(to bottom, #eaeaea 0%, #fafafa 100%);
    box-shadow: inset 0px 0px 2px 0px rgba(0,0,0,0.2), 0px 0px 2px 1px #0078ff;
  }
`);

/**
 * Similar to button1 but smaller to match other grist buttons.
 */
export const button1Small = styled(button1, `
  height: 2.5rem;
  line-height: 1.1rem;
  font-size: 1rem;
  font-weight: bold;
  color: #444;
  border-radius: 4px;
  box-shadow: none;
  outline: none;
  &:active:not(:disabled) {
    box-shadow: none;
  }
`);

const buttonBrightStyle = `
  &:not(:disabled) {
    background: linear-gradient(to bottom, #ffb646 0%,#f68400 100%);
    border-color: #f68400;
    color: #ffffff;
    text-shadow: 1px 1px 0px rgb(0,0,0,0.2);
  }
  &:active:not(:disabled) {
    background: linear-gradient(to bottom, #f68400 0%,#ffb646 100%);
  }
`;

/**
 * Just like button1 but orange with white text.
 */
export const button1Bright = styled(button1, buttonBrightStyle);

/**
 * Just like button1Small but orange with white text.
 */
export const button1SmallBright = styled(button1Small, buttonBrightStyle);

/**
 * A button that looks like a flat circle with a unicode symbol inside, e.g.
 * "\u2713" for checkmark, or "\u00D7" for an "x".
 *
 * Modifier class circleSymbolButton.cls("-light") makes it look disabled.
 * Modifier class circleSymbolButton.cls("-green") makes it green.
 */
export const circleSymbolButton = styled('button', `
  border: none;
  padding: 0px;
  width: 1em;
  height: 1em;
  margin: 0.3em;
  background: grey;
  color: #fff;
  border-radius: 1em;
  font-family: sans-serif;
  font-weight: bold;
  text-align: center;
  font-size: 1.2em;
  line-height: 0em;
  text-decoration: none;
  cursor:pointer;

  &-light {
    background-color: lightgrey;
  }
  &-green {
    background-color: #00c209;
  }
`);
