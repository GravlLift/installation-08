// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * A keyboard event target where text is being typed (an input, a textarea, a dropdown, an
 * editable area): a global shortcut must not fire there. Single source for the test, shared by the
 * replay and the sidebar; a keyboard event's target can be `window` or `document`, with no
 * tag name nor editing property.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}
