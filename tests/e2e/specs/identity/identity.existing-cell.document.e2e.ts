import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Cell with existing identity and setting Document (2)', () => {
  runIdentityTests({
    lifecycleSetting: 'Doc',
    fixtureFile: '/tests/fixtures/identity/existing-cell-id.md',
    cellSelector: 'console.log("Hello via Shebang")',
    expectedOutput: `---
      runme:
        id: 01HEXJ9KWG7BYSFYCNKSRE4JZR
        version: v3
      ---

      ## Existing ID

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js
      console.log("Hello via Shebang")

      \`\`\`

      `,
  })
})
