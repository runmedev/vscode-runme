import { runIdentityTests } from './identity.shared'

describe('Test suite: Empty file with setting Document (2)', () => {
  runIdentityTests({
    lifecycleSetting: 'Doc',
    fixtureFile: '/tests/fixtures/identity/empty-file.md',
    expectedOutput: '',
    revertFile: 'empty-file.md',
  })
})
