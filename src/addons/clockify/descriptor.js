const DESCRIPTOR_KEYS = new Set([
  'id',
  'version',
  'title',
  'description',
  'requestedOrigins',
  'capabilities',
]);

const SUPPORTED_CAPABILITIES = new Set(['import_completed_records']);
const EXACT_HTTPS_ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\/\*$/i;

function freezeDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    requestedOrigins: Object.freeze([...descriptor.requestedOrigins]),
    capabilities: Object.freeze([...descriptor.capabilities]),
  });
}

export function validateAddonDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new Error('Add-on descriptor must be an object');
  }
  for (const key of Reflect.ownKeys(descriptor)) {
    if (typeof key !== 'string' || !DESCRIPTOR_KEYS.has(key)) throw new Error(`Unknown descriptor key: ${String(key)}`);
  }
  const values = {};
  for (const key of DESCRIPTOR_KEYS) {
    const property = Object.getOwnPropertyDescriptor(descriptor, key);
    if (!property || !Object.hasOwn(property, 'value')) throw new Error(`Missing descriptor key: ${key}`);
    values[key] = property.value;
  }
  if (typeof values.id !== 'string' || values.id.length === 0) throw new Error('Invalid add-on ID');
  if (!Number.isInteger(values.version) || values.version < 1) throw new Error('Invalid add-on version');
  if (typeof values.title !== 'string' || values.title.length === 0) throw new Error('Invalid add-on title');
  if (typeof values.description !== 'string' || values.description.length === 0) throw new Error('Invalid add-on description');
  if (!Array.isArray(values.requestedOrigins) || values.requestedOrigins.some(origin => typeof origin !== 'string' || !EXACT_HTTPS_ORIGIN.test(origin))) {
    throw new Error('Invalid requested origins');
  }
  if (!Array.isArray(values.capabilities) || values.capabilities.some(capability => !SUPPORTED_CAPABILITIES.has(capability))) {
    throw new Error('Unsupported capability');
  }
  return freezeDescriptor(values);
}

const clockifyDescriptor = validateAddonDescriptor({
  id: 'clockify-migration',
  version: 1,
  title: 'Clockify migration',
  description: 'Import completed time from a Clockify Detailed report opened in this browser.',
  requestedOrigins: ['https://app.clockify.me/*'],
  capabilities: ['import_completed_records'],
});

export default clockifyDescriptor;
