import { expect } from 'chai'

import { FunctionType } from '../'

describe('FunctionType', () => {
    it("isAsync() should return false", () => {
        var instance = new FunctionType()
        expect(instance.isAsync).to.be.false
    })
})
