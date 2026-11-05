const demo = document.querySelector('.demo');

if (demo) {
  const viewButtons = [...demo.querySelectorAll('[data-view]')];
  const title = document.querySelector('#result-title');
  const description = document.querySelector('#result-description');
  const states = {
    intent: ['Documented architecture', 'The model records the service-to-API relationship.'],
    evidence: ['Observed architecture', 'Illustrative evidence includes one additional dependency.'],
    diff: ['Undocumented dependency', 'Observed evidence reveals a connection missing from the model.'],
  };

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.view;
      demo.dataset.mode = mode;
      for (const candidate of viewButtons) {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      }
      [title.textContent, description.textContent] = states[mode];
    });
  }
}
