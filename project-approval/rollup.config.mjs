import replace from '@rollup/plugin-replace'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = dirname(fileURLToPath(import.meta.url))
const config = load(readFileSync(join(root, 'config', 'plugin.yaml'), 'utf8'))
const version = config?.service?.version ?? ''

export default function defineRollupConfig(input) {
  input.plugins = [
    {
      name: 'project-typescript-transpile',
      transform(code, id) {
        if (!id.endsWith('.ts') || id.includes('node_modules')) return null
        return { code: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, esModuleInterop: true }, fileName: id }).outputText, map: null }
      },
    },
    replace({ preventAssignment: true, 'process.env.VERSION': JSON.stringify(version) }),
    ...(input.plugins || []),
  ]
  return input
}
