# Спецификация UI-компонента: Elastic Timeline Editor

**Статус:** согласование интерфейсного контракта
**Язык:** русский
**Граница документа:** самостоятельный UI-компонент редактирования временных интервалов.

---

## 1. Назначение

`Elastic Timeline Editor` показывает и редактирует набор временных интервалов на одной горизонтальной временной шкале.

Компонент предназначен для случаев, когда несколько коротких последовательных интервалов должны оставаться различимыми и интерактивными, даже если в реальном времени они заняли секунды. Он использует **эластичный display-scale**: плотным участкам предоставляется больше экранного пространства, а пустым и малонасыщенным — меньше, при сохранении хронологического порядка.

Компонент отвечает только за:

- визуализацию временных интервалов;
- навигацию по времени;
- выбор элемента и показ его деталей;
- preview для move и resize;
- выдачу событий намерения пользователя наружу.

Компонент не знает, где хранятся данные, как выполняется валидация, каким транспортом отправляется изменение и на какой странице он встроен.

---

## 2. Не-цели

Компонент **не должен**:

- изменять или нормализовать входные timestamp'ы без явного действия пользователя;
- считать minimum visual width реальной длительностью;
- перемещать интервал между строками;
- разрешать перетаскивание интервала через соседний интервал;
- показывать время позже переданного `now`;
- самостоятельно сохранять, запрашивать, кешировать или синхронизировать данные;
- содержать product-specific copy, сетевые вызовы, доменную валидацию или storage-логику;
- требовать конкретный framework, библиотеку или browser extension API.

---

## 3. Термины

| Термин | Значение |
|---|---|
| **Actual time** | Реальные timestamp'ы входной модели. Единственная временная истина. |
| **Display coordinate** | Внутренняя экранная координата, применяемая только для layout и pointer interaction. |
| **View** | Actual-time интервал, видимый в viewport. |
| **Canvas** | Полный scrollable layout загруженного диапазона. |
| **Cell** | Календарный час при view до 48 часов либо календарный день при более широком view. |
| **Dense cell** | Cell, в котором обычной ширины недостаточно для minimum widths и gaps её интервалов. |
| **Предыдущий/следующий сосед** | Ближайший завершённый interval в стабильном хронологическом порядке внутри той же строки. |
| **Minimum interactive width** | Минимальная видимая ширина блока — **30 CSS px**. Это не длительность. |
| **Snap** | Шаг, к которому округляется только конечный результат user gesture. Default — 1 минута. |

Хронологический порядок: `startedAt`, затем `endedAt`, затем стабильный `id`.

---

## 4. Входная модель и публичный API

```ts
type TimestampMs = number

interface TimelineItem {
  id: string
  startedAt: TimestampMs
  endedAt: TimestampMs | null // null допускается только для running item

  title: string
  url?: string
  color?: string

  isRunning?: boolean
  isEditable?: boolean // default: true для completed item
  isPending?: boolean
  rowId?: string // default: общая строка без названия
}

interface TimelineRow {
  id: string
  title?: string
}

interface TimelineView {
  start: TimestampMs
  end: TimestampMs
  focusedAt: TimestampMs
}

interface TimelineEdit {
  id: string
  startedAt: TimestampMs
  endedAt: TimestampMs
  kind: 'move' | 'resize-left' | 'resize-right'
}

interface ElasticTimelineProps {
  items: TimelineItem[]
  rows?: TimelineRow[]
  now: TimestampMs
  view?: TimelineView

  minViewSpanMs?: number // default: 1 hour
  maxViewSpanMs?: number // default: 7 days
  defaultViewSpanMs?: number // default: 24 hours
  snapMs?: number // default: 1 minute
  minimumDurationMs?: number // default и абсолютный minimum: 1 minute

  onViewChange?(view: TimelineView): void
  onSelect?(item: TimelineItem): void
  onStart?(item: TimelineItem): void
  onStop?(item: TimelineItem): void | Promise<void>
  onEditPreview?(edit: TimelineEdit): void
  onEditCommit?(edit: TimelineEdit): void | Promise<void>
  onEditCancel?(item: TimelineItem): void
}
```

