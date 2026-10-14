import { demoProvider } from './demoProvider.js'
import { evolutionProvider } from './evolutionProvider.js'
import { metaProvider } from './metaProvider.js'

export { publicInstance } from './public.js'

export function providerFor(inst) {
  if (inst.provider === 'meta') return metaProvider
  return inst.provider === 'evolution' ? evolutionProvider : demoProvider
}
