# Elastic Timeline Editor

Встроенный в репозиторий Clockoli framework-neutral редактор временных интервалов по спецификации [`elastic-timeline-ui-component-spec.ru.md`](./elastic-timeline-ui-component-spec.ru.md). Его исходники, сборка и полный тестовый набор версионируются вместе с Clockoli; пакетный интерфейс сохраняется для изолированной проверки consumer-контракта.

Полный reference публичного API, lifecycle, callbacks, styling и framework adapters: [`docs/API.md`](./docs/API.md).

## Установка

```bash
npm install elastic-timeline-editor
```

Компонент поставляется как ESM-пакет без runtime dependencies. Для работы нужен современный desktop-браузер с Pointer Events, pointer capture, `ResizeObserver`, CSS custom properties и ES modules. SSR может импортировать пакет, но `createElasticTimeline` следует вызывать только после появления DOM-контейнера.

## Возможности

- точный initial view `[now − 24 часа, now]`;
- zoom от 1 часа до 7 дней без отображения future time;
- нелинейный эластичный scale с hour/day cells;
- несколько именованных строк через `rows`/`rowId`: все интервалы используют одну общую горизонтальную раскладку, а `rowId` меняет только вертикальную позицию;
- minimum block width 30px и gap 4px;
- mobility reserve в dense cells, чтобы каждый editable block реально двигался и изменялся без сдвига соседей;
- connector-dot между соседними blocks одной строки при actual gap 0 или 1 секунда, а также при достижении minimum visual gap во время move/resize;
- тонкий border 1px и заметный 1.2s pulse для running item;
- click selection; пара обычных clicks надёжно вызывает Start для completed item и Stop для running item, включая попадание в resize-край короткого блока;
- hover/focus details с явной подсказкой о действии по double-click;
- direct pointer move/left resize/right resize с pointer capture;
- единый coordinate mapping: при move левая грань, при resize захваченная грань совпадает с timestamp на header scale;
- стабильная scale между последовательными edit-коммитами и защита от overlap при любых комбинациях resize-граней;
- ограничения по immediate completed neighbours, minimum duration и snap;
- keyboard pan, zoom и редактирование; horizontal wheel сначала прокручивает elastic overflow до настоящего края, затем сдвигает временное окно;
- running/read-only/pending states;
- header/canvas растягиваются до фактического правого края global layout, поэтому подпись текущего времени остаётся над running block даже при плотной истории;
- `update()` для authoritative model и `destroy()` без оставшихся listeners.

## Запуск демо

```bash
npm install
npm run dev
```

Vite напечатает локальный URL. Демо содержит 12 пятисекундных интервалов, historical overlap и running item. Все completed-задачи доступны для move и resize; hover показывает details, double-click запускает completed-задачу и останавливает running-задачу.

## Использование

```js
import { createElasticTimeline } from 'elastic-timeline-editor'
import 'elastic-timeline-editor/style.css'

const timeline = createElasticTimeline(container, {
  items,
  rows: [
    { id: 'work', title: 'Работа' },
    { id: 'personal', title: 'Личное' },
  ],
  now: Date.now(),
  onSelect(item) {},
  onStart(item) {},
  onStop(item) {},
  onEditPreview(edit) {},
  async onEditCommit(edit) {
    await save(edit)
    timeline.update({ items: await loadAuthoritativeItems() })
  },
  onEditCancel(item) {},
  onViewChange(view) {},
})

// Authoritative refresh
timeline.update({ items, now: Date.now() })

// Unmount
timeline.destroy()
```

Completed item редактируется по умолчанию. Для блокировки передайте `isEditable: false` или `isPending: true`. Running item задаётся `endedAt: null`: его можно расширять влево, но нельзя перемещать или изменять правую границу `now`.

Любой resize соблюдает `minimumDurationMs` (по умолчанию ровно 1 минута), даже если исходный загруженный интервал был короче.

Item закрепляется за строкой полем `rowId`; move и resize никогда не меняют строку. Над timeline слева/справа показаны границы view, а по центру — сумма отслеженных durations за видимый период.

Zoom имеет магнитное сопротивление на spans 1 и 3 суток: crossing останавливается точно на границе, затем временно движется в четыре раза медленнее.

Дополнительные options:

```js
{
  minViewSpanMs: 60 * 60 * 1000,
  maxViewSpanMs: 7 * 24 * 60 * 60 * 1000,
  defaultViewSpanMs: 24 * 60 * 60 * 1000,
  snapMs: 60 * 1000,
  minimumDurationMs: 60 * 1000,
  view: { start, end, focusedAt },
}
```

## Проверка

```bash
npm test          # pure scale/layout/constraints/view tests
npm run test:e2e # desktop Chromium interaction и accessibility geometry
npm run build     # standalone ES module + isolated CSS
npm run test:package # установка tarball в отдельный TypeScript/Vite consumer
npm run test:all
```
