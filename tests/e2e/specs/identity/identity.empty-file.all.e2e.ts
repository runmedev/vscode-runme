import { runIdentityTests } from './identity.shared'

describe('Test suite: Empty file with setting All (1)', () => {
  runIdentityTests({
    lifecycleSetting: 'All',
    fixtureFile: '/tests/fixtures/identity/empty-file.md',
    expectedOutput: '',
    revertFile: 'empty-file.md',
  })
})
