import { describe, it, before, after } from 'mocha'
import sinon from 'sinon'
import assert from 'assert'

function testModule (options) {
  describe(options.name, () => {
    for (const testCase of options.cases) {
      testModuleCase(testCase)
    }
  })
}

function testModuleCase (testCase) {
  describe(testCase.name, () => {
    before(async () => {
      if (testCase.stub) {
        await testCase.stub()
      }
    })
    after(() => { sinon.restore() })
    it(`expect error: ${testCase.error || false}`, async () => {
      let hasError = false
      try {
        await testCase.run()
      } catch (e) {
        if (!testCase.error) {
          console.error(e)
        }
        hasError = true
      }
      assert.equal(hasError, testCase.error || false)
    })
  })
}

export const TestCommon = {
  testModule
}
