import react from '@vitejs/plugin-react'

/**
 * The React Compiler transform the app builds use, for Vitest, so tests run
 * compiled output. Only the compiler step is taken from the React plugin: the
 * rest of it pins the JSX runtime to `automatic`, which makes oxc ignore the
 * per-file `@jsx` pragma the Slate fixtures need. Test files stay out for the
 * same reason.
 */
export function reactCompiler() {
  return react({ compiler: true, exclude: [/\.test\.tsx?$/, /\/node_modules\//] }).filter(
    (plugin) => 'name' in plugin && plugin.name === 'vite:react-compiler',
  )
}
