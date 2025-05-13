import { runIdentityTests } from './identity.shared'

describe('Test suite: Empty file with setting None (0)', () => {
  runIdentityTests({
    lifecycleSetting: 'None',
    fixtureFile: '/tests/fixtures/identity/empty-file.md',
    expectedOutput: '',
    revertFile: 'empty-file.md',
    assertOptions: { strict: true },
  })
})
