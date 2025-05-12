import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Cell with existent identity and setting None (0)',
  lifecycleSetting: 'None',
  fixtureFile: '/tests/fixtures/identity/existent-cell-id.md',
  cellSelector: 'console.log("Hello via Shebang")',
  expectedOutput: `
      ## Existent ID
      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js
      console.log("Hello via Shebang")

      \`\`\`

      `,
  revertFile: 'existent-cell-id.md',
  assertOptions: { strict: true },
})
