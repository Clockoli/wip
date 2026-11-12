import { getAddon } from './registry.js';

export async function setAddonEnabled({ store, permissions }, id, enabled) {
  const descriptor = getAddon(id);
  if (!descriptor) throw new Error('Unknown add-on');
  if (typeof enabled !== 'boolean') throw new Error('Add-on enabled state must be Boolean');
  const descriptorPermissions = { origins: [...descriptor.requestedOrigins] };
  if (enabled) {
    if (!await permissions.contains(descriptorPermissions)) throw new Error('Add-on permission was not granted');
    try {
      await store.setAddonEnabled(id, enabled);
    } catch (error) {
      try { await permissions.remove(descriptorPermissions); } catch { /* preserve the storage failure */ }
      throw error;
    }
  } else {
    try {
      await store.setAddonEnabled(id, enabled);
    } catch (error) {
      throw error;
    }
    try {
      if (!await permissions.remove(descriptorPermissions)) throw new Error('Add-on permission could not be removed');
    } catch (error) {
      try { await store.setAddonEnabled(id, true); } catch { /* preserve the permission failure */ }
      throw error;
    }
  }
  return { id, enabled };
}
