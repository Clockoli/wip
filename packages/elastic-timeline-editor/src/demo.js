import './demo.css'
import { createElasticTimeline } from './timeline/index.js'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const now = new Date(2026, 7, 31, 17, 0, 0, 0).getTime()
const at = (hours, minutes = 0, seconds = 0) => {
  const date = new Date(now)
  date.setHours(hours, minutes, seconds, 0)
  return date.getTime()
}

let items = [
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `dense-${String(index + 1).padStart(2, '0')}`,
    title: `Короткая ${index + 1}`,
    startedAt: at(10, 5) + index * 4 * MINUTE,
    endedAt: at(10, 5) + index * 4 * MINUTE + 5 * SECOND,
    isEditable: true,
  })),
  {
    id: 'overlap-01',
    title: 'Историческое пересечение A',
    startedAt: at(12, 0),
    endedAt: at(12, 20),
    isEditable: true,
  },
  {
    id: 'overlap-02',
    title: 'Историческое пересечение B',
    startedAt: at(12, 20, 1),
    endedAt: at(12, 45),
    isEditable: true,
  },
  {
    id: 'editable-previous',
    title: 'Предыдущая задача',
    startedAt: at(14, 0),
    endedAt: at(14, 20),
    isEditable: true,
  },
  {
    id: 'editable-main',
    title: 'Редактируемая задача',
    url: 'https://example.test/tasks/editable-main?full=true',
    startedAt: at(14, 30, 17),
    endedAt: at(14, 45, 29),
    isEditable: true,
  },
  {
    id: 'editable-next',
    title: 'Следующая задача',
    startedAt: at(15, 0),
    endedAt: at(15, 20),
    isEditable: true,
  },
  {
    id: 'running',
    title: 'Выполняется сейчас',
    startedAt: at(16, 20),
    endedAt: null,
    isRunning: true,
  },
].map((item) => ({
  ...item,
  rowId: item.id.startsWith('dense-') ? 'short' : 'main',
}))

const events = []
function emit(message) {
  events.push(message)
}

const timeline = createElasticTimeline(document.querySelector('#timeline'), {
  items,
  rows: [
    { id: 'short', title: 'Короткие задачи' },
    { id: 'main', title: 'Основные задачи' },
  ],
  now,
  // The demo contains five-second tasks, so use a one-second snap. The
  // standalone component still defaults to one minute when omitted.
  snapMs: SECOND,
  onSelect(item) {
    emit(`select:${item.id}`)
  },
  onStart(item) {
    emit(`start:${item.id}`)
    items = items.map((candidate) => {
      if (candidate.id === item.id) {
        return { ...candidate, startedAt: now - MINUTE, endedAt: null, isRunning: true }
      }
      if (candidate.isRunning) {
        return { ...candidate, endedAt: now, isRunning: false }
      }
      return candidate
    })
    window.__DEMO_ITEMS__ = items
    timeline.update({ items })
  },
  onStop(item) {
    emit(`stop:${item.id}`)
  },
  onEditPreview(edit) {
    emit(`preview:${edit.kind}:${edit.id}:${edit.startedAt}:${edit.endedAt}`)
  },
  onEditCommit(edit) {
    emit(`commit:${edit.kind}:${edit.id}:${edit.startedAt}:${edit.endedAt}`)
    items = items.map((item) => item.id === edit.id
      ? {
          ...item,
          startedAt: edit.startedAt,
          endedAt: item.isRunning ? null : edit.endedAt,
        }
      : item)
    window.__DEMO_ITEMS__ = items
    timeline.update({ items })
  },
  onEditCancel(item) {
    emit(`cancel:${item.id}`)
  },
  onViewChange(nextView) {
    emit(`view:${nextView.start}:${nextView.end}`)
  },
})

window.__DEMO_NOW__ = now
window.__DEMO_ITEMS__ = items
window.__DEMO_EVENTS__ = events
window.__TIMELINE__ = timeline
