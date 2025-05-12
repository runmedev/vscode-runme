import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Cell with existent identity and setting cell only (3)',
  lifecycleSetting: 'Cell',
  fixtureFile: '/tests/fixtures/identity/existent-cell-id.md',
  cellSelector: 'console.log("Hello via Shebang")',
  expectedOutput: `
      ## Existent ID
      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"id":"01HER3GA0RQKJETKK5X5PPRTB4"}
      console.log("Hello via Shebang")

      \`\`\`

      `,
  revertFile: 'existent-cell-id.md',
})
