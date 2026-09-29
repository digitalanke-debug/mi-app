import { demoProvider } from './demoProvider.js'
import { evolutionProvider } from './evolutionProvider.js'

export function providerFor(inst) {
  return inst.provider === 'evolution' ? evolutionProvider : demoProvider
}