### Обязательства владельца компонента

Владелец передаёт:

- уже загруженные элементы в допустимом historical range;
- актуальное `now`;
- authoritative items после успешного либо отклонённого изменения;
- ошибки сохранения и pending state через обновлённую input model.

Компонент не изменяет `items` напрямую.

---

## 5. Initial view и временные границы

1. Default view — **ровно `[now − 24 часа, now]`**.
2. `now` находится на правой границе initial viewport.
3. При initial open пользователь видит **и начало, и конец** 24-часового периода без horizontal scrolling.
4. Более ранняя история может быть доступна в canvas, но изначально не должна быть видна.
5. Максимальная доступная история задаётся `maxViewSpanMs`, default — 7 дней.
6. Future time не отображается и не становится доступным через scroll, pan, zoom или edit.
7. Когда view пересчитывается при refresh, resize контейнера или authoritative update, сохраняется actual-time anchor. Refresh не прыгает к произвольному краю canvas.
8. Если `view` не передан, закрытие и следующее монтирование снова начинают с последних 24 часов.

---

## 6. Zoom и навигация

### 6.1 Границы zoom

| Свойство | Значение по умолчанию |
|---|---:|
| Minimum view span | 1 час |
| Default view span | 24 часа |
| Maximum view span | 7 дней |

Zoom меняет видимый actual-time span. Он не меняет данные и не должен сбрасывать actual-time anchor.

### 6.2 Обязательные способы навигации

| Взаимодействие | Поведение |
|---|---|
| Горизонтальный scroll | Панорамирование по actual time. |
| Shift + wheel / горизонтальный trackpad | Панорамирование. |
| Alt + wheel | Zoom. |
| Ctrl/⌘ + wheel или pinch | Zoom; если browser позволяет безопасно перехватить gesture. |
| `Left` / `Right` | Панорамирование на один видимый cell step. |
| Alt + `Left` / `Right` | Панорамирование на 20% текущего view. |

1. Zoom должен быть очевиден: controls видимы, доступны с keyboard и имеют tooltip/accessible name.
2. После zoom in/out view обязан визуально измениться. Нельзя реализовывать zoom как изменение внутреннего состояния без смены геометрии.
3. При view до 48 часов header показывает часы (`HH:mm`); при большем view — дни (например, `Mon 24`).
4. Hour labels не должны накладываться друг на друга в week view.
5. Границы view span **1 сутки** и **3 суток** являются магнитными: crossing сначала останавливается точно на границе, а дальнейшее движение непосредственно за ней замедляется в 4 раза.

---

## 7. Эластичный масштаб и row layout

### 7.1 Правдивость времени

1. Actual timestamps — единственный источник истины.
2. Отображение использует строгую монотонную функцию:

```text
actualA < actualB  =>  displayX(actualA) < displayX(actualB)
```

3. Display-scale может быть нелинейным, но не может менять порядок интервалов.
4. Tooltip и selected details всегда показывают actual start, actual end и actual duration.

### 7.2 Cells

- При view `<= 48 h`: cells — локальные календарные часы.
- При view `> 48 h`: cells — локальные календарные дни.
- Текущая timezone влияет на labels и cell boundaries, но не на actual timestamp input.

### 7.3 Приоритет распределения ширины

Для каждого cell компонент определяет пространство, необходимое для интерактивного размещения блоков.

При дефиците ширины приоритет такой:

1. **Сначала сжимаются пустые cells.**
2. Затем сжимаются cells с малым количеством либо малой occupied duration.
3. Dense cells получают нужную ширину для visible blocks.
4. Только если физически невозможно показать все minimum footprints в выбранном view, canvas становится шире viewport и доступен horizontal navigation.

