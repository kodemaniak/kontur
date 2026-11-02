export {};

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(message: unknown): void;
      getState(): unknown;
      setState(state: unknown): unknown;
    };
    konturMessages: unknown[];
    konturInitialState?: unknown;
    konturInitialHostMessage?: unknown;
    konturSavedState?: unknown;
  }
}

window.konturMessages = [];
window.acquireVsCodeApi = () => ({
  postMessage: (message) => window.konturMessages.push(message),
  getState: () => window.konturInitialState
    ?? JSON.parse(sessionStorage.getItem('kontur-test-state') ?? 'null')
    ?? window.konturSavedState,
  setState: (state) => {
    window.konturSavedState = state;
    sessionStorage.setItem('kontur-test-state', JSON.stringify(state));
    return state;
  },
});

const addEventListener = window.addEventListener.bind(window);
(window as any).addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => {
  addEventListener(type, listener, options);
  if (type === 'message' && window.konturInitialHostMessage !== undefined) {
    const data = window.konturInitialHostMessage;
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data })));
  }
};
