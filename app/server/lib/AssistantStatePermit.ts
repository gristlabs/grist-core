import { IPermitStore, Permit } from "app/server/lib/Permit";

/**
 * A {@link Permit} that contains assistant-related state.
 *
 * This is currently used by the `/api/assistant/start` endpoint, which
 * redirects to the signup page if the user is unauthenticated.
 * As part of this redirect, a `gr_signup_state` cookie is set which
 * includes the ID of a {@link AssistantStatePermit} containing the
 * prompt the user submitted to the `/api/assistant/start` endpoint. This
 * permit is later replaced with one containing the `docId` of a new
 * document created on the user's first visit after signup, as part of
 * welcoming the user. Finally, the permit is retrieved and cleared
 * when the document with matching `docId` is first opened with the
 * `assistantState` URL parameter set to the permit's ID.
 *
 * Unlike browser cookies, which can only store upwards of ~4 KB of data,
 * permits are able to store significantly larger amounts of data, hence
 * why they are used to store assistant state like LLM prompts.
 * Cookies are still used to track permits across signups (in
 * `gr_signup_state`), but we only store the permit IDs in them.
 */
export interface AssistantStatePermit extends Permit {
  prompt: string;
  docId?: string;
}

/**
 * Gets an assistant state permit by ID, removing it in the process.
 *
 * Returns `null` if a permit with the specified ID does not exist.
 *
 * Note: This is a wrapper for {@link IPermitStore.getPermit} that clears
 * the permit from the store and sets the key prefix for you.
 */
export async function getAssistantStatePermit(
  store: IPermitStore,
  id: string,
  options: { remove?: boolean } = {}
): Promise<AssistantStatePermit | null> {
  const { remove = false } = options;
  const prefix = store.getKeyPrefix();
  const key = prefix + id;
  const permit = (await store.getPermit(key)) as AssistantStatePermit | null;
  if (remove) {
    await store.removePermit(key);
  }
  return permit;
}

/**
 * Sets a new assistant state permit.
 *
 * Returns an ID that can be passed to {@link getAssistantStatePermit} to
 * retrieve the permit.
 *
 * Note: This is a wrapper for {@link IPermitStore.setPermit} that sets a
 * reasonable TTL and strips the key prefix for you.
 */
export async function setAssistantStatePermit(
  store: IPermitStore,
  permit: AssistantStatePermit
): Promise<string> {
  const key = await store.setPermit(permit, 1000 * 60 * 60);
  const prefix = store.getKeyPrefix();
  const id = key.replace(prefix, "");
  return id;
}
