import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Document with existent identity and setting Cell only (3)',
  lifecycleSetting: 'Cell',
  fixtureFile: '/tests/fixtures/identity/existent-doc-id.md',
  cellSelector: 'console.log("Run scripts via Shebang!")',
  expectedOutput: `---
      foo:
        bar: baz
      runme:
        id: 01HEJKW175Z0SYY4SJCA86J0TF
        version: v3
      ---

      ## Document with id

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"name":"foo"}
      console.log("Run scripts via Shebang!")

      \`\`\`

      `,
  revertFile: 'existent-doc-id.md',
})
