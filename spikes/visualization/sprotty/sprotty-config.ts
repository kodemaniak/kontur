import ElkConstructor from 'elkjs-sprotty/lib/elk.bundled.js';
import { Container, ContainerModule } from 'inversify';
import {
  configureModelElement, configureViewerOptions, ConsoleLogger, loadDefaultModules,
  LocalModelSource, LogLevel, PolylineEdgeView, RectangularNodeView, SEdgeImpl,
  SGraphImpl, SGraphView, SLabelImpl, SLabelView, SNodeImpl, TYPES,
} from 'sprotty';
import { ElkFactory, ElkLayoutEngine, elkLayoutModule } from 'sprotty-elk';

export default (containerId: string) => {
  const module = new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(TYPES.ModelSource).to(LocalModelSource).inSingletonScope();
    bind(TYPES.IModelLayoutEngine).toService(ElkLayoutEngine);
    bind<ElkFactory>(ElkFactory).toConstantValue(() => new ElkConstructor({ algorithms: ['layered'] }));
    rebind(TYPES.ILogger).to(ConsoleLogger).inSingletonScope();
    rebind(TYPES.LogLevel).toConstantValue(LogLevel.warn);
    const context = { bind, unbind, isBound, rebind };
    configureModelElement(context, 'graph', SGraphImpl, SGraphView);
    configureModelElement(context, 'node', SNodeImpl, RectangularNodeView);
    configureModelElement(context, 'edge', SEdgeImpl, PolylineEdgeView);
    configureModelElement(context, 'label:node', SLabelImpl, SLabelView);
    configureModelElement(context, 'label:edge', SLabelImpl, SLabelView);
    configureViewerOptions(context, { baseDiv: containerId, needsClientLayout: true, zoomLimits: { min: 0.02, max: 2 } });
  });
  const container = new Container();
  loadDefaultModules(container);
  container.load(elkLayoutModule, module);
  return container;
};
