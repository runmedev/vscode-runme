import { runIdentityTestSuite } from '../../helpers/identity.shared'

runIdentityTestSuite({
  suiteName: 'Test suite: Empty file with setting Document (2)',
  lifecycleSetting: 'Doc',
  fixtureFile: '/tests/fixtures/identity/empty-file.md',
  expectedOutput: '',
  revertFile: 'empty-file.md',
})
