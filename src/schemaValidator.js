// Minimal validator for the Gemini-style (OpenAPI subset) schemas in
// schema.js: type, nullable, enum, properties, required, items. Used for
// providers that cannot enforce a response schema server-side (GLM), so a
// malformed answer becomes a 502 instead of reaching the mobile client.

function typeOk(type, value) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return true;
  }
}

function validate(schema, value, path = '$') {
  if (value === null || value === undefined) {
    return schema.nullable ? [] : [`${path}: required non-null value`];
  }
  if (schema.type && !typeOk(schema.type, value)) {
    return [`${path}: expected ${schema.type}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path}: value not in enum`];
  }
  const errors = [];
  if (schema.type === 'object' && schema.properties) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`));
    }
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  return errors;
}

module.exports = { validate };
