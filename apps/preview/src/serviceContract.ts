import { parsePreviewJson, type PreviewResult } from './contract';

export type PreviewServiceResponse = {
  schemaVersion: 1;
  revision: number;
  documentUri: string;
  result: PreviewResult;
};

export function parsePreviewResponse(
  text: string,
  expected: { revision: number; documentUri: string },
): PreviewServiceResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`Invalid service response JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Service response must be an object.');
  }

  const envelope = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'revision', 'documentUri', 'result'];
  if (Object.keys(envelope).length !== keys.length || keys.some((key) => !(key in envelope))) {
    throw new TypeError('Invalid service response shape.');
  }
  if (envelope.schemaVersion !== 1) throw new TypeError('Unsupported service protocol version.');
  if (typeof envelope.revision !== 'number' || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) {
    throw new TypeError('Service response revision must be a positive safe integer.');
  }
  if (typeof envelope.documentUri !== 'string' || envelope.documentUri.length === 0) {
    throw new TypeError('Service response document URI must be nonempty.');
  }
  if (envelope.revision !== expected.revision) {
    throw new TypeError('Service response revision does not match the request.');
  }
  if (envelope.documentUri !== expected.documentUri) {
    throw new TypeError('Service response document URI does not match the request.');
  }

  return {
    schemaVersion: 1,
    revision: envelope.revision,
    documentUri: envelope.documentUri,
    result: parsePreviewJson(JSON.stringify(envelope.result)),
  };
}
