import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Cell with existing identity and setting Cell only (3)', () => {
  runIdentityTests({
    lifecycleSetting: 'Cell',
    fixtureFile: '/tests/fixtures/identity/existing-cell-id.md',
    cellSelector: 'console.log("Hello via Shebang")',
    expectedOutput: `
      ## Existing ID

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"id":"01HER3GA0RQKJETKK5X5PPRTB4"}
      console.log("Hello via Shebang")

      \`\`\`

      `,
  })
})
