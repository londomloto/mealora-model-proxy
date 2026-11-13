// Converts the Gemini-style schemas in schema.js to OpenAI strict
// json_schema, which requires: every property listed in `required`,
// `additionalProperties: false`, and null expressed as a type union.
// Optional (non-required) fields become required-but-nullable; the answer is
// then passed through `stripStrictNulls`, which removes those nulls again so
// the result matches the original contract exactly.

function toStrictSchema(schema) {
  const out = {};
  if (schema.description) out.description = schema.description;

  if (schema.type === 'object') {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    out.type = 'object';
    out.properties = {};
    for (const [key, sub] of Object.entries(props)) {
      const converted = toStrictSchema(sub);
      out.properties[key] = required.has(key) ? converted : nullable(converted);
    }
    out.required = Object.keys(props);
    out.additionalProperties = false;
  } else if (schema.type === 'array') {
    out.type = 'array';
    if (schema.items) out.items = toStrictSchema(schema.items);
  } else {
    out.type = schema.type;
    if (schema.enum) out.enum = [...schema.enum];
  }

  return schema.nullable ? nullable(out) : out;
}

function nullable(s) {
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('null')) return s;
  const out = { ...s, type: [...types, 'null'] };
  if (out.enum && !out.enum.includes(null)) out.enum = [...out.enum, null];
  return out;
}

// Removes nulls the strict conversion forced onto optional, non-nullable
// fields. Nulls on fields the original schema marks nullable are kept.
function stripStrictNulls(schema, value) {
  if (value === null || typeof value !== 'object') return value;
  if (schema.type === 'array' && Array.isArray(value)) {
    return value.map((item) => (schema.items ? stripStrictNulls(schema.items, item) : item));
  }
  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required || []);
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties[key];
      if (!sub) continue;
      if (v === null && !required.has(key) && !sub.nullable) continue;
      out[key] = stripStrictNulls(sub, v);
    }
    return out;
  }
  return value;
}

module.exports = { toStrictSchema, stripStrictNulls };
