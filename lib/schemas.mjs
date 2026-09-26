const str = { type: 'string' };
const list = (items) => ({ type: 'array', items });
const choice = (...values) => ({ type: 'string', enum: values });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const readingSchema = obj({ parameter: str, value: str, unit: str, reference: str, interpretation: str });
export const visionSchema = obj({
  usable: { type: 'boolean' }, crop: str, summary: str,
  observations: list(str), possibleIssues: list(obj({ name: str, evidence: str })),
  limitations: list(str), followUp: list(str)
});
export const soilSchema = obj({ readable: { type: 'boolean' }, summary: str, readings: list(readingSchema), warnings: list(str) });
export const planSchema = obj({
  summary: str,
  actions: list(obj({ title: str, priority: choice('Now', 'Next', 'Monitor'), detail: str, rationale: str, sourceIds: list(str) })),
  irrigation: str, nutrition: str, missingInformation: list(str), limitations: list(str)
});
export const reviewSchema = obj({ verdict: choice('Reviewed with limitations', 'Needs more evidence'), notes: list(str), plan: planSchema });

// Validate the same strict schema used by the API before displaying model output.
export function validate(schema, value, path = 'response') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    for (const key of schema.required) if (!(key in value)) throw new Error(`${path}.${key} is missing.`);
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) throw new Error(`${path}.${key} is unexpected.`);
      validate(schema.properties[key], value[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 40) throw new Error(`${path} must be a short list.`);
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
  } else {
    if (typeof value !== schema.type) throw new Error(`${path} has an invalid type.`);
    if (schema.type === 'string' && value.length > 6000) throw new Error(`${path} is too long.`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an invalid value.`);
  }
  return value;
}
