import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Cell with existent identity and setting None (0)', () => {
  runIdentityTests({
    lifecycleSetting: 'None',
    fixtureFile: '/tests/fixtures/identity/existent-cell-id.md',
    cellSelector: 'console.log("Run scripts via Shebang!")',
    expectedOutput: `---
      foo:
        bar: baz
      runme:
        id: 01HEJKW1A2QKJQJQJQJQJQJQJQ
        version: v3
      ---

      ## Cell with id

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"name":"foo"}
      console.log("Run scripts via Shebang!")

      \`\`\`

      `,
    revertFile: 'existent-cell-id.md',
    assertOptions: { strict: true },
  })
})
