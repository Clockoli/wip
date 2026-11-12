import clockifyDescriptor, { validateAddonDescriptor } from './clockify/descriptor.js';

const ADDONS = Object.freeze([clockifyDescriptor]);

export function createAddonRegistry(descriptors) {
  if (!Array.isArray(descriptors)) throw new Error('Add-on registry must be an array');
  const addons = Object.freeze(descriptors.map(validateAddonDescriptor));
  const addonsById = new Map();
  for (const descriptor of addons) {
    if (addonsById.has(descriptor.id)) throw new Error(`Duplicate add-on ID: ${descriptor.id}`);
    addonsById.set(descriptor.id, descriptor);
  }
  return Object.freeze({
    list: addons,
    get(id) { return typeof id === 'string' ? addonsById.get(id) : undefined; },
  });
}

const REGISTRY = createAddonRegistry(ADDONS);

export function listAddons() {
  return REGISTRY.list;
}

export function getAddon(id) {
  return REGISTRY.get(id);
}
