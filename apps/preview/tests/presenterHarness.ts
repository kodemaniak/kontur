import { mountPreview, type DiagramRenderer, type PreviewPresenter } from '../src/presenter';

declare global {
  interface Window {
    createKonturPreview: (render?: DiagramRenderer) => PreviewPresenter;
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Presenter test root is missing.');
window.createKonturPreview = (render) => mountPreview(root, render);
