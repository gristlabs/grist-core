/**
 * Draggable, collapsible mockup controls panel for dev/testing.
 * Used by the boot-key login page and the setup wizard.
 */
import { dom, DomElementArg, observable, styled } from "grainjs";

/**
 * Wraps `...content` in a fixed panel that can be dragged by its header
 * and collapsed/expanded with a toggle button.
 */
export function buildMockupPanel(title: string, ...content: DomElementArg[]) {
  const collapsed = observable(false);

  // --- Drag state ---
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let dragging = false;

  function onMouseDown(ev: MouseEvent, panel: HTMLElement) {
    // Only drag from the header bar itself, not buttons inside it.
    if ((ev.target as HTMLElement).tagName === "BUTTON") { return; }
    ev.preventDefault();
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;
    const rect = panel.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) { return; }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${origX + dx}px`;
      panel.style.top = `${origY + dy}px`;
      // Clear bottom/right anchoring so position is purely left/top.
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return cssMockupPanel(
    dom.on("mousedown", (ev: MouseEvent, el: HTMLElement) => onMouseDown(ev, el)),
    cssMockupHeader(
      cssMockupTitle(title),
      cssMockupToggle(
        dom.text(use => use(collapsed) ? "\u25B6" : "\u25BC"),
        dom.on("click", () => collapsed.set(!collapsed.get())),
      ),
    ),
    cssMockupBody(
      dom.cls("collapsed", collapsed),
      ...content,
    ),
  );
}

// Re-export styled components so callers can build content rows.
export { cssMockupSection, cssMockupRow, cssMockupButton, cssMockupDesc };

// --- Styles ---

const cssMockupPanel = styled("div", `
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 340px;
  max-height: 70vh;
  background: #1a1a2e;
  color: #e0e0e0;
  border-radius: 8px;
  font-size: 12px;
  z-index: 1000;
  box-shadow: -2px -2px 12px rgba(0, 0, 0, 0.4);
  cursor: default;
  user-select: none;
`);

const cssMockupHeader = styled("div", `
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: grab;
  border-bottom: 1px solid #333;
  &:active { cursor: grabbing; }
`);

const cssMockupTitle = styled("div", `
  font-weight: bold;
  font-size: 13px;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`);

const cssMockupToggle = styled("button", `
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  &:hover { color: #fff; }
`);

const cssMockupBody = styled("div", `
  padding: 8px 12px 12px;
  overflow-y: auto;
  max-height: calc(70vh - 40px);
  transition: max-height 0.25s ease, padding 0.25s ease, opacity 0.2s ease;
  &.collapsed {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    overflow: hidden;
    opacity: 0;
  }
`);

const cssMockupSection = styled("div", `
  font-weight: 600;
  margin-top: 10px;
  margin-bottom: 4px;
  color: #aaa;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.5px;
  &:first-child { margin-top: 0; }
`);

const cssMockupRow = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
  &:last-child { margin-bottom: 0; }
`);

const cssMockupButton = styled("button", `
  padding: 4px 8px;
  border: 1px solid #444;
  border-radius: 3px;
  background: #2a2a4a;
  color: #ccc;
  cursor: pointer;
  font-size: 11px;
  user-select: none;
  &:hover {
    background: #3a3a5a;
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
    &:hover {
      background: #2a2a4a;
      color: #ccc;
    }
  }
`);

const cssMockupDesc = styled("div", `
  color: #888;
  font-size: 11px;
  margin-bottom: 6px;
`);
