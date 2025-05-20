import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Cell with existing identity and setting None (0)', () => {
  runIdentityTests({
    lifecycleSetting: 'None',
    fixtureFile: '/tests/fixtures/identity/existing-cell-id.md',
    cellSelector: 'console.log("Hello via Shebang")',
    expectedOutput: `
      ## Existing ID

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js
      console.log("Hello via Shebang")

      \`\`\`

      `,
    revertFile: 'existing-cell-id.md',
    assertOptions: { strict: true },
  })
})
