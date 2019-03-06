import { expect } from 'chai'
import * as m from 'ts-mockito'

import { ArrayLiteralType, BasicType } from '../'

describe('empty ArrayLiteralType', () => {
    let instance: ArrayLiteralType

    before(() => {
        instance = new ArrayLiteralType([])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('literal[]')
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw('Implementation error')
    })
})

describe('filled ArrayLiteralType', () => {
    let instance: ArrayLiteralType
    let item1: BasicType
    let item2: BasicType

    before(() => {
        item1 = new BasicType('byte')
        item2 = new BasicType('int')
        instance = new ArrayLiteralType([item1, item2])
    })

    it('toString()', () => {
        expect(instance.toString()).to.equal('literal[byte,int]')
    })

    it('toTypeCodeString()', () => {
        expect(() => instance.toTypeCodeString()).to.throw('Implementation error')
    })
})
