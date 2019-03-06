import { expect } from 'chai'
import * as m from 'ts-mockito'

import { ObjectLiteralType, BasicType } from '../'

describe('empty ObjectLiteralType', () => {
    let instance: ObjectLiteralType

    before(() => {
        instance = new ObjectLiteralType(null)
    })

    it('toString()', () => {
        expect(() => instance.toString()).to.throw(/Cannot read/)
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw('Implementation error')
    })
})

describe('string, bool ObjectLiteralType', () => {
    let instance: ObjectLiteralType
    let types: Map<string, BasicType>
    let typeOne: BasicType
    let typeTwo: BasicType

    before(() => {
        types = new Map<string, BasicType>()
        typeOne = new BasicType('int')
        typeTwo = new BasicType('bool')

        types.set('one', typeOne)
        types.set('two', typeTwo)
        instance = new ObjectLiteralType(types)
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('literal{one: int,two: bool}')
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw('Implementation error')
    })
})
