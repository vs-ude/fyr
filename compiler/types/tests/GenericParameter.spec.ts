import { expect } from 'chai'

import { GenericParameter } from '../'

describe('GenericParameter', () => {
    it("toTypeCodeString() should return an error", () => {
        var instance = new GenericParameter()
        expect(() => instance.toTypeCodeString()).to.throw(Error)
    })
})
