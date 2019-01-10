import { expect } from 'chai'

import { GenericParameter } from '../GenericParameter'

describe('GenericParameter', () => {
    var g = new GenericParameter()
    it("toTypeCodeString() should return an error", () => {
        expect(g.toTypeCodeString).to.throw(Error)
    })
})
