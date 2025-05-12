import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Empty file with setting All (1)',
  lifecycleSetting: 'All',
  fixtureFile: '/tests/fixtures/identity/empty-file.md',
  expectedOutput: '',
  revertFile: 'empty-file.md',
})
