import { runIdentityTests } from './identity.shared'

describe('Test suite: Shebang with setting Cell only (3)', () => {
  runIdentityTests({
    lifecycleSetting: 'Cell',
    fixtureFile: '/tests/fixtures/identity/shebang.md',
    cellSelector: 'console.log("Scenario 1: Run scripts via Shebang!")',
    expectedOutput: `
      ## Shebang
      Example file used as part of the end to end suite

      ## Scenario 1

      \`\`\`js {"name":"foo","id":"01HEXJ9KWG7BYSFYCNKVF0VWR6"}
      console.log("Scenario 1: Run scripts via Shebang!")

      \`\`\`

      `,
    revertFile: 'shebang.md',
  })
})