Для default 24-hour view компонент должен стараться разместить весь период сразу. Нормальная плотность коротких последовательных записей не должна прятать начало 24 часов за scroll.

### 7.4 Именованные строки

1. Timeline может содержать одну или несколько строк из `rows`.
2. `TimelineItem.rowId` закрепляет block за строкой; move и resize не меняют `rowId`.
3. Соседние ограничения вычисляются только среди items той же строки.
4. Внутри каждой строки blocks имеют стабильный хронологический порядок и visible gap **не менее 4 CSS px**.
5. Short intervals и historical overlaps не создают дополнительные автоматические строки: все blocks одного `rowId` остаются в одной visual row.
6. Если `rows` не передан, строки выводятся по первому появлению `rowId`; items без `rowId` попадают в общую строку без названия.
7. Между хронологически соседними blocks одной строки выводится маленькая connector-dot, если их actual gap ровно **1 секунда** **или** move/resize довёл visual gap до минимально разрешённых 4px. Точка появляется уже во время preview, не является hit target и исчезает сразу после увеличения gap.

### 7.5 Short и dense intervals

1. Каждый block имеет width минимум **30 CSS px**.
2. Последовательность из нескольких секундных задач выводится как последовательность отдельных блоков в пределах своей строки.
3. Dense cell растягивается настолько, чтобы нужные blocks были различимы и управляемы.
4. Dense cell резервирует дополнительное horizontal пространство между соседями, чтобы каждый editable block можно было реально move и resize мышью в обе стороны без сдвига остальных blocks.
5. Dense cell не получает специальных badge, синей подсветки, отдельного icon или explanatory label. Более широкая геометрия сама является достаточной информацией.
6. Longer actual gaps должны оставаться визуально больше shorter gaps, насколько это не противоречит minimum interactive footprints.

---

## 8. Визуальный язык и доступность

### 8.1 Блок интервала

Каждый block обязан иметь:

- высоту минимум 32 CSS px, предпочительно 40 CSS px на desktop;
- minimum width 30 CSS px;
- тонкий видимый border **1 CSS px** на светлом и тёмном фоне;
- достаточный contrast текста;
- нецветовой indication доступности interaction;
- чёткий focus indicator.

### 8.2 Цвета задач

1. Identity цвета — stable item key; default — URL, если он есть, иначе `id`.
2. Palette содержит не более 20 curated qualitative colours.
3. Первые 20 разных visible identities получают perceptually distinct colors.
4. Один и тот же identity сохраняет цвет в рамках жизненного цикла mounted component при pan, zoom, selection и refresh.
5. После 20 identities цвет может повторяться, только если все palette colors уже заняты. По возможности нельзя повторять цвет у adjacent blocks.
6. Borders, labels, selected state и grips должны оставаться различимыми и без восприятия цвета.

### 8.3 Running item

1. Running item заканчивается визуально в `now`.
2. Он имеет хорошо заметный pulse: цикл около 1.2 секунды, усиление brightness и внешний halo.
3. При `prefers-reduced-motion: reduce` pulse отключается, но running state остаётся понятным.
4. Running item нельзя move или resize справа; left resize допускается для изменения actual start.

### 8.4 Summary над timeline

1. Левая граница summary показывает minimum actual time текущего view.
2. Правая граница показывает maximum actual time текущего view.
3. По центру более крупным шрифтом показывается сумма actual durations всех items, пересечённых с текущим view; running item считается до `now`.
4. Вертикальная линия `now` не выводится; running state обозначается самим пульсирующим block.

---

## 9. Selection и детали задачи

### 9.1 Hover, focus и click

Hover/focus по completed item:

1. Показывает inline detail region без закрытия timeline сразу при касании курсором или keyboard focus.
3. Detail region содержит:
   - title;
   - полный URL как кликабельную ссылку, если URL предоставлен;
   - actual start;
   - actual end;
   - actual duration;
   - кнопку **Start**, если передан `onStart` и item не running.
