import assert from 'node:assert/strict'
import test from 'node:test'
import { readMachines, validGatewayUrl } from '../src/machines.ts'

test('accepts HTTPS gateway URLs and rejects embedded credentials or unsafe schemes', () => {
  assert.equal(validGatewayUrl('https://rdp.example/guacamole/#/client/1'), true)
  assert.equal(validGatewayUrl('/guacamole/#/client/1'), true)
  assert.equal(validGatewayUrl('//evil.example/'), false)
  assert.equal(validGatewayUrl('https://user:pass@rdp.example/'), false)
  assert.equal(validGatewayUrl('javascript:alert(1)'), false)
  assert.equal(validGatewayUrl('http://rdp.example/'), false)
})

test('loads only valid machine entries', () => {
  const storage = { getItem: () => JSON.stringify([
    { id: '1', name: '示例工作站', url: 'https://rdp.example/guacamole/#/client/1' },
    { id: '2', name: 'bad', url: 'javascript:alert(1)' },
  ]) }
  assert.deepEqual(readMachines(storage), [{ id: '1', name: '示例工作站', url: 'https://rdp.example/guacamole/#/client/1' }])
})
