import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Document with existing identity and setting Document (2)', () => {
  runIdentityTests({
    lifecycleSetting: 'Doc',
    fixtureFile: '/tests/fixtures/identity/existing-doc-id.md',
    cellSelector: 'console.log("Run scripts via Shebang!")',
    expectedOutput: `---
      foo:
        bar: baz
      runme:
        id: 01HEJKW175Z0SYY4SJCA86J0TF
        version: v3
      ---

      ## Document with id

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"name":"foo"}
      console.log("Run scripts via Shebang!")

      \`\`\`

      `,
  })
})
