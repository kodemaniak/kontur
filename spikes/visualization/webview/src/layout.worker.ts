import ElkConstructor from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { LayoutRequest, LayoutResponse } from './layout';

const elk = new ElkConstructor();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage: (response: LayoutResponse) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const graph = await elk.layout(data.graph as ElkNode);
    scope.postMessage({ id: data.id, graph });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
