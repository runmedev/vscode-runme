import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Empty file with setting None (0)',
  lifecycleSetting: 'None',
  fixtureFile: '/tests/fixtures/identity/empty-file.md',
  expectedOutput: '',
  revertFile: 'empty-file.md',
  assertOptions: { strict: true },
})
