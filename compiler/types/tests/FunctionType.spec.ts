import { expect } from 'chai'
import * as m from 'ts-mockito'

import { FunctionType, Type } from '../'

describe('empty FunctionType', () => {
    let instance: FunctionType

    before(() => {
        instance = new FunctionType()
    })

    it('toString() ', () => {
        expect(instance.toString()).to.equal("() => undefined")
    })

    it("isAsync() should return false", () => {
        expect(instance.isAsync()).to.equal(false)
    })
})

describe('filled FunctionType', () => {
    let instance: FunctionType

    before(() => {
        const returnType: Type = m.mock(Type)
        m.when(returnType.toString).thenReturn(() => 'void')
        instance = new FunctionType()

        instance.returnType = m.instance(returnType)
    })

    it('toString() ', () => {
        expect(instance.toString()).to.equal("() => void")
    })

    it("isAsync() should return false", () => {
        expect(instance.isAsync()).to.equal(false)
    })
})
