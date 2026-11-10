import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AssignmentEventSchema } from '@siriusx/contracts/executor'
import { SCENARIOS, runScenario } from '../src/scenarios.ts'

describe('BG1 scenario runner', () => {
  for (const name of Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>) {
    it(`runs ${name} and validates every contract event`, async () => {
      const result = await runScenario(name)
      expect(result.result).toBe('pass')
      for (const event of result.events) expect(() => AssignmentEventSchema.parse(event)).not.toThrow()
    })
  }

  it('keeps the fake executor free of process, network and filesystem execution', async () => {
    const source = await readFile(new URL('../src/fake-executor.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/node:child_process|node:net|node:http|node:fs|spawn\(|exec\(|fetch\(/u)
  })
})
