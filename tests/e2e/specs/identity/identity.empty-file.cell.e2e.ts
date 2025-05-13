import { runIdentityTests } from './identity.shared'

describe('Test suite: Empty file with setting Cell only (3)', () => {
  runIdentityTests({
    lifecycleSetting: 'Cell',
    fixtureFile: '/tests/fixtures/identity/empty-file.md',
    expectedOutput: '',
    revertFile: 'empty-file.md',
  })
})