4. Click отдельно selects item и вызывает `onSelect(item)`, но не является условием показа details.
5. Details явно подсказывают: **«Двойной клик — запустить задачу»**.

Detail region должен быть доступен с keyboard и не может перекрывать controls других blocks.

### 9.2 Double click

Double-click по item:

1. Для completed item немедленно вызывает `onStart(item)`.
2. Для running item немедленно вызывает `onStop(item)`.
3. Не требует предварительного selection click.
4. Не вызывает edit и не открывает native browser text selection.

---

## 10. Direct manipulation

### 10.1 Hit targets

У completed editable item есть три независимые зоны:

| Зона | Cursor | Действие |
|---|---|---|
| Body | `grab` / `grabbing` | Move whole interval. |
| Left edge | `ew-resize` | Resize actual start. |
| Right edge | `ew-resize` | Resize actual end. |

Требования:

1. Move/resize начинаются сразу: selection click не является prerequisite.
2. При минимальной ширине body и обе edge zones остаются однозначно targetable.
3. Во время gesture отображается high-contrast guide с proposed actual start, proposed actual end и duration.
4. `Escape` отменяет preview без commit.
5. Pointer capture обязателен: gesture не теряется при выходе pointer за block.
6. При move левая грань block использует ту же actual/display mapping, что и header timeline; при resize mapping определяется только захваченной гранью. Pointer coordinate, видимая грань и proposed timestamp должны соответствовать одной точке шкалы.

### 10.2 Ограничения move

Для выбранного completed item определяются immediate chronological neighbours:

```text
previousEnd = endedAt предыдущего item или earliest allowed time
nextStart   = startedAt следующего item или now
```

При move:

```text
newStartedAt >= previousEnd
newEndedAt   <= nextStart
newEndedAt - newStartedAt = исходная actual duration
```

Следствия:

- Item можно двигать **только внутри собственного промежутка между соседями**.
- Нельзя перенести item в совершенно другое место timeline.
- Нельзя перепрыгнуть через соседний item.
- Нельзя создать actual overlap.

### 10.3 Ограничения resize

| Gesture | Разрешённая область |
|---|---|
| Resize left | `previousEnd <= newStartedAt <= endedAt − minimumDuration` |
| Resize right | `startedAt + minimumDuration <= newEndedAt <= nextStart` |

1. Left resize меняет только start; right resize — только end.
2. Resize не создаёт overlap c соседями.
3. Resize не может вывести completed interval в future (`newEndedAt <= now`).
4. `minimumDuration` по умолчанию — 1 минута, configurable.
5. Если snap point выходит за разрешённую границу, результат clamp'ится к границе, а не перескакивает через неё.
6. При последовательных edits elastic scale не пересчитывается из изменённой длительности item: все жесты mounted view используют одну mapping до смены view, ширины, `now` или внешней замены набора данных.
7. Right resize сохраняет левую visual edge; left resize сохраняет правую actual edge и не может протолкнуть 30px minimum footprint через следующего visual neighbour.
8. Последовательности `right edge → left edge` и `left edge → right edge`, включая повторные циклы до упора, не создают visual overlap.

### 10.4 Snap

1. Default snap — 1 минута.
2. Snap применяется только к результату user move/resize.
3. Неизменённые entries с seconds precision не округляются.
4. Parent может запросить другой `snapMs`; component не должен сам менять этот policy.

### 10.5 События изменения

- При pointer move component может вызывать `onEditPreview(edit)`.
- При pointer release component вызывает один `onEditCommit(edit)`.
- Component не считает commit успешным, пока parent не передаст authoritative update.
- Пока item `isPending`, повторное редактирование блокируется, остальные элементы и navigation остаются доступны.
- При ошибке parent возвращает старое authoritative состояние; component должен убрать preview и оставить error presentation в зоне, определённой владельцем.

---

## 11. Keyboard interaction

