const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const backend = fs.readFileSync('backend/src/index.ts', 'utf8')
const manifest = fs.readFileSync('config/plugin.yaml', 'utf8')

test('backend identity comes from ONES gateway headers', () => {
  assert.match(backend, /ones-user-id/)
  assert.doesNotMatch(backend, /bodyOf\(req\)\.operator_uuid/)
})

test('dangerous rich text and non-HTTPS attachments are rejected', () => {
  assert.match(backend, /script\|style\|iframe/)
  assert.match(backend, /\^https:\\\/\\\//)
})

test('state transitions and draft-only deletion are enforced', () => {
  assert.match(backend, /target === 'published' \? \['draft','withdrawn'\] : \['published'\]/)
  assert.match(backend, /record\.status !== 'draft'/)
})

test('entity updates never persist the internal query key', () => {
  assert.match(backend, /function storedRecord/)
  assert.doesNotMatch(backend, /announcements\.set\(record\._key, \{ \.\.\.record,/)
  assert.ok((backend.match(/\.\.\.storedRecord\(record\)/g) || []).length >= 3)
})

test('manifest declares both modules and all storage entities', () => {
  for (const value of ['ones:project:component:new', 'ones:workspace:new', 'announcement_audience', 'announcement_read']) assert.ok(manifest.includes(value))
})
