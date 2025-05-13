import { runIdentityTests } from './identity.shared'

describe('Test suite: Shebang with setting None (0)', () => {
  runIdentityTests({
    lifecycleSetting: 'None',
    fixtureFile: '/tests/fixtures/identity/shebang.md',
    cellSelector: 'console.log("Scenario 1: Run scripts via Shebang!")',
    expectedOutput: `
      ## Shebang
      Example file used as part of the end to end suite

      ## Scenario 1

      \`\`\`js {"name":"foo"}
      console.log("Scenario 1: Run scripts via Shebang!")

      \`\`\`

      ## Scenario 2

      \`\`\`js {"id":"01HY444G8B44DF0DSGVRQ299QV"}
      console.log("Scenario 2: Run scripts via Shebang!")

      \`\`\`

      ## Scenario 3

      \`\`\`js
      console.log("Scenario 3: Run scripts via Shebang!")

      \`\`\`
      `,
    revertFile: 'shebang.md',
    assertOptions: { strict: true },
  })
})