Когда completed item в focus:

| Shortcut | Действие |
|---|---|
| `Alt + Left` / `Alt + Right` | Move на один snap внутри neighbour bounds. |
| `Ctrl + Alt + Left` / `Ctrl + Alt + Right` | Resize left. |
| `Shift + Alt + Left` / `Shift + Alt + Right` | Resize right. |
| `Enter` | Select/open detail. |
| `Space` | Begin/confirm keyboard edit mode, если такая mode предоставлена. |
| `Escape` | Cancel preview или clear selection. |

Focus order следует actual chronological order.

---

## 12. Responsive behaviour

1. Компонент заполняет доступную ширину контейнера.
2. При container resize сохраняется actual-time anchor.
3. Vertical height определяется количеством строк и стабильна между изменениями `rows`.
4. На 320 CSS px minimum interactive width, borders, grips, focus и detail region остаются usable.
5. Scroll timeline не должен блокировать вертикальный scroll родительской страницы вне явного horizontal/zoom gesture.

---

## 13. Acceptance criteria

### Initial view

- [ ] First render показывает строго последние 24 actual часа.
- [ ] `now` находится справа.
- [ ] Начало и конец этого периода доступны сразу, без initial horizontal scroll.
- [ ] Неделя не видна initial render.
- [ ] Zoom out открывает до 7 дней; zoom in ограничен 1 часом.

### Layout

- [ ] Три sequential five-second items одного `rowId` показаны рядом в своей строке.
- [ ] Двенадцать short sequential items одного `rowId` в одном часу показаны в своей строке, без visual overlap.
- [ ] Каждый block не уже 30 CSS px.
- [ ] Каждый pair adjacent blocks имеет gap минимум 4 CSS px.
- [ ] Даже actual-overlapping input items не создают дополнительную строку внутри одного `rowId`.
- [ ] Blocks разных `rowId` выводятся на отдельных именованных строках и не перемещаются между ними.
- [ ] Actual neighbours с gap ровно 1 секунда либо blocks на minimum visual gap соединяются маленькой non-interactive точкой; точка появляется во время move/resize preview, другие строки не соединяются.
- [ ] В dense случае свободные cells сжимаются раньше low-occupancy и dense cells.
- [ ] Каждый editable block имеет реальный visual travel для move и обеих resize-граней; interaction одного block не меняет геометрию остальных.

### Editing

- [ ] Body drag не может вывести item за previous/next neighbour bounds.
- [ ] Left resize не проходит за end предыдущего item.
- [ ] Right resize не проходит за start следующего item.
- [ ] Resize не может создать future end.
- [ ] Move сохраняет actual duration.
- [ ] Resize изменяет только grabbed edge.
- [ ] Любой resize ограничен minimum duration ровно 1 минута, включая изначально более короткие items.
- [ ] При move левая грань, а при resize захваченная грань соответствует той же timestamp-позиции, что и метки header.
- [ ] Для каждого editable block последовательности обеих resize-граней до упора в обоих порядках и повторных циклах не создают overlap и не двигают другие blocks.
- [ ] `Escape` отменяет gesture.
- [ ] Unchanged seconds-precision item не округляется.

### Interaction

- [ ] Hover/focus открывает details без предварительного click; уход курсора скрывает details.
- [ ] Double-click вызывает `onStart` один раз для completed item и `onStop` один раз для running item.
- [ ] Wheel modifier и keyboard zoom меняют view.
- [ ] Zoom crossing останавливается на 1 и 3 сутках и замедляется непосредственно за границей.
- [ ] Визуальные controls, grips и focus state работают без reliance только на цвет.
- [ ] Running item pulses; move/right-resize запрещены, left-resize доступен.
- [ ] Block border равен 1 CSS px; running pulse заметно отличается по brightness и halo.

### Accessibility

