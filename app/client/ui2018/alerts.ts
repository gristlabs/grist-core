/**
 * A simple alert component that displays a highlighted message with an info icon.
 *
 * Example:
 *
 * `alert('This is some important information')`
 */
import { dom, DomElementArg, styled } from 'grainjs';
import { vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';

/**
 * Creates an alert element with an icon and message.
 */
export function alert(...args: DomElementArg[]) {
  return cssAlert(
    cssAlertIcon(
      icon('Info',
        dom.style('width', '13px'),
        dom.style('height', '13px'),
        dom.style('background-color', 'currentColor'),
      ),
    ),
    dom('p', ...args)
  );
}

const cssAlert = styled('div', `
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  background-color: #ffe4b6;
  color: #000;
  border: 1px solid #cb7b2b;
  border-radius: ${vars.controlBorderRadius};
  margin-bottom: 16px;
  & p {
    margin: 0;
  }
`);

const cssAlertIcon = styled('span', `
  display: inline-flex;
  align-items: center;
  position: relative;
  top: 2px;
`);
