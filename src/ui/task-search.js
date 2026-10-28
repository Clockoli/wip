// Shared task search for extension pages and the classic GitHub content script.
(() => {
  function taskText(task) {
    const issue = task.issue;
    return `${task.title ?? task.taskTitle ?? task.issueTitle ?? ''} ${task.taskUrl ?? issue?.url ?? task.url ?? ''} ${issue ? `${issue.owner}/${issue.repo} #${issue.number} ${issue.type}` : ''}`;
  }

  function matchesQuery(value, query) {
    return (Array.isArray(value) ? value : [value]).some(field => String(field ?? '').toLowerCase().includes(query));
  }

  function mount(input, { onInput = () => {}, textOf = taskText } = {}) {
    input.addEventListener('input', onInput);
    return {
      get query() { return input.value.trim().toLowerCase(); },
      matches(items, eligible = () => true, limit = Infinity) {
        const query = input.value.trim().toLowerCase();
        const result = [];
        for (const item of items) {
          if (eligible(item) && (!query || matchesQuery(textOf(item), query))) result.push(item);
          if (result.length >= limit) break;
        }
        return result;
      },
      clear() { input.value = ''; input.focus({ preventScroll: true }); onInput(); },
    };
  }

  globalThis.ClockoliTaskSearch = { mount };
})();