- [ ] Все controls доступны keyboard.
- [ ] Каждый item имеет accessible name с title, actual interval и доступными action.
- [ ] Text, borders и focus indicators соответствуют WCAG AA.
- [ ] Reduced motion отключает pulse и animated preview transitions.

---

## 14. Обязательный тест-план для реализации

### Pure layout tests

1. Monotonic actual/display mapping.
2. Exactly 24-hour initial view including a non-hour-aligned start.
3. Base-cell compression и dense-cell expansion.
4. Одна visual row на каждый `rowId` для sequential и actual-overlap fixtures.
5. Minimum width/gap geometry.
6. Neighbour-bounded move, left resize и right resize.
7. Snap без изменения untouched seconds values.
8. Palette uniqueness до 20 identities.
9. View bounds: 1 hour, 24 hours, 7 days, no future.

### Browser tests

1. First render geometry: 24-hour start и `now` одновременно в viewport.
2. `−`/`+`, wheel modifiers, keyboard zoom и pan.
3. Click detail contents и URL link.
4. Double-click `onStart`.
5. Direct body drag без preselection.
6. Direct left/right resize без preselection.
7. Attempted move через neighbour и attempted overlap resize: callback не получает invalid proposal.
8. Dense fixture с минимум 12 short sequential items: одна visual row на `rowId`, screenshot и DOM geometry.
9. Desktop viewport.
10. `prefers-reduced-motion` behaviour.

---

## 15. Реализационная свобода

Эта спецификация намеренно не задаёт:

- framework;
- renderer или DOM structure;
- конкретную layout algorithm;
- источник items;
- persistence mechanism;
- конкретную palette;
- container, page или product, в котором компонент будет использован.

Любая реализация приемлема, если выполняет публичный контракт, все interaction constraints и acceptance criteria этого документа.

---

## 16. Рекомендуемая техническая форма

Рекомендуемая реализация — **vanilla JavaScript**, без обязательного React runtime и без готовой timeline-библиотеки.

Причины:

1. Компонент должен оставаться переносимым UI-элементом, не связанным с конкретным приложением или framework.
2. Ключевая логика — elastic display-scale, row-local placement, neighbour bounds и pointer interaction — всё равно является собственной логикой компонента; готовая линейная timeline-библиотека её не заменяет.
3. Browser-native APIs достаточны для требований этой спецификации: DOM, Pointer Events, pointer capture, `ResizeObserver`, native scroll, wheel events, keyboard events и `requestAnimationFrame`.
4. Чистые layout-модули можно тестировать без DOM; interaction и editor — отдельно в browser tests.
5. Интеграция в приложение сводится к тонкому adapter layer: преобразовать records в `TimelineItem` и обработать public callbacks.

### 16.1 Рекомендуемая структура модулей

```text
src/timeline/
  scale.js         // actual ↔ display mapping и elastic calendar cells
  layout.js        // одна строка, minimum widths, gaps, palette
  constraints.js   // neighbour bounds для move и resize
  interaction.js   // pointer capture, drag, resize, zoom, keyboard
  editor.js        // DOM renderer и публичный компонентный API
  editor.css       // изолированные стили компонента
```

Эти модули не должны импортировать код продукта, storage, networking, browser-extension APIs или доменную модель владельца.

### 16.2 Рекомендуемый public API

Компонент может экспортироваться как framework-neutral factory:

```js
const timeline = createElasticTimeline(container, {
  items,
  now,
  onSelect,
  onStart,
  onEditPreview,
  onEditCommit,
  onViewChange,
})

// При authoritative update:
timeline.update({ items, now })

// При удалении контейнера:
timeline.destroy()
```

`createElasticTimeline` создаёт DOM только внутри переданного `container`. `destroy()` обязан снять event listeners, отменить animation frames, освободить pointer capture при необходимости и не оставить глобальных обработчиков.

Web Component допускается как дополнительная обёртка, но не является обязательной частью реализации. React/Vue/Svelte adapter также может быть добавлен отдельно и не должен становиться зависимостью базового компонента.
