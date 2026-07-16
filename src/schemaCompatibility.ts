import type { JsonPrimitive, JsonSchema, SchemaCompatibilityChange, SchemaCompatibilityReport } from './types/common.js';

export interface SchemaAssetVersion {
  version: number;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export function analyzeSchemaCompatibility(previous: SchemaAssetVersion | null, current: SchemaAssetVersion, now = new Date().toISOString()): SchemaCompatibilityReport {
  if (!previous) return { previousVersion: null, breaking: false, changes: [], checkedAt: now };
  const changes = [
    ...compareSchema(previous.inputSchema, current.inputSchema, 'input', 'inputSchema'),
    ...compareSchema(previous.outputSchema, current.outputSchema, 'output', 'outputSchema')
  ];
  return { previousVersion: previous.version, breaking: changes.some((change) => change.breaking), changes, checkedAt: now };
}

function compareSchema(previous: JsonSchema, current: JsonSchema, direction: 'input' | 'output', path: string): SchemaCompatibilityChange[] {
  const changes: SchemaCompatibilityChange[] = [];
  if (previous.type !== current.type) changes.push(change(direction, path, 'type-changed', `Type changed from ${previous.type || 'unspecified'} to ${current.type || 'unspecified'}.`));
  if (direction === 'input' && previous.additionalProperties !== false && current.additionalProperties === false) {
    changes.push(change(direction, path, 'additional-properties-restricted', 'Additional input properties are no longer accepted.'));
  }
  const previousRequired = new Set(previous.required || []);
  const currentRequired = new Set(current.required || []);
  if (direction === 'input') {
    for (const key of currentRequired) if (!previousRequired.has(key)) changes.push(change(direction, `${path}.${key}`, 'required-added', `Input '${key}' became required.`));
  } else {
    for (const key of previousRequired) if (!currentRequired.has(key)) changes.push(change(direction, `${path}.${key}`, 'required-removed', `Output '${key}' is no longer guaranteed.`));
  }
  const previousProperties = previous.properties || {};
  const currentProperties = current.properties || {};
  for (const [key, previousProperty] of Object.entries(previousProperties)) {
    const currentProperty = currentProperties[key];
    const propertyPath = `${path}.properties.${key}`;
    if (!currentProperty) {
      changes.push(change(direction, propertyPath, 'property-removed', `${direction === 'input' ? 'Input' : 'Output'} property '${key}' was removed.`));
      continue;
    }
    changes.push(...compareSchema(previousProperty, currentProperty, direction, propertyPath));
  }
  if (isEnumNarrowed(previous.enum, current.enum)) changes.push(change(direction, path, 'enum-narrowed', 'The set of accepted values was narrowed.'));
  return changes;
}

function isEnumNarrowed(previous?: JsonPrimitive[], current?: JsonPrimitive[]): boolean {
  if (!previous?.length || !current?.length) return false;
  return previous.some((value) => !current.includes(value));
}

function change(direction: 'input' | 'output', path: string, kind: SchemaCompatibilityChange['kind'], message: string): SchemaCompatibilityChange {
  return { direction, path, kind, breaking: true, message };
}
