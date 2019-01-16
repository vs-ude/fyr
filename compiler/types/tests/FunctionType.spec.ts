import { expect } from 'chai'

import * as ft from '../FunctionType'

describe('FunctionType', () => {
    it("isAsync() should return false", () => {
        var instance = new ft.FunctionType()
        expect(instance.isAsync).to.be.false

    })
})
