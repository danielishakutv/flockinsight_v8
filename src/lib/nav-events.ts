/**
 * The name of the event that toggles the sidebar.
 *
 * The keyboard shortcut is matched in `ShortcutsProvider`, which sits at the
 * bottom of the app shell and has no way to reach the `Sidebar`'s state. So
 * the provider fires this and the sidebar listens — the same arrangement
 * `openCommandPalette` already uses, and for the same reason: lifting the
 * rail's state up to the layout would make the whole shell a client component.
 *
 * Its own module, rather than exported from either side, so the sidebar does
 * not have to import the provider and the provider does not have to import the
 * sidebar.
 */
export const TOGGLE_SIDEBAR_EVENT = "fi:toggle-sidebar";

/** Collapse or expand the sidebar from anywhere. */
export function toggleSidebar(): void {
  window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT));
}
