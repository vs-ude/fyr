import { expect } from 'chai'

import * as g from '../GenericParameter'

describe('GenericParameter', () => {
    it("toTypeCodeString() should return an error", () => {
        var instance = new g.GenericParameter()
        expect(instance.toTypeCodeString).to.throw(Error)
    })
})
