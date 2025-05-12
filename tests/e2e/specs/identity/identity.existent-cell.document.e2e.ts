import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Cell with existent identity and setting document only (2)',
  lifecycleSetting: 'Doc',
  fixtureFile: '/tests/fixtures/identity/existent-cell-id.md',
  cellSelector: 'console.log("Hello via Shebang")',
  expectedOutput: `
      ---
      runme:
        id: 01HEXJ9KWG7BYSFYCNKSRE4JZR
        version: v3
      ---

      ## Existent ID
      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js
      console.log("Hello via Shebang")
      \`\`\`

      `,
  revertFile: 'existent-cell-id.md',
})
