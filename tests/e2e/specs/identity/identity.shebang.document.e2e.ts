import { runIdentityTestSuite } from '../../helpers/identity.shared.js'

runIdentityTestSuite({
  suiteName: 'Test suite: Shebang with setting Document only (2)',
  lifecycleSetting: 'Doc',
  fixtureFile: '/tests/fixtures/identity/shebang.md',
  cellSelector: 'console.log("Scenario 1: Run scripts via Shebang!")',
  expectedOutput: `---
      runme:
        id: 01HEXJ9KWG7BYSFYCNKSRE4JZR
        version: v3
      ---

      ## Shebang
      Example file used as part of the end to end suite

      ## Scenario 1

      \`\`\`js {"name":"foo"}
      console.log("Scenario 1: Run scripts via Shebang!")

      \`\`\`

      `,
  revertFile: 'shebang.md',
})
