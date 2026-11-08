import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Generator, getConfig } from '@tanstack/router-generator'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const generator = new Generator({ config: getConfig({}, root), root })

await generator.run()
