import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Cell with existent identity and setting All (1)',
  lifecycleSetting: 'All',
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

      \`\`\`js {"id":"01HER3GA0RQKJETKK5X5PPRTB4"}
      console.log("Hello via Shebang")

      \`\`\`

      `,
  revertFile: 'existent-cell-id.md',
})
