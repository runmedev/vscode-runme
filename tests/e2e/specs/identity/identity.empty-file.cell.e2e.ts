import { runIdentityTests } from './identity.shared.js'

describe('Test suite: Empty file with setting Cell only (3)', () => {
  runIdentityTests({
    lifecycleSetting: 'Cell',
    fixtureFile: '/tests/fixtures/identity/empty-file.md',
    expectedOutput: '',
  })
})
