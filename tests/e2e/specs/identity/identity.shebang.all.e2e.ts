import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Shebang with setting All (1)',
  lifecycleSetting: 'All',
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

      \`\`\`js {"id":"01HEXJ9KWG7BYSFYCNKVF0VWR6","name":"foo"}
      console.log("Scenario 1: Run scripts via Shebang!")

      \`\`\`

      `,
  revertFile: 'shebang.md',
})
